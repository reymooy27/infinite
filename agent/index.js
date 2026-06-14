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

function openSSHSession(msg) {
  const { sessionId, host, port, username, authType, password, privateKey } = msg;
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
