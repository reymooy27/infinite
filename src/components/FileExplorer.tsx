// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompare,
  LoaderCircle,
  PanelLeft,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import CodeEditor from "./CodeEditor";
import DiffViewer from "./DiffViewer";

// --- Types ---

type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: string;
};

type DirState = {
  loading: boolean;
  error: string;
  entries: FileEntry[];
};

type FileContent = {
  path: string;
  content: string;
  loading: boolean;
  error: string;
};


const STORAGE_KEY = (projectId: string) => `file-explorer-state:${projectId}`;

function loadState(projectId: string) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(projectId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(projectId: string, state: any) {
  try {
    sessionStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(state));
  } catch {}
}

interface FileExplorerProps {
  open: boolean;
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  initialPath?: string | null;
  onClose: () => void;
  /** When true, omits the aside positioning/background — for use inside an external wrapper. */
  embedded?: boolean;
}

// --- Helpers ---

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return FileCode2;
  if (["json", "yaml", "yml", "toml", "ini", "env", "conf"].includes(ext))
    return FileText;
  if (["md", "txt", "log", "csv"].includes(ext)) return FileText;
  if (["html", "css", "scss", "less"].includes(ext)) return FileCode2;
  if (
    ["py", "rb", "go", "rs", "java", "c", "cpp", "h", "sh", "bash"].includes(
      ext,
    )
  )
    return FileCode2;
  return File;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

// --- Inline rename / create input ---

type Draft = {
  mode: "new-file" | "new-folder" | "rename";
  parent: string;
  path: string;
  value: string;
};

interface TreeCtx {
  isIgnored: (path: string) => boolean;
  selectedPath: string | null;
  draft: Draft | null;
  onContext: (e: React.MouseEvent, entry: FileEntry | null) => void;
  onSelectEntry: (entry: FileEntry) => void;
  onDraftChange: (value: string) => void;
  onDraftCommit: () => void;
  onDraftCancel: () => void;
}

function InlineInput({
  depth,
  isDir,
  value,
  ctx,
}: {
  depth: number;
  isDir: boolean;
  value: string;
  ctx: TreeCtx;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) ctx.onDraftCommit();
    else ctx.onDraftCancel();
  };

  const Icon = isDir ? Folder : File;

  return (
    <div
      className="flex w-full items-center gap-1.5 rounded-md border border-sky-500/60 bg-neutral-900 py-1"
      style={{ paddingLeft: `${depth * 12 + (isDir ? 8 : 24)}px`, paddingRight: 8 }}
    >
      <Icon size={14} className="shrink-0 text-sky-400" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => ctx.onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
        }}
        onBlur={() => finish(true)}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none"
      />
    </div>
  );
}

// --- Tree Node ---

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  dirCache: Record<string, DirState>;
  expandedFolders: Set<string>;
  activeFilePath: string | null;
  searchQuery: string;
  ctx: TreeCtx;
  onToggleFolder: (path: string) => void;
  onFileSelect: (path: string) => void;
}

function TreeNode({
  entry,
  depth,
  dirCache,
  expandedFolders,
  activeFilePath,
  searchQuery,
  ctx,
  onToggleFolder,
  onFileSelect,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(entry.path);
  const isActive = !entry.isDir && entry.path === activeFilePath;
  const isSelected = entry.path === ctx.selectedPath;
  const childState = dirCache[entry.path];
  const indent = depth * 12;
  const ignored = ctx.isIgnored(entry.path);
  const dim = ignored ? " text-neutral-600 italic" : "";
  const renaming = ctx.draft?.mode === "rename" && ctx.draft.path === entry.path;

  if (renaming) {
    return (
      <div style={{ paddingLeft: `${indent + (entry.isDir ? 0 : 16)}px`, paddingRight: 8 }}>
        <InlineInput depth={depth} isDir={entry.isDir} value={ctx.draft.value} ctx={ctx} />
      </div>
    );
  }

  if (entry.isDir) {
    const sortedChildren = childState?.entries
      ? sortEntries(childState.entries)
      : [];
    const filteredChildren = searchQuery
      ? sortedChildren.filter((c) => {
          const fullPath = c.path ? c.path.toLowerCase() : c.name.toLowerCase();
          return fullPath.includes(searchQuery);
        })
      : sortedChildren;
    const creatingHere = ctx.draft && ctx.draft.parent === entry.path && ctx.draft.mode !== "rename";

    return (
      <div>
        <button
          onClick={() => {
            onToggleFolder(entry.path);
            ctx.onSelectEntry(entry);
          }}
          onContextMenu={(e) => ctx.onContext(e, entry)}
          className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] transition-colors hover:bg-neutral-800/70 hover:text-white cursor-pointer ${
            isSelected ? "bg-neutral-800/70" : ""
          }${dim || " text-neutral-300"}`}
          title={ignored ? "Ignored by git" : undefined}
          style={{ paddingLeft: `${indent + 8}px`, paddingRight: 8 }}
        >
          {isExpanded ? (
            <ChevronDown size={12} className="shrink-0 text-neutral-600" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-neutral-600" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} className={`shrink-0 ${ignored ? "text-neutral-600" : "text-sky-400"}`} />
          ) : (
            <Folder size={14} className={`shrink-0 ${ignored ? "text-neutral-600" : "text-sky-400"}`} />
          )}
          <span className="min-w-0 truncate">{entry.name}</span>
        </button>
        {isExpanded &&
          childState?.loading &&
          sortedChildren.length === 0 && (
            <div
              className="py-1 text-[11px] text-neutral-600"
              style={{ paddingLeft: `${indent + 32}px` }}
            >
              Loading...
            </div>
          )}
        {isExpanded &&
          filteredChildren.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              dirCache={dirCache}
              expandedFolders={expandedFolders}
              activeFilePath={activeFilePath}
              searchQuery={searchQuery}
              ctx={ctx}
              onToggleFolder={onToggleFolder}
              onFileSelect={onFileSelect}
            />
          ))}
        {isExpanded && creatingHere && (
          <div style={{ paddingLeft: 16, paddingRight: 8 }}>
            <InlineInput
              depth={depth + 1}
              isDir={ctx.draft.mode === "new-folder"}
              value={ctx.draft.value}
              ctx={ctx}
            />
          </div>
        )}
      </div>
    );
  }

  const Icon = getFileIcon(entry.name);

  return (
    <button
      onClick={() => {
        onFileSelect(entry.path);
        ctx.onSelectEntry(entry);
      }}
      onContextMenu={(e) => ctx.onContext(e, entry)}
      className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] transition-colors cursor-pointer ${
        isActive
          ? "bg-neutral-800 text-white"
          : isSelected && !ignored
            ? "bg-neutral-800/70 text-neutral-400 hover:bg-neutral-800/70 hover:text-white"
            : `${ignored ? "" : "text-neutral-400 "}hover:bg-neutral-800/70 hover:text-white`
      }${dim}`}
      title={ignored ? `${entry.path} — ignored by git` : undefined}
      style={{ paddingLeft: `${indent + 24}px`, paddingRight: 8 }}
    >
      <Icon size={14} className={`shrink-0 ${ignored ? "text-neutral-700" : "text-neutral-500"}`} />
      <span className="min-w-0 truncate">{entry.name}</span>
    </button>
  );
}

// --- Main Component ---

export default function FileExplorer({
  open,
  projectId,
  connectionId,
  initialPath,
  onClose,
  embedded = false,
}: FileExplorerProps) {
  // Tree state
  const [dirCache, setDirCache] = useState<Record<string, DirState>>(() => {
    if (!projectId) return {};
    const s = loadState(projectId);
    return (s?.dirCache as Record<string, DirState>) ?? {};
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    if (!projectId) return new Set();
    const s = loadState(projectId);
    return new Set(s?.expandedFolders ?? []);
  });
  const [filterText, setFilterText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 768,
  );
  const filterTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  // Editor state
  const [openFile, setOpenFile] = useState<FileContent | null>(() => {
    if (!projectId) return null;
    const s = loadState(projectId);
    return s?.openFile ?? null;
  });
  const [editContent, setEditContent] = useState<string | null>(() => {
    if (!projectId) return null;
    const s = loadState(projectId);
    return s?.editContent ?? null;
  });
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [headContent, setHeadContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  // Recently-opened file paths (most-recent first) for the mobile quick-switch
  // strip. ponytail: in-memory only, capped at 6 — add persistence when needed.
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  // Explorer CRUD + gitignore state
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(
    null,
  );
  const [treeError, setTreeError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // `git ls-files -o -i` lists excluded dirs with a trailing slash and excluded
  // files without one, so a path is ignored when it matches exactly or sits
  // under an ignored directory.
  const isIgnored = useCallback(
    (path: string) => {
      if (ignored.size === 0) return false;
      if (ignored.has(path) || ignored.has(`${path}/`)) return true;
      for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
        if (ignored.has(path.slice(0, i + 1))) return true;
      }
      return false;
    },
    [ignored],
  );

  // --- API calls ---

  const fetchDir = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setDirCache((prev) => ({
        ...prev,
        [path]: {
          loading: true,
          error: "",
          entries: prev[path]?.entries ?? [],
        },
      }));

      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        if (connectionId)
          params.set("connectionId", String(connectionId));
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const res = await fetch(
          `/api/projects/${projectId}/files${suffix}`,
        );
        const body = await res.json();
        if (!res.ok)
          throw new Error(body.error || "Failed to list directory");

        setDirCache((prev) => ({
          ...prev,
          [path]: { loading: false, error: "", entries: body.entries },
        }));
      } catch (err) {
        setDirCache((prev) => ({
          ...prev,
          [path]: {
            loading: false,
            error:
              err instanceof Error ? err.message : "Failed to load",
            entries: prev[path]?.entries ?? [],
          },
        }));
      }
    },
    [projectId, connectionId],
  );

  const fetchFile = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setOpenFile({ path, content: "", loading: true, error: "" });
      setEditContent(null);
      setDiffMode(false);
      setHeadContent(null);
      setRecentFiles((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 6));

      try {
        const params = new URLSearchParams({ path });
        if (connectionId)
          params.set("connectionId", String(connectionId));
        const res = await fetch(
          `/api/projects/${projectId}/files/read?${params.toString()}`,
        );
        const body = await res.json();
        if (!res.ok)
          throw new Error(body.error || "Failed to read file");

        setOpenFile({
          path,
          content: body.content,
          loading: false,
          error: "",
        });
        setEditContent(body.content);
      } catch (err) {
        setOpenFile({
          path,
          content: "",
          loading: false,
          error:
            err instanceof Error ? err.message : "Failed to read file",
        });
      }
    },
    [projectId, connectionId],
  );

  const saveFile = useCallback(async () => {
    if (!projectId || !openFile || editContent === null) return;
    setSaving(true);
    setSaveFeedback(null);

    try {
      const params = new URLSearchParams();
      if (connectionId)
        params.set("connectionId", String(connectionId));
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const res = await fetch(
        `/api/projects/${projectId}/files/write${suffix}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: openFile.path,
            content: editContent,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save");

      setOpenFile({
        ...openFile,
        content: editContent,
        loading: false,
        error: "",
      });
      setSaveFeedback("Saved");
    } catch (err) {
      setSaveFeedback(
        err instanceof Error ? err.message : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [projectId, connectionId, openFile, editContent]);

  const fetchHeadContent = useCallback(async () => {
    if (!projectId || !openFile) return;
    setDiffLoading(true);
    try {
      const params = new URLSearchParams({ path: openFile.path });
      if (connectionId)
        params.set("connectionId", String(connectionId));
      const res = await fetch(
        `/api/projects/${projectId}/git/file-head?${params}`,
      );
      const body = await res.json();
      setHeadContent(body.content ?? "");
    } catch {
      setHeadContent("");
    } finally {
      setDiffLoading(false);
    }
  }, [projectId, connectionId, openFile]);

  const toggleDiff = useCallback(() => {
    if (!diffMode) {
      setDiffMode(true);
      fetchHeadContent();
    } else {
      setDiffMode(false);
      setHeadContent(null);
    }
  }, [diffMode, fetchHeadContent]);

  // --- Explorer CRUD ---

  const postFiles = useCallback(
    async (action: string, body: Record<string, unknown>) => {
      const params = new URLSearchParams();
      if (connectionId) params.set("connectionId", String(connectionId));
      const res = await fetch(`/api/projects/${projectId}/files/${action}?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed to ${action}`);
      return json;
    },
    [projectId, connectionId],
  );

  const failTree = useCallback((err: unknown) => {
    setTreeError(err instanceof Error ? err.message : "Operation failed");
  }, []);

  const beginCreate = useCallback(
    (mode: "new-file" | "new-folder", parent: string) => {
      setMenu(null);
      if (parent && !expandedFolders.has(parent)) {
        setExpandedFolders((prev) => new Set(prev).add(parent));
        if (!dirCache[parent]?.entries?.length) void fetchDir(parent);
      }
      setDraft({ mode, parent, path: "", value: "" });
    },
    [expandedFolders, dirCache, fetchDir],
  );

  const beginRename = useCallback((entry: FileEntry) => {
    setMenu(null);
    setDraft({
      mode: "rename",
      parent: parentOf(entry.path),
      path: entry.path,
      value: entry.name,
    });
  }, []);

  const commitDraft = useCallback(async () => {
    if (!projectId || !draft) return;
    const name = draft.value.trim();
    setDraft(null);
    if (!name) return;

    try {
      if (draft.mode === "rename") {
        if (name === draft.path.split("/").pop()) return;
        const newPath = draft.parent ? `${draft.parent}/${name}` : name;
        await postFiles("rename", { path: draft.path, newPath });
        if (openFile?.path === draft.path) {
          setOpenFile(null);
          setEditContent(null);
        }
        setSelectedPath(newPath);
        void fetchDir(draft.parent);
      } else {
        const target = draft.parent ? `${draft.parent}/${name}` : name;
        await postFiles("create", { path: target, isDir: draft.mode === "new-folder" });
        void fetchDir(draft.parent);
        if (draft.mode === "new-file") void fetchFile(target);
      }
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      failTree(err);
    }
  }, [projectId, draft, postFiles, fetchDir, fetchFile, openFile, failTree]);

  const deleteEntry = useCallback(
    async (entry: FileEntry) => {
      setMenu(null);
      if (!projectId) return;
      const suffix = entry.isDir ? " and its contents" : "";
      if (!window.confirm(`Delete ${entry.path}${suffix}?`)) return;

      try {
        const params = new URLSearchParams({ path: entry.path });
        if (connectionId) params.set("connectionId", String(connectionId));
        const res = await fetch(`/api/projects/${projectId}/files?${params}`, {
          method: "DELETE",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to delete");

        if (openFile && (openFile.path === entry.path || openFile.path.startsWith(`${entry.path}/`))) {
          setOpenFile(null);
          setEditContent(null);
        }
        setSelectedPath(null);
        void fetchDir(parentOf(entry.path));
        setRefreshNonce((n) => n + 1);
      } catch (err) {
        failTree(err);
      }
    },
    [projectId, connectionId, fetchDir, openFile, failTree],
  );

  const openContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (entry) setSelectedPath(entry.path);
    setMenu({
      x: Math.max(4, Math.min(e.clientX, window.innerWidth - 180)),
      y: Math.max(4, Math.min(e.clientY, window.innerHeight - 170)),
      entry,
    });
  }, []);

  const treeCtx: TreeCtx = {
    isIgnored,
    selectedPath,
    draft,
    onContext: openContextMenu,
    onSelectEntry: (entry) => setSelectedPath(entry.path),
    onDraftChange: (value) => setDraft((d) => (d ? { ...d, value } : d)),
    onDraftCommit: () => void commitDraft(),
    onDraftCancel: () => setDraft(null),
  };

  // --- Effects ---


  // Persist state
  useEffect(() => {
    if (!projectId || !open) return;
    saveState(projectId, {
      openFile,
      editContent,
      expandedFolders: Array.from(expandedFolders),
      dirCache,
    });
  }, [open, openFile, editContent, expandedFolders, dirCache, projectId]);

  // Reset on open
  useEffect(() => {
    if (!open || !projectId) return;
    // Restore dari sessionStorage jika ada; jika tidak, reset
    const s = loadState(projectId);
    if (s) {
      setDirCache(s.dirCache ?? {});
      setExpandedFolders(new Set(s.expandedFolders ?? []));
      if (s.openFile) {
        setOpenFile(s.openFile);
        setEditContent(s.editContent ?? s.openFile.content);
        void fetchFile(s.openFile.path);
      } else {
        setOpenFile(null);
        setEditContent(null);
        setDiffMode(false);
        setHeadContent(null);
        void fetchDir("");
      }
    } else {
      setDirCache({});
      setExpandedFolders(new Set());
      setOpenFile(null);
      setEditContent(null);
      setDiffMode(false);
      setHeadContent(null);
      void fetchDir("");
    }
  }, [open, projectId, fetchDir]);

  // Auto-open initialPath
  useEffect(() => {
    if (!open || !projectId || !initialPath) return;
    void fetchFile(initialPath);
    setDiffMode(true);
  }, [open, projectId, initialPath, fetchFile]);

  // Debounce filter → search
  useEffect(() => {
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(
      () => setSearchQuery(filterText.toLowerCase()),
      200,
    );
    return () => clearTimeout(filterTimerRef.current);
  }, [filterText]);

  // Run recursive search on the server so matches in unfetched subfolders appear
  useEffect(() => {
    if (!projectId || !searchQuery) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setSearchLoading(true);
    const params = new URLSearchParams({ q: searchQuery });
    if (connectionId) params.set("connectionId", String(connectionId));
    fetch(`/api/projects/${projectId}/files/search?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((body) => {
        if (ctrl.signal.aborted) return;
        setSearchResults(body.entries ?? []);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setSearchResults([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSearchLoading(false);
      });
    return () => ctrl.abort();
  }, [projectId, connectionId, searchQuery]);

  // Auto-dismiss save feedback
  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

  useEffect(() => {
    if (!treeError) return;
    const t = setTimeout(() => setTreeError(null), 4000);
    return () => clearTimeout(t);
  }, [treeError]);

  // Gitignored paths, refetched on open/refresh.
  useEffect(() => {
    if (!open || !projectId) return;
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (connectionId) params.set("connectionId", String(connectionId));
    fetch(`/api/projects/${projectId}/files/ignored?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { ignored: [] }))
      .then((b) => setIgnored(new Set(b.ignored ?? [])))
      .catch(() => {});
    return () => ctrl.abort();
  }, [open, projectId, connectionId, refreshNonce]);

  // Escape belongs to the overlay while it is up. This listener is registered
  // once, before the panel's own Escape handler, so it can win the race.
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = menu !== null || draft !== null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !overlayOpenRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setMenu(null);
      setDraft(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!menu) return;
    // Closes on outside press only: a plain window mousedown listener would also
    // fire for presses inside the menu, unmounting it before the item's click.
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // --- Tree interactions ---

  const toggleFolder = useCallback(
    (path: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!dirCache[path] || dirCache[path].entries.length === 0) {
            void fetchDir(path);
          }
        }
        return next;
      });
    },
    [dirCache, fetchDir],
  );

  const handleRefresh = () => {
    void fetchDir("");
    expandedFolders.forEach((p) => void fetchDir(p));
    setRefreshNonce((n) => n + 1);
  };

  const handleFileSelect = (path: string) => {
    void fetchFile(path);
    // On mobile the tree is a full-width overlay; collapse it so the freshly
    // opened file is visible instead of leaving the user on the file list.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setTreeCollapsed(true);
    }
  };

  // --- Derived state ---

  const rootEntries = dirCache[""]?.entries
    ? sortEntries(dirCache[""].entries)
    : [];

  const siblingEntries = selectedPath ? (dirCache[parentOf(selectedPath)]?.entries ?? []) : [];
  const selectedEntry = siblingEntries.find((e) => e.path === selectedPath) ?? null;
  const actionDir = !selectedPath
    ? ""
    : selectedEntry?.isDir
      ? selectedPath
      : parentOf(selectedPath);

  // When searching, show the server's recursive results (reaches unfetched
  // subfolders); otherwise show the root tree as-is.
  const filteredFlat = searchQuery ? (searchResults ?? []) : null;

  const isModified =
    editContent !== null &&
    openFile &&
    editContent !== openFile.content;

  // --- Keyboard shortcuts ---

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isText =
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA";

      if (isText) {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          void saveFile();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (selectedPath && !draft) {
        const entry = (dirCache[parentOf(selectedPath)]?.entries ?? []).find(
          (en) => en.path === selectedPath,
        );
        if (e.key === "F2" && entry) {
          e.preventDefault();
          beginRename(entry);
        } else if (e.key === "Delete" && entry) {
          e.preventDefault();
          void deleteEntry(entry);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () =>
      window.removeEventListener("keydown", onKeyDown, true);
  }, [open, saveFile, onClose, draft, selectedPath, dirCache, beginRename, deleteEntry]);

  // Expose fetchFile for git panel integration
  useEffect(() => {
    if (!open) return;
    (window as any).__focusExplorerOpenFile = fetchFile;
    return () => {
      delete (window as any).__focusExplorerOpenFile;
    };
  }, [open, fetchFile]);

  if (!open) return null;

  return (
    <aside className={embedded
      ? "flex h-full w-full border-l border-neutral-800 bg-neutral-950 shadow-2xl"
      : "absolute inset-y-0 right-0 z-40 flex w-full max-w-[56rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl"
    }>
      {/* --- Tree Panel (left) --- */}
      {/* Mobile: full-width overlay so file names have room; collapses on select.
          Desktop: fixed 15rem sidebar. */}
      <div
        className={`absolute inset-0 z-10 flex h-full w-full shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 md:static md:z-auto md:w-60 md:bg-transparent ${
          treeCollapsed ? "hidden" : "flex"
        } md:flex`}
      >
        {/* Tree header */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            Explorer
          </span>
          <button
            onClick={() => beginCreate("new-file", actionDir)}
            title="New File"
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
          >
            <FilePlus2 size={12} />
          </button>
          <button
            onClick={() => beginCreate("new-folder", actionDir)}
            title="New Folder"
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={handleRefresh}
            title="Refresh"
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setTreeCollapsed(true)}
            title="Collapse sidebar"
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer md:hidden"
          >
            <PanelLeft size={12} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>

        {/* Tree search */}
        <div className="border-b border-neutral-800 px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1">
            <Search
              size={11}
              className="shrink-0 text-neutral-500"
            />
            <input
              ref={searchRef}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter files..."
              className="min-w-0 flex-1 bg-transparent text-[11px] text-neutral-100 outline-none placeholder:text-neutral-600"
            />
            {filterText && (
              <button
                onClick={() => setFilterText("")}
                className="shrink-0 text-neutral-500 hover:text-white cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Tree content */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden py-1"
          onContextMenu={(e) => openContextMenu(e, null)}
        >
          {dirCache[""]?.loading && rootEntries.length === 0 && (
            <div className="flex items-center justify-center py-6 text-neutral-500">
              <LoaderCircle
                size={14}
                className="animate-spin mr-2"
              />
              <span className="text-xs">Loading...</span>
            </div>
          )}

          {dirCache[""]?.error && (
            <div className="mx-2 my-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">
              {dirCache[""].error}
            </div>
          )}

          {treeError && (
            <div className="mx-2 my-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">
              {treeError}
            </div>
          )}

          {filteredFlat ? (
            searchLoading && filteredFlat.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-neutral-500">
                <LoaderCircle size={14} className="animate-spin mr-2" />
                <span className="text-xs">Searching...</span>
              </div>
            ) : filteredFlat.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                No matching files
              </div>
            ) : (
              filteredFlat.map((entry) => {
                const Icon = entry.isDir ? Folder : getFileIcon(entry.name);
                const isActive = !entry.isDir && entry.path === openFile?.path;
                const dim = isIgnored(entry.path) ? " text-neutral-600 italic" : "";
                return (
                  <button
                    key={entry.path}
                    onClick={() => {
                      setSelectedPath(entry.path);
                      if (entry.isDir) toggleFolder(entry.path);
                      else handleFileSelect(entry.path);
                    }}
                    onContextMenu={(e) => openContextMenu(e, entry)}
                    className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] transition-colors cursor-pointer ${
                      isActive
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-300 hover:bg-neutral-800/70 hover:text-white"
                    }${dim}`}
                    style={{ paddingLeft: 8, paddingRight: 8 }}
                    title={entry.path}
                  >
                    {entry.isDir ? (
                      <Folder size={14} className="shrink-0 text-sky-400" />
                    ) : (
                      <Icon size={14} className="shrink-0 text-neutral-500" />
                    )}
                    <span className="min-w-0 truncate font-mono">{entry.path}</span>
                    </button>
                  );
              })
            )
          ) : (
            <>
              {rootEntries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  dirCache={dirCache}
                  expandedFolders={expandedFolders}
                  activeFilePath={openFile?.path ?? null}
                  searchQuery={searchQuery}
                  ctx={treeCtx}
                  onToggleFolder={toggleFolder}
                  onFileSelect={handleFileSelect}
                />
              ))}
              {draft && draft.parent === "" && draft.mode !== "rename" && (
                <div style={{ paddingLeft: 16, paddingRight: 8 }}>
                  <InlineInput
                    depth={0}
                    isDir={draft.mode === "new-folder"}
                    value={draft.value}
                    ctx={treeCtx}
                  />
                </div>
              )}
            </>
          )}

          {filteredFlat === null &&
            rootEntries.length === 0 &&
            !dirCache[""]?.loading &&
            !dirCache[""]?.error && (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                Empty project
              </div>
            )}
        </div>
      </div>

      {/* --- Editor Panel (right) --- */}
      <div className="flex h-full flex-1 flex-col min-w-0">
        {/* Editor header */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          {/* Expand tree button — mobile only, when collapsed */}
          {treeCollapsed && (
            <button
              onClick={() => setTreeCollapsed(false)}
              title="Show file tree"
              className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer md:hidden shrink-0"
            >
              <PanelLeft size={14} />
            </button>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2">
            {openFile ? (
              <FileCode2
                size={14}
                className="shrink-0 text-neutral-300"
              />
            ) : (
              <FileCode2
                size={14}
                className="shrink-0 text-neutral-600"
              />
            )}
            <p className="truncate text-[13px] font-medium text-neutral-100">
              {openFile
                ? openFile.path.split("/").pop()
                : "No file open"}
            </p>
            {openFile && isModified && (
              <span className="text-[10px] text-amber-400 shrink-0">
                modified
              </span>
            )}
          </div>

          {openFile && editContent !== null && (
            <button
              onClick={() => void saveFile()}
              disabled={saving || !isModified}
              title="Save (Ctrl+S)"
              className={`rounded p-1.5 transition-colors ${
                isModified && !saving
                  ? "text-emerald-400 hover:bg-emerald-500/10"
                  : "text-neutral-600 cursor-not-allowed"
              }`}
            >
              {saving ? (
                <LoaderCircle
                  size={14}
                  className="animate-spin"
                />
              ) : (
                <Save size={14} />
              )}
            </button>
          )}

          {/* Refresh + Close — mobile only, when tree collapsed */}
          {treeCollapsed && (
            <>
              <button
                onClick={handleRefresh}
                title="Refresh"
                className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer md:hidden"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={onClose}
                title="Close"
                className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer md:hidden"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>

        {/* Recent-files quick switch — mobile only. One tap to jump between
            recently opened files without reopening the tree. */}
        {recentFiles.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-neutral-800 px-2 py-1.5 md:hidden">
            {recentFiles.map((p) => {
              const isActive = p === openFile?.path;
              const Icon = getFileIcon(p);
              return (
                <button
                  key={p}
                  onClick={() => void fetchFile(p)}
                  title={p}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                    isActive
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-800/70 hover:text-white"
                  }`}
                >
                  <Icon size={12} className="shrink-0 text-neutral-500" />
                  <span className="max-w-[8rem] truncate">{p.split("/").pop()}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Editor content */}
        <div className="flex-1 overflow-y-auto">
          {!openFile ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-600">
              <FileCode2 size={32} strokeWidth={1} />
              <p className="text-xs">
                Select a file from the tree to edit
              </p>
            </div>
          ) : openFile.loading ? (
            <div className="flex items-center justify-center h-full text-neutral-500">
              <LoaderCircle
                size={16}
                className="animate-spin mr-2"
              />
              <span className="text-xs">Loading file...</span>
            </div>
          ) : openFile.error ? (
            <div className="p-3">
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
                {openFile.error}
              </div>
            </div>
          ) : (
            <div className="flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 text-[10px] text-neutral-500 shrink-0">
                <span className="font-mono truncate">
                  {openFile.path}
                </span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {editContent !== null && (
                    <span>
                      {editContent.split("\n").length} lines
                    </span>
                  )}
                  <button
                    onClick={toggleDiff}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                      diffMode
                        ? "bg-blue-500/20 text-blue-400"
                        : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                    }`}
                    title="Toggle git diff view"
                  >
                    <GitCompare size={11} />
                    <span>Diff</span>
                  </button>
                  {!diffMode && (
                    <button
                      onClick={saveFile}
                      disabled={saving}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
                      title="Save (Ctrl+S)"
                    >
                      <Save size={11} />
                      <span>
                        {saving ? "Saving..." : "Save"}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {saveFeedback && !diffMode && (
                <div
                  className={`mx-3 mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                    saveFeedback === "Saved"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                      : "border-red-500/20 bg-red-500/10 text-red-200"
                  }`}
                >
                  {saveFeedback}
                </div>
              )}

              {diffMode ? (
                diffLoading ? (
                  <div className="flex flex-1 items-center justify-center text-neutral-500">
                    <LoaderCircle
                      size={16}
                      className="animate-spin mr-2"
                    />
                    <span className="text-xs">Loading diff...</span>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0">
                    <DiffViewer
                      path={openFile.path}
                      original={headContent ?? ""}
                      modified={
                        editContent ?? openFile.content
                      }
                    />
                  </div>
                )
              ) : (
                <div className="flex-1 min-h-0">
                  <CodeEditor
                    path={openFile.path}
                    value={editContent ?? openFile.content}
                    onChange={(val) => setEditContent(val)}
                    onSave={saveFile}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Editor footer */}
        {openFile && (
          <div className="border-t border-neutral-800 px-3 py-1.5 flex items-center gap-3 text-[9px] text-neutral-600 shrink-0">
            <span>⌘S save</span>
            <span>esc close</span>
            <span>F2 rename</span>
            <span>right-click menu</span>
          </div>
        )}
      </div>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[10060] min-w-[11rem] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(menu.entry === null || menu.entry.isDir) && (
              <>
                <MenuItem
                  icon={FilePlus2}
                  label="New File"
                  onClick={() => beginCreate("new-file", menu.entry?.path ?? actionDir)}
                />
                <MenuItem
                  icon={FolderPlus}
                  label="New Folder"
                  onClick={() => beginCreate("new-folder", menu.entry?.path ?? actionDir)}
                />
                <div className="my-1 border-t border-neutral-800" />
              </>
            )}
            {menu.entry && (
              <>
                <MenuItem icon={Pencil} label="Rename" onClick={() => beginRename(menu.entry)} />
                <MenuItem
                  icon={Trash2}
                  label="Delete"
                  danger
                  onClick={() => void deleteEntry(menu.entry)}
                />
              </>
            )}
            {!menu.entry && (dirCache[""]?.entries?.length ?? 0) > 0 && (
              <MenuItem
                icon={RefreshCw}
                label="Refresh"
                onClick={() => {
                  setMenu(null);
                  handleRefresh();
                }}
              />
            )}
          </div>,
          document.body,
        )}
    </aside>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: typeof File;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors cursor-pointer ${
        danger
          ? "text-red-300 hover:bg-red-500/10"
          : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
      }`}
    >
      <Icon size={13} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}
