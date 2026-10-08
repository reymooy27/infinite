import { Router, type Request, type Response } from "express";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import http from "http";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const PORT_RANGE_START = 4791;
const PORT_RANGE_END = 4891;
const READY_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 5_000;

interface Managed {
  proc: ChildProcess;
  port: number;
}

const managed = new Map<string, Managed>();

function copyHeaders(source: http.IncomingHttpHeaders, skip: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (skip.includes(key.toLowerCase())) continue;
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value[0];
  }
  return out;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function findFreePort(): Promise<number | null> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

async function waitUntilReady(proc: ChildProcess, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (proc.exitCode !== null) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1200) });
      void res.body?.cancel();
      if (res.ok) return true;
    } catch {}
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

function stopOne(entry: Managed) {
  const { proc } = entry;
  if (proc.exitCode === null && !proc.killed) {
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, KILL_GRACE_MS);
  }
}

// Kill every managed child when the API server dies, whatever the signal.
function killAll() {
  for (const entry of managed.values()) stopOne(entry);
  managed.clear();
}
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.on(signal, killAll);
}

async function getProjectWithDirectory(
  req: Request,
  res: Response,
): Promise<{ id: string; directory: string } | null> {
  const projectId = String(req.params.projectId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: LOCAL_USER_ID },
  });
  if (!project || !project.directory) {
    res.status(400).json({ error: "Project not found or has no directory" });
    return null;
  }
  return { id: project.id, directory: project.directory };
}

const router = Router();

// POST /api/opencode/:projectId/start
router.post("/:projectId/start", async (req, res) => {
  try {
    const existing = managed.get(req.params.projectId);
    if (existing && existing.proc.exitCode === null) {
      res.json({ running: true, port: existing.port });
      return;
    }
    managed.delete(req.params.projectId);

    const project = await getProjectWithDirectory(req, res);
    if (!project) return;

    const port = await findFreePort();
    if (!port) {
      res.status(502).json({ error: "No free port in 4791-4891" });
      return;
    }

    const proc = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: project.directory,
      stdio: "ignore",
    });
    proc.on("exit", () => managed.delete(project.id));

    const ready = await waitUntilReady(proc, port, READY_TIMEOUT_MS);
    if (!ready) {
      proc.kill("SIGKILL");
      logger.error("[OpenCode] serve did not become ready", { projectId: project.id, port });
      res.status(502).json({ error: "opencode serve did not become ready in time" });
      return;
    }

    managed.set(project.id, { proc, port });
    logger.info("[OpenCode] started", { projectId: project.id, port, pid: proc.pid });
    res.json({ running: true, port });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start opencode";
    logger.error("[OpenCode] start error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/opencode/:projectId/stop
router.post("/:projectId/stop", (req, res) => {
  const entry = managed.get(req.params.projectId);
  if (entry) {
    managed.delete(req.params.projectId);
    stopOne(entry);
  }
  res.json({ running: false });
});

// GET /api/opencode/:projectId/status
router.get("/:projectId/status", (req, res) => {
  const entry = managed.get(req.params.projectId);
  const running = Boolean(entry && entry.proc.exitCode === null && !entry.proc.killed);
  if (entry && !running) managed.delete(req.params.projectId);
  res.json({ running, port: running && entry ? entry.port : null });
});

// Proxy: forwards every method/path/query to the opencode HTTP API.
// Express 5: the remaining path (with query string) lands in req.url.
router.use("/:projectId/proxy", (req, res) => {
  const entry = managed.get(req.params.projectId);
  if (!entry || entry.proc.exitCode !== null) {
    managed.delete(req.params.projectId);
    res.status(409).json({ error: "opencode not running" });
    return;
  }

  // express.json() runs before routes and consumes JSON bodies; re-serialize
  // what it parsed. Any other body is still on the wire and gets piped.
  const contentType = String(req.headers["content-type"] || "");
  const bodyParsed = req.body !== undefined && contentType.includes("application/json");
  const headers = copyHeaders(req.headers, ["host", "connection", "transfer-encoding", "content-length"]);
  headers.host = `127.0.0.1:${entry.port}`;

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: entry.port,
      method: req.method,
      path: `/${req.url.replace(/^\/+/, "")}`,
      headers,
    },
    (upRes) => {
      const upType = String(upRes.headers["content-type"] || "");
      res.status(upRes.statusCode || 502);
      const upHeaders = copyHeaders(upRes.headers, ["transfer-encoding", "content-length"]);
      for (const [key, value] of Object.entries(upHeaders)) res.setHeader(key, value);

      if (upType.includes("text/event-stream")) {
        res.setHeader("cache-control", "no-cache, no-transform");
        res.setHeader("x-accel-buffering", "no");
        res.flushHeaders();
        upRes.on("data", (chunk: Buffer) => res.write(chunk));
        upRes.on("end", () => res.end());
      } else {
        upRes.pipe(res);
      }
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).json({ error: "opencode proxy request failed" });
    else res.end();
  });
  res.on("close", () => upstream.destroy());

  if (bodyParsed) {
    const body = Buffer.from(JSON.stringify(req.body));
    upstream.setHeader("content-type", "application/json");
    upstream.setHeader("content-length", String(body.length));
    upstream.end(body);
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(upstream);
  } else {
    upstream.end();
  }
});

export default router;
