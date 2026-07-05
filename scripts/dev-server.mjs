import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const buildEntry = path.join(rootDir, ".server-build", "index.js");

let appProcess = null;
let restartTimer = null;
let shuttingDown = false;

function log(line) {
  process.stdout.write(`[server-dev] ${line}\n`);
}

function stopApp() {
  if (!appProcess) return;
  appProcess.removeAllListeners();
  appProcess.kill("SIGTERM");
  appProcess = null;
}

function startApp() {
  if (!existsSync(buildEntry) || shuttingDown) return;
  stopApp();
  log("starting relay");
  appProcess = spawn(process.execPath, [buildEntry], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  appProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`relay exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    appProcess = null;
  });
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startApp();
  }, 150);
}

const tscProcess = spawn(
  "npx",
  ["tsc", "-p", "server/tsconfig.build.json", "--watch", "--preserveWatchOutput", "--pretty", "false"],
  {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  },
);

function handleCompilerChunk(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  if (text.includes("Found 0 errors")) {
    scheduleRestart();
  }
}

tscProcess.stdout.on("data", handleCompilerChunk);
tscProcess.stderr.on("data", (chunk) => {
  process.stderr.write(chunk.toString());
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`stopping on ${signal}`);
  if (restartTimer) clearTimeout(restartTimer);
  stopApp();
  tscProcess.kill("SIGTERM");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

tscProcess.on("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(0);
    return;
  }
  log(`compiler exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  stopApp();
  process.exit(code ?? 1);
});
