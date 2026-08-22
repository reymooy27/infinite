// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  Server,
  RefreshCw,
  X,
  Skull,
  Plug,
} from "lucide-react";
import { useSSHStore } from "@/stores/useSSHStore";
import type { SSHConnection } from "@/types";

interface SysStats {
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

const POLL_MS = 2000;

function fmtKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${kb}K`;
}

function fmtBytesPerSec(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB/s`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB/s`;
  return `${Math.round(b)} B/s`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}m`].filter(Boolean).join(" ");
}

// Green → yellow → red as load rises, matching btop's meter feel.
function loadColor(pct: number): string {
  if (pct >= 85) return "bg-red-500";
  if (pct >= 60) return "bg-yellow-500";
  return "bg-green-500";
}

function Meter({ pct, className = "" }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-neutral-800 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${loadColor(clamped)}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function ConnectionPicker({
  connections,
  onSelect,
}: {
  connections: SSHConnection[];
  onSelect: (c: SSHConnection) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-2 text-neutral-400">
        <Activity size={32} />
        <p className="text-sm">Select a server to monitor</p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        {connections.map((conn) => (
          <button
            key={conn.id}
            onClick={() => onSelect(conn)}
            className="flex w-full items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-800/70 px-3 py-3 text-left transition-colors cursor-pointer hover:border-blue-500 hover:bg-neutral-800"
          >
            <span className="mt-0.5 text-blue-400">
              <Server size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-neutral-100">
                {conn.name}
              </span>
              <span className="mt-1 block text-xs text-neutral-400">
                {conn.username}@{conn.host}:{conn.port}
              </span>
            </span>
          </button>
        ))}
        {connections.length === 0 && (
          <p className="text-center text-xs text-neutral-500">
            No SSH connections. Add one in the SSH sidebar.
          </p>
        )}
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  right,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
          <span className="text-blue-400">{icon}</span>
          {title}
        </div>
        {right && <div className="text-[11px] text-neutral-400">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export default function SysMonitor({
  connectionId,
  onClose,
  onConnectionChange,
}: {
  connectionId?: number;
  onClose?: () => void;
  onConnectionChange?: (id: number | null) => void;
}) {
  const connections = useSSHStore((s) => s.connections);
  const fetchConnections = useSSHStore((s) => s.fetchConnections);

  const [selected, setSelected] = useState<SSHConnection | null>(() =>
    connectionId ? connections.find((c) => c.id === connectionId) ?? null : null,
  );
  const [stats, setStats] = useState<SysStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [procSort, setProcSort] = useState<"cpu" | "mem">("cpu");
  const [confirm, setConfirm] = useState<{ message: string; pid: number } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (connectionId == null) return;
    const found = connections.find((c) => c.id === connectionId) ?? null;
    if (found && found.id !== selected?.id) setSelected(found);
  }, [connectionId, connections, selected?.id]);

  const handleSelect = useCallback(
    (conn: SSHConnection | null) => {
      setSelected(conn);
      setStats(null);
      setError(null);
      onConnectionChange?.(conn?.id ?? null);
    },
    [onConnectionChange],
  );

  const selectedId = selected?.id;

  const load = useCallback(async () => {
    if (!selectedId || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/sysmon/${selectedId}/stats?sort=${procSort}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load stats");
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [selectedId, procSort]);

  const killProc = useCallback(
    async (pid: number, signal: "TERM" | "KILL") => {
      if (!selectedId) return;
      try {
        const res = await fetch(`/api/sysmon/${selectedId}/kill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, signal }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "Kill failed");
        void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kill failed");
      }
    },
    [selectedId, load],
  );

  // Poll on an interval; the fetch itself takes ~0.6s (server samples /proc
  // around a sleep), so POLL_MS is the gap between samples, not a hard cadence.
  useEffect(() => {
    if (!selectedId) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, selectedId]);

  const memPct = stats && stats.mem.totalKb ? (stats.mem.usedKb / stats.mem.totalKb) * 100 : 0;
  const swapPct = stats && stats.mem.swapTotalKb ? (stats.mem.swapUsedKb / stats.mem.swapTotalKb) * 100 : 0;

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0a0a0a]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
          <Activity size={14} className="text-blue-400" />
          System Monitor
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            title="Refresh"
            disabled={!selectedId || loading}
            className="flex h-7 w-7 items-center justify-center rounded border border-neutral-700 text-neutral-300 cursor-pointer hover:bg-neutral-800 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded border border-neutral-700 text-neutral-400 cursor-pointer hover:bg-neutral-800 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-[11px] text-neutral-400">
        <Server size={12} />
        {selected ? (
          <>
            <span className="truncate">
              {selected.name} ({selected.username}@{selected.host})
            </span>
            {stats && (
              <span className="shrink-0 text-neutral-500">up {fmtUptime(stats.uptimeSec)}</span>
            )}
            <button
              onClick={() => handleSelect(null)}
              className="ml-auto shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 cursor-pointer hover:bg-neutral-800"
            >
              Change server
            </button>
          </>
        ) : (
          <span>No server selected</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selected ? (
          <ConnectionPicker connections={connections} onSelect={handleSelect} />
        ) : error && !stats ? (
          <div className="p-4 text-center text-xs text-red-400">{error}</div>
        ) : !stats ? (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-neutral-900" />
            ))}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <Card
              icon={<Cpu size={13} />}
              title="CPU"
              right={
                <span>
                  {stats.cpu.total.toFixed(0)}% · load {stats.load[0].toFixed(2)} {stats.load[1].toFixed(2)} {stats.load[2].toFixed(2)}
                </span>
              }
            >
              <Meter pct={stats.cpu.total} className="mb-2 h-2.5" />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                {stats.cpu.cores.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 font-mono text-[10px] text-neutral-500">
                      c{i}
                    </span>
                    <Meter pct={c} />
                    <span className="w-8 shrink-0 text-right font-mono text-[10px] text-neutral-400">
                      {c.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              icon={<MemoryStick size={13} />}
              title="Memory"
              right={<span>{fmtKb(stats.mem.usedKb)} / {fmtKb(stats.mem.totalKb)}</span>}
            >
              <Meter pct={memPct} className="h-2.5" />
              {stats.mem.swapTotalKb > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-[10px] text-neutral-500">
                    <span>swap</span>
                    <span>{fmtKb(stats.mem.swapUsedKb)} / {fmtKb(stats.mem.swapTotalKb)}</span>
                  </div>
                  <Meter pct={swapPct} />
                </div>
              )}
            </Card>

            <Card
              icon={<Network size={13} />}
              title="Network"
              right={
                <span className="font-mono">
                  ↓ {fmtBytesPerSec(stats.net.rxBytesPerSec)} · ↑ {fmtBytesPerSec(stats.net.txBytesPerSec)}
                </span>
              }
            >
              <div className="flex gap-2 text-[11px] text-neutral-400">
                <span className="flex-1 rounded bg-neutral-800/60 px-2 py-1.5 text-center">
                  <span className="text-green-400">↓</span> {fmtBytesPerSec(stats.net.rxBytesPerSec)}
                </span>
                <span className="flex-1 rounded bg-neutral-800/60 px-2 py-1.5 text-center">
                  <span className="text-blue-400">↑</span> {fmtBytesPerSec(stats.net.txBytesPerSec)}
                </span>
              </div>
            </Card>

            {stats.disks.length > 0 && (
              <Card icon={<HardDrive size={13} />} title="Disks">
                <div className="space-y-1.5">
                  {stats.disks.map((d) => (
                    <div key={d.mount} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate font-mono text-[10px] text-neutral-400" title={d.mount}>
                        {d.mount}
                      </span>
                      <Meter pct={d.usePct} />
                      <span className="w-24 shrink-0 text-right font-mono text-[10px] text-neutral-500">
                        {fmtKb(d.usedKb)}/{fmtKb(d.sizeKb)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card
              icon={<Activity size={13} />}
              title="Top processes"
              right={
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setProcSort("cpu")}
                    className={`rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${
                      procSort === "cpu"
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    CPU
                  </button>
                  <button
                    onClick={() => setProcSort("mem")}
                    className={`rounded px-1.5 py-0.5 text-[10px] cursor-pointer ${
                      procSort === "mem"
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    MEM
                  </button>
                </div>
              }
            >
              <div className="overflow-hidden rounded">
                <div className="flex gap-2 border-b border-neutral-800 pb-1 text-[10px] font-medium text-neutral-500">
                  <span className="w-12 shrink-0">PID</span>
                  <span className="flex-1">Command</span>
                  <span className={`w-12 shrink-0 text-right ${procSort === "cpu" ? "text-neutral-300" : ""}`}>CPU%</span>
                  <span className={`w-16 shrink-0 text-right ${procSort === "mem" ? "text-neutral-300" : ""}`}>MEM</span>
                  <span className="w-8 shrink-0" />
                </div>
                {stats.procs.map((p) => (
                  <div key={p.pid} className="group flex items-center gap-2 py-0.5 font-mono text-[10px] text-neutral-300">
                    <span className="w-12 shrink-0 text-neutral-500">{p.pid}</span>
                    <span className="flex-1 truncate" title={p.command}>{p.command}</span>
                    <span className="w-12 shrink-0 text-right text-green-400">{p.cpu.toFixed(1)}</span>
                    <span
                      className="w-16 shrink-0 text-right text-blue-400"
                      title={`${p.mem.toFixed(1)}%`}
                    >
                      {fmtKb(p.rssKb)}
                    </span>
                    <button
                      onClick={() =>
                        setConfirm({
                          message: `Kill process ${p.pid} (${p.command})?`,
                          pid: p.pid,
                        })
                      }
                      title="Kill process"
                      className="flex h-5 w-8 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors cursor-pointer hover:text-red-400 active:text-red-400"
                    >
                      <Skull size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              icon={<Plug size={13} />}
              title="Listening ports"
              right={<span>{stats.ports.length}</span>}
            >
              {stats.ports.length === 0 ? (
                <p className="py-2 text-center text-[11px] text-neutral-500">
                  No listening ports (or insufficient privileges)
                </p>
              ) : (
                <div className="overflow-hidden rounded">
                  <div className="flex gap-2 border-b border-neutral-800 pb-1 text-[10px] font-medium text-neutral-500">
                    <span className="w-16 shrink-0">Port</span>
                    <span className="w-10 shrink-0">Proto</span>
                    <span className="flex-1">Process</span>
                    <span className="w-8 shrink-0" />
                  </div>
                  {stats.ports.map((p) => (
                    <div
                      key={`${p.proto}-${p.address}-${p.port}-${p.pid}`}
                      className="group flex items-center gap-2 py-0.5 font-mono text-[10px] text-neutral-300"
                    >
                      <span className="w-16 shrink-0 text-amber-400">{p.port}</span>
                      <span className="w-10 shrink-0 text-neutral-500">{p.proto}</span>
                      <span className="flex-1 truncate" title={`${p.address}:${p.port}${p.pid ? ` · pid ${p.pid}` : ""}`}>
                        {p.process || "—"}
                        {p.pid ? <span className="text-neutral-600"> ({p.pid})</span> : ""}
                      </span>
                      {p.pid ? (
                        <button
                          onClick={() =>
                            setConfirm({
                              message: `Kill ${p.process || "process"} on port ${p.port} (pid ${p.pid})?`,
                              pid: p.pid,
                            })
                          }
                          title="Kill process holding this port"
                          className="flex h-5 w-8 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors cursor-pointer hover:text-red-400 active:text-red-400"
                        >
                          <Skull size={12} />
                        </button>
                      ) : (
                        <span className="w-8 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {confirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="w-[calc(100%-32px)] max-w-xs rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
            <p className="text-sm text-neutral-200">{confirm.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 cursor-pointer hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void killProc(confirm.pid, "TERM");
                  setConfirm(null);
                }}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 cursor-pointer hover:bg-neutral-800"
              >
                Term
              </button>
              <button
                onClick={() => {
                  void killProc(confirm.pid, "KILL");
                  setConfirm(null);
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white cursor-pointer hover:bg-red-500"
              >
                Kill -9
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


