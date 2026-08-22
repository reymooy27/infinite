import { runSSHCommand, type SSHConnection } from "./ssh.js";

// btop-style stats gathered in ONE ssh round-trip. We read /proc twice around a
// short sleep so CPU% and net rates are real deltas (like btop), not cumulative
// counters. Everything is parsed on the server into a flat JSON the UI renders.

export interface SysStats {
  cpu: { total: number; cores: number[] };
  load: [number, number, number];
  uptimeSec: number;
  mem: {
    totalKb: number;
    usedKb: number;
    availableKb: number;
    swapTotalKb: number;
    swapUsedKb: number;
  };
  net: { rxBytesPerSec: number; txBytesPerSec: number };
  disks: Array<{ fs: string; sizeKb: number; usedKb: number; usePct: number; mount: string }>;
  procs: Array<{ pid: number; command: string; cpu: number; mem: number; rssKb: number }>;
  ports: Array<{ proto: string; port: number; address: string; pid: number | null; process: string }>;
}

const SLEEP_SEC = 0.6;

// One command, section-delimited. Single-quoted markers so the remote shell
// echoes them verbatim. `sortKey` picks the ps sort column so top-N is correct
// for whichever column the UI is showing (sorting client-side would only see
// the top-CPU slice and miss memory-heavy idle processes).
function buildScript(sortKey: "cpu" | "mem"): string {
  const sortFlag = sortKey === "mem" ? "-%mem" : "-%cpu";
  return [
    "echo @@STAT1", "cat /proc/stat",
    "echo @@NET1", "cat /proc/net/dev",
    `sleep ${SLEEP_SEC}`,
    "echo @@STAT2", "cat /proc/stat",
    "echo @@NET2", "cat /proc/net/dev",
    "echo @@MEM", "cat /proc/meminfo",
    "echo @@LOAD", "cat /proc/loadavg",
    "echo @@UPTIME", "cat /proc/uptime",
    "echo @@DISK", "df -Pk -x tmpfs -x devtmpfs -x squashfs 2>/dev/null",
    "echo @@PROC", `ps -eo pid,%cpu,%mem,rss,comm --sort=${sortFlag} 2>/dev/null | head -n 21`,
    // Listening sockets. `ss` is on modern distros; fall back to netstat. -p needs
    // privileges to see PID/name of *other* users' sockets, so those may be blank.
    "echo @@PORTS", "ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null",
  ].join("; ");
}

function splitSections(out: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = "";
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r/g, "");
    const m = line.match(/^@@(\w+)$/);
    if (m) {
      current = m[1];
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  return sections;
}

// cpu line fields: user nice system idle iowait irq softirq steal ...
function parseCpuLines(lines: string[]): Record<string, { total: number; idle: number }> {
  const map: Record<string, { total: number; idle: number }> = {};
  for (const line of lines) {
    if (!line.startsWith("cpu")) continue;
    const parts = line.trim().split(/\s+/);
    const label = parts[0]; // "cpu" (aggregate) or "cpu0", "cpu1", ...
    const nums = parts.slice(1).map(Number);
    if (nums.length < 5) continue;
    const total = nums.reduce((a, b) => a + b, 0);
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0); // idle + iowait
    map[label] = { total, idle };
  }
  return map;
}

function cpuUsage(
  before: { total: number; idle: number } | undefined,
  after: { total: number; idle: number } | undefined,
): number {
  if (!before || !after) return 0;
  const totalD = after.total - before.total;
  const idleD = after.idle - before.idle;
  if (totalD <= 0) return 0;
  return Math.max(0, Math.min(100, ((totalD - idleD) / totalD) * 100));
}

// Sum rx (col 1) and tx (col 9) bytes across real interfaces (skip lo).
function parseNetTotals(lines: string[]): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const iface = line.slice(0, idx).trim();
    if (iface === "lo") continue;
    const cols = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    if (cols.length < 9) continue;
    rx += cols[0] ?? 0;
    tx += cols[8] ?? 0;
  }
  return { rx, tx };
}

function parseMeminfo(lines: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const line of lines) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) map[m[1]] = Number(m[2]);
  }
  return map;
}

export async function getSysStats(
  connection: SSHConnection,
  opts: { sort?: "cpu" | "mem" } = {},
): Promise<SysStats> {
  const { stdout, code } = await runSSHCommand(connection, buildScript(opts.sort ?? "cpu"), { timeoutMs: 15000 });
  if (code !== 0 && !stdout.includes("@@STAT2")) {
    throw new Error("Failed to read system stats (is this a Linux host?)");
  }
  const s = splitSections(stdout);

  const cpu1 = parseCpuLines(s.STAT1 ?? []);
  const cpu2 = parseCpuLines(s.STAT2 ?? []);
  const coreLabels = Object.keys(cpu2)
    .filter((k) => /^cpu\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const cores = coreLabels.map((k) => cpuUsage(cpu1[k], cpu2[k]));
  const total = cpuUsage(cpu1.cpu, cpu2.cpu);

  const net1 = parseNetTotals(s.NET1 ?? []);
  const net2 = parseNetTotals(s.NET2 ?? []);
  const net = {
    rxBytesPerSec: Math.max(0, (net2.rx - net1.rx) / SLEEP_SEC),
    txBytesPerSec: Math.max(0, (net2.tx - net1.tx) / SLEEP_SEC),
  };

  const mi = parseMeminfo(s.MEM ?? []);
  const memTotal = mi.MemTotal ?? 0;
  const memAvail = mi.MemAvailable ?? mi.MemFree ?? 0;
  const swapTotal = mi.SwapTotal ?? 0;
  const swapFree = mi.SwapFree ?? 0;
  const mem = {
    totalKb: memTotal,
    availableKb: memAvail,
    usedKb: Math.max(0, memTotal - memAvail),
    swapTotalKb: swapTotal,
    swapUsedKb: Math.max(0, swapTotal - swapFree),
  };

  const loadParts = (s.LOAD?.[0] ?? "").trim().split(/\s+/).map(Number);
  const load: [number, number, number] = [
    loadParts[0] || 0,
    loadParts[1] || 0,
    loadParts[2] || 0,
  ];

  const uptimeSec = Number((s.UPTIME?.[0] ?? "0").trim().split(/\s+/)[0]) || 0;

  // df -Pk output: Filesystem 1024-blocks Used Available Capacity Mounted-on
  const disks = (s.DISK ?? [])
    .slice(1) // drop header
    .map((line) => line.trim().split(/\s+/))
    .filter((c) => c.length >= 6)
    .map((c) => ({
      fs: c[0],
      sizeKb: Number(c[1]) || 0,
      usedKb: Number(c[2]) || 0,
      usePct: Number((c[4] || "0").replace("%", "")) || 0,
      mount: c.slice(5).join(" "),
    }))
    .filter((d) => d.sizeKb > 0);

  // ps output: PID %CPU %MEM RSS(kb) COMMAND
  const procs = (s.PROC ?? [])
    .slice(1) // drop header
    .map((line) => line.trim().split(/\s+/))
    .filter((c) => c.length >= 5 && /^\d+$/.test(c[0]))
    .map((c) => ({
      pid: Number(c[0]),
      cpu: Number(c[1]) || 0,
      mem: Number(c[2]) || 0,
      rssKb: Number(c[3]) || 0,
      command: c.slice(4).join(" "),
    }));

  return { cpu: { total, cores }, load, uptimeSec, mem, net, disks, procs, ports: parsePorts(s.PORTS ?? []) };
}

// Parse `ss -tulnp` (preferred) or `netstat -tulnp` listening sockets into a
// deduped, port-sorted list. Both tools vary in column layout, so we key off
// stable landmarks: the "LISTEN" state and the users:(("name",pid=N,...)) blob.
function parsePorts(lines: string[]): SysStats["ports"] {
  const out: SysStats["ports"] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !/\bLISTEN\b/.test(line)) continue;
    const cols = line.split(/\s+/);
    const proto = (cols[0] || "").toLowerCase(); // tcp/tcp6/udp...
    if (!/^(tcp|udp)/.test(proto)) continue;

    // Local address:port is the column right before or containing LISTEN's row.
    // Grab the last host:port-looking token that precedes the process blob.
    const addrToken = cols.find((c, i) => i > 0 && /:\d+$/.test(c) && !c.includes("users:"));
    if (!addrToken) continue;
    const idx = addrToken.lastIndexOf(":");
    const address = addrToken.slice(0, idx) || "*";
    const port = Number(addrToken.slice(idx + 1));
    if (!port) continue;

    // Process: users:(("nginx",pid=1234,fd=6)) — ss; or  1234/nginx — netstat.
    let process = "";
    let pid: number | null = null;
    const ssMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    const netMatch = line.match(/\s(\d+)\/(\S+)\s*$/);
    if (ssMatch) {
      process = ssMatch[1];
      pid = Number(ssMatch[2]);
    } else if (netMatch) {
      pid = Number(netMatch[1]);
      process = netMatch[2];
    }

    const key = `${proto}:${address}:${port}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ proto: proto.startsWith("udp") ? "udp" : "tcp", port, address, pid, process });
  }
  return out.sort((a, b) => a.port - b.port);
}

// Kill a process by PID. signal defaults to TERM (graceful); pass "KILL" for -9.
export async function killProcess(
  connection: SSHConnection,
  pid: number,
  signal: "TERM" | "KILL" = "TERM",
): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(pid) || pid <= 1) {
    // Guard: pid must be a real, non-init process. Blocks 0/1 and NaN before
    // it ever reaches the remote shell.
    return { ok: false, message: "Invalid PID" };
  }
  const { stderr, code } = await runSSHCommand(connection, `kill -${signal} ${pid}`);
  if (code !== 0) {
    return { ok: false, message: stderr.trim() || `Failed to kill ${pid}` };
  }
  return { ok: true, message: `Sent SIG${signal} to ${pid}` };
}
