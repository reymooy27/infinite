#!/usr/bin/env node
/**
 * Infinite Agent — dials back to the Fly server and proxies SSH connections
 * Usage: node index.js --token=<token> --server=wss://infinite-server.fly.dev
 */
import { WebSocket } from "ws";
import { Client as SSHClient } from "ssh2";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    token: { type: "string" },
    server: { type: "string", default: "wss://infinite-server.fly.dev" },
  },
});

const TOKEN = values.token || process.env.INFINITE_TOKEN;
const SERVER = values.server || process.env.INFINITE_SERVER || "wss://infinite-server.fly.dev";

if (!TOKEN) {
  console.error("Error: --token is required (or set INFINITE_TOKEN env var)");
  process.exit(1);
}

// Active SSH sessions keyed by sessionId
const sessions = new Map();

let ws;
let reconnectDelay = 2000;

function connect() {
  const url = `${SERVER}/ws/agent?token=${TOKEN}`;
  console.log(`[Agent] Connecting to ${SERVER}...`);
  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("[Agent] Connected to relay server");
    reconnectDelay = 2000;
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "connected") {
      console.log(`[Agent] Registered as agent ${msg.agentId}`);
      return;
    }

    if (msg.type === "ssh") {
      openSSHSession(msg);
      return;
    }

    if (msg.type === "data" && msg.sessionId) {
      const session = sessions.get(msg.sessionId);
      if (!session) return;
      const data = msg.encoding === "base64"
        ? Buffer.from(msg.data, "base64")
        : Buffer.from(msg.data);
      session.stream?.write(data);
      return;
    }

    if (msg.type === "resize" && msg.sessionId) {
      const session = sessions.get(msg.sessionId);
      if (!session?.stream) return;
      if (msg.cols && msg.rows) {
        session.stream.setWindow(msg.rows, msg.cols, 0, 0);
      }
      return;
    }

    if (
      (msg.type === "tmux_list_windows" || msg.type === "tmux_select_window") &&
      msg.sessionId
    ) {
      void handleTmuxMessage(msg);
      return;
    }

    if (msg.type === "ping") {
      return;
    }

    if (msg.type === "close" && msg.sessionId) {
      closeSession(msg.sessionId);
      return;
    }
  });

  ws.on("close", () => {
    console.log(`[Agent] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    sessions.forEach((_, id) => closeSession(id));
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on("error", (err) => {
    console.error("[Agent] WebSocket error:", err.message);
  });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.stream?.end();
  session.client?.end();
  sessions.delete(sessionId);
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildInitialDirectoryCommand(initialDirectory) {
  if (!initialDirectory) return "";
  return `if cd -- ${quoteShellArg(initialDirectory)}; then __infinite_bootstrap_clear=1; else __infinite_bootstrap_clear=0; fi`;
}

function buildBootstrapClearCommand(initialDirectory) {
  if (!initialDirectory) return "";
  return "if [ \"${__infinite_bootstrap_clear:-0}\" = \"1\" ]; then printf '\\033[H\\033[2J\\033[3J'; unset __infinite_bootstrap_clear; fi";
}

function buildShellBootstrap(initialDirectory) {
  const commands = [
    buildInitialDirectoryCommand(initialDirectory),
    "__infinite_emit_cwd() { printf '\\033]7;file://%s%s\\007' \"${HOSTNAME:-localhost}\" \"$PWD\"; }",
    "__infinite_emit_tmux() { printf '\\033]1338;tmux=%s;%s\\007' \"${TMUX-}\" \"${TMUX_PANE-}\"; }",
    "__infinite_emit_state() { __infinite_emit_cwd; __infinite_emit_tmux; }",
    "if [ -n \"${ZSH_VERSION-}\" ]; then",
    "  autoload -Uz add-zsh-hook >/dev/null 2>&1 || true",
    "  if command -v add-zsh-hook >/dev/null 2>&1; then",
    "    add-zsh-hook precmd __infinite_emit_state",
    "  else",
    "    precmd_functions+=(__infinite_emit_state)",
    "  fi",
    "elif [ -n \"${BASH_VERSION-}\" ]; then",
    "  case \";${PROMPT_COMMAND-};\" in",
    "    *\";__infinite_emit_state;\"*) ;;",
    "    *) PROMPT_COMMAND=\"__infinite_emit_state${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
    "  esac",
    "fi",
    "__infinite_emit_state",
    buildBootstrapClearCommand(initialDirectory),
  ].filter(Boolean);

  return `${commands.join("\n")}\r`;
}

function normalizeTmuxError(stderr, code) {
  const message = String(stderr || "").trim();
  if (code === 127 || message.includes("command not found")) {
    return {
      reason: "tmux_missing",
      message: "tmux is not installed on remote host",
    };
  }

  return {
    reason: "not_in_tmux",
    message: "Not in tmux session",
  };
}

function execSSHCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";
      let exitCode = null;
      let settled = false;

      stream.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });

      stream.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      stream.on("exit", (code) => {
        exitCode = code ?? null;
      });

      stream.on("close", (code) => {
        if (settled) return;
        settled = true;
        resolve({
          stdout,
          stderr,
          code: exitCode ?? code ?? null,
        });
      });

      stream.on("error", (streamErr) => {
        if (settled) return;
        settled = true;
        reject(streamErr);
      });
    });
  });
}

function buildTmuxCommand(tmuxEnv, tmuxPaneId, command) {
  if (!tmuxPaneId) return null;
  const socketPath = tmuxEnv?.split(",")[0]?.trim();
  const prefix = socketPath
    ? `tmux -S ${quoteShellArg(socketPath)}`
    : "tmux";
  return `${prefix} ${command}`;
}

async function listTmuxWindows(client, tmuxEnv, tmuxPaneId) {
  const tmuxCommand = (command) => buildTmuxCommand(tmuxEnv, tmuxPaneId, command);
  if (!tmuxCommand("true")) {
    return {
      ok: false,
      reason: "not_in_tmux",
      message: "Not in tmux session",
      windows: [],
    };
  }

  const delimiter = "\u001f";
  const sessionFormat = `#{session_name}${delimiter}#{window_id}`;
  const listFormat = `#{window_id}${delimiter}#{window_index}${delimiter}#{window_name}${delimiter}#{?window_active,1,0}${delimiter}#{window_panes}`;

  const sessionResult = await execSSHCommand(
    client,
    tmuxCommand(
      `display-message -p -t ${quoteShellArg(tmuxPaneId)} ${quoteShellArg(sessionFormat)}`,
    ),
  );

  if (sessionResult.code !== 0) {
    return {
      ok: false,
      ...normalizeTmuxError(sessionResult.stderr, sessionResult.code),
      windows: [],
    };
  }

  const [sessionName = "", activeWindowId = ""] = sessionResult.stdout
    .trim()
    .split(delimiter);

  const windowsResult = await execSSHCommand(
    client,
    tmuxCommand(
      `list-windows -t ${quoteShellArg(sessionName)} -F ${quoteShellArg(listFormat)}`,
    ),
  );

  if (windowsResult.code !== 0) {
    return {
      ok: false,
      reason: "tmux_error",
      message: windowsResult.stderr.trim() || "Failed to list tmux windows",
      windows: [],
    };
  }

  const windows = windowsResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = "", index = "0", name = "", isActive = "0", paneCount = "0"] = line.split(delimiter);
      return {
        id,
        index: Number.parseInt(index, 10) || 0,
        name,
        isActive: isActive === "1",
        paneCount: Number.parseInt(paneCount, 10) || 0,
      };
    });

  return {
    ok: true,
    sessionName,
    activeWindowId,
    windows,
  };
}

function resolveTmuxTarget(msg) {
  if (typeof msg.targetWindowId === "string" && /^[A-Za-z0-9@._:-]+$/.test(msg.targetWindowId)) {
    return msg.targetWindowId;
  }

  if (Number.isInteger(msg.targetWindowIndex)) {
    return String(msg.targetWindowIndex);
  }

  return null;
}

async function handleTmuxMessage(msg) {
  const session = sessions.get(msg.sessionId);
  if (!session?.client) return;

  if (msg.type === "tmux_list_windows") {
    try {
      const result = await listTmuxWindows(
        session.client,
        msg.tmuxEnv,
        msg.tmuxPaneId,
      );
      send({ type: "tmux_windows", sessionId: msg.sessionId, ...result });
    } catch (err) {
      send({
        type: "tmux_windows",
        sessionId: msg.sessionId,
        ok: false,
        reason: "tmux_error",
        message: err instanceof Error ? err.message : "Failed to list tmux windows",
        windows: [],
      });
    }
    return;
  }

  if (msg.type === "tmux_select_window") {
    const target = resolveTmuxTarget(msg);
    if (!target) {
      send({
        type: "tmux_select_result",
        sessionId: msg.sessionId,
        ok: false,
        message: "Invalid tmux window target",
      });
      return;
    }

    const command = buildTmuxCommand(
      msg.tmuxEnv,
      msg.tmuxPaneId,
      `select-window -t ${quoteShellArg(target)}`,
    );
    if (!command) {
      send({
        type: "tmux_select_result",
        sessionId: msg.sessionId,
        ok: false,
        message: "Not in tmux session",
      });
      return;
    }

    try {
      const result = await execSSHCommand(session.client, command);

      send({
        type: "tmux_select_result",
        sessionId: msg.sessionId,
        ok: result.code === 0,
        targetWindowId: target,
        ...(result.code === 0
          ? {}
          : { message: result.stderr.trim() || "Failed to switch tmux window" }),
      });
    } catch (err) {
      send({
        type: "tmux_select_result",
        sessionId: msg.sessionId,
        ok: false,
        message: err instanceof Error ? err.message : "Failed to switch tmux window",
      });
    }
  }
}

function openSSHSession(msg) {
  const {
    sessionId,
    host,
    port,
    username,
    authType,
    password,
    privateKey,
    initialDirectory,
  } = msg;
  console.log(`[Agent] Opening SSH session ${sessionId} → ${username}@${host}:${port}`);

  const client = new SSHClient();
  sessions.set(sessionId, { client, stream: null });

  const authConfig = {
    host,
    port: port || 22,
    username,
    ...(authType === "key"
      ? { privateKey: Buffer.from(privateKey) }
      : { password }),
    readyTimeout: 15000,
  };

  client.on("ready", () => {
    client.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        send({ type: "error", sessionId, message: err.message });
        closeSession(sessionId);
        return;
      }

      const session = sessions.get(sessionId);
      if (session) session.stream = stream;

      send({ type: "connected", sessionId });
      stream.write(buildShellBootstrap(initialDirectory));

      stream.on("data", (data) => {
        send({ type: "data", sessionId, data: data.toString("base64"), encoding: "base64" });
      });

      stream.stderr.on("data", (data) => {
        send({ type: "data", sessionId, data: data.toString("base64"), encoding: "base64" });
      });

      stream.on("close", () => {
        send({ type: "close", sessionId });
        closeSession(sessionId);
      });
    });
  });

  client.on("error", (err) => {
    console.error(`[Agent] SSH error for ${sessionId}:`, err.message);
    send({ type: "error", sessionId, message: err.message });
    closeSession(sessionId);
  });

  client.connect(authConfig);
}

connect();
