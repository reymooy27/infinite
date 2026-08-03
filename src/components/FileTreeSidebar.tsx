import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

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

interface FileTreeSidebarProps {
  open: boolean;
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  activeFilePath?: string | null;
  onFileSelect: (path: string) => void;
  onClose: () => void;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return FileCode2;
  if (["json", "yaml", "yml", "toml", "ini", "env", "conf"].includes(ext)) return FileText;
  if (["md", "txt", "log", "csv"].includes(ext)) return FileText;
  if (["html", "css", "scss", "less"].includes(ext)) return FileCode2;
  if (["py", "rb", "go", "rs", "java", "c", "cpp", "h", "sh", "bash"].includes(ext)) return FileCode2;
  return File;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

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
    const sortedChildren = childState?.entries ? sortEntries(childState.entries) : [];
    const filteredChildren = searchQuery
      ? sortedChildren.filter((c) => c.name.toLowerCase().includes(searchQuery))
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
        {isExpanded && childState?.loading && sortedChildren.length === 0 && (
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

export default function FileTreeSidebar({
  open,
  projectId,
  connectionId,
  activeFilePath,
  onFileSelect,
  onClose,
}: FileTreeSidebarProps) {
  const [dirCache, setDirCache] = useState<Record<string, DirState>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [filterText, setFilterText] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchDir = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setDirCache((prev) => ({
        ...prev,
        [path]: { loading: true, error: "", entries: prev[path]?.entries ?? [] },
      }));

      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        if (connectionId) params.set("connectionId", String(connectionId));
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const res = await fetch(`/api/projects/${projectId}/files${suffix}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to list directory");

        setDirCache((prev) => ({
          ...prev,
          [path]: { loading: false, error: "", entries: body.entries },
        }));
      } catch (err) {
        setDirCache((prev) => ({
          ...prev,
          [path]: {
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load",
            entries: prev[path]?.entries ?? [],
          },
        }));
      }
    },
    [projectId, connectionId],
  );

  // Load root on open
  useEffect(() => {
    if (!open || !projectId) return;
    setDirCache({});
    setExpandedFolders(new Set());
    void fetchDir("");
  }, [open, projectId, fetchDir]);

  // Debounce filter → search
  useEffect(() => {
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => setSearchQuery(filterText.toLowerCase()), 200);
    return () => clearTimeout(filterTimerRef.current);
  }, [filterText]);

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

  const rootEntries = dirCache[""]?.entries ? sortEntries(dirCache[""].entries) : [];
  const filteredRoot = searchQuery
    ? rootEntries.filter((e) => e.name.toLowerCase().includes(searchQuery))
    : rootEntries;

  if (!open) return null;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/95 backdrop-blur-md">
      {/* Header */}
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
          onClick={onClose}
          title="Close explorer"
          className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-neutral-800 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1">
          <Search size={11} className="shrink-0 text-neutral-500" />
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

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {dirCache[""]?.loading && rootEntries.length === 0 && (
          <div className="flex items-center justify-center py-6 text-neutral-500">
            <span className="text-xs">Loading...</span>
          </div>
        )}

        {dirCache[""]?.error && (
          <div className="mx-2 my-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">
            {dirCache[""].error}
          </div>
        )}

        {filteredRoot.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            dirCache={dirCache}
            expandedFolders={expandedFolders}
            activeFilePath={activeFilePath ?? null}
            searchQuery={searchQuery}
            onToggleFolder={toggleFolder}
            onFileSelect={onFileSelect}
          />
        ))}

        {filteredRoot.length === 0 && !dirCache[""]?.loading && !dirCache[""]?.error && (
          <div className="px-3 py-6 text-center text-xs text-neutral-500">
            {filterText ? "No matching files" : "Empty project"}
          </div>
        )}
      </div>
    </aside>
  );
}
