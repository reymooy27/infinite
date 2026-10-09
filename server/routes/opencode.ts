import { Router, type Request, type Response } from "express";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import http from "http";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const PORT_RANGE_START = 4791;
const PORT_RANGE_END = 4891;
const READY_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 5_000;

// Two execution modes: local spawn (runs natively on the host) or remote
// control of the host daemon. OPENCODE_HOSTD_URL set -> start/stop/status are
// delegated; the proxy stays local because host networking shares 127.0.0.1.
const HOSTD_URL = (process.env.OPENCODE_HOSTD_URL || "").replace(/\/+$/, "");
const HOSTD_TOKEN = String(process.env["OPENCODE_HOSTD" + "_TOKEN"] ?? "");
const DAEMON_TIMEOUT_MS = 90_000;

const remotePorts = new Map<string, number>();

interface HostdReply {
  status: number;
  json: { running?: boolean; port?: number | null; error?: string };
}

async function hostdCall(
  pathname: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<HostdReply> {
  const url = new URL(HOSTD_URL + pathname);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      authorization: `Bearer ${HOSTD_TOKEN}`,
      ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(DAEMON_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as HostdReply["json"];
  return { status: res.status, json };
}

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

async function waitUntilReady(
  proc: ChildProcess,
  port: number,
  timeoutMs: number,
  isDead: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (proc.exitCode !== null || isDead()) return false;
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

    if (HOSTD_URL) {
      try {
        const r = await hostdCall("/start", { method: "POST", body: { dir: project.directory } });
        if (r.status === 200 && typeof r.json.port === "number") {
          remotePorts.set(project.id, r.json.port);
          logger.info("[OpenCode] started via host daemon", { projectId: project.id, port: r.json.port });
          res.json({ running: true, port: r.json.port });
        } else {
          res.status(r.json.error ? r.status : 502).json({ error: r.json.error || "host daemon start failed" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("[OpenCode] host daemon unreachable", { url: HOSTD_URL, error: message });
        res.status(502).json({ error: `opencode host daemon unreachable at ${HOSTD_URL}` });
      }
      return;
    }

    const port = await findFreePort();
    if (!port) {
      res.status(502).json({ error: "No free port in 4791-4891" });
      return;
    }

    const proc = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      cwd: project.directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // stdio piped (not "ignore") so spawn ENOENT + crash output reach the 502 body.
    let spawnError: string | null = null;
    let outputTail = "";
    const absorb = (chunk: Buffer) => {
      outputTail = (outputTail + String(chunk)).slice(-500);
    };
    proc.stdout?.on("data", absorb);
    proc.stderr?.on("data", absorb);
    proc.on("error", (err) => {
      spawnError = err.message;
    });
    proc.on("exit", () => managed.delete(project.id));

    const ready = await waitUntilReady(proc, port, READY_TIMEOUT_MS, () => spawnError !== null);
    if (!ready) {
      proc.kill("SIGKILL");
      const detail = spawnError
        ? `failed to launch "opencode serve": ${spawnError}`
        : outputTail
          ? `no healthy response in time; last output: ${outputTail.trim()}`
          : "opencode serve did not become ready in time";
      logger.error("[OpenCode] start failed", { projectId: project.id, port, detail });
      res.status(502).json({ error: detail });
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
router.post("/:projectId/stop", async (req, res) => {
  const id = String(req.params.projectId);
  if (HOSTD_URL) {
    remotePorts.delete(id);
    try {
      const project = await prisma.project.findFirst({ where: { id, userId: LOCAL_USER_ID } });
      if (project?.directory) await hostdCall("/stop", { method: "POST", body: { dir: project.directory } });
    } catch (err) {
      logger.warn("[OpenCode] host daemon stop failed", { projectId: id, error: err instanceof Error ? err.message : String(err) });
    }
    res.json({ running: false });
    return;
  }
  const entry = managed.get(id);
  if (entry) {
    managed.delete(id);
    stopOne(entry);
  }
  res.json({ running: false });
});

// GET /api/opencode/:projectId/status
router.get("/:projectId/status", async (req, res) => {
  const id = String(req.params.projectId);
  if (HOSTD_URL) {
    let running = false;
    let port: number | null = null;
    try {
      const project = await prisma.project.findFirst({ where: { id, userId: LOCAL_USER_ID } });
      if (project?.directory) {
        const r = await hostdCall("/status", { query: { dir: project.directory } });
        running = Boolean(r.json.running);
        port = typeof r.json.port === "number" ? r.json.port : null;
      }
    } catch {
      running = false;
      port = null;
    }
    if (running && port) remotePorts.set(id, port);
    else remotePorts.delete(id);
    res.json({ running, port });
    return;
  }
  const entry = managed.get(id);
  const running = Boolean(entry && entry.proc.exitCode === null && !entry.proc.killed);
  if (entry && !running) managed.delete(id);
  res.json({ running, port: running && entry ? entry.port : null });
});

// Proxy: forwards every method/path/query to the opencode HTTP API.
// Express 5: the remaining path (with query string) lands in req.url.
router.use("/:projectId/proxy", (req, res) => {
  const entry = managed.get(req.params.projectId);
  if (entry && entry.proc.exitCode !== null) managed.delete(req.params.projectId);
  const port =
    entry && entry.proc.exitCode === null ? entry.port : remotePorts.get(String(req.params.projectId));
  if (!port) {
    res.status(409).json({ error: "opencode not running" });
    return;
  }

  // express.json() runs before routes and consumes JSON bodies; re-serialize
  // what it parsed. Any other body is still on the wire and gets piped.
  const contentType = String(req.headers["content-type"] || "");
  const bodyParsed = req.body !== undefined && contentType.includes("application/json");
  const headers = copyHeaders(req.headers, ["host", "connection", "transfer-encoding", "content-length"]);
  headers.host = `127.0.0.1:${port}`;

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
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
