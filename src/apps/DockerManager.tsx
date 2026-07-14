"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Play,
  Square,
  RotateCw,
  Pause,
  Trash2,
  Eye,
  Terminal,
  Network,
  Database,
  HardDrive,
  RefreshCw,
  AlertTriangle,
  Server,
  Container as ContainerIcon,
  X,
} from "lucide-react";
import { useSSHStore } from "@/stores/useSSHStore";
import type { SSHConnection } from "@/types";

interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "created" | "restarting" | "dead" | "removing" | "other";
  ports: string;
  created: string;
  cpuPerc?: string;
  memUsage?: string;
}

interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

interface DockerVolume {
  name: string;
  driver: string;
  size: string;
  created: string;
}

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

type Tab = "containers" | "images" | "volumes" | "networks";

const STATE_COLORS: Record<DockerContainer["state"], string> = {
  running: "bg-green-500",
  exited: "bg-neutral-500",
  paused: "bg-yellow-500",
  created: "bg-blue-500",
  restarting: "bg-yellow-500",
  dead: "bg-red-500",
  removing: "bg-yellow-500",
  other: "bg-neutral-600",
};

function StateBadge({ state }: { state: DockerContainer["state"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300">
      <span className={`h-2 w-2 rounded-full ${STATE_COLORS[state]}`} />
      {state}
    </span>
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
        <Boxes size={32} />
        <p className="text-sm">Select a server to manage Docker</p>
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

function ContainerRow({
  container,
  onAction,
}: {
  container: DockerContainer;
  onAction: (action: string, id: string) => void;
}) {
  const running = container.state === "running";
  const paused = container.state === "paused";
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-100">
              {container.names}
            </span>
            <StateBadge state={container.state} />
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-400">
            {container.image}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
            {container.id.slice(0, 12)}
            {container.ports ? ` · ${container.ports}` : ""}
          </div>
          {(container.cpuPerc || container.memUsage) && (
            <div className="mt-1 font-mono text-[11px] text-neutral-400">
              CPU {container.cpuPerc || "—"} · {container.memUsage || "—"}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!running && !paused && (
            <IconBtn title="Start" onClick={() => onAction("start", container.id)}>
              <Play size={14} />
            </IconBtn>
          )}
          {running && (
            <IconBtn title="Stop" onClick={() => onAction("stop", container.id)}>
              <Square size={14} />
            </IconBtn>
          )}
          <IconBtn title="Restart" onClick={() => onAction("restart", container.id)}>
            <RotateCw size={14} />
          </IconBtn>
          {!paused && running && (
            <IconBtn title="Pause" onClick={() => onAction("pause", container.id)}>
              <Pause size={14} />
            </IconBtn>
          )}
          {paused && (
            <IconBtn title="Unpause" onClick={() => onAction("unpause", container.id)}>
              <Play size={14} />
            </IconBtn>
          )}
          <IconBtn
            title="Remove"
            danger
            onClick={() => onAction("remove", container.id)}
          >
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md border border-neutral-700 transition-colors cursor-pointer ${
        danger
          ? "text-red-400 hover:bg-red-500/15 hover:border-red-500/50"
          : "text-neutral-300 hover:bg-neutral-700 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-10 text-center text-xs text-neutral-500">{label}</div>
  );
}

function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="w-[calc(100%-32px)] max-w-xs rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
        <div className="flex items-start gap-2 text-amber-400">
          <AlertTriangle size={18} />
          <p className="text-sm text-neutral-200">{message}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 cursor-pointer hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white cursor-pointer hover:bg-red-500"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <h3 className="text-xs font-semibold text-neutral-200">{title}</h3>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
        >
          ✕
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11px] text-neutral-300">
        {content}
      </pre>
    </div>
  );
}

export default function DockerManager({
  connectionId,
  windowId,
  onClose,
  onConnectionChange,
}: {
  connectionId?: number;
  windowId?: string;
  onClose?: () => void;
  onConnectionChange?: (id: number | null) => void;
}) {
  void windowId;
  const connections = useSSHStore((s) => s.connections);
  const fetchConnections = useSSHStore((s) => s.fetchConnections);

  const [selectedConnection, setSelectedConnection] = useState<SSHConnection | null>(
    () => {
      if (connectionId) {
        const found = connections.find((c) => c.id === connectionId);
        return found ?? null;
      }
      return null;
    },
  );

  const handleSelectConnection = useCallback(
    (conn: SSHConnection | null) => {
      setSelectedConnection(conn);
      onConnectionChange?.(conn?.id ?? null);
    },
    [onConnectionChange],
  );
  const [tab, setTab] = useState<Tab>("containers");
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; content: string } | null>(
    null,
  );

  const apiBase =
    typeof window !== "undefined"
      ? (window as unknown as { __INFINITE_API_BASE__?: string }).__INFINITE_API_BASE__ ??
        `${window.location.protocol}//${window.location.hostname}:7891`
      : "http://localhost:7891";

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (connectionId == null) return;
    const found = connections.find((c) => c.id === connectionId) ?? null;
    if (!found || found.id === selectedConnection?.id) return;
    const handle = setTimeout(() => setSelectedConnection(found), 0);
    return () => clearTimeout(handle);
  }, [connectionId, connections, selectedConnection?.id]);

  const selectedId = selectedConnection?.id;

  const loadAll = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, i, v, n] = await Promise.all([
        fetch(`${apiBase}/api/docker/${selectedId}/containers?all=1`).then((r) =>
          r.json(),
        ),
        fetch(`${apiBase}/api/docker/${selectedId}/images`).then((r) => r.json()),
        fetch(`${apiBase}/api/docker/${selectedId}/volumes`).then((r) => r.json()),
        fetch(`${apiBase}/api/docker/${selectedId}/networks`).then((r) => r.json()),
      ]);
      if (c.error) throw new Error(c.error);
      if (i.error) throw new Error(i.error);
      if (v.error) throw new Error(v.error);
      if (n.error) throw new Error(n.error);
      setContainers(c.containers ?? []);
      setImages(i.images ?? []);
      setVolumes(v.volumes ?? []);
      setNetworks(n.networks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Docker data");
    } finally {
      setLoading(false);
    }
  }, [apiBase, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const handle = setTimeout(() => {
      void loadAll();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadAll, selectedId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const runContainerAction = useCallback(
    async (action: string, id: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/containers/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, force: action === "remove" }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || `Failed to ${action}`);
        }
        showToast(`${action} ok`);
        await loadAll();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Action failed");
      }
    },
    [apiBase, loadAll, selectedId, showToast],
  );

  const removeImage = useCallback(
    async (id: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/images/remove`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, force: true }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "Failed to remove");
        showToast("image removed");
        await loadAll();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Remove failed");
      }
    },
    [apiBase, loadAll, selectedId, showToast],
  );

  const removeVolume = useCallback(
    async (name: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/volumes/remove`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, force: true }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "Failed to remove");
        showToast("volume removed");
        await loadAll();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Remove failed");
      }
    },
    [apiBase, loadAll, selectedId, showToast],
  );

  const removeNetwork = useCallback(
    async (id: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/networks/remove`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "Failed to remove");
        showToast("network removed");
        await loadAll();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Remove failed");
      }
    },
    [apiBase, loadAll, selectedId, showToast],
  );

  const prune = useCallback(async () => {
    if (!selectedId) return;
    setConfirm({
      message: "Prune unused containers, images, networks and build cache?",
      onConfirm: async () => {
        setConfirm(null);
        try {
          const res = await fetch(`${apiBase}/api/docker/${selectedId}/prune`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ volumes: false }),
          });
          const data = await res.json();
          showToast("prune done");
          setDrawer({
            title: "Prune result",
            content: JSON.stringify(data, null, 2),
          });
          await loadAll();
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Prune failed");
        }
      },
    });
  }, [apiBase, loadAll, selectedId, showToast]);

  const viewLogs = useCallback(
    async (id: string, name: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/containers/${id}/logs?tail=500`,
        );
        const data = await res.json();
        setDrawer({ title: `Logs: ${name}`, content: data.logs ?? data.error ?? "" });
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load logs");
      }
    },
    [apiBase, selectedId, showToast],
  );

  const viewInspect = useCallback(
    async (id: string, name: string) => {
      if (!selectedId) return;
      try {
        const res = await fetch(
          `${apiBase}/api/docker/${selectedId}/containers/${id}/inspect`,
        );
        const data = await res.json();
        setDrawer({
          title: `Inspect: ${name}`,
          content:
            typeof data.inspect === "string"
              ? data.inspect
              : JSON.stringify(data, null, 2),
        });
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to inspect");
      }
    },
    [apiBase, selectedId, showToast],
  );

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "containers", label: "Containers", icon: <ContainerIcon size={14} /> },
    { id: "images", label: "Images", icon: <Boxes size={14} /> },
    { id: "volumes", label: "Volumes", icon: <Database size={14} /> },
    { id: "networks", label: "Networks", icon: <Network size={14} /> },
  ];

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="space-y-2 p-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-neutral-800" />
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <div className="p-4 text-center text-xs text-red-400">{error}</div>
      );
    }
    if (tab === "containers") {
      if (containers.length === 0)
        return <EmptyState label="No containers" />;
      return (
        <div className="space-y-2 p-3">
          {containers.map((c) => (
            <div key={c.id}>
              <ContainerRow container={c} onAction={(a, id) => runContainerAction(a, id)} />
              <div className="mt-1 flex justify-end gap-1 pr-1">
                <button
                  onClick={() => viewLogs(c.id, c.names)}
                  className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 cursor-pointer hover:bg-neutral-800"
                >
                  <Terminal size={12} /> Logs
                </button>
                <button
                  onClick={() => viewInspect(c.id, c.names)}
                  className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 cursor-pointer hover:bg-neutral-800"
                >
                  <Eye size={12} /> Inspect
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (tab === "images") {
      if (images.length === 0) return <EmptyState label="No images" />;
      return (
        <div className="space-y-1 p-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-neutral-100">
                  {img.repository || "<none>"}
                  {img.tag ? `:${img.tag}` : ""}
                </div>
                <div className="truncate font-mono text-[11px] text-neutral-500">
                  {img.id.slice(0, 20)} · {img.size} · {img.created}
                </div>
              </div>
              <IconBtn
                title="Remove"
                danger
                onClick={() =>
                  setConfirm({
                    message: `Remove image ${img.repository}:${img.tag}?`,
                    onConfirm: () => {
                      setConfirm(null);
                      removeImage(img.id);
                    },
                  })
                }
              >
                <Trash2 size={14} />
              </IconBtn>
            </div>
          ))}
        </div>
      );
    }
    if (tab === "volumes") {
      if (volumes.length === 0) return <EmptyState label="No volumes" />;
      return (
        <div className="space-y-1 p-3">
          {volumes.map((vol) => (
            <div
              key={vol.name}
              className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-neutral-100">{vol.name}</div>
                <div className="truncate font-mono text-[11px] text-neutral-500">
                  {vol.driver} · {vol.size || "—"}
                </div>
              </div>
              <IconBtn
                title="Remove"
                danger
                onClick={() =>
                  setConfirm({
                    message: `Remove volume ${vol.name}?`,
                    onConfirm: () => {
                      setConfirm(null);
                      removeVolume(vol.name);
                    },
                  })
                }
              >
                <Trash2 size={14} />
              </IconBtn>
            </div>
          ))}
        </div>
      );
    }
    if (networks.length === 0) return <EmptyState label="No networks" />;
    return (
      <div className="space-y-1 p-3">
        {networks.map((net) => (
          <div
            key={net.id}
            className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-neutral-100">{net.name}</div>
              <div className="truncate font-mono text-[11px] text-neutral-500">
                {net.id.slice(0, 20)} · {net.driver} · {net.scope}
              </div>
            </div>
            <IconBtn
              title="Remove"
              danger
              onClick={() =>
                setConfirm({
                  message: `Remove network ${net.name}?`,
                  onConfirm: () => {
                    setConfirm(null);
                    removeNetwork(net.id);
                  },
                })
              }
            >
              <Trash2 size={14} />
            </IconBtn>
          </div>
        ))}
      </div>
    );
  }, [containers, error, images, loading, networks, removeImage, removeNetwork, removeVolume, runContainerAction, tab, volumes, viewInspect, viewLogs]);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#0a0a0a]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors cursor-pointer shrink-0 ${
                tab === t.id
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={prune}
            title="Prune unused"
            className="flex items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 cursor-pointer hover:bg-neutral-800"
          >
            <HardDrive size={12} /> Prune
          </button>
          <button
            onClick={loadAll}
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
        {selectedConnection ? (
          <>
            <span className="truncate">
              {selectedConnection.name} ({selectedConnection.username}@{selectedConnection.host})
            </span>
            <button
              onClick={() => handleSelectConnection(null)}
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
        {!selectedConnection ? (
          <ConnectionPicker
            connections={connections}
            onSelect={handleSelectConnection}
          />
        ) : (
          content
        )}
      </div>

      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 shadow-lg">
          {toast}
        </div>
      )}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {drawer && (
        <DetailDrawer
          title={drawer.title}
          content={drawer.content}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
