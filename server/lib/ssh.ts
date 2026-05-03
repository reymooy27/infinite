import { Client, ClientChannel, ConnectConfig } from "ssh2";
import { SocksClient } from "socks";
import type { Socket as NodeSocket } from "net";
import { logger } from "./logger.js";

const ERR_UNHANDLED = "ERR_UNHANDLED_ERROR";

const SOCKS_PROXY_HOST = "127.0.0.1";
const SOCKS_PROXY_PORT = 1055;

const TS_SUBNET = /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./;

function isTailscaleIP(host: string): boolean {
  return TS_SUBNET.test(host);
}

async function createSocksSocket(
  targetHost: string,
  targetPort: number,
): Promise<NodeJS.Socket> {
  const { socket } = await SocksClient.createConnection({
    proxy: {
      host: SOCKS_PROXY_HOST,
      port: SOCKS_PROXY_PORT,
      type: 5,
    },
    command: "connect",
    destination: {
      host: targetHost,
      port: targetPort,
    },
  });
  return socket;
}

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

export async function createSSHSocket(
  connection: SSHConnection,
  ws: {
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  },
) {
  logger.info(`[SSH] Connecting to ${connection.host}:${connection.port} as ${connection.username}`, {
    connectionId: connection.id,
    name: connection.name,
    authType: connection.authType
  });

  const conn = new Client();

  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    readyTimeout: 30000,
  };

  if (isTailscaleIP(connection.host)) {
    try {
      logger.info(`[SSH] Routing ${connection.host} through Tailscale SOCKS5 proxy`);
      const socket = await createSocksSocket(connection.host, connection.port || 22);
      config.sock = socket as unknown as ConnectConfig["sock"];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[SSH] SOCKS5 proxy connection failed for ${connection.id}`, { error: msg });
      ws.send(JSON.stringify({ type: "error", message: `Tailscale proxy failed: ${msg}` }));
      ws.close();
      return null;
    }
  }

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

      logger.info(`[SSH] Shell stream opened for connection ${connection.id}`);

      stream.on("data", (data: Buffer) => {
        ws.send(
          JSON.stringify({ type: "data", data: data.toString("base64") }),
        );
      });

      stream.stderr.on("data", (data: Buffer) => {
        ws.send(
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
        ws.send(JSON.stringify({ type: "disconnected" }));
        ws.close();
      });

      ws.on("close", () => {
        logger.info(`[SSH] WebSocket closed for connection ${connection.id}`);
        stream.close();
        conn.end();
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