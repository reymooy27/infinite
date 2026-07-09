"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Plus,
  RefreshCw,
  Upload,
  Download,
  Trash2,
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

type GitLastCommit = {
  hash: string;
  subject: string;
  relativeDate: string;
  authorName: string;
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
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  stashCount: number;
  branches: string[];
  lastCommit: GitLastCommit | null;
  clean: boolean;
  changes: GitChange[];
  scannedAt: string;
};

type GitAction =
  | "stage"
  | "stage_all"
  | "unstage"
  | "unstage_all"
  | "discard"
  | "commit"
  | "checkout_branch"
  | "create_branch"
  | "pull"
  | "push";

type GitActionResponse = {
  ok: boolean;
  stdout: string;
  stderr: string;
  nextStatus: GitStatusPayload;
};

type GitTreeFileNode = {
  name: string;
  change: GitChange;
};

type GitTreeNode = {
  name: string;
  path: string;
  folders: GitTreeNode[];
  files: GitTreeFileNode[];
};

type ConfirmationState =
  | null
  | {
      title: string;
      message: string;
      action: GitAction;
      branch?: string;
      paths?: string[];
      messageText?: string;
    };

interface FocusModeGitPanelProps {
  open: boolean;
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  onClose: () => void;
}

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
      bucket.files.push({ name: change.path, change });
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
        if (currentNode) currentNode.folders.push(next);
      }
      currentNode = next;
      const childMap = new Map<string, GitTreeNode>();
      for (const folder of next.folders) {
        childMap.set(folder.path, folder);
      }
      currentMap = childMap;
    }

    if (currentNode) {
      currentNode.files.push({ name: fileName, change });
    }
  }

  const sortTree = (nodes: GitTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      node.folders = sortTree(node.folders);
      node.files.sort((a, b) => a.name.localeCompare(b.name));
    }
    return nodes;
  };

  const rootNode = root.get("__root__");
  return {
    folders: sortTree(Array.from(root.values()).filter((node) => node.path !== "")),
    files: [...(rootNode?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function collectFolderPaths(node: GitTreeNode): string[] {
  return [
    ...node.files.map((file) => file.change.path),
    ...node.folders.flatMap((child) => collectFolderPaths(child)),
  ];
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

function getFeedbackToneClass(kind: "success" | "error") {
  return kind === "success"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
    : "border-red-500/20 bg-red-500/10 text-red-200";
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
  const [actionBusy, setActionBusy] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [stageAllBeforeCommit, setStageAllBeforeCommit] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);

  const loadStatus = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      if (!projectId) {
        setData(null);
        setError("");
        return;
      }

      if (!silent) setLoading(true);
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
        if (!signal?.aborted && !silent) setLoading(false);
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

  const tree = useMemo(
    () => (data ? buildGitTree(data.changes) : { folders: [], files: [] }),
    [data],
  );

  const executeAction = useCallback(
    async (payload: { action: GitAction; paths?: string[]; branch?: string; message?: string }) => {
      if (!projectId) return;

      setActionBusy(true);
      setFeedback(null);
      setError("");

      try {
        const res = await fetch(`/api/projects/${projectId}/git/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: payload.action,
            connectionId,
            directory,
            paths: payload.paths,
            branch: payload.branch,
            message: payload.message,
          }),
        });
        const body = (await res.json()) as Partial<GitActionResponse> & { error?: string };

        if (!res.ok || !body.ok || !body.nextStatus) {
          throw new Error(body.error || body.stderr || body.stdout || "Git action failed");
        }

        setData(body.nextStatus);
        if (payload.action === "commit") {
          setCommitMessage("");
        }
        if (payload.action === "checkout_branch" || payload.action === "create_branch") {
          setBranchMenuOpen(false);
          setNewBranchName("");
        }

        const summary =
          body.stdout?.trim() ||
          ({
            stage: "Files staged",
            stage_all: "All changes staged",
            unstage: "Files unstaged",
            unstage_all: "All staged changes cleared",
            discard: "Changes discarded",
            commit: "Commit created",
            checkout_branch: `Switched to ${payload.branch}`,
            create_branch: `Created ${payload.branch}`,
            pull: "Pull complete",
            push: "Push complete",
          }[payload.action] ?? "Git action complete");

        setFeedback({ kind: "success", text: summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Git action failed";
        setFeedback({ kind: "error", text: message });
      } finally {
        setActionBusy(false);
      }
    },
    [connectionId, directory, projectId],
  );

  const requestAction = useCallback(
    (payload: { action: GitAction; paths?: string[]; branch?: string; message?: string }) => {
      if (payload.action === "discard") {
        setConfirmation({
          title: "Discard changes?",
          message: "This will restore tracked files and remove untracked files for selected paths.",
          ...payload,
        });
        return;
      }

      if (
        (payload.action === "checkout_branch" || payload.action === "create_branch") &&
        data &&
        !data.clean
      ) {
        setConfirmation({
          title: "Switch branch with local changes?",
          message: "Current working tree is dirty. Branch switch may fail or leave changes carried over.",
          ...payload,
        });
        return;
      }

      void executeAction(payload);
    },
    [data, executeAction],
  );

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return;

    if (stageAllBeforeCommit) {
      await executeAction({ action: "stage_all" });
    }
    await executeAction({ action: "commit", message });
  }, [commitMessage, executeAction, stageAllBeforeCommit]);

  const handleBranchCreate = useCallback(() => {
    const branch = newBranchName.trim();
    if (!branch) return;
    requestAction({ action: "create_branch", branch });
  }, [newBranchName, requestAction]);

  const renderRowActions = (change: GitChange) => (
    <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {!change.staged && (
        <button
          onClick={() => requestAction({ action: "stage", paths: [change.path] })}
          className="rounded px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/10"
          title="Stage file"
        >
          Stage
        </button>
      )}
      {change.staged && (
        <button
          onClick={() => requestAction({ action: "unstage", paths: [change.path] })}
          className="rounded px-1.5 py-0.5 text-[10px] text-amber-100 hover:bg-amber-500/10"
          title="Unstage file"
        >
          Unstage
        </button>
      )}
      {(change.unstaged || change.untracked) && (
        <button
          onClick={() => requestAction({ action: "discard", paths: [change.path] })}
          className="rounded px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-500/10"
          title="Discard file changes"
        >
          Discard
        </button>
      )}
    </div>
  );

  const renderFile = (file: GitTreeFileNode, depth: number) => (
    <div
      key={`${depth}-${file.change.path}-${file.change.indexStatus}-${file.change.workTreeStatus}`}
      className="group flex items-start gap-2 rounded-md px-2 py-1 text-[12px] text-neutral-300 hover:bg-neutral-800/70"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      title={
        file.change.originalPath
          ? `${file.change.label}: ${file.change.originalPath} -> ${file.change.path}`
          : file.change.label
      }
    >
      <FileCode2 size={14} className="mt-0.5 shrink-0 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-neutral-200">{file.name}</span>
          <div className="flex items-center gap-2">
            <span className={`shrink-0 text-[11px] font-semibold ${getStatusClassName(file.change)}`}>
              {getStatusText(file.change)}
            </span>
            {renderRowActions(file.change)}
          </div>
        </div>
        {file.change.originalPath && (
          <p className="truncate text-[10px] text-neutral-500">from {file.change.originalPath}</p>
        )}
      </div>
    </div>
  );

  const renderFolder = (node: GitTreeNode, depth: number): React.ReactNode => {
    const collapsed = collapsedFolders[node.path] ?? false;
    const folderPaths = collectFolderPaths(node);

    return (
      <div key={node.path}>
        <div
          className="group flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[12px] text-neutral-300 hover:bg-neutral-800/70"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <button onClick={() => toggleFolder(node.path)} className="flex min-w-0 flex-1 items-center gap-1">
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
          <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => requestAction({ action: "stage", paths: folderPaths })}
              className="rounded px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/10"
              title="Stage folder changes"
            >
              Stage
            </button>
            <button
              onClick={() => requestAction({ action: "unstage", paths: folderPaths })}
              className="rounded px-1.5 py-0.5 text-[10px] text-amber-100 hover:bg-amber-500/10"
              title="Unstage folder changes"
            >
              Unstage
            </button>
            <button
              onClick={() => requestAction({ action: "discard", paths: folderPaths })}
              className="rounded px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-500/10"
              title="Discard folder changes"
            >
              Discard
            </button>
          </div>
        </div>
        {!collapsed && (
          <div>
            {node.folders.map((child) => renderFolder(child, depth + 1))}
            {node.files.map((file) => renderFile(file, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!open) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[26rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitBranch size={15} className="shrink-0 text-neutral-300" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-100">Git</p>
              <p className="truncate text-[11px] text-neutral-500">{data?.projectName ?? "Active project"}</p>
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

          {feedback && (
            <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${getFeedbackToneClass(feedback.kind)}`}>
              {feedback.text}
            </div>
          )}

          {!error && data && (
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-3">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <button
                      onClick={() => setBranchMenuOpen((prev) => !prev)}
                      disabled={actionBusy || !data.isRepo}
                      className="flex w-full items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-left text-sm text-neutral-100 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">
                        {data.detached ? "Detached HEAD" : data.branch ?? "No branch"}
                      </span>
                      <ChevronDown size={14} className="shrink-0 text-neutral-500" />
                    </button>

                    {branchMenuOpen && data.isRepo && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
                        <div className="max-h-48 overflow-y-auto p-1">
                          {data.branches.map((branch) => (
                            <button
                              key={branch}
                              onClick={() => requestAction({ action: "checkout_branch", branch })}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                                branch === data.branch
                                  ? "bg-neutral-800 text-white"
                                  : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                              }`}
                            >
                              <span className="truncate">{branch}</span>
                              {branch === data.branch && <span className="text-[10px] uppercase text-sky-300">current</span>}
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-neutral-800 p-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={newBranchName}
                              onChange={(e) => setNewBranchName(e.target.value)}
                              placeholder="new-branch-name"
                              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-700"
                            />
                            <button
                              onClick={handleBranchCreate}
                              disabled={!newBranchName.trim() || actionBusy}
                              className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Create
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  {data.upstream && <span>{data.upstream}</span>}
                  {data.ahead > 0 && <span className="text-sky-200">ahead {data.ahead}</span>}
                  {data.behind > 0 && <span className="text-amber-200">behind {data.behind}</span>}
                  {data.stashCount > 0 && <span>stash {data.stashCount}</span>}
                </div>

                {data.lastCommit && (
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-[11px] text-neutral-400">
                    <div className="flex items-center gap-2 text-neutral-300">
                      <GitCommitHorizontal size={12} className="shrink-0" />
                      <span className="font-mono text-neutral-500">{data.lastCommit.hash}</span>
                      <span className="truncate">{data.lastCommit.subject}</span>
                    </div>
                    <div className="mt-1 truncate">
                      {data.lastCommit.authorName} · {data.lastCommit.relativeDate}
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => requestAction({ action: "pull" })}
                    disabled={actionBusy || !data.isRepo}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download size={12} />
                    Pull
                  </button>
                  <button
                    onClick={() => requestAction({ action: "push" })}
                    disabled={actionBusy || !data.isRepo}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Upload size={12} />
                    Push
                  </button>
                  <button
                    onClick={() => requestAction({ action: "stage_all" })}
                    disabled={actionBusy || !data.isRepo || data.changes.length === 0}
                    className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Stage all
                  </button>
                  <button
                    onClick={() => requestAction({ action: "unstage_all" })}
                    disabled={actionBusy || !data.isRepo || data.stagedCount === 0}
                    className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Unstage all
                  </button>
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
                    <span>Changes</span>
                    <span>{data.changes.length}</span>
                  </div>
                  <div className="py-1">
                    {tree.folders.map((node) => renderFolder(node, 0))}
                    {tree.files.map((file) => renderFile(file, 0))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-neutral-800 bg-neutral-950/95 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-neutral-200">Commit</p>
            <label className="flex items-center gap-2 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={stageAllBeforeCommit}
                onChange={(e) => setStageAllBeforeCommit(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
              />
              Stage all first
            </label>
          </div>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Write commit message..."
            rows={3}
            className="w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-700"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-neutral-500">
              {data?.branch ? `On ${data.branch}` : "No branch selected"}
            </div>
            <button
              onClick={() => void handleCommit()}
              disabled={actionBusy || !commitMessage.trim() || !data?.isRepo}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {actionBusy ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />}
              Commit
            </button>
          </div>
        </div>

        {confirmation && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
              <h3 className="text-sm font-semibold text-white">{confirmation.title}</h3>
              <p className="mt-2 text-sm text-neutral-400">{confirmation.message}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmation(null)}
                  className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const next = confirmation;
                    setConfirmation(null);
                    void executeAction({
                      action: next.action,
                      branch: next.branch,
                      paths: next.paths,
                      message: next.messageText,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                >
                  <Trash2 size={14} />
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
