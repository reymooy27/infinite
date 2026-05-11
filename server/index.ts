import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import type { IncomingMessage } from "http";
import { prisma } from "./lib/prisma.js";
import { decrypt } from "./lib/crypto.js";
import { createSSHSocket } from "./lib/ssh.js";
import { createBrowserSession } from "./lib/browser.js";
import { logger } from "./lib/logger.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, pingInterval: 15000, pingTimeout: 5000 });

app.use(cors());
app.use(express.json());

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
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  const sessionToken = cookies["next-auth.session-token"];
  if (!sessionToken) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { sessionToken },
      select: { userId: true },
    });
    return session?.userId || null;
  } catch {
    return null;
  }
}

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
  logger.info(`[WS] Upgrade request for ${pathname}`);

  if (pathname === "/ws/ssh" || pathname === "/ws/browser") {
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

  const userId = await getUserIdFromSession(req);
  if (!userId) {
    logger.warn(`[WS] Connection rejected: no valid session`);
    ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  if (pathname === "/ws/browser") {
    const windowId = u.searchParams.get("windowId") || "";
    logger.info(`[WS] New browser session, windowId: ${windowId}, userId: ${userId}`);
    const viewportW = parseInt(u.searchParams.get("width") || "1024", 10);
    const viewportH = parseInt(u.searchParams.get("height") || "768", 10);
    createBrowserSession(ws, viewportW, viewportH, windowId).catch((err) => {
      logger.error(`[WS] Failed to create browser session`, { error: err.message });
    });
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

  let row: ConnectionRow | null;
  try {
    row = await prisma.connection.findFirst({
      where: { id: connId, userId },
    }) as ConnectionRow | null;
  } catch (err) {
    logger.error(`[WS] Database error fetching connection ${connId}`, {
      error: err instanceof Error ? err.message : String(err)
    });
    ws.send(JSON.stringify({ type: "error", message: "Database error" }));
    ws.close();
    return;
  }

  if (!row) {
    logger.warn(`[WS] Connection rejected: connection ${connId} not found or not owned by user`);
    ws.send(JSON.stringify({ type: "error", message: "Connection not found" }));
    ws.close();
    return;
  }

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    logger.error(`[WS] Connection ${connId}: ENCRYPTION_SECRET not set`);
    ws.send(
      JSON.stringify({ type: "error", message: "ENCRYPTION_SECRET not set" }),
    );
    ws.close();
    return;
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
      error: err instanceof Error ? err.message : String(err)
    });
    ws.send(JSON.stringify({ type: "error", message: "Failed to decrypt credentials" }));
    ws.close();
    return;
  }

  logger.info(`[WS] SSH connection established: ${connection.name} (${connection.host})`);
  createSSHSocket(connection, ws as Parameters<typeof createSSHSocket>[1], windowId);
});

wss.on("error", (err) => {
  logger.error(`[WS] WebSocket server error`, { error: err.message });
});

const PORT = process.env.WS_PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server started`, { port: PORT, env: process.env.NODE_ENV || "development" });
});
