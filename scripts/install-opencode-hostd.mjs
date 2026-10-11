#!/usr/bin/env node
// One-time host setup for the OpenCode daemon (hostd/opencode-hostd.mjs).
// Idempotent: safe to re-run after moving the repo; keeps the existing token.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const log = (msg) => console.log(`ok  ${msg}`);
const die = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const ok = (r) => r.status === 0;

fs.existsSync(path.join(root, "hostd", "opencode-hostd.mjs")) || die("run this from the repo root");
ok(run("git", ["check-ignore", "-q", ".env"])) ||
  die(".env is NOT gitignored — refusing to store the token there; fix the ignore rule first");

const cfgDir = path.join(os.homedir(), ".config", "infinite");
const envFile = path.join(cfgDir, "opencode-hostd.env");
fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
let token = null;
try {
  token = /OPENCODE_HOSTD_TOKEN=([0-9a-f]+)/.exec(fs.readFileSync(envFile, "utf8"))?.[1] ?? null;
} catch {}
if (token) {
  log(`token kept -> ${envFile}`);
} else {
  token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(envFile, `OPENCODE_HOSTD_TOKEN=${token}\n`, { mode: 0o600 });
  log(`token written -> ${envFile}`);
}

const sc = run(process.execPath, ["hostd/opencode-hostd.mjs", "--selfcheck"]);
process.stdout.write(sc.stdout || "");
if (!ok(sc)) die(`selfcheck failed: ${sc.stderr}`);

function findOpencodeBin() {
  const candidates = [
    process.env.OPENCODE_BIN,
    ...(process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "opencode")),
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

const opencodeBin = findOpencodeBin();
if (!opencodeBin) {
  die(
    'opencode binary not found (checked OPENCODE_BIN, PATH, ~/.opencode/bin/opencode).\n' +
      "     Install it first:  curl -fsSL https://opencode.ai/install | bash\n" +
      "     then re-run this script.",
  );
}
log(`opencode binary -> ${opencodeBin}`);

const unitName = "infinite-opencode-hostd.service";
const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
fs.mkdirSync(unitDir, { recursive: true });
const unit = fs
  .readFileSync(path.join(root, "hostd", unitName), "utf8")
  .replaceAll("__NODE_BIN__", process.execPath)
  .replaceAll("__REPO_ROOT__", root)
  .replaceAll("__OPENCODE_DIR__", path.dirname(opencodeBin));
fs.writeFileSync(path.join(unitDir, unitName), unit);
log(`unit rendered -> ${path.join(unitDir, unitName)}`);
ok(run("systemctl", ["--user", "daemon-reload"])) ||
  die("systemctl --user unavailable — the daemon needs a Linux systemd user session");
ok(run("systemctl", ["--user", "enable", "--now", unitName])) || die("systemctl --user enable --now failed");
log("daemon enabled + started");

const envPath = path.join(root, ".env");
let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split("\n") : [];
if (lines.length && !fs.existsSync(`${envPath}.bak-opencode-hostd`)) {
  fs.copyFileSync(envPath, `${envPath}.bak-opencode-hostd`);
  log(`backup -> ${envPath}.bak-opencode-hostd`);
}
lines = lines.filter((l) => !/^OPENCODE_HOSTD_(URL|TOKEN)=/.test(l));
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push("OPENCODE_HOSTD_URL=http://127.0.0.1:7890", `OPENCODE_HOSTD_TOKEN=${token}`, "");
fs.writeFileSync(envPath, lines.join("\n"));
log(".env updated (OPENCODE_HOSTD_URL + OPENCODE_HOSTD_TOKEN)");

console.log(
  "\nNext: pick up the new keys —\n  docker: docker compose up -d --force-recreate server\n  native: restart the API server process",
);
