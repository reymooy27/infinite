import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), "server/.env"), override: true });
import express from "express";
import { createServer } from "http";
import http from "http";
import https from "https";
import { WebSocket, WebSocketServer } from "ws";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { IncomingMessage } from "http";
import { prisma } from "./lib/prisma.js";
import { decrypt } from "./lib/crypto.js";
import {
  createSSHSocket,
  createSFTPConnection,
  ensureLocalTunnel,
} from "./lib/ssh.js";
import {
  dockerStats,
  getContainerLogs,
  inspectContainer,
  listContainers,
  listImages,
  listNetworks,
  listVolumes,
  pauseContainer,
  pruneDocker,
  removeContainer,
  removeImage,
  removeNetwork,
  removeVolume,
  restartContainer,
  startContainer,
  stopContainer,
  unpauseContainer,
} from "./lib/docker.js";
import { logger } from "./lib/logger.js";
import bookmarksRouter from "./routes/bookmarks.js";
import notesRouter from "./routes/notes.js";
import layoutRouter from "./routes/layout.js";
import connectionsRouter from "./routes/connections.js";
import aiProvidersRouter from "./routes/ai-providers.js";
import aiKeysRouter from "./routes/ai-keys.js";
import projectsRouter from "./routes/projects.js";
import devBrowserRouter from "./routes/dev-browser.js";
import routerUsageRouter from "./routes/router-usage.js";

const LOCAL_USER_ID = "local-user";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
});
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:7890",
  "http://127.0.0.1:7890",
  "http://localhost:9871",
  "http://127.0.0.1:9871",
];

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(",")
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: true,
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

// Domain routes
app.use("/api/bookmarks", bookmarksRouter);
app.use("/api/notes", notesRouter);
app.use("/api/layout", layoutRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/ai-providers", aiProvidersRouter);
app.use("/api/ai-keys", aiKeysRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/dev-browser", devBrowserRouter);
app.use("/api/router-usage", routerUsageRouter);

function resolveConfiguredPublicServerBaseUrl() {
  const configured =
    process.env.PUBLIC_SERVER_URL || process.env.VITE_WS_URL || "";

  if (!configured) return null;
  if (configured.startsWith("http://") || configured.startsWith("https://")) {
    return configured.replace(/\/+$/, "");
  }
  if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
    return configured.replace(/^ws/, "http").replace(/\/+$/, "");
  }
  return `https://${configured.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

function getPublicServerBaseUrl(req: express.Request) {
  const configured = resolveConfiguredPublicServerBaseUrl();
  if (configured) return configured;

  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocol = forwardedProto || req.protocol || "http";
  return `${protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function normalizeTunnelScheme(value: unknown) {
  return value === "https" ? "https" : "http";
}

app.post("/api/tunnels", async (req, res) => {
  const userId = getUserIdFromRequest(req);

  const connectionId = parseInt(String(req.body?.connectionId || "0"), 10);
  const targetHost =
    typeof req.body?.targetHost === "string" && req.body.targetHost
      ? req.body.targetHost
      : "127.0.0.1";
  const targetPort = parseInt(String(req.body?.targetPort || "0"), 10);
  const scheme = normalizeTunnelScheme(req.body?.scheme);

  if (!connectionId || !targetPort) {
    res.status(400).json({ error: "Missing connectionId or targetPort" });
    return;
  }

  try {
    const connection = await loadConnection(connectionId, userId);
    const tunnel = await ensureLocalTunnel(connection, targetHost, targetPort);
    const publicBaseUrl = getPublicServerBaseUrl(req);
    const publicTunnelBaseUrl = `${publicBaseUrl}/api/tunnels/${connectionId}/${targetPort}/${scheme}`;
    res.json({
      ...tunnel,
      url: publicTunnelBaseUrl,
    });
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

app.use("/api/tunnels/:connectionId/:targetPort/:scheme", async (req, res) => {
  const userId = getUserIdFromRequest(req);
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const targetPort = parseInt(String(req.params.targetPort || "0"), 10);
  const scheme = normalizeTunnelScheme(req.params.scheme);

  if (!connectionId || !targetPort) {
    res.status(400).json({ error: "Missing connectionId or targetPort" });
    return;
  }

  try {
    const connection = await loadConnection(connectionId, userId);
    const tunnel = await ensureLocalTunnel(connection, "127.0.0.1", targetPort);
    const requestPath = req.url || "/";
    const upstreamHeaders = { ...req.headers };
    upstreamHeaders.host = `localhost:${targetPort}`;
    delete upstreamHeaders.connection;
    delete upstreamHeaders["content-length"];

    const upstreamRequest = (scheme === "https" ? https : http).request(
      {
        protocol: `${scheme}:`,
        hostname: "127.0.0.1",
        port: tunnel.localPort,
        method: req.method,
        path: requestPath,
        headers: upstreamHeaders,
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers };
        const location = upstreamResponse.headers.location;

        if (location) {
          try {
            const localOrigin = `${scheme}://localhost:${targetPort}`;
            const redirectTarget = new URL(location, `${localOrigin}/`);
            const isLocalRedirect =
              (redirectTarget.hostname === "localhost" ||
                redirectTarget.hostname === "127.0.0.1" ||
                redirectTarget.hostname === "0.0.0.0") &&
              Number(redirectTarget.port || (scheme === "https" ? "443" : "80")) === targetPort;

            if (isLocalRedirect) {
              responseHeaders.location =
                `${getPublicServerBaseUrl(req)}/api/tunnels/${connectionId}/${targetPort}/${scheme}` +
                `${redirectTarget.pathname}${redirectTarget.search}${redirectTarget.hash}`;
            }
          } catch {}
        }

        res.status(upstreamResponse.statusCode || 502);
        Object.entries(responseHeaders).forEach(([key, value]) => {
          if (value === undefined) return;
          res.setHeader(key, value as string | string[]);
        });
        upstreamResponse.pipe(res);
      },
    );

    upstreamRequest.on("error", (err) => {
      logger.error("[Tunnel] Upstream proxy error", {
        connectionId,
        targetPort,
        error: err.message,
      });
      if (!res.headersSent) {
        res.status(502).json({ error: "Tunnel proxy request failed" });
      } else {
        res.end();
      }
    });

    req.pipe(upstreamRequest);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to proxy tunnel request";
    logger.error("[Tunnel] Failed to proxy request", {
      connectionId,
      targetPort,
      error: message,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
});


// ---------------- Docker Manager API ----------------
// All Docker operations run over SSH against a saved connection.

async function withConnection<T>(
  req: express.Request,
  connectionId: number,
  fn: (connection: Awaited<ReturnType<typeof loadConnection>>) => Promise<T>,
): Promise<T> {
  const userId = getUserIdFromRequest(req);
  const connection = await loadConnection(connectionId, userId);
  return fn(connection);
}

app.get("/api/docker/:connectionId/containers", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  try {
    await withConnection(req, connectionId, async (connection) => {
      const all = req.query.all === "1" || req.query.all === "true";
      const containers = await listContainers(connection, { all });
      const stats = await dockerStats(connection);
      const merged = containers.map((c: { id: string; cpuPerc?: string; memUsage?: string }) => ({
        ...c,
        cpuPerc: stats[c.id]?.cpuPerc ?? "",
        memUsage: stats[c.id]?.memUsage ?? "",
      }));
      res.json({ containers: merged });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list containers";
    logger.error("[Docker] list containers failed", { connectionId, error: message });
    res.status(500).json({ error: message });
  }
});

app.get("/api/docker/:connectionId/images", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  try {
    await withConnection(req, connectionId, async (connection) => {
      const images = await listImages(connection);
      res.json({ images });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list images";
    res.status(500).json({ error: message });
  }
});

app.get("/api/docker/:connectionId/volumes", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  try {
    await withConnection(req, connectionId, async (connection) => {
      const volumes = await listVolumes(connection);
      res.json({ volumes });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list volumes";
    res.status(500).json({ error: message });
  }
});

app.get("/api/docker/:connectionId/networks", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  try {
    await withConnection(req, connectionId, async (connection) => {
      const networks = await listNetworks(connection);
      res.json({ networks });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list networks";
    res.status(500).json({ error: message });
  }
});

app.post("/api/docker/:connectionId/containers/:action", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const action = String(req.params.action || "");
  const id = String(req.body?.id || "");
  const allowed = ["start", "stop", "restart", "pause", "unpause", "remove"];
  if (!connectionId || !id) {
    res.status(400).json({ error: "Missing connectionId or id" });
    return;
  }
  if (!allowed.includes(action)) {
    res.status(400).json({ error: `Unknown action: ${action}` });
    return;
  }
  try {
    const result = await withConnection(req, connectionId, async (connection) => {
      switch (action) {
        case "start":
          return startContainer(connection, id);
        case "stop":
          return stopContainer(connection, id);
        case "restart":
          return restartContainer(connection, id);
        case "pause":
          return pauseContainer(connection, id);
        case "unpause":
          return unpauseContainer(connection, id);
        case "remove":
          return removeContainer(connection, id, Boolean(req.body?.force));
        default:
          return { ok: false, message: "Unknown action" };
      }
    });
    if ((result as { ok: boolean }).ok) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Docker action failed";
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/docker/:connectionId/images/remove", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const id = String(req.body?.id || "");
  if (!connectionId || !id) {
    res.status(400).json({ error: "Missing connectionId or id" });
    return;
  }
  try {
    const result = await withConnection(req, connectionId, (connection) =>
      removeImage(connection, id, Boolean(req.body?.force)),
    );
    if (result.ok) res.json(result);
    else res.status(400).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove image";
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/docker/:connectionId/volumes/remove", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const name = String(req.body?.name || "");
  if (!connectionId || !name) {
    res.status(400).json({ error: "Missing connectionId or name" });
    return;
  }
  try {
    const result = await withConnection(req, connectionId, (connection) =>
      removeVolume(connection, name, Boolean(req.body?.force)),
    );
    if (result.ok) res.json(result);
    else res.status(400).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove volume";
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/docker/:connectionId/networks/remove", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const id = String(req.body?.id || "");
  if (!connectionId || !id) {
    res.status(400).json({ error: "Missing connectionId or id" });
    return;
  }
  try {
    const result = await withConnection(req, connectionId, (connection) =>
      removeNetwork(connection, id),
    );
    if (result.ok) res.json(result);
    else res.status(400).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove network";
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/docker/:connectionId/containers/:id/logs", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const id = String(req.params.id || "");
  if (!connectionId || !id) {
    res.status(400).json({ error: "Missing connectionId or id" });
    return;
  }
  try {
    const logs = await withConnection(req, connectionId, (connection) =>
      getContainerLogs(connection, id, {
        tail: req.query.tail ? parseInt(String(req.query.tail), 10) : undefined,
        since: req.query.since ? String(req.query.since) : undefined,
      }),
    );
    res.json({ logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch logs";
    res.status(500).json({ error: message });
  }
});

app.get("/api/docker/:connectionId/containers/:id/inspect", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  const id = String(req.params.id || "");
  if (!connectionId || !id) {
    res.status(400).json({ error: "Missing connectionId or id" });
    return;
  }
  try {
    const inspect = await withConnection(req, connectionId, (connection) =>
      inspectContainer(connection, id),
    );
    res.json({ inspect });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to inspect container";
    res.status(500).json({ error: message });
  }
});

app.post("/api/docker/:connectionId/prune", async (req, res) => {
  const connectionId = parseInt(String(req.params.connectionId || "0"), 10);
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  try {
    const result = await withConnection(req, connectionId, (connection) =>
      pruneDocker(connection, { volumes: Boolean(req.body?.volumes) }),
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to prune";
    res.status(500).json({ error: message });
  }
});


// Per-user active SSH session tracking
const userSessions = new Map<string, Set<import("ws").WebSocket>>();

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
}

// Local-only mode: no auth required
function getUserIdFromRequest(_req: express.Request): string {
  void _req;
  return LOCAL_USER_ID;
}

function getUserIdFromSession(_req: IncomingMessage): string {
  void _req;
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

  if (pathname === "/ws/ssh" || pathname === "/ws/sftp") {
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

  // SFTP endpoint — file transfer only, no shell
  if (pathname === "/ws/sftp") {
    const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);

    if (!connId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
      ws.close();
      return;
    }

    try {
      const connection = await loadConnection(connId, getUserIdFromSession(req));
      createSFTPConnection(connection, ws as Parameters<typeof createSFTPConnection>[1]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load connection";
      ws.send(JSON.stringify({ type: "error", message }));
      ws.close();
    }
    return;
  }

  // SSH endpoint
  const userId = getUserIdFromSession(req);

  const sessions = userSessions.get(userId) || new Set();
  sessions.add(ws);
  userSessions.set(userId, sessions);
  ws.on("close", () => {
    sessions.delete(ws);
    if (sessions.size === 0) userSessions.delete(userId);
  });

  const connId = parseInt(u.searchParams.get("connectionId") || "0", 10);
  const windowId = u.searchParams.get("windowId") || "";
  const initialDirectory = u.searchParams.get("directory") || undefined;
  const replayOnAttach = u.searchParams.get("replay") !== "0";

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

    createSSHSocket(
      connection,
      ws as Parameters<typeof createSSHSocket>[1],
      windowId,
      initialDirectory,
      replayOnAttach,
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
