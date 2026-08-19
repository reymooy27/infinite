// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitCompare,
  LoaderCircle,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
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

// --- Tree Node ---

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  dirCache: Record<string, DirState>;
  expandedFolders: Set<string>;
  activeFilePath: string | null;
  searchQuery: string;
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
  onToggleFolder,
  onFileSelect,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(entry.path);
  const isActive = !entry.isDir && entry.path === activeFilePath;
  const childState = dirCache[entry.path];
  const indent = depth * 12;

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

    return (
      <div>
        <button
          onClick={() => onToggleFolder(entry.path)}
          className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] text-neutral-300 transition-colors hover:bg-neutral-800/70 hover:text-white cursor-pointer"
          style={{ paddingLeft: `${indent + 8}px`, paddingRight: 8 }}
        >
          {isExpanded ? (
            <ChevronDown size={12} className="shrink-0 text-neutral-600" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-neutral-600" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} className="shrink-0 text-sky-400" />
          ) : (
            <Folder size={14} className="shrink-0 text-sky-400" />
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
              onToggleFolder={onToggleFolder}
              onFileSelect={onFileSelect}
            />
          ))}
      </div>
    );
  }

  const Icon = getFileIcon(entry.name);

  return (
    <button
      onClick={() => onFileSelect(entry.path)}
      className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] transition-colors cursor-pointer ${
        isActive
          ? "bg-neutral-800 text-white"
          : "text-neutral-400 hover:bg-neutral-800/70 hover:text-white"
      }`}
      style={{ paddingLeft: `${indent + 24}px`, paddingRight: 8 }}
    >
      <Icon size={14} className="shrink-0 text-neutral-500" />
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

  // Auto-dismiss save feedback
  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

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
    setDirCache({});
    setExpandedFolders(new Set());
    void fetchDir("");
  };

  const handleFileSelect = (path: string) => {
    void fetchFile(path);
  };

  // --- Derived state ---

  // Flatten cached entries recursively (only folders already loaded into dirCache)
  const flattenCachedEntries = useCallback((): FileEntry[] => {
    const result: FileEntry[] = [];
    const seen = new Set<string>();
    const walk = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        result.push(entry);
        if (entry.isDir) {
          const child = dirCache[entry.path];
          if (child?.entries) walk(child.entries);
        }
      }
    };
    if (dirCache[""]?.entries) walk(dirCache[""].entries);
    return result;
  }, [dirCache]);

  const rootEntries = dirCache[""]?.entries
    ? sortEntries(dirCache[""].entries)
    : [];

  // When filtering, flatten all cached entries; otherwise show root tree as-is
  const filteredFlat = searchQuery
    ? flattenCachedEntries().filter((e) => {
        const fullPath = e.path ? e.path.toLowerCase() : e.name.toLowerCase();
        return fullPath.includes(searchQuery);
      })
    : null;

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
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () =>
      window.removeEventListener("keydown", onKeyDown, true);
  }, [open, saveFile, onClose]);

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
      <div
        className={`flex h-full w-60 shrink-0 flex-col border-r border-neutral-800 ${
          treeCollapsed ? "hidden" : "flex"
        } md:flex`}
      >
        {/* Tree header */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            Explorer
          </span>
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
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
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

          {filteredFlat ? (
            filteredFlat.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">
                No matching files
              </div>
            ) : (
              filteredFlat.map((entry) => {
                const Icon = entry.isDir ? Folder : getFileIcon(entry.name);
                const isActive = !entry.isDir && entry.path === openFile?.path;
                return (
                  <button
                    key={entry.path}
                    onClick={() =>
                      entry.isDir
                        ? toggleFolder(entry.path)
                        : handleFileSelect(entry.path)
                    }
                    className={`group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-[12px] transition-colors cursor-pointer ${
                      isActive
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-300 hover:bg-neutral-800/70 hover:text-white"
                    }`}
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
            rootEntries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                dirCache={dirCache}
                expandedFolders={expandedFolders}
                activeFilePath={openFile?.path ?? null}
                searchQuery={searchQuery}
                onToggleFolder={toggleFolder}
                onFileSelect={handleFileSelect}
              />
            ))
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
          </div>
        )}
      </div>
    </aside>
  );
}
