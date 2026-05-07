import { Client, ClientChannel } from "ssh2";
import { logger } from "./logger.js";

const ERR_UNHANDLED = "ERR_UNHANDLED_ERROR";

interface SSHConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
}

interface WebSocketMessage {
  type: string;
  data?: string;
  cols?: number;
  rows?: number;
}

interface ActiveSession {
  conn: Client;
  stream: ClientChannel;
  ws?: {
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  };
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ActiveSession>();
const SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes

function validatePrivateKey(keyStr: string): {
  valid: boolean;
  error?: string;
} {
  if (!keyStr || typeof keyStr !== "string") {
    return { valid: false, error: "No key data provided" };
  }
  const trimmed = keyStr.trim();
  if (!trimmed.startsWith("-----BEGIN")) {
    return {
      valid: false,
      error: "Key does not appear to be a valid PEM-encoded private key",
    };
  }
  return { valid: true };
}

export function createSSHSocket(
  connection: SSHConnection,
  ws: {
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  },
  windowId?: string
) {
  if (windowId && sessions.has(windowId)) {
    const session = sessions.get(windowId)!;
    logger.info(`[SSH] Re-attaching to session ${windowId}`);

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = undefined;
    }

    // Update the session's WebSocket
    session.ws = ws;

    // Send connected status immediately
    ws.send(JSON.stringify({ type: "connected" }));

    // Re-attach listeners
    ws.on("message", (msg: unknown) => {
      try {
        const parsed = JSON.parse(msg as string) as WebSocketMessage;
        if (parsed.type === "data" && parsed.data) {
          session.stream.write(parsed.data);
        } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          session.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
        }
      } catch {
        logger.debug(`[SSH] Malformed message from session ${windowId}`);
      }
    });

    ws.on("close", () => {
      logger.info(`[SSH] WebSocket closed for session ${windowId}, detaching...`);
      session.ws = undefined;
      session.cleanupTimer = setTimeout(() => {
        logger.info(`[SSH] Cleaning up idle session ${windowId}`);
        session.stream.close();
        session.conn.end();
        sessions.delete(windowId);
      }, SESSION_TIMEOUT);
    });

    return;
  }

  logger.info(`[SSH] Connecting to ${connection.host}:${connection.port} as ${connection.username}`, {
    connectionId: connection.id,
    name: connection.name,
    authType: connection.authType,
    windowId
  });

  const conn = new Client();

  const config: {
    host: string;
    port: number;
    username: string;
    readyTimeout: number;
    keepaliveInterval?: number;
    keepaliveCountMax?: number;
    password?: string;
    privateKey?: string;
  } = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
  };

  if (connection.authType === "key" && connection.privateKey) {
    const validation = validatePrivateKey(connection.privateKey);
    if (!validation.valid) {
      logger.warn(`[SSH] Invalid private key for connection ${connection.id}`);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Invalid private key: ${validation.error}`,
        }),
      );
      ws.close();
      return null;
    }
    config.privateKey = connection.privateKey;
  } else {
    config.password = connection.password;
  }

  let initialCols = 80;
  let initialRows = 24;

  conn.on("ready", () => {
    logger.info(`[SSH] Shell ready for connection ${connection.id}`);
    ws.send(JSON.stringify({ type: "connected" }));
    const shellOptions = {
      term: "xterm-256color",
      cols: initialCols,
      rows: initialRows,
    };

    conn.shell(shellOptions, (err: Error | null, stream: ClientChannel) => {
      if (err) {
        logger.error(`[SSH] Shell error for connection ${connection.id}`, { error: err.message });
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Shell error: ${err.message}`,
          }),
        );
        return;
      }

      const session: ActiveSession = { conn, stream, ws };
      if (windowId) sessions.set(windowId, session);

      logger.info(`[SSH] Shell stream opened for connection ${connection.id}`);

      stream.on("data", (data: Buffer) => {
        session.ws?.send(
          JSON.stringify({ type: "data", data: data.toString("base64") }),
        );
      });

      stream.stderr.on("data", (data: Buffer) => {
        session.ws?.send(
          JSON.stringify({ type: "data", data: data.toString("base64") }),
        );
      });

      ws.on("message", (msg: unknown) => {
        try {
          const parsed = JSON.parse(msg as string) as WebSocketMessage;
          if (parsed.type === "data" && parsed.data) {
            stream.write(parsed.data);
          } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          }
        } catch {
          logger.debug(`[SSH] Malformed message from connection ${connection.id}`);
        }
      });

      stream.on("close", () => {
        logger.info(`[SSH] Shell stream closed for connection ${connection.id}`);
        session.ws?.send(JSON.stringify({ type: "disconnected" }));
        session.ws?.close();
        if (windowId) sessions.delete(windowId);
      });

      ws.on("close", () => {
        if (windowId) {
          logger.info(`[SSH] WebSocket closed for session ${windowId}, detaching...`);
          session.ws = undefined;
          session.cleanupTimer = setTimeout(() => {
            logger.info(`[SSH] Cleaning up idle session ${windowId}`);
            stream.close();
            conn.end();
            sessions.delete(windowId);
          }, SESSION_TIMEOUT);
        } else {
          logger.info(`[SSH] WebSocket closed for ephemeral connection, ending...`);
          stream.close();
          conn.end();
        }
      });
    });
  });

  conn.on("error", (err: Error & { code?: string }) => {
    logger.error(`[SSH] Connection error for ${connection.id}`, {
      error: err.message,
      code: err.code
    });
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  });

  conn.on("close", () => {
    logger.info(`[SSH] Connection closed for ${connection.id}`);
    if (windowId) sessions.delete(windowId);
  });

  try {
    logger.debug(`[SSH] Initiating connection to ${connection.host}:${connection.port}`);
    conn.connect(config);
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    logger.error(`[SSH] Connect failed for ${connection.id}`, {
      error: error.message,
      code: error.code
    });
    if (error.code === ERR_UNHANDLED) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid private key format",
        }),
      );
    } else {
      ws.send(JSON.stringify({ type: "error", message: error.message }));
    }
    ws.close();
    return null;
  }

  return conn;
}