import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import type { IncomingMessage } from "http";
import { prisma } from "./lib/prisma.js";
import { decrypt } from "./lib/crypto.js";
import { createSSHSocket, ensureLocalTunnel } from "./lib/ssh.js";
import { logger } from "./lib/logger.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, pingInterval: 15000, pingTimeout: 5000 });

app.use(cors());
app.use(express.json());

app.post("/api/tunnels", async (req, res) => {
  const connectionId = parseInt(String(req.body?.connectionId || "0"), 10);
  const targetHost =
    typeof req.body?.targetHost === "string" && req.body.targetHost
      ? req.body.targetHost
      : "127.0.0.1";
  const targetPort = parseInt(String(req.body?.targetPort || "0"), 10);

  if (!connectionId || !targetPort) {
    res.status(400).json({ error: "Missing connectionId or targetPort" });
    return;
  }

  try {
    const connection = await loadConnection(connectionId);
    const tunnel = await ensureLocalTunnel(connection, targetHost, targetPort);
    res.json(tunnel);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create tunnel";
    logger.error("[Tunnel] Failed to create local tunnel", {
      connectionId,
      targetHost,
      targetPort,
      error: message,
    });
    res.status(500).json({ error: message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

interface ConnectionRow {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  passwordEncrypted: string | null;
  privateKeyEncrypted: string | null;
}

async function loadConnection(connId: number) {
  let row: ConnectionRow | null;
  try {
    row = (await prisma.connection.findUnique({
      where: { id: connId },
    })) as ConnectionRow | null;
  } catch (err) {
    logger.error(`[WS] Database error fetching connection ${connId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("Database error");
  }

  if (!row) {
    throw new Error("Connection not found");
  }

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET not set");
  }

  const connection: {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: "password" | "key";
    password?: string;
    privateKey?: string;
  } = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as "password" | "key",
  };

  try {
    if (row.passwordEncrypted) {
      connection.password = decrypt(row.passwordEncrypted, secret);
    }
    if (row.privateKeyEncrypted) {
      connection.privateKey = decrypt(row.privateKeyEncrypted, secret);
    }
  } catch (err) {
    logger.error(`[WS] Connection ${connId}: Failed to decrypt credentials`, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("Failed to decrypt credentials");
  }

  return connection;
}

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
  logger.info(`[WS] Upgrade request for ${pathname}`);

  if (pathname === "/ws/ssh") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    logger.warn(`[WS] Rejected upgrade for unknown path: ${pathname}`);
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const rawUrl = req.url || "";
  const u = new URL(rawUrl, "http://localhost");
  const pathname = u.pathname;

  const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);
  const windowId = u.searchParams.get("windowId") || "";

  logger.info(`[WS] New SSH connection attempt, connectionId: ${connId}, windowId: ${windowId}`);

  if (!connId) {
    logger.warn(`[WS] Connection rejected: missing connectionId`);
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  try {
    const connection = await loadConnection(connId);
    logger.info(
      `[WS] SSH connection established: ${connection.name} (${connection.host})`,
    );
    createSSHSocket(
      connection,
      ws as Parameters<typeof createSSHSocket>[1],
      windowId,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load SSH connection";
    logger.error(`[WS] Connection ${connId}: setup failed`, {
      error: message,
    });
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
});

wss.on("error", (err) => {
  logger.error(`[WS] WebSocket server error`, { error: err.message });
});

const PORT = process.env.WS_PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server started`, { port: PORT, env: process.env.NODE_ENV || "development" });
});
