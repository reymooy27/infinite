import { Client, ClientChannel } from "ssh2";

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
) {
  const conn = new Client();

  const config: {
    host: string;
    port: number;
    username: string;
    readyTimeout: number;
    password?: string;
    privateKey?: string;
  } = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    readyTimeout: 15000,
  };

  if (connection.authType === "key" && connection.privateKey) {
    const validation = validatePrivateKey(connection.privateKey);
    if (!validation.valid) {
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
  // Define a temporary store for dimensions if they arrive before the shell is ready
  let initialCols = 80;
  let initialRows = 24;

  conn.on("ready", () => {
    ws.send(JSON.stringify({ type: "connected" }));
    const shellOptions = {
      term: "xterm-256color",
      cols: initialCols, // Use the latest numbers received from WS
      rows: initialRows,
    };

    conn.shell(shellOptions, (err: Error | null, stream: ClientChannel) => {
      if (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Shell error: ${err.message}`,
          }),
        );
        return;
      }

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
            console.log("setting window", parsed.cols, parsed.rows);
            stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          }
        } catch {
          /* ignore malformed messages */
        }
      });

      stream.on("close", () => {
        ws.send(JSON.stringify({ type: "disconnected" }));
        ws.close();
      });

      ws.on("close", () => {
        stream.close();
        conn.end();
      });
    });
  });

  conn.on("error", (err: Error & { code?: string }) => {
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  });

  try {
    conn.connect(config);
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    if (error.code === ERR_UNHANDLED) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid private key format",
        }),
      );
      ws.close();
      return null;
    }
    ws.send(JSON.stringify({ type: "error", message: error.message }));
    ws.close();
    return null;
  }

  return conn;
}
