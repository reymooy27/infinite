"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
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

type GitStashEntry = {
  selector: string;
  subject: string;
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
  recentCommits: GitLastCommit[];
  stashes: GitStashEntry[];
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
  kind: "file";
  id: string;
  name: string;
  path: string;
  depth: number;
  change: GitChange;
};

type GitTreeFolderNode = {
  kind: "folder";
  id: string;
  name: string;
  path: string;
  depth: number;
  folders: GitTreeFolderNode[];
  files: GitTreeFileNode[];
};

type FlatRow =
  | {
      id: string;
      kind: "folder";
      name: string;
      depth: number;
      path: string;
      folderPaths: string[];
      collapsed: boolean;
      files: GitChange[];
    }
  | {
      id: string;
      kind: "file";
      name: string;
      depth: number;
      path: string;
      folderPaths: string[];
      change: GitChange;
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
      confirmLabel?: string;
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
  type MutableFolder = {
    name: string;
    path: string;
    folders: MutableFolder[];
    files: GitTreeFileNode[];
  };

  const root = new Map<string, MutableFolder>();

  for (const change of changes) {
    const parts = change.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
      let bucket = root.get("__root__");
      if (!bucket) {
        bucket = { name: "", path: "", folders: [], files: [] };
        root.set("__root__", bucket);
      }
      bucket.files.push({
        kind: "file",
        id: `file:${change.path}`,
        name: change.path,
        path: change.path,
        depth: 0,
        change,
      });
      continue;
    }

    const fileName = parts[parts.length - 1];
    const folders = parts.slice(0, -1);
    let currentMap = root;
    let currentNode: MutableFolder | null = null;
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
      const childMap = new Map<string, MutableFolder>();
      for (const folder of next.folders) {
        childMap.set(folder.path, folder);
      }
      currentMap = childMap;
    }

    if (currentNode) {
      currentNode.files.push({
        kind: "file",
        id: `file:${change.path}`,
        name: fileName,
        path: change.path,
        depth: folders.length,
        change,
      });
    }
  }

  const convertFolder = (folder: MutableFolder, depth: number): GitTreeFolderNode => {
    const sortedFolders = [...folder.folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => convertFolder(child, depth + 1));
    const sortedFiles = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));
    return {
      kind: "folder",
      id: `folder:${folder.path}`,
      name: folder.name,
      path: folder.path,
      depth,
      folders: sortedFolders,
      files: sortedFiles.map((file) => ({ ...file, depth: depth + 1 })),
    };
  };

  const rootFolder = root.get("__root__");
  return {
    folders: Array.from(root.values())
      .filter((folder) => folder.path !== "")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => convertFolder(folder, 0)),
    files: [...(rootFolder?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function collectFolderPaths(folder: GitTreeFolderNode): string[] {
  return [
    ...folder.files.map((file) => file.path),
    ...folder.folders.flatMap((child) => collectFolderPaths(child)),
  ];
}

function collectFolderChanges(folder: GitTreeFolderNode): GitChange[] {
  return [
    ...folder.files.map((file) => file.change),
    ...folder.folders.flatMap((child) => collectFolderChanges(child)),
  ];
}

function flattenVisibleRows(
  folders: GitTreeFolderNode[],
  files: GitTreeFileNode[],
  collapsedFolders: Record<string, boolean>,
): FlatRow[] {
  const rows: FlatRow[] = [];

  const pushFolder = (folder: GitTreeFolderNode) => {
    const folderPaths = collectFolderPaths(folder);
    const collapsed = collapsedFolders[folder.path] ?? false;
    rows.push({
      id: folder.id,
      kind: "folder",
      name: folder.name,
      depth: folder.depth,
      path: folder.path,
      folderPaths,
      collapsed,
      files: collectFolderChanges(folder),
    });
    if (collapsed) return;
    for (const child of folder.folders) pushFolder(child);
    for (const file of folder.files) {
      rows.push({
        id: file.id,
        kind: "file",
        name: file.name,
        depth: file.depth,
        path: file.path,
        folderPaths: [file.path],
        change: file.change,
      });
    }
  };

  for (const folder of folders) pushFolder(folder);
  for (const file of files) {
    rows.push({
      id: file.id,
      kind: "file",
      name: file.name,
      depth: 0,
      path: file.path,
      folderPaths: [file.path],
      change: file.change,
    });
  }

  return rows;
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

function hasPendingStage(changes: GitChange[]) {
  return changes.some((change) => change.unstaged || change.untracked);
}

function hasStagedOnly(changes: GitChange[]) {
  return changes.some((change) => change.staged);
}

function hasDiscardable(changes: GitChange[]) {
  return changes.some((change) => change.unstaged || change.untracked);
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
  const [branchSearch, setBranchSearch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [stageAllBeforeCommit, setStageAllBeforeCommit] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [stashOpen, setStashOpen] = useState(true);
  const branchSearchRef = useRef<HTMLInputElement>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (!branchMenuOpen) return;
    window.setTimeout(() => branchSearchRef.current?.focus(), 0);
  }, [branchMenuOpen]);

  const tree = useMemo(
    () => (data ? buildGitTree(data.changes) : { folders: [], files: [] }),
    [data],
  );

  const visibleRows = useMemo(
    () => flattenVisibleRows(tree.folders, tree.files, collapsedFolders),
    [collapsedFolders, tree.files, tree.folders],
  );

  const activeRowId =
    selectedRowId && visibleRows.some((row) => row.id === selectedRowId)
      ? selectedRowId
      : visibleRows[0]?.id ?? null;
  const selectedRow = visibleRows.find((row) => row.id === activeRowId) ?? null;
  const filteredBranches = useMemo(() => {
    if (!data) return [];
    const query = branchSearch.trim().toLowerCase();
    if (!query) return data.branches;
    return data.branches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchSearch, data]);

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
          setBranchSearch("");
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
          confirmLabel: "Discard",
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
          message: "Current working tree is dirty. Branch switch may fail or carry changes over.",
          confirmLabel: "Switch",
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

  const toggleStageForRow = useCallback(
    (row: FlatRow) => {
      if (row.kind === "file") {
        if (row.change.unstaged || row.change.untracked) {
          requestAction({ action: "stage", paths: [row.path] });
          return;
        }
        if (row.change.staged) {
          requestAction({ action: "unstage", paths: [row.path] });
        }
        return;
      }

      if (hasPendingStage(row.files)) {
        requestAction({ action: "stage", paths: row.folderPaths });
        return;
      }
      if (hasStagedOnly(row.files)) {
        requestAction({ action: "unstage", paths: row.folderPaths });
      }
    },
    [requestAction],
  );

  const unstageRow = useCallback(
    (row: FlatRow) => {
      if (row.kind === "file") {
        requestAction({ action: "unstage", paths: [row.path] });
        return;
      }
      requestAction({ action: "unstage", paths: row.folderPaths });
    },
    [requestAction],
  );

  const discardRow = useCallback(
    (row: FlatRow) => {
      requestAction({ action: "discard", paths: row.folderPaths });
    },
    [requestAction],
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      const isTextTarget =
        target?.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT";

      if (confirmation) {
        if (event.key === "Escape") {
          event.preventDefault();
          setConfirmation(null);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const next = confirmation;
          setConfirmation(null);
          void executeAction({
            action: next.action,
            branch: next.branch,
            paths: next.paths,
            message: next.messageText,
          });
        }
        return;
      }

      if (isTextTarget) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void handleCommit();
        } else if (event.key === "Escape" && branchMenuOpen) {
          event.preventDefault();
          setBranchMenuOpen(false);
        }
        return;
      }

      const activeIndex = visibleRows.findIndex((row) => row.id === activeRowId);
      const moveSelection = (nextIndex: number) => {
        const next = visibleRows[nextIndex];
        if (!next) return;
        setSelectedRowId(next.id);
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          if (visibleRows.length > 0) {
            moveSelection(Math.min(activeIndex + 1, visibleRows.length - 1));
          }
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          if (visibleRows.length > 0) {
            moveSelection(Math.max(activeIndex - 1, 0));
          }
          break;
        case "h":
        case "ArrowLeft":
          if (selectedRow?.kind === "folder" && !selectedRow.collapsed) {
            event.preventDefault();
            toggleFolder(selectedRow.path);
          }
          break;
        case "l":
        case "ArrowRight":
        case "Enter":
          if (selectedRow?.kind === "folder") {
            event.preventDefault();
            toggleFolder(selectedRow.path);
          }
          break;
        case " ":
        case "s":
          if (selectedRow) {
            event.preventDefault();
            toggleStageForRow(selectedRow);
          }
          break;
        case "u":
          if (selectedRow) {
            event.preventDefault();
            unstageRow(selectedRow);
          }
          break;
        case "x":
          if (selectedRow && hasDiscardable(selectedRow.kind === "file" ? [selectedRow.change] : selectedRow.files)) {
            event.preventDefault();
            discardRow(selectedRow);
          }
          break;
        case "b":
          event.preventDefault();
          setBranchMenuOpen((prev) => !prev);
          break;
        case "c":
          event.preventDefault();
          commitTextareaRef.current?.focus();
          break;
        case "g":
          event.preventDefault();
          void loadStatus();
          break;
        case "a":
          event.preventDefault();
          requestAction({ action: "stage_all" });
          break;
        case "p":
          event.preventDefault();
          if (event.shiftKey) {
            requestAction({ action: "push" });
          } else {
            requestAction({ action: "pull" });
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeRowId,
    branchMenuOpen,
    confirmation,
    discardRow,
    executeAction,
    handleCommit,
    loadStatus,
    open,
    requestAction,
    selectedRow,
    toggleFolder,
    toggleStageForRow,
    unstageRow,
    visibleRows,
  ]);

  const renderActionIcons = (row: FlatRow, showSelected = false) => {
    const fileChanges = row.kind === "file" ? [row.change] : row.files;
    const canStage = hasPendingStage(fileChanges);
    const canUnstage = hasStagedOnly(fileChanges);
    const canDiscard = hasDiscardable(fileChanges);

    return (
      <div
        className={`ml-2 flex shrink-0 items-center gap-1 transition-opacity ${
          showSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {canStage && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              toggleStageForRow(row);
            }}
            className="rounded p-1 text-sky-200 hover:bg-sky-500/10"
            title="Stage"
          >
            <Plus size={12} />
          </button>
        )}
        {canUnstage && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              unstageRow(row);
            }}
            className="rounded p-1 text-amber-100 hover:bg-amber-500/10"
            title="Unstage"
          >
            <Minus size={12} />
          </button>
        )}
        {canDiscard && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              discardRow(row);
            }}
            className="rounded p-1 text-red-200 hover:bg-red-500/10"
            title="Discard"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    );
  };

  const renderFileRow = (row: Extract<FlatRow, { kind: "file" }>) => {
    const selected = row.id === activeRowId;
    return (
      <button
        key={row.id}
        onClick={() => setSelectedRowId(row.id)}
        className={`group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors ${
          selected ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-800/70"
        }`}
        style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
        title={row.change.originalPath ? `${row.change.originalPath} -> ${row.change.path}` : row.change.label}
      >
        <FileCode2 size={14} className="mt-0.5 shrink-0 text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <span className="truncate">{row.name}</span>
            <div className="flex items-center gap-2">
              <span className={`shrink-0 text-[11px] font-semibold ${getStatusClassName(row.change)}`}>
                {getStatusText(row.change)}
              </span>
              {renderActionIcons(row, selected)}
            </div>
          </div>
          {row.change.originalPath && (
            <p className="truncate text-[10px] text-neutral-500">from {row.change.originalPath}</p>
          )}
        </div>
      </button>
    );
  };

  const renderFolderRow = (row: Extract<FlatRow, { kind: "folder" }>) => {
    const selected = row.id === activeRowId;
    return (
      <button
        key={row.id}
        onClick={() => setSelectedRowId(row.id)}
        className={`group flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[12px] transition-colors ${
          selected ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-800/70"
        }`}
        style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
            toggleFolder(row.path);
          }}
          className="inline-flex shrink-0 items-center"
        >
          {row.collapsed ? (
            <ChevronRight size={13} className="text-neutral-500" />
          ) : (
            <ChevronDown size={13} className="text-neutral-500" />
          )}
        </span>
        {row.collapsed ? (
          <Folder size={14} className="shrink-0 text-sky-300" />
        ) : (
          <FolderOpen size={14} className="shrink-0 text-sky-300" />
        )}
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        {renderActionIcons(row, selected)}
      </button>
    );
  };

  if (!open) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[27rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
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
                        <div className="border-b border-neutral-800 p-2">
                          <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                            <Search size={13} className="shrink-0 text-neutral-500" />
                            <input
                              ref={branchSearchRef}
                              value={branchSearch}
                              onChange={(event) => setBranchSearch(event.target.value)}
                              placeholder="Search branches"
                              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1">
                          {filteredBranches.map((branch) => (
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
                          {filteredBranches.length === 0 && (
                            <div className="px-3 py-3 text-sm text-neutral-500">No matching branch</div>
                          )}
                        </div>
                        <div className="border-t border-neutral-800 p-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={newBranchName}
                              onChange={(event) => setNewBranchName(event.target.value)}
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

                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-[11px] text-neutral-500">
                  <div className="truncate">{data.directory ?? "No directory"}</div>
                  <div className="mt-1 truncate">
                    `j/k` move · `space` stage · `u` unstage · `x` discard · `b` branch · `c` commit · `g` refresh · `p/P` pull/push
                  </div>
                  <div className="mt-1 truncate">Updated {formatTimestamp(data.scannedAt)}</div>
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
                    {visibleRows.map((row) =>
                      row.kind === "folder" ? renderFolderRow(row) : renderFileRow(row),
                    )}
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                <button
                  onClick={() => setHistoryOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between border-b border-neutral-800 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-500"
                >
                  <span>Commit history</span>
                  {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {historyOpen && (
                  <div className="max-h-48 overflow-y-auto py-1">
                    {data.recentCommits.length === 0 && (
                      <div className="px-3 py-3 text-sm text-neutral-500">No commit history</div>
                    )}
                    {data.recentCommits.map((commit) => (
                      <div key={`${commit.hash}-${commit.subject}`} className="px-3 py-2 text-sm text-neutral-300">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-neutral-500">{commit.hash}</span>
                          <span className="truncate text-neutral-100">{commit.subject}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500">
                          {commit.authorName} · {commit.relativeDate}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                <button
                  onClick={() => setStashOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between border-b border-neutral-800 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-500"
                >
                  <span>Stash list</span>
                  {stashOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {stashOpen && (
                  <div className="max-h-40 overflow-y-auto py-1">
                    {data.stashes.length === 0 && (
                      <div className="px-3 py-3 text-sm text-neutral-500">No stashes</div>
                    )}
                    {data.stashes.map((stash) => (
                      <div key={`${stash.selector}-${stash.subject}`} className="px-3 py-2 text-sm text-neutral-300">
                        <div className="font-mono text-[11px] text-neutral-500">{stash.selector}</div>
                        <div className="mt-1 text-neutral-100">{stash.subject}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                onChange={(event) => setStageAllBeforeCommit(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-900"
              />
              Stage all first
            </label>
          </div>
          <textarea
            ref={commitTextareaRef}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
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
                  {confirmation.confirmLabel ?? "Continue"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
