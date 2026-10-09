#!/usr/bin/env node
// Host daemon that spawns `opencode serve` OUTSIDE the Docker backend. The
// container runs with host networking, so it reaches this on 127.0.0.1:7890.
// Contract: POST /start {dir} | POST /stop {dir} | GET /status?dir=...
// All routes require "Authorization: Bearer $OPENCODE_HOSTD_TOKEN".
// ponytail: single host, single user, loopback-only, fixed arg vector;
// upgrade path = real auth + multi-host if ever needed.

import http from "node:http";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const SELF = process.argv.includes("--selfcheck");
if (SELF && !process.env.OPENCODE_HOSTD_TOKEN) {
  process.env.OPENCODE_HOSTD_TOKEN = crypto.randomBytes(16).toString("hex");
}

const PORT = Number(process.env.OPENCODE_HOSTD_PORT || 7890);
const TOKEN = String(process.env["OPENCODE_HOSTD" + "_TOKEN"] ?? "");
const READY_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 5_000;
const RANGE_START = 4791;
const RANGE_END = 4891;
const STATE_FILE =
  process.env.INFINITE_HOSTD_STATE ||
  path.join(os.homedir(), ".local", "state", "infinite-opencode-hostd", "state.json");

if (!TOKEN) {
  console.error("infinite-opencode-hostd: OPENCODE_HOSTD_TOKEN is required");
  process.exit(2);
}

// dir -> { pid, port, proc|null }; proc is null for entries reclaimed from
// the state file after a daemon restart.
const serves = new Map();
const pending = new Map();
let bin = null;

function resolveBin() {
  if (bin) return bin;
  const candidates = [
    process.env.OPENCODE_BIN,
    ...(process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "opencode")),
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      bin = c;
      return bin;
    } catch {}
  }
  throw new Error(
    "opencode binary not found (checked OPENCODE_BIN, PATH, ~/.opencode/bin); set OPENCODE_BIN",
  );
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function health(port, ms) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(ms),
    });
    void res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
    const out = {};
    for (const [dir, s] of serves) out[dir] = { pid: s.pid, port: s.port };
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2), { mode: 0o600 });
  } catch {}
}

async function loadState() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return;
  }
  for (const [dir, e] of Object.entries(raw ?? {})) {
    if (typeof e?.pid === "number" && typeof e?.port === "number" && alive(e.pid) && (await health(e.port, 600))) {
      serves.set(dir, { pid: e.pid, port: e.port, proc: null });
    }
  }
  saveState();
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

async function findFreePort() {
  for (let port = RANGE_START; port <= RANGE_END; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

function startDir(raw) {
  if (typeof raw !== "string" || !path.isAbsolute(raw)) return null;
  try {
    if (!fs.statSync(raw).isDirectory()) return null;
    return fs.realpathSync(raw);
  } catch {
    return null;
  }
}

// Stop is forgiving: the dir may have been deleted while its serve ran.
function stopDir(raw) {
  if (typeof raw !== "string" || !path.isAbsolute(raw)) return null;
  try {
    return fs.realpathSync(raw);
  } catch {
    return raw;
  }
}

function killEntry(entry) {
  try {
    if (entry.proc) entry.proc.kill("SIGTERM");
    else process.kill(entry.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      if (entry.proc ? entry.proc.exitCode === null : alive(entry.pid)) {
        if (entry.proc) entry.proc.kill("SIGKILL");
        else process.kill(entry.pid, "SIGKILL");
      }
    } catch {}
  }, KILL_GRACE_MS).unref();
}

async function isLive(entry) {
  if (entry.proc) return entry.proc.exitCode === null;
  return alive(entry.pid) && (await health(entry.port, 600));
}

async function beginStart(dir) {
  const existing = serves.get(dir);
  if (existing) {
    if (await isLive(existing)) return { status: 200, body: { running: true, port: existing.port } };
    serves.delete(dir);
    saveState();
  }

  let binPath;
  try {
    binPath = resolveBin();
  } catch (err) {
    return { status: 502, body: { error: `failed to launch "opencode serve": ${err.message}` } };
  }

  const port = await findFreePort();
  if (!port) return { status: 429, body: { error: `no free port in ${RANGE_START}-${RANGE_END}` } };

  const proc = spawn(binPath, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: dir, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let spawnError = null;
  let outputTail = "";
  const absorb = (chunk) => {
    outputTail = (outputTail + String(chunk)).slice(-500);
  };
  proc.stdout?.on("data", absorb);
  proc.stderr?.on("data", absorb);
  proc.on("error", (err) => {
    spawnError = err.message;
  });
  proc.on("exit", () => {
    if (serves.get(dir)?.pid === proc.pid) {
      serves.delete(dir);
      saveState();
    }
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  for (;;) {
    if (proc.exitCode !== null || spawnError) break;
    if (await health(port, 800)) {
      ready = true;
      break;
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ready) {
    try {
      proc.kill("SIGKILL");
    } catch {}
    const detail = spawnError
      ? `failed to launch "opencode serve": ${spawnError}`
      : outputTail
        ? `no healthy response in time; last output: ${outputTail.trim()}`
        : "opencode serve did not become ready in time";
    console.error(`start failed for ${dir}: ${detail}`);
    return { status: 502, body: { error: detail } };
  }

  serves.set(dir, { pid: proc.pid, port, proc });
  saveState();
  console.log(`started opencode serve dir=${dir} port=${port} pid=${proc.pid}`);
  return { status: 200, body: { running: true, port } };
}

function authorized(req) {
  const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ""));
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (!authorized(req)) return send(401, { error: "unauthorized" });
  const url = new URL(req.url, "http://hostd");
  try {
    if (req.method === "POST" && url.pathname === "/start") {
      const body = await readJson(req);
      const dir = startDir(body?.dir);
      if (!dir) return send(400, { error: "dir must be an existing absolute directory" });
      let job = pending.get(dir);
      if (!job) {
        job = beginStart(dir);
        pending.set(dir, job);
        void job.finally(() => pending.delete(dir));
      }
      const r = await job;
      return send(r.status, r.body);
    }
    if (req.method === "POST" && url.pathname === "/stop") {
      const body = await readJson(req);
      const dir = stopDir(body?.dir);
      if (!dir) return send(400, { error: "dir must be an absolute path" });
      const entry = serves.get(dir);
      if (entry) {
        serves.delete(dir);
        killEntry(entry);
        saveState();
        console.log(`stopped opencode serve dir=${dir} pid=${entry.pid}`);
      }
      return send(200, { running: false });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      const dir = startDir(url.searchParams.get("dir"));
      if (!dir) return send(400, { error: "dir must be an existing absolute directory" });
      const entry = serves.get(dir);
      if (!entry) return send(200, { running: false, port: null });
      if (!(await isLive(entry))) {
        serves.delete(dir);
        saveState();
        return send(200, { running: false, port: null });
      }
      return send(200, { running: true, port: entry.port });
    }
    return send(404, { error: "not found" });
  } catch (err) {
    return send(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

async function runSelfcheck(port) {
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  const post = (p, body, headers = {}) =>
    fetch(base + p, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  try {
    assert.equal((await post("/start", { dir: "/tmp" })).status, 401, "no token must 401");
    assert.equal((await post("/start", { dir: "/tmp" }, { authorization: "Bearer nope" })).status, 401, "bad token must 401");
    assert.equal((await post("/start", { dir: "relative/path" }, auth)).status, 400, "relative dir must 400");
    assert.equal((await post("/start", {}, auth)).status, 400, "missing dir must 400");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hostd-self-"));
    const st = await (await fetch(`${base}/status?dir=${encodeURIComponent(tmp)}`, { headers: auth })).json();
    assert.deepEqual(st, { running: false, port: null }, "idle status");
    assert.equal((await post("/stop", { dir: tmp }, auth)).status, 200, "stop idempotent");
    assert.equal((await fetch(`${base}/nope`, { headers: auth })).status, 404, "unknown route 404");
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("SELFCHECK_OK");
    return true;
  } catch (err) {
    console.error(`SELFCHECK_FAILED: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) process.exit(0);
  shuttingDown = true;
  for (const [, entry] of serves) killEntry(entry);
  serves.clear();
  saveState();
  server.close();
  setTimeout(() => process.exit(0), KILL_GRACE_MS + 200).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await loadState();
server.listen(SELF ? 0 : PORT, "127.0.0.1", () => {
  if (SELF) {
    void runSelfcheck(server.address().port).then((ok) => process.exit(ok ? 0 : 1));
  } else {
    console.log(`infinite-opencode-hostd listening on http://127.0.0.1:${PORT}`);
  }
});
