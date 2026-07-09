"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCw,
  X,
} from "lucide-react";

type GitChange = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  workTreeStatus: string;
  label: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
};

type GitStatusPayload = {
  projectId: string;
  projectName: string;
  directory: string | null;
  available: boolean;
  isRepo: boolean;
  reason: string | null;
  repoRoot: string | null;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  clean: boolean;
  changes: GitChange[];
  scannedAt: string;
};

interface FocusModeGitPanelProps {
  open: boolean;
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  onClose: () => void;
}

type GitTreeNode = {
  name: string;
  path: string;
  folders: GitTreeNode[];
  files: GitChange[];
};

function getStatusText(change: GitChange) {
  if (change.conflicted) return "U";
  if (change.untracked) return "A";
  if (change.indexStatus === "R" || change.workTreeStatus === "R") return "R";
  if (change.indexStatus === "D" || change.workTreeStatus === "D") return "D";
  if (change.indexStatus === "A") return "A";
  if (change.indexStatus === "M" || change.workTreeStatus === "M") return "M";
  if (change.indexStatus === "C" || change.workTreeStatus === "C") return "C";
  return "•";
}

function getStatusClassName(change: GitChange) {
  if (change.conflicted) return "text-red-300";
  if (change.untracked) return "text-emerald-300";
  if (change.indexStatus === "R" || change.workTreeStatus === "R") return "text-sky-300";
  if (change.indexStatus === "D" || change.workTreeStatus === "D") return "text-rose-300";
  if (change.staged && change.unstaged) return "text-amber-200";
  if (change.staged) return "text-sky-300";
  if (change.workTreeStatus === "M") return "text-yellow-200";
  return "text-neutral-400";
}

function buildGitTree(changes: GitChange[]) {
  const root = new Map<string, GitTreeNode>();

  for (const change of changes) {
    const parts = change.path.split("/").filter(Boolean);

    if (parts.length <= 1) {
      let bucket = root.get("__root__");
      if (!bucket) {
        bucket = { name: "", path: "", folders: [], files: [] };
        root.set("__root__", bucket);
      }
      bucket.files.push(change);
      continue;
    }

    const fileName = parts[parts.length - 1];
    const folders = parts.slice(0, -1);
    let currentMap = root;
    let currentNode: GitTreeNode | null = null;
    let currentPath = "";

    for (const segment of folders) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let next = currentMap.get(currentPath);
      if (!next) {
        next = { name: segment, path: currentPath, folders: [], files: [] };
        currentMap.set(currentPath, next);
        if (currentNode) {
          currentNode.folders.push(next);
        }
      }
      currentNode = next;
      const childMap = new Map<string, GitTreeNode>();
      for (const folder of next.folders) {
        childMap.set(folder.path, folder);
      }
      currentMap = childMap;
    }

    if (currentNode) {
      currentNode.files.push({ ...change, path: fileName });
    }
  }

  const rootNode = root.get("__root__");
  const topFolders = Array.from(root.values()).filter((node) => node.path !== "");

  const sortTree = (nodes: GitTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      node.folders = sortTree(node.folders);
      node.files.sort((a, b) => a.path.localeCompare(b.path));
    }
    return nodes;
  };

  return {
    folders: sortTree(topFolders),
    files: [...(rootNode?.files ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function FocusModeGitPanel({
  open,
  projectId,
  connectionId,
  directory,
  onClose,
}: FocusModeGitPanelProps) {
  const [data, setData] = useState<GitStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const loadStatus = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      if (!projectId) {
        setData(null);
        setError("");
        return;
      }

      if (!silent) {
        setLoading(true);
      }
      setError("");

      try {
        const query = new URLSearchParams();
        if (typeof connectionId === "number" && Number.isFinite(connectionId)) {
          query.set("connectionId", String(connectionId));
        }
        if (directory?.trim()) {
          query.set("directory", directory.trim());
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        const res = await fetch(`/api/projects/${projectId}/git-status${suffix}`, {
          cache: "no-store",
          signal,
        });
        const body = await res.json();

        if (!res.ok) {
          throw new Error(body.error || "Failed to load git status");
        }

        setData(body);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load git status");
      } finally {
        if (!signal?.aborted && !silent) {
          setLoading(false);
        }
      }
    },
    [connectionId, directory, projectId],
  );

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => {
      void loadStatus(controller.signal);
    }, 0);

    const intervalId = window.setInterval(() => {
      void loadStatus(controller.signal, true);
    }, 5000);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadStatus, open]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  if (!open) return null;

  const tree = data ? buildGitTree(data.changes) : { folders: [], files: [] };

  const renderFile = (change: GitChange, depth: number) => (
    <div
      key={`${depth}-${change.path}-${change.indexStatus}-${change.workTreeStatus}`}
      className="group flex items-start gap-2 rounded-md px-2 py-1 text-[12px] text-neutral-300 hover:bg-neutral-800/70"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      title={change.originalPath ? `${change.label}: ${change.originalPath} -> ${change.path}` : change.label}
    >
      <FileCode2 size={14} className="mt-0.5 shrink-0 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-neutral-200">{change.path}</span>
          <span className={`shrink-0 text-[11px] font-semibold ${getStatusClassName(change)}`}>
            {getStatusText(change)}
          </span>
        </div>
        {change.originalPath && (
          <p className="truncate text-[10px] text-neutral-500">from {change.originalPath}</p>
        )}
      </div>
    </div>
  );

  const renderFolder = (node: GitTreeNode, depth: number): React.ReactNode => {
    const collapsed = collapsedFolders[node.path] ?? false;

    return (
      <div key={node.path}>
        <button
          onClick={() => toggleFolder(node.path)}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[12px] text-neutral-300 hover:bg-neutral-800/70"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {collapsed ? (
            <ChevronRight size={13} className="shrink-0 text-neutral-500" />
          ) : (
            <ChevronDown size={13} className="shrink-0 text-neutral-500" />
          )}
          {collapsed ? (
            <Folder size={14} className="shrink-0 text-sky-300" />
          ) : (
            <FolderOpen size={14} className="shrink-0 text-sky-300" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!collapsed && (
          <div>
            {node.folders.map((child) => renderFolder(child, depth + 1))}
            {node.files.map((change) => renderFile(change, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[24rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitBranch size={15} className="shrink-0 text-neutral-300" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-100">Git changes</p>
              <p className="truncate text-[11px] text-neutral-500">
                {data?.projectName ?? "Active project"}
              </p>
            </div>
          </div>
          <button
            onClick={() => void loadStatus()}
            title="Refresh git status"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onClose}
            title="Close git sidebar"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !data && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-6 text-center text-sm text-neutral-400">
              Loading git status...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {!error && data && (
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-100">
                    {data.detached ? "Detached HEAD" : data.branch ?? "No branch"}
                  </span>
                  {data.upstream && (
                    <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                      {data.upstream}
                    </span>
                  )}
                  {data.ahead > 0 && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-100">
                      ahead {data.ahead}
                    </span>
                  )}
                  {data.behind > 0 && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                      behind {data.behind}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Staged</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.stagedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Modified</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.unstagedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Untracked</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.untrackedCount}</p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-neutral-400">
                    <p>Conflicts</p>
                    <p className="mt-1 text-lg text-neutral-100">{data.conflictedCount}</p>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-neutral-500">
                  <p className="truncate">{data.directory ?? "No directory"}</p>
                  <p className="truncate">Updated {formatTimestamp(data.scannedAt)}</p>
                </div>
              </div>

              {!data.available && (
                <div className="flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-3 text-sm text-neutral-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                  <p>{data.reason ?? "Project directory not configured"}</p>
                </div>
              )}

              {data.available && !data.isRepo && (
                <div className="flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3 py-3 text-sm text-neutral-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                  <p>{data.reason ?? "Directory is not a git repository"}</p>
                </div>
              )}

              {data.isRepo && data.clean && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
                  Working tree clean
                </div>
              )}

              {data.isRepo && data.changes.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                  <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                    <span>Files</span>
                    <span>{data.changes.length}</span>
                  </div>
                  <div className="py-1">
                    {tree.folders.map((node) => renderFolder(node, 0))}
                    {tree.files.map((change) => renderFile(change, 0))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
