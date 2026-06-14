import { Client, ClientChannel, SFTPWrapper } from "ssh2";
import net from "net";
import type { AddressInfo } from "net";
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

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface ActiveSession {
  conn: Client;
  stream: ClientChannel;
  ws?: {
    send: (data: string | Buffer) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  };
  cleanupTimer?: ReturnType<typeof setTimeout>;
  recentOutput: Buffer[];
  recentOutputBytes: number;
}

interface AgentProxySession {
  sessionId: string;
  agentId: string;
  ws?: {
    send: (data: string | Buffer) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  };
  cleanupTimer?: ReturnType<typeof setTimeout>;
  onExpire?: () => void;
  onAgentClose?: () => void;
  onAgentMessage?: (raw: Buffer) => void;
}

interface ActiveTunnel {
  conn: Client;
  server: net.Server;
  localPort: number;
}

const sessions = new Map<string, ActiveSession>();
const agentSessions = new Map<string, AgentProxySession>();
const tunnels = new Map<string, ActiveTunnel>();
const SESSION_TIMEOUT = 1000 * 60 * 60 * 8; // 8 hours
const CHUNK_SIZE = 64 * 1024; // 64KB for file transfer chunks
const MAX_RECENT_OUTPUT_BYTES = 256 * 1024;

interface ActiveUpload {
  sftp: SFTPWrapper;
  handle: Buffer;
  filePath: string;
  bytesWritten: number;
  fileSize: number;
}

interface ActiveDownload {
  sftp: SFTPWrapper;
  handle: Buffer;
  fileName: string;
  fileSize: number;
}

const activeUploads = new Map<string, ActiveUpload>();
const activeDownloads = new Map<string, ActiveDownload>();

function appendRecentOutput(session: ActiveSession, data: Buffer) {
  session.recentOutput.push(data);
  session.recentOutputBytes += data.length;

  while (
    session.recentOutputBytes > MAX_RECENT_OUTPUT_BYTES &&
    session.recentOutput.length > 1
  ) {
    const dropped = session.recentOutput.shift();
    if (!dropped) break;
    session.recentOutputBytes -= dropped.length;
  }
}

function replayRecentOutput(session: ActiveSession) {
  if (!session.ws || session.recentOutput.length === 0) return;
  for (const chunk of session.recentOutput) {
    session.ws.send(chunk);
  }
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

function getSSHConfig(connection: SSHConnection) {
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
    keepaliveInterval: 30000,
    keepaliveCountMax: 10,
  };

  if (connection.authType === "key" && connection.privateKey) {
    const validation = validatePrivateKey(connection.privateKey);
    if (!validation.valid) {
      throw new Error(`Invalid private key: ${validation.error}`);
    }
    config.privateKey = connection.privateKey;
  } else {
    config.password = connection.password;
  }

  return config;
}

function connectSSH(connection: SSHConnection): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config = getSSHConfig(connection);

    conn.once("ready", () => resolve(conn));
    conn.once("error", reject);

    try {
      conn.connect(config);
    } catch (err) {
      reject(err);
    }
  });
}

export async function ensureLocalTunnel(
  connection: SSHConnection,
  targetHost: string,
  targetPort: number,
) {
  const key = `${connection.id}:${targetHost}:${targetPort}`;
  const existing = tunnels.get(key);
  if (existing) {
    return {
      localPort: existing.localPort,
      url: `http://127.0.0.1:${existing.localPort}`,
    };
  }

  const conn = await connectSSH(connection);
  const server = net.createServer((socket) => {
    conn.forwardOut(
      socket.localAddress || "127.0.0.1",
      socket.localPort || 0,
      targetHost,
      targetPort,
      (err, stream) => {
        if (err) {
          logger.error("[SSH] Tunnel forward error", {
            connectionId: connection.id,
            targetHost,
            targetPort,
            error: err.message,
          });
          socket.destroy(err);
          return;
        }

        socket.pipe(stream);
        stream.pipe(socket);

        stream.on("error", () => {
          socket.destroy();
        });

        socket.on("error", () => {
          stream.close();
        });
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address?.port) {
    server.close();
    conn.end();
    throw new Error("Failed to allocate local tunnel port");
  }

  const tunnel: ActiveTunnel = {
    conn,
    server,
    localPort: address.port,
  };
  tunnels.set(key, tunnel);

  conn.on("close", () => {
    tunnels.delete(key);
    server.close();
  });

  server.on("close", () => {
    tunnels.delete(key);
    conn.end();
  });

  logger.info("[SSH] Local tunnel ready", {
    connectionId: connection.id,
    targetHost,
    targetPort,
    localPort: address.port,
  });

  return {
    localPort: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function readNextChunk(
  sftp: SFTPWrapper,
  handle: Buffer,
  ws: { send: (data: string) => void },
  downloadId: string,
  fileSize: number,
  position: number,
) {
  const buffer = Buffer.alloc(CHUNK_SIZE);
  sftp.read(handle, buffer, 0, CHUNK_SIZE, position, (err, bytesRead, dataBuffer) => {
    if (err) {
      ws.send(JSON.stringify({ type: "download_error", downloadId, message: err.message }));
      sftp.close(handle, () => {});
      sftp.end();
      activeDownloads.delete(downloadId);
      return;
    }

    if (bytesRead === 0) {
      ws.send(JSON.stringify({ type: "download_complete", downloadId }));
      sftp.close(handle, () => {});
      sftp.end();
      activeDownloads.delete(downloadId);
      return;
    }

    const chunk = dataBuffer.subarray(0, bytesRead);
    ws.send(JSON.stringify({
      type: "download_chunk",
      downloadId,
      data: chunk.toString("base64"),
      offset: position,
      total: fileSize,
    }));

    readNextChunk(sftp, handle, ws, downloadId, fileSize, position + bytesRead);
  });
}

function handleUploadStart(
  conn: Client,
  ws: { send: (data: string) => void },
  msg: { uploadId: string; fileName: string; fileSize: number; destPath: string },
  windowId?: string,
) {
  const fullPath = msg.destPath.endsWith("/")
    ? msg.destPath + msg.fileName
    : msg.destPath;

  conn.sftp((err, sftp) => {
    if (err) {
      ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
      return;
    }

    sftp.open(fullPath, "w", (openErr, handle) => {
      if (openErr) {
        ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: openErr.message }));
        sftp.end();
        return;
      }

      activeUploads.set(msg.uploadId, {
        sftp,
        handle,
        filePath: fullPath,
        bytesWritten: 0,
        fileSize: msg.fileSize,
      });

      ws.send(JSON.stringify({ type: "upload_ack", uploadId: msg.uploadId }));
    });
  });
}

function handleUploadChunk(
  ws: { send: (data: string) => void },
  msg: { uploadId: string; data: string; offset: number },
) {
  const upload = activeUploads.get(msg.uploadId);
  if (!upload) return;

  const decoded = Buffer.from(msg.data, "base64");
  upload.sftp.write(upload.handle, decoded, 0, decoded.length, msg.offset, (err) => {
    if (err) {
      ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
      upload.sftp.close(upload.handle, () => {});
      upload.sftp.end();
      activeUploads.delete(msg.uploadId);
      return;
    }

    upload.bytesWritten += decoded.length;

    ws.send(JSON.stringify({
      type: "upload_progress",
      uploadId: msg.uploadId,
      bytesWritten: upload.bytesWritten,
      fileSize: upload.fileSize,
    }));
  });
}

function handleUploadEnd(
  ws: { send: (data: string) => void },
  msg: { uploadId: string },
) {
  const upload = activeUploads.get(msg.uploadId);
  if (!upload) return;

  upload.sftp.close(upload.handle, (err) => {
    upload.sftp.end();
    activeUploads.delete(msg.uploadId);

    if (err) {
      ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
    } else {
      ws.send(JSON.stringify({ type: "upload_complete", uploadId: msg.uploadId, path: upload.filePath }));
    }
  });
}

function handleDownloadRequest(
  conn: Client,
  ws: { send: (data: string) => void },
  msg: { downloadId: string; remotePath: string },
) {
  conn.sftp((err, sftp) => {
    if (err) {
      ws.send(JSON.stringify({ type: "download_error", downloadId: msg.downloadId, message: err.message }));
      return;
    }

    sftp.stat(msg.remotePath, (statErr, stats) => {
      if (statErr) {
        ws.send(JSON.stringify({ type: "download_error", downloadId: msg.downloadId, message: `File not found: ${statErr.message}` }));
        sftp.end();
        return;
      }

      sftp.open(msg.remotePath, "r", (openErr, handle) => {
        if (openErr) {
          ws.send(JSON.stringify({ type: "download_error", downloadId: msg.downloadId, message: openErr.message }));
          sftp.end();
          return;
        }

        const fileName = msg.remotePath.split("/").pop() || "download";
        const fileSize = stats.size;

        ws.send(JSON.stringify({
          type: "download_start",
          downloadId: msg.downloadId,
          fileName,
          fileSize,
        }));

        activeDownloads.set(msg.downloadId, { sftp, handle, fileName, fileSize });

        readNextChunk(sftp, handle, ws, msg.downloadId, fileSize, 0);
      });
    });
  });
}

function handleFileTransferMessage(
  conn: Client,
  ws: { send: (data: string) => void },
  msg: Record<string, unknown>,
  windowId?: string,
) {
  switch (msg.type) {
    case "upload_start":
      handleUploadStart(conn, ws, msg as { uploadId: string; fileName: string; fileSize: number; destPath: string }, windowId);
      break;
    case "upload_chunk":
      handleUploadChunk(ws, msg as { uploadId: string; data: string; offset: number });
      break;
    case "upload_end":
      handleUploadEnd(ws, msg as { uploadId: string });
      break;
    case "download_request":
      handleDownloadRequest(conn, ws, msg as { downloadId: string; remotePath: string });
      break;
  }
}

function cleanupFileTransfersForSession(_windowId?: string) {
  for (const [uploadId, upload] of Array.from(activeUploads)) {
    activeUploads.delete(uploadId);
    upload.sftp.close(upload.handle, () => {});
    upload.sftp.end();
  }
  for (const [downloadId, download] of Array.from(activeDownloads)) {
    activeDownloads.delete(downloadId);
    download.sftp.close(download.handle, () => {});
    download.sftp.end();
  }
}

export function createSSHSocket(
  connection: SSHConnection,
  ws: {
    send: (data: string | Buffer) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  },
  windowId?: string,
  initialDirectory?: string,
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
    replayRecentOutput(session);

    // Re-attach listeners
    ws.on("message", (msg: unknown) => {
      try {
        const parsed = JSON.parse(msg as string) as WebSocketMessage;
        if (parsed.type === "data" && parsed.data) {
          session.stream.write(parsed.data);
        } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          session.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
        } else {
          handleFileTransferMessage(session.conn, ws, parsed as unknown as Record<string, unknown>, windowId);
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

  let config;
  try {
    config = getSSHConfig(connection);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid SSH configuration";
    logger.warn(`[SSH] Invalid SSH config for connection ${connection.id}`, {
      error: message,
    });
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
    return null;
  }

  const initialCols = 80;
  const initialRows = 24;

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

      const session: ActiveSession = {
        conn,
        stream,
        ws,
        recentOutput: [],
        recentOutputBytes: 0,
      };
      if (windowId) sessions.set(windowId, session);

      logger.info(`[SSH] Shell stream opened for connection ${connection.id}`);

      if (initialDirectory) {
        stream.write(`cd -- ${quoteShellArg(initialDirectory)}\r`);
      }

      stream.on("data", (data: Buffer) => {
        appendRecentOutput(session, data);
        session.ws?.send(data);
      });
      stream.stderr.on("data", (data: Buffer) => {
        appendRecentOutput(session, data);
        session.ws?.send(data);
      });

      ws.on("message", (msg: unknown) => {
        try {
          const parsed = JSON.parse(msg as string) as WebSocketMessage;
          if (parsed.type === "data" && parsed.data) {
            stream.write(parsed.data);
          } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            stream.setWindow(parsed.rows, parsed.cols, 0, 0);
          } else {
            handleFileTransferMessage(conn, ws, parsed as unknown as Record<string, unknown>, windowId);
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

export function getAgentProxySession(windowId: string) {
  return agentSessions.get(windowId);
}

export function attachAgentProxySession(
  windowId: string,
  agentId: string,
  sessionId: string,
  ws: {
    send: (data: string | Buffer) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  },
) {
  const existing = agentSessions.get(windowId);
  if (existing) {
    if (existing.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
      existing.cleanupTimer = undefined;
    }
    existing.ws = ws;
    return existing;
  }

  const session: AgentProxySession = {
    agentId,
    sessionId,
    ws,
  };
  agentSessions.set(windowId, session);
  return session;
}

export function detachAgentProxySession(windowId: string) {
  const session = agentSessions.get(windowId);
  if (!session) return;

  session.ws = undefined;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    logger.info(`[Agent] Cleaning up idle proxied session ${windowId}`);
    session.onExpire?.();
    agentSessions.delete(windowId);
  }, SESSION_TIMEOUT);
}

export function clearAgentProxySession(windowId: string) {
  const session = agentSessions.get(windowId);
  if (!session) return;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  agentSessions.delete(windowId);
}

export function setAgentProxySessionExpireHandler(
  windowId: string,
  onExpire: () => void,
) {
  const session = agentSessions.get(windowId);
  if (!session) return;
  session.onExpire = onExpire;
}

export function setAgentProxySessionHandlers(
  windowId: string,
  handlers: {
    onAgentClose: () => void;
    onAgentMessage: (raw: Buffer) => void;
  },
) {
  const session = agentSessions.get(windowId);
  if (!session) return;
  session.onAgentClose = handlers.onAgentClose;
  session.onAgentMessage = handlers.onAgentMessage;
}

export function createSFTPConnection(
  connection: SSHConnection,
  ws: {
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (msg: unknown) => void) => void;
  },
) {
  logger.info(`[SFTP] Connecting to ${connection.host}:${connection.port} as ${connection.username}`, {
    connectionId: connection.id,
    name: connection.name,
    authType: connection.authType,
  });

  const conn = new Client();

  let config;
  try {
    config = getSSHConfig(connection);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid SSH configuration";
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
    return null;
  }

  conn.on("ready", () => {
    logger.info(`[SFTP] Ready for connection ${connection.id}`);
    ws.send(JSON.stringify({ type: "connected" }));

    ws.on("message", (msg: unknown) => {
      try {
        const parsed = JSON.parse(msg as string);
        handleFileTransferMessage(conn, ws, parsed as unknown as Record<string, unknown>);
      } catch {
        logger.debug(`[SFTP] Malformed message from connection ${connection.id}`);
      }
    });
  });

  conn.on("error", (err: Error & { code?: string }) => {
    logger.error(`[SFTP] Connection error for ${connection.id}`, {
      error: err.message,
      code: err.code,
    });
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  });

  ws.on("close", () => {
    logger.info(`[SFTP] WebSocket closed for connection ${connection.id}`);
    conn.end();
  });

  conn.on("close", () => {
    logger.info(`[SFTP] Connection closed for ${connection.id}`);
  });

  try {
    conn.connect(config);
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    ws.send(JSON.stringify({ type: "error", message: error.message }));
    ws.close();
    return null;
  }

  return conn;
}
