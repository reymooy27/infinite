// Self-check for the disk-cleanup remote scripts. No framework: run with
// `npx tsx scripts/check-diskcleanup.ts`.
//
// Four things can actually break here and all are invisible to tsc/eslint:
//   1. the generated shell is syntactically valid bash
//   2. the parser survives whatever the remote actually prints (missing tools,
//      permission denied, empty journal)
//   3. each command reports what it really did, not blanket success
//   4. the allowlist rejects anything that is not a known target id
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildScanScript,
  CLEANUP_COMMANDS,
  isCleanupTarget,
  CLEANUP_TARGETS,
  parseSizeWithUnit,
} from "../server/lib/diskcleanup.js";

const sh = (cmd: string) => execFileSync("bash", ["-c", cmd], { encoding: "utf8" });
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// --- 1. every generated command is valid bash ---------------------------
const scan = buildScanScript();
for (const [id, cmd] of Object.entries(CLEANUP_COMMANDS)) {
  try {
    sh(`bash -n <<'EOF'\n${cmd}\nEOF`);
  } catch (err) {
    throw new Error(`CLEANUP_COMMANDS.${id} is not valid bash:\n${cmd}\n${msg(err)}`);
  }
}
try {
  sh(`bash -n <<'EOF'\n${scan}\nEOF`);
} catch (err) {
  throw new Error(`scan script is not valid bash:\n${scan}\n${msg(err)}`);
}

// --- 2. the scan script runs and parses --------------------------------
const out = sh(buildScanScript());
const rows = new Map(
  out
    .split("\n")
    .map((l) => l.replace(/\r/g, "").trim())
    .filter(Boolean)
    .map((l) => {
      const t = l.indexOf("\t");
      return [l.slice(0, t).trim(), l.slice(t + 1).trim()] as const;
    }),
);
for (const key of ["trash", "tmp", "pkgcache", "logs"]) {
  assert.ok(rows.has(key), `scan output is missing the "${key}" row:\n${out}`);
  assert.ok(Number(rows.get(key)) >= 0, `"${key}" parsed negative or NaN`);
}
assert.ok(rows.has("journal"), `scan output is missing the "journal" row:\n${out}`);

// --- 2b. journal human units normalise to KB ---------------------------
// journalctl says "1.2G" and the payload is KB everywhere else. This used to be
// done with awk, where mawk truncated 1.2 to 1 and under-reported by 20%.
assert.equal(parseSizeWithUnit("1.2G"), Math.round(1.2 * 1048576));
assert.equal(parseSizeWithUnit("512M"), 512 * 1024);
assert.equal(parseSizeWithUnit("1.5T"), Math.round(1.5 * 1024 ** 3));
assert.equal(parseSizeWithUnit("2G"), 2 * 1048576);
assert.equal(parseSizeWithUnit("4k"), 4);
// A host with no journal emits nothing; that must be 0, never NaN.
for (const empty of ["", "no journals found", "  "]) {
  assert.equal(parseSizeWithUnit(empty), 0, `${JSON.stringify(empty)} should be 0`);
}

// --- 2c. cleanup commands report what they actually did ----------------
// An unconditional `echo cleared` reported success when the target did not even
// exist, so the sizes never moved and nothing explained why. Each command must
// distinguish "removed N" from "there was nothing here".
const trashCmd = CLEANUP_COMMANDS.trash;
const runTrash = (xdg: string) =>
  execFileSync("bash", ["-c", trashCmd], { encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: xdg } })
    .trim()
    .split("\n")
    .pop()!
    .trim();

const empty = mkdtempSync(join(tmpdir(), "dc-trash-"));
assert.match(runTrash(empty), /no Trash directory/, "absent Trash must not claim success");

const filled = mkdtempSync(join(tmpdir(), "dc-trash-"));
mkdirSync(join(filled, "Trash/files/d"), { recursive: true });
mkdirSync(join(filled, "Trash/info"), { recursive: true });
writeFileSync(join(filled, "Trash/files/a"), "a");
writeFileSync(join(filled, "Trash/files/.dot"), "a");
writeFileSync(join(filled, "Trash/files/d/b"), "a");
assert.match(runTrash(filled), /^\d+ item\(s\) removed$/, "populated Trash must report a count");
assert.equal(readdirSync(join(filled, "Trash/files")).length, 0, "trash contents must be gone");
// The files/info dirs themselves must survive — file managers expect them.
assert.ok(existsSync(join(filled, "Trash/files")) && existsSync(join(filled, "Trash/info")));
assert.match(runTrash(filled), /^0 item\(s\) removed$/, "an emptied Trash must report 0");
assert.notEqual(runTrash(empty), runTrash(filled), "absent and empty must be distinguishable");

// --- 3. the allowlist is a closed set -----------------------------------
for (const id of CLEANUP_TARGETS) {
  assert.ok(isCleanupTarget(id), `${id} should be a valid target`);
}
for (const bad of ["", "rm -rf /", "trash; rm -rf /", "../../etc", null, undefined, 7, ["trash"]]) {
  assert.equal(isCleanupTarget(bad), false, `${JSON.stringify(bad)} must be rejected`);
}

console.log("ok: bash valid, units parsed, cleanup reports truthfully, allowlist closed");
