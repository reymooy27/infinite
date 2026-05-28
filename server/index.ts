import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { IncomingMessage } from "http";
import { prisma } from "./lib/prisma.js";
import { decrypt } from "./lib/crypto.js";
import { createSSHSocket, ensureLocalTunnel } from "./lib/ssh.js";
import { logger } from "./lib/logger.js";

const LOCAL_USER_ID = "local-user";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  pingInterval: 15000,
  pingTimeout: 5000,
});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:7890")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again later" },
});
app.use("/api", apiLimiter);

app.post("/api/tunnels", async (req, res) => {
  const userId = getUserIdFromRequest(req);

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
    const connection = await loadConnection(connectionId, userId);
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

// Per-user active SSH session tracking
const userSessions = new Map<string, Set<import("ws").WebSocket>>();
const MAX_SESSIONS_PER_USER = 5;

app.post("/api/agents/online", (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const online = ids.filter((id) => {
    const ws = agentRegistry.get(id);
    return ws && ws.readyState === 1; // OPEN
  });
  res.json({ online });
});

app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    dbOk = true;
  } catch {}
  const activeConnections = Array.from(userSessions.values()).reduce(
    (sum, s) => sum + s.size,
    0,
  );
  const status = dbOk ? "ok" : "degraded";
  res.status(dbOk ? 200 : 503).json({
    status,
    db: dbOk ? "connected" : "unreachable",
    activeConnections,
    timestamp: new Date().toISOString(),
  });
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
  agentId: string | null;
}

// Local-only mode: no auth required
function getUserIdFromRequest(_req: express.Request): string {
  return LOCAL_USER_ID;
}

function getUserIdFromSession(_req: IncomingMessage): string {
  return LOCAL_USER_ID;
}

async function loadConnection(connId: number, userId: string) {
  let row: ConnectionRow | null;
  try {
    row = (await prisma.connection.findFirst({
      where: { id: connId, userId },
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
    agentId?: string;
  } = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as "password" | "key",
    agentId: row.agentId ?? undefined,
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

// Proxy SSH traffic between browser WS and agent WS
// Protocol: agent receives {type:"ssh",sessionId,host,port,username,authType,password?,privateKey?}
// then raw binary frames are piped both ways tagged with sessionId
function proxyThroughAgent(
  browserWs: WebSocket,
  agentWs: WebSocket,
  connection: Awaited<ReturnType<typeof loadConnection>>,
  windowId: string,
) {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  logger.info(
    `[Agent] Proxying session ${sessionId} for connection ${connection.id}`,
  );

  // Tell agent to open SSH connection
  agentWs.send(
    JSON.stringify({
      type: "ssh",
      sessionId,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.authType,
      password: connection.password,
      privateKey: connection.privateKey,
      windowId,
    }),
  );

  // Browser → Agent
  browserWs.on("message", (data) => {
    if (agentWs.readyState === WebSocket.OPEN) {
      // Wrap with sessionId prefix for agent multiplexing
      if (typeof data === "string") {
        agentWs.send(JSON.stringify({ type: "data", sessionId, data }));
      } else {
        agentWs.send(
          JSON.stringify({
            type: "data",
            sessionId,
            data: Buffer.from(data as Buffer).toString("base64"),
            encoding: "base64",
          }),
        );
      }
    }
  });

  // Agent → Browser (filter by sessionId)
  const onAgentMessage = (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.sessionId !== sessionId) return;
      if (msg.type === "data") {
        const payload =
          msg.encoding === "base64"
            ? Buffer.from(msg.data, "base64")
            : msg.data;
        if (browserWs.readyState === WebSocket.OPEN) browserWs.send(payload);
      } else if (msg.type === "error" || msg.type === "close") {
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(
            JSON.stringify({ type: msg.type, message: msg.message }),
          );
          browserWs.close();
        }
      } else {
        // Forward control messages (connected, resize ack, etc.)
        if (browserWs.readyState === WebSocket.OPEN)
          browserWs.send(JSON.stringify(msg));
      }
    } catch {}
  };

  agentWs.on("message", onAgentMessage);

  browserWs.on("close", () => {
    agentWs.off("message", onAgentMessage);
    if (agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({ type: "close", sessionId }));
    }
  });

  agentWs.on("close", () => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(
        JSON.stringify({ type: "error", message: "Agent disconnected" }),
      );
      browserWs.close();
    }
  });
}

// WS upgrade rate limit: per-IP, 10 attempts per minute
const wsUpgradeAttempts = new Map<string, { count: number; resetAt: number }>();

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
  const ip = req.socket.remoteAddress || "unknown";

  // Rate limit upgrades
  const now = Date.now();
  const entry = wsUpgradeAttempts.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= 10) {
      socket.destroy();
      return;
    }
    entry.count++;
  } else {
    wsUpgradeAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  }

  if (pathname === "/ws/ssh" || pathname === "/ws/agent") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const rawUrl = req.url || "";
  const u = new URL(rawUrl, "http://localhost");
  const pathname = u.pathname;

  // Agent registration endpoint
  if (pathname === "/ws/agent") {
    const token = u.searchParams.get("token");
    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }
    const agent = await prisma.agent
      .findUnique({ where: { token } })
      .catch(() => null);
    if (!agent) {
      ws.close(4001, "Invalid token");
      return;
    }
    agentRegistry.set(agent.id, ws);
    logger.info(`[Agent] Connected: ${agent.id} (${agent.name})`);
    ws.send(JSON.stringify({ type: "connected", agentId: agent.id }));
    ws.on("close", () => {
      agentRegistry.delete(agent.id);
      logger.info(`[Agent] Disconnected: ${agent.id}`);
    });
    // Keep alive pings handled by wss pingInterval
    return;
  }

  // SSH endpoint
  const userId = getUserIdFromSession(req);

  // Enforce per-user session limit
  const sessions = userSessions.get(userId) || new Set();
  if (sessions.size >= MAX_SESSIONS_PER_USER) {
    ws.send(
      JSON.stringify({ type: "error", message: "Too many active sessions" }),
    );
    ws.close(4008, "Session limit reached");
    return;
  }
  sessions.add(ws);
  userSessions.set(userId, sessions);
  ws.on("close", () => {
    sessions.delete(ws);
    if (sessions.size === 0) userSessions.delete(userId);
  });

  const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);
  const windowId = u.searchParams.get("windowId") || "";

  logger.info(
    `[WS] SSH connection, connectionId: ${connId}, userId: ${userId}`,
  );

  if (!connId) {
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  try {
    const connection = await loadConnection(connId, userId);

    // If connection has an agentId, proxy through the agent
    if (connection.agentId) {
      const agentWs = agentRegistry.get(connection.agentId);
      if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Agent is offline" }));
        ws.close();
        return;
      }
      proxyThroughAgent(ws, agentWs, connection, windowId);
      return;
    }

    createSSHSocket(
      connection,
      ws as Parameters<typeof createSSHSocket>[1],
      windowId,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load SSH connection";
    logger.error(`[WS] Connection ${connId}: setup failed`, { error: message });
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
});

wss.on("error", (err) => {
  logger.error(`[WS] WebSocket server error`, { error: err.message });
});

const PORT = process.env.WS_PORT || 7891;
server.listen(PORT, () => {
  logger.info(`Server started`, {
    port: PORT,
    env: process.env.NODE_ENV || "development",
  });
});

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
