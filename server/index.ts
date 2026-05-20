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
  userId: string;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.split("=");
    if (name && rest.length > 0) {
      cookies[name.trim()] = rest.join("=").trim();
    }
  });
  return cookies;
}

async function getUserIdFromSession(req: IncomingMessage): Promise<string | null> {
  const cookieHeader = req.headers.cookie;
  const url = req.url ? new URL(req.url, "http://localhost") : null;
  const queryToken = url?.searchParams.get("token");
  const path = url?.pathname || "unknown";

  logger.debug(`[Auth] getUserIdFromSession called for ${path}`);
  logger.debug(`[Auth] Cookie header present: ${!!cookieHeader}`);
  logger.debug(`[Auth] Cookie header value: ${cookieHeader?.substring(0, 200)}`);
  logger.debug(`[Auth] Query token present: ${!!queryToken}`);

  let sessionToken: string | null = null;

  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const cookieKeys = Object.keys(cookies);
    logger.debug(`[Auth] Cookies found: ${cookieKeys.join(", ")}`);
    sessionToken = 
      cookies["authjs.session-token"] || 
      cookies["next-auth.session-token"] || 
      cookies["__Secure-next-auth.session-token"] || 
      cookies["__Host-next-auth.session-token"] || 
      null;
    logger.debug(`[Auth] Cookie session token found: ${!!sessionToken}`);
  }

  if (!sessionToken && queryToken) {
    sessionToken = queryToken;
    logger.debug(`[Auth] Using query token as fallback`);
  }

  if (!sessionToken) {
    logger.warn(`[Auth] No session token found for ${path}`);
    return null;
  }

  const tokenPreview = sessionToken.length > 20 ? sessionToken.substring(0, 20) + "..." : sessionToken;
  logger.debug(`[Auth] Token preview: ${tokenPreview}`);

  try {
    const session = await prisma.session.findUnique({
      where: { sessionToken },
      select: { userId: true },
    });
    if (!session) {
      logger.warn(`[Auth] Session not found in DB for token ${tokenPreview}`);
      return null;
    }
    logger.info(`[Auth] Valid session found, userId: ${session.userId}`);
    return session.userId;
  } catch (err) {
    logger.error(`[Auth] DB error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function loadConnection(connId: number, userId?: string) {
  let row: ConnectionRow | null;
  try {
    row = (await prisma.connection.findFirst({
      where: userId ? { id: connId, userId } : { id: connId },
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

  const userId = await getUserIdFromSession(req);
  if (!userId) {
    logger.warn(`[WS] Connection rejected: no valid session`);
    ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);
  const windowId = u.searchParams.get("windowId") || "";

  logger.info(`[WS] New SSH connection attempt, connectionId: ${connId}, windowId: ${windowId}, userId: ${userId}`);

  if (!connId) {
    logger.warn(`[WS] Connection rejected: missing connectionId`);
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  try {
    const connection = await loadConnection(connId, userId);
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
