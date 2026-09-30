import { runSSHCommand, type SSHConnection } from "./ssh.js";

// Disk cleanup over SSH. Like sysmon.ts, everything is a fixed remote script —
// the client only ever picks KEYS out of CLEANUP_TARGETS, so no caller-supplied
// string is ever interpolated into a shell command. That is the trust boundary:
// the POST body is untrusted input, the command table is not.

export const CLEANUP_TARGETS = ["trash", "tmp", "pkgcache", "logs"] as const;
export type CleanupTarget = (typeof CLEANUP_TARGETS)[number];

// Only files older than this are touched in /tmp — anything younger may belong
// to a running process.
const TMP_MAX_AGE_DAYS = 7;

// Journal is capped to this after vacuuming; it never grows past it.
const JOURNAL_KEEP = "50M";

export interface CleanupScanEntry {
  id: CleanupTarget;
  sizeKb: number;
  /** Extra context for the UI (e.g. the journal half of the "logs" row). */
  detail?: string;
}

export interface CleanupResultEntry {
  id: CleanupTarget;
  ok: boolean;
  message: string;
  beforeKb: number;
  afterKb: number;
  reclaimedKb: number;
}

// Which `du` path maps to which target. A single host may have several, so the
// first one that exists wins.
const PKG_CACHE_DIRS = [
  "/var/cache/apt/archives", // Debian / Ubuntu
  "/var/cache/dnf", // Fedora / RHEL 8+
  "/var/cache/yum", // RHEL 7 / CentOS
  "/var/cache/pacman/pkg", // Arch
];

// journalctl --disk-usage prints human units ("1.2G"). We deliberately do NOT
// rescale in shell: mawk (the default awk on Debian/Ubuntu, i.e. our target
// hosts) coerces the strnum "1.2" to 1 and that wrongness survives the
// multiply, so a 1.2G journal would be under-reported as 1G. It emits the raw
// token and the unit maths happens in TypeScript, where floats behave.
const JOURNAL_RAW_PIPELINE = "journalctl --disk-usage 2>/dev/null | grep -oiE '[0-9.]+[KMGT]' | head -1";

const KB_PER_UNIT: Record<string, number> = {
  "": 1 / 1024, // journalctl's bare number is bytes
  K: 1,
  M: 1024,
  G: 1024 * 1024,
  T: 1024 ** 3,
  P: 1024 ** 4,
};

// "1.2G" -> KB. Unparseable input (no journal installed, empty output) -> 0.
export function parseSizeWithUnit(raw: string): number {
  const m = raw.trim().match(/^([\d.]+)\s*([KMGTP]?)$/i);
  if (!m) return 0;
  const mult = KB_PER_UNIT[m[2].toUpperCase()];
  if (mult === undefined) return 0;
  return Math.round((Number(m[1]) || 0) * mult);
}

// One round-trip, `key<TAB>value` per line. A target that errors (missing
// tool, no permission) still emits its key with an empty value, so the parser
// reports 0 rather than dropping the row.
// Exported for scripts/check-diskcleanup.ts (bash -n + parser check).
export function buildScanScript(): string {
  return [
    "printf 'trash\\t'; du -sk \"$HOME/.local/share/Trash\" 2>/dev/null | cut -f1",
    // du of a whole tree is slower than summing file sizes; find+awk only walks
    // stale files, which is also exactly what the cleanup deletes.
    `printf 'tmp\\t'; find /tmp /var/tmp -xdev -type f -mtime +${TMP_MAX_AGE_DAYS} -printf '%s\\n' 2>/dev/null | awk '{s+=$1} END {printf "%d\\n", s/1024}'`,
    `printf 'pkgcache\\t'; for d in ${PKG_CACHE_DIRS.join(" ")}; do [ -d "$d" ] && du -sk "$d" 2>/dev/null | cut -f1 && break; done`,
    "printf 'logs\\t'; du -sk /var/log 2>/dev/null | cut -f1",
    `printf 'journal\\t'; ${JOURNAL_RAW_PIPELINE}`,
  ].join("; ");
}

// Returns the raw value for each key; callers apply the right unit per key
// (du -sk is already KB, journalctl is human units).
function parseScan(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r/g, "").trim();
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    map.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim());
  }
  return map;
}

export async function scanDiskCleanup(connection: SSHConnection): Promise<CleanupScanEntry[]> {
  const { stdout } = await runSSHCommand(connection, buildScanScript(), { timeoutMs: 30000 });
  const m = parseScan(stdout);
  const kb = (key: string) => Number(m.get(key)) || 0;
  const logKb = kb("logs");
  const journalKb = parseSizeWithUnit(m.get("journal") ?? "");

  return CLEANUP_TARGETS.map((id) => {
    if (id === "logs") {
      return {
        id,
        // One row, honest total: /var/log and the journal overlap on systemd
        // hosts, but they are separate reclaimable stores so we sum them.
        sizeKb: logKb + journalKb,
        detail: `/var/log ${fmt(logKb)} · journal ${fmt(journalKb)}`,
      };
    }
    if (id === "tmp") return { id, sizeKb: kb("tmp"), detail: `older than ${TMP_MAX_AGE_DAYS}d` };
    if (id === "trash") return { id, sizeKb: kb("trash"), detail: "~/.local/share/Trash" };
    return { id, sizeKb: kb("pkgcache"), detail: "package manager cache" };
  });
}

function fmt(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  if (kb >= 1024) return `${Math.round(kb / 1024)}M`;
  return `${Math.round(kb)}K`;
}

// Fixed command per target. No placeholders — nothing from the request can
// reach these strings, only the key can select one.
// Each one's LAST stdout line describes what it actually did, so the UI can
// tell "removed 3 items" from "there was nothing here" from "permission
// denied" — an unconditional `echo cleared` made every failure look like a
// success and left the sizes unmoved with no explanation.
// Exported for scripts/check-diskcleanup.ts (bash -n check).
export const CLEANUP_COMMANDS: Record<CleanupTarget, string> = {
  // -mindepth 1 keeps the files/info dirs in place (file managers recreate them
  // but some tools assume they exist) and takes out dotfiles for free, which a
  // shell glob would miss.
  trash: `T="\${XDG_DATA_HOME:-$HOME/.local/share}/Trash"; if [ ! -d "$T" ]; then echo "no Trash directory at $T"; else N=$(find "$T/files" -mindepth 1 2>/dev/null | wc -l); find "$T/files" -mindepth 1 -delete 2>/dev/null; find "$T/info" -mindepth 1 -delete 2>/dev/null; echo "$N item(s) removed"; fi`,
  tmp: `N=$(find /tmp /var/tmp -xdev -type f -mtime +${TMP_MAX_AGE_DAYS} 2>/dev/null | wc -l); find /tmp /var/tmp -xdev -type f -mtime +${TMP_MAX_AGE_DAYS} -delete 2>/dev/null; find /tmp /var/tmp -xdev -type d -mtime +${TMP_MAX_AGE_DAYS} -empty -delete 2>/dev/null; echo "$N stale file(s) removed"`,
  // Needs root on most distros. The tool's own stderr is what explains the
  // failure, so it must survive to the result (see lastLine).
  pkgcache: `if command -v apt-get >/dev/null 2>&1; then apt-get clean && echo "package cache cleaned"; elif command -v dnf >/dev/null 2>&1; then dnf clean all >/dev/null && echo "package cache cleaned"; elif command -v yum >/dev/null 2>&1; then yum clean all >/dev/null && echo "package cache cleaned"; elif command -v pacman >/dev/null 2>&1; then pacman -Sc --noconfirm >/dev/null && echo "package cache cleaned"; else echo "no known package manager"; exit 1; fi`,
  // Vacuum the journal, then truncate only ROTATED logs — the active
  // `*.log` never matches `*.log.[0-9]*`, so nothing loses the tail of what it
  // is currently writing.
  logs: `J=$(journalctl --vacuum-size=${JOURNAL_KEEP} 2>&1 | tail -1); N=$(find /var/log -type f \\( -name '*.gz' -o -name '*.log.[0-9]*' -o -name '*.old' \\) 2>/dev/null | wc -l); find /var/log -type f \\( -name '*.gz' -o -name '*.log.[0-9]*' -o -name '*.old' \\) -exec truncate -s 0 {} + 2>/dev/null; echo "\${J:-journalctl not available}, $N rotated log(s) truncated"`,
};

// The last non-empty line of a stream — the per-command status lives there.
function lastLine(text: string): string {
  return text.trim().split("\n").pop()?.trim() ?? "";
}

export function isCleanupTarget(value: unknown): value is CleanupTarget {
  return typeof value === "string" && (CLEANUP_TARGETS as readonly string[]).includes(value);
}

export async function runDiskCleanup(
  connection: SSHConnection,
  targets: CleanupTarget[],
): Promise<{ results: CleanupResultEntry[]; scan: CleanupScanEntry[] }> {
  const before = await scanDiskCleanup(connection);
  const beforeById = new Map(before.map((e) => [e.id, e.sizeKb]));

  const ran: Array<{ id: CleanupTarget; ok: boolean; message: string }> = [];
  for (const id of targets) {
    // Deleting a temp tree can walk a lot of inodes; give it room.
    const { stdout, stderr, code } = await runSSHCommand(connection, CLEANUP_COMMANDS[id], { timeoutMs: 120000 });
    // On failure the reason is almost always on stderr (apt's permission
    // warnings land there while stdout stays empty), so prefer it.
    const message =
      code === 0
        ? lastLine(stdout) || "cleaned"
        : lastLine(stderr) || lastLine(stdout) || `command failed (exit ${code})`;
    ran.push({ id, ok: code === 0, message });
  }

  // Re-scan so "reclaimed" is measured, not predicted.
  const after = await scanDiskCleanup(connection);
  const afterById = new Map(after.map((e) => [e.id, e.sizeKb]));
  const results: CleanupResultEntry[] = ran.map((r) => {
    const beforeKb = beforeById.get(r.id) ?? 0;
    const afterKb = afterById.get(r.id) ?? 0;
    return { ...r, beforeKb, afterKb, reclaimedKb: Math.max(0, beforeKb - afterKb) };
  });

  return { results, scan: after };
}
