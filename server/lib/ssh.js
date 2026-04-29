import { Client } from "ssh2";

const ERR_UNHANDLED = "ERR_UNHANDLED_ERROR";

function validatePrivateKey(keyStr) {
  if (!keyStr || typeof keyStr !== "string") {
    return { valid: false, error: "No key data provided" };
  }
  const trimmed = keyStr.trim();
  if (!trimmed.startsWith("-----BEGIN")) {
    return { valid: false, error: "Key does not appear to be a valid PEM-encoded private key" };
  }
  return { valid: true };
}

export function createSSHSocket(connection, ws) {
  const conn = new Client();

  const config = {
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    readyTimeout: 15000,
  };

  if (connection.authType === "key" && connection.privateKey) {
    const validation = validatePrivateKey(connection.privateKey);
    if (!validation.valid) {
      ws.send(JSON.stringify({ type: "error", message: `Invalid private key: ${validation.error}` }));
      ws.close();
      return null;
    }
    config.privateKey = connection.privateKey;
  } else {
    config.password = connection.password;
  }

  conn.on("ready", () => {
    ws.send(JSON.stringify({ type: "connected" }));

    conn.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", message: `Shell error: ${err.message}` }));
        return;
      }

      stream.on("data", (data) => {
        ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
      });

      stream.stderr.on("data", (data) => {
        ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
      });

      ws.on("message", (msg) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === "data" && parsed.data) {
            stream.write(parsed.data);
          } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          }
        } catch { /* ignore malformed messages */ }
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

  conn.on("error", (err) => {
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  });

  try {
    conn.connect(config);
  } catch (err) {
    if (err.code === ERR_UNHANDLED) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid private key format" }));
      ws.close();
      return null;
    }
    ws.send(JSON.stringify({ type: "error", message: err.message }));
    ws.close();
    return null;
  }

  return conn;
}