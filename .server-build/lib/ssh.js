import { Client } from "ssh2";
import net from "net";
import path from "path";
import { logger } from "./logger.js";
const ERR_UNHANDLED = "ERR_UNHANDLED_ERROR";
function safeSocketSend(ws, data) {
    if (!ws)
        return;
    try {
        ws.send(data);
    }
    catch { }
}
function safeSocketClose(ws) {
    if (!ws)
        return;
    try {
        ws.close();
    }
    catch { }
}
function quoteShellArg(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function buildInitialDirectoryCommand(initialDirectory) {
    if (!initialDirectory)
        return "";
    return `if cd -- ${quoteShellArg(initialDirectory)}; then printf '\\033[2K\\r\\033[1A\\033[2K\\r'; fi`;
}
function buildCwdTrackingBootstrap(initialDirectory) {
    const commands = [
        buildInitialDirectoryCommand(initialDirectory),
        "__infinite_emit_cwd() { printf '\\033]7;file://%s%s\\007' \"${HOSTNAME:-localhost}\" \"$PWD\"; }",
        "if [ -n \"${ZSH_VERSION-}\" ]; then",
        "  autoload -Uz add-zsh-hook >/dev/null 2>&1 || true",
        "  if command -v add-zsh-hook >/dev/null 2>&1; then",
        "    add-zsh-hook precmd __infinite_emit_cwd",
        "  else",
        "    precmd_functions+=(__infinite_emit_cwd)",
        "  fi",
        "elif [ -n \"${BASH_VERSION-}\" ]; then",
        "  case \";${PROMPT_COMMAND-};\" in",
        "    *\";__infinite_emit_cwd;\"*) ;;",
        "    *) PROMPT_COMMAND=\"__infinite_emit_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
        "  esac",
        "fi",
        "__infinite_emit_cwd",
    ].filter(Boolean);
    return `${commands.join("\n")}\r`;
}
const sessions = new Map();
const agentSessions = new Map();
const tunnels = new Map();
const SESSION_TIMEOUT = 1000 * 60 * 60 * 8; // 8 hours
const CHUNK_SIZE = 64 * 1024; // 64KB for file transfer chunks
const MAX_RECENT_OUTPUT_BYTES = 256 * 1024;
const activeUploads = new Map();
const activeDownloads = new Map();
function cleanupDownload(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (!download)
        return;
    activeDownloads.delete(downloadId);
    download.cleanup();
}
function appendRecentOutput(session, data) {
    session.recentOutput.push(data);
    session.recentOutputBytes += data.length;
    while (session.recentOutputBytes > MAX_RECENT_OUTPUT_BYTES &&
        session.recentOutput.length > 1) {
        const dropped = session.recentOutput.shift();
        if (!dropped)
            break;
        session.recentOutputBytes -= dropped.length;
    }
}
function replayRecentOutput(session) {
    if (!session.ws || session.recentOutput.length === 0)
        return;
    for (const chunk of session.recentOutput) {
        session.ws.send(chunk);
    }
}
function validatePrivateKey(keyStr) {
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
function getSSHConfig(connection) {
    const config = {
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
    }
    else {
        config.password = connection.password;
    }
    return config;
}
function connectSSH(connection) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const config = getSSHConfig(connection);
        conn.once("ready", () => resolve(conn));
        conn.once("error", reject);
        try {
            conn.connect(config);
        }
        catch (err) {
            reject(err);
        }
    });
}
export async function ensureLocalTunnel(connection, targetHost, targetPort) {
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
        conn.forwardOut(socket.localAddress || "127.0.0.1", socket.localPort || 0, targetHost, targetPort, (err, stream) => {
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
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address?.port) {
        server.close();
        conn.end();
        throw new Error("Failed to allocate local tunnel port");
    }
    const tunnel = {
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
function readNextChunk(sftp, handle, ws, downloadId, fileSize, position) {
    const buffer = Buffer.alloc(CHUNK_SIZE);
    sftp.read(handle, buffer, 0, CHUNK_SIZE, position, (err, bytesRead, dataBuffer) => {
        if (err) {
            ws.send(JSON.stringify({ type: "download_error", downloadId, message: err.message }));
            cleanupDownload(downloadId);
            return;
        }
        if (bytesRead === 0) {
            ws.send(JSON.stringify({ type: "download_complete", downloadId }));
            cleanupDownload(downloadId);
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
function sanitizeRelativeUploadPath(value) {
    const normalized = path.posix.normalize(value);
    const parts = normalized
        .split("/")
        .filter((part) => part && part !== "." && part !== "..");
    if (parts.length === 0) {
        throw new Error("Invalid upload path");
    }
    return parts.join("/");
}
function buildUploadPath(msg) {
    if (!msg.treatDestAsDirectory) {
        return msg.destPath.endsWith("/")
            ? msg.destPath + msg.fileName
            : msg.destPath;
    }
    const relativePath = sanitizeRelativeUploadPath(msg.relativePath || msg.fileName);
    const basePath = msg.destPath.trim() || ".";
    return path.posix.join(basePath, relativePath);
}
function ensureRemoteDirectory(sftp, directoryPath) {
    const normalized = path.posix.normalize(directoryPath);
    const parts = normalized
        .split("/")
        .filter((part) => part && part !== ".");
    if (parts.length === 0) {
        return Promise.resolve();
    }
    const isAbsolute = normalized.startsWith("/");
    return new Promise((resolve, reject) => {
        let currentPath = isAbsolute ? "/" : "";
        const step = (index) => {
            if (index >= parts.length) {
                resolve();
                return;
            }
            currentPath = currentPath === "/"
                ? `/${parts[index]}`
                : currentPath
                    ? `${currentPath}/${parts[index]}`
                    : parts[index];
            sftp.stat(currentPath, (statErr) => {
                if (!statErr) {
                    step(index + 1);
                    return;
                }
                sftp.mkdir(currentPath, (mkdirErr) => {
                    if (mkdirErr) {
                        reject(mkdirErr);
                        return;
                    }
                    step(index + 1);
                });
            });
        };
        step(0);
    });
}
function handleUploadStart(conn, ws, msg) {
    const fullPath = buildUploadPath(msg);
    const parentDir = path.posix.dirname(fullPath);
    conn.sftp((err, sftp) => {
        if (err) {
            ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
            return;
        }
        ensureRemoteDirectory(sftp, parentDir).then(() => {
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
        }).catch((mkdirErr) => {
            ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: mkdirErr.message }));
            sftp.end();
        });
    });
}
function handleUploadChunk(ws, msg) {
    const upload = activeUploads.get(msg.uploadId);
    if (!upload)
        return;
    const decoded = Buffer.from(msg.data, "base64");
    upload.sftp.write(upload.handle, decoded, 0, decoded.length, msg.offset, (err) => {
        if (err) {
            ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
            upload.sftp.close(upload.handle, () => { });
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
function handleUploadEnd(ws, msg) {
    const upload = activeUploads.get(msg.uploadId);
    if (!upload)
        return;
    upload.sftp.close(upload.handle, (err) => {
        upload.sftp.end();
        activeUploads.delete(msg.uploadId);
        if (err) {
            ws.send(JSON.stringify({ type: "upload_error", uploadId: msg.uploadId, message: err.message }));
        }
        else {
            ws.send(JSON.stringify({ type: "upload_complete", uploadId: msg.uploadId, path: upload.filePath }));
        }
    });
}
function handleDownloadRequest(conn, ws, msg) {
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
            if (typeof stats.isDirectory === "function" && stats.isDirectory()) {
                sftp.end();
                streamDirectoryArchive(conn, ws, msg.downloadId, msg.remotePath);
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
                activeDownloads.set(msg.downloadId, {
                    fileName,
                    fileSize,
                    cleanup: () => {
                        sftp.close(handle, () => { });
                        sftp.end();
                    },
                });
                readNextChunk(sftp, handle, ws, msg.downloadId, fileSize, 0);
            });
        });
    });
}
function streamDirectoryArchive(conn, ws, downloadId, remotePath) {
    const normalizedPath = path.posix.normalize(remotePath);
    const parentDir = path.posix.dirname(normalizedPath);
    const baseName = path.posix.basename(normalizedPath);
    const archiveName = `${baseName || "download"}.tar.gz`;
    const command = `tar -C ${quoteShellArg(parentDir)} -czf - -- ${quoteShellArg(baseName)}`;
    conn.exec(command, (err, stream) => {
        if (err) {
            ws.send(JSON.stringify({ type: "download_error", downloadId, message: err.message }));
            return;
        }
        let bytesSent = 0;
        let finished = false;
        ws.send(JSON.stringify({
            type: "download_start",
            downloadId,
            fileName: archiveName,
            fileSize: 0,
            isArchive: true,
        }));
        activeDownloads.set(downloadId, {
            fileName: archiveName,
            fileSize: 0,
            cleanup: () => {
                if (!stream.destroyed) {
                    stream.close();
                }
            },
        });
        stream.on("data", (chunk) => {
            bytesSent += chunk.length;
            ws.send(JSON.stringify({
                type: "download_chunk",
                downloadId,
                data: chunk.toString("base64"),
                offset: bytesSent - chunk.length,
                total: 0,
            }));
        });
        stream.stderr.on("data", (chunk) => {
            logger.warn("[SFTP] Archive stderr", {
                downloadId,
                remotePath,
                message: chunk.toString("utf8"),
            });
        });
        stream.on("close", (code) => {
            if (finished)
                return;
            finished = true;
            cleanupDownload(downloadId);
            if (code && code !== 0) {
                ws.send(JSON.stringify({
                    type: "download_error",
                    downloadId,
                    message: `Failed to archive folder (exit ${code})`,
                }));
                return;
            }
            ws.send(JSON.stringify({ type: "download_complete", downloadId }));
        });
        stream.on("error", (streamErr) => {
            if (finished)
                return;
            finished = true;
            cleanupDownload(downloadId);
            ws.send(JSON.stringify({ type: "download_error", downloadId, message: streamErr.message }));
        });
    });
}
function handleListRequest(conn, ws, msg) {
    const requestedPath = msg.requestPath?.trim() || ".";
    conn.sftp((err, sftp) => {
        if (err) {
            ws.send(JSON.stringify({ type: "list_error", requestPath: requestedPath, message: err.message }));
            return;
        }
        sftp.realpath(requestedPath, (realErr, resolvedPath) => {
            if (realErr || !resolvedPath) {
                ws.send(JSON.stringify({
                    type: "list_error",
                    requestPath: requestedPath,
                    message: realErr?.message || "Path not found",
                }));
                sftp.end();
                return;
            }
            const currentPath = path.posix.normalize(resolvedPath);
            sftp.readdir(currentPath, (readErr, entries) => {
                if (readErr) {
                    ws.send(JSON.stringify({
                        type: "list_error",
                        requestPath: requestedPath,
                        message: readErr.message,
                    }));
                    sftp.end();
                    return;
                }
                const list = (entries || [])
                    .filter((entry) => entry.filename !== "." && entry.filename !== "..")
                    .map((entry) => {
                    const entryPath = currentPath === "/"
                        ? `/${entry.filename}`
                        : path.posix.join(currentPath, entry.filename);
                    return {
                        name: entry.filename,
                        path: entryPath,
                        isDirectory: Boolean(entry.attrs?.isDirectory?.()),
                        size: entry.attrs?.size || 0,
                    };
                })
                    .sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory)
                        return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                ws.send(JSON.stringify({
                    type: "list_response",
                    requestPath: requestedPath,
                    currentPath,
                    parentPath: currentPath === "/" ? null : path.posix.dirname(currentPath),
                    entries: list,
                }));
                sftp.end();
            });
        });
    });
}
function handleFileTransferMessage(conn, ws, msg) {
    switch (msg.type) {
        case "upload_start":
            handleUploadStart(conn, ws, msg);
            break;
        case "upload_chunk":
            handleUploadChunk(ws, msg);
            break;
        case "upload_end":
            handleUploadEnd(ws, msg);
            break;
        case "download_request":
            handleDownloadRequest(conn, ws, msg);
            break;
        case "list_request":
            handleListRequest(conn, ws, msg);
            break;
    }
}
export function createSSHSocket(connection, ws, windowId, initialDirectory) {
    if (windowId && sessions.has(windowId)) {
        const session = sessions.get(windowId);
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
        ws.on("message", (msg) => {
            try {
                const parsed = JSON.parse(msg);
                if (parsed.type === "data" && parsed.data) {
                    session.stream.write(parsed.data);
                }
                else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
                    session.stream.setWindow(parsed.rows, parsed.cols, 0, 0);
                }
                else {
                    handleFileTransferMessage(session.conn, ws, parsed);
                }
            }
            catch {
                logger.debug(`[SSH] Malformed message from session ${windowId}`);
            }
        });
        ws.on("close", () => {
            if (sessions.get(windowId) !== session)
                return;
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
    let session = null;
    let config;
    try {
        config = getSSHConfig(connection);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Invalid SSH configuration";
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
        conn.shell(shellOptions, (err, stream) => {
            if (err) {
                logger.error(`[SSH] Shell error for connection ${connection.id}`, { error: err.message });
                safeSocketSend(ws, JSON.stringify({
                    type: "error",
                    message: `Shell error: ${err.message}`,
                }));
                safeSocketClose(ws);
                return;
            }
            session = {
                conn,
                stream,
                ws,
                recentOutput: [],
                recentOutputBytes: 0,
            };
            const currentSession = session;
            if (windowId)
                sessions.set(windowId, session);
            logger.info(`[SSH] Shell stream opened for connection ${connection.id}`);
            stream.write(buildCwdTrackingBootstrap(initialDirectory));
            stream.on("data", (data) => {
                appendRecentOutput(currentSession, data);
                safeSocketSend(currentSession.ws, data);
            });
            stream.stderr.on("data", (data) => {
                appendRecentOutput(currentSession, data);
                safeSocketSend(currentSession.ws, data);
            });
            ws.on("message", (msg) => {
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed.type === "data" && parsed.data) {
                        stream.write(parsed.data);
                    }
                    else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
                        stream.setWindow(parsed.rows, parsed.cols, 0, 0);
                    }
                    else {
                        handleFileTransferMessage(conn, ws, parsed);
                    }
                }
                catch {
                    logger.debug(`[SSH] Malformed message from connection ${connection.id}`);
                }
            });
            stream.on("close", () => {
                logger.info(`[SSH] Shell stream closed for connection ${connection.id}`);
                if (!session)
                    return;
                safeSocketSend(session.ws, JSON.stringify({ type: "disconnected" }));
                safeSocketClose(session.ws);
                if (windowId)
                    sessions.delete(windowId);
            });
            stream.on("error", (streamErr) => {
                logger.error(`[SSH] Shell stream error for connection ${connection.id}`, {
                    error: streamErr.message,
                });
                safeSocketSend(session?.ws ?? ws, JSON.stringify({ type: "error", message: streamErr.message }));
                safeSocketClose(session?.ws ?? ws);
                if (windowId)
                    sessions.delete(windowId);
                conn.end();
            });
            ws.on("close", () => {
                if (windowId && sessions.get(windowId) !== session)
                    return;
                if (!session) {
                    logger.info(`[SSH] WebSocket closed before session init for connection ${connection.id}`);
                    conn.end();
                    return;
                }
                if (windowId) {
                    logger.info(`[SSH] WebSocket closed for session ${windowId}, detaching...`);
                    session.ws = undefined;
                    session.cleanupTimer = setTimeout(() => {
                        logger.info(`[SSH] Cleaning up idle session ${windowId}`);
                        stream.close();
                        conn.end();
                        sessions.delete(windowId);
                    }, SESSION_TIMEOUT);
                }
                else {
                    logger.info(`[SSH] WebSocket closed for ephemeral connection, ending...`);
                    stream.close();
                    conn.end();
                }
            });
        });
    });
    conn.on("error", (err) => {
        logger.error(`[SSH] Connection error for ${connection.id}`, {
            error: err.message,
            code: err.code
        });
        safeSocketSend(session?.ws ?? ws, JSON.stringify({ type: "error", message: err.message }));
        safeSocketClose(session?.ws ?? ws);
        if (windowId)
            sessions.delete(windowId);
    });
    conn.on("close", () => {
        logger.info(`[SSH] Connection closed for ${connection.id}`);
        safeSocketSend(session?.ws ?? ws, JSON.stringify({ type: "disconnected" }));
        safeSocketClose(session?.ws ?? ws);
        if (windowId)
            sessions.delete(windowId);
    });
    try {
        logger.debug(`[SSH] Initiating connection to ${connection.host}:${connection.port}`);
        conn.connect(config);
    }
    catch (err) {
        const error = err;
        logger.error(`[SSH] Connect failed for ${connection.id}`, {
            error: error.message,
            code: error.code
        });
        if (error.code === ERR_UNHANDLED) {
            ws.send(JSON.stringify({
                type: "error",
                message: "Invalid private key format",
            }));
        }
        else {
            ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        ws.close();
        return null;
    }
    return conn;
}
export function getAgentProxySession(windowId) {
    return agentSessions.get(windowId);
}
export function attachAgentProxySession(windowId, agentId, sessionId, ws) {
    const existing = agentSessions.get(windowId);
    if (existing) {
        if (existing.cleanupTimer) {
            clearTimeout(existing.cleanupTimer);
            existing.cleanupTimer = undefined;
        }
        existing.ws = ws;
        return existing;
    }
    const session = {
        agentId,
        sessionId,
        ws,
    };
    agentSessions.set(windowId, session);
    return session;
}
export function detachAgentProxySession(windowId) {
    const session = agentSessions.get(windowId);
    if (!session)
        return;
    session.ws = undefined;
    if (session.cleanupTimer)
        clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => {
        logger.info(`[Agent] Cleaning up idle proxied session ${windowId}`);
        session.onExpire?.();
        agentSessions.delete(windowId);
    }, SESSION_TIMEOUT);
}
export function clearAgentProxySession(windowId) {
    const session = agentSessions.get(windowId);
    if (!session)
        return;
    if (session.cleanupTimer)
        clearTimeout(session.cleanupTimer);
    agentSessions.delete(windowId);
}
export function setAgentProxySessionExpireHandler(windowId, onExpire) {
    const session = agentSessions.get(windowId);
    if (!session)
        return;
    session.onExpire = onExpire;
}
export function setAgentProxySessionHandlers(windowId, handlers) {
    const session = agentSessions.get(windowId);
    if (!session)
        return;
    session.onAgentClose = handlers.onAgentClose;
    session.onAgentMessage = handlers.onAgentMessage;
}
export function createSFTPConnection(connection, ws) {
    logger.info(`[SFTP] Connecting to ${connection.host}:${connection.port} as ${connection.username}`, {
        connectionId: connection.id,
        name: connection.name,
        authType: connection.authType,
    });
    const conn = new Client();
    let config;
    try {
        config = getSSHConfig(connection);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Invalid SSH configuration";
        ws.send(JSON.stringify({ type: "error", message }));
        ws.close();
        return null;
    }
    conn.on("ready", () => {
        logger.info(`[SFTP] Ready for connection ${connection.id}`);
        ws.send(JSON.stringify({ type: "connected" }));
        ws.on("message", (msg) => {
            try {
                const parsed = JSON.parse(msg);
                handleFileTransferMessage(conn, ws, parsed);
            }
            catch {
                logger.debug(`[SFTP] Malformed message from connection ${connection.id}`);
            }
        });
    });
    conn.on("error", (err) => {
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
    }
    catch (err) {
        const error = err;
        ws.send(JSON.stringify({ type: "error", message: error.message }));
        ws.close();
        return null;
    }
    return conn;
}
