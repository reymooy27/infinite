import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

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

interface FocusModeFileExplorerProps {
  open: boolean;
  projectId: string | null;
  connectionId?: number;
  directory?: string;
  onClose: () => void;
}

function getFileIcon(name: string, isDir: boolean) {
  if (isDir) return null; // handled separately
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return FileCode2;
  if (["json", "yaml", "yml", "toml", "ini", "env", "conf"].includes(ext)) return FileText;
  if (["md", "txt", "log", "csv"].includes(ext)) return FileText;
  if (["html", "css", "scss", "less"].includes(ext)) return FileCode2;
  if (["py", "rb", "go", "rs", "java", "c", "cpp", "h", "sh", "bash"].includes(ext)) return FileCode2;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FocusModeFileExplorer({
  open,
  projectId,
  connectionId,
  directory,
  onClose,
}: FocusModeFileExplorerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [dirCache, setDirCache] = useState<Record<string, DirState>>({});
  const [openFile, setOpenFile] = useState<FileContent | null>(null);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Record<string, DirState>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

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

  const fetchFile = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setOpenFile({ path, content: "", loading: true, error: "" });
      setEditContent(null);

      try {
        const params = new URLSearchParams({ path });
        if (connectionId) params.set("connectionId", String(connectionId));
        const res = await fetch(
          `/api/projects/${projectId}/files/read?${params.toString()}`,
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to read file");

        setOpenFile({ path, content: body.content, loading: false, error: "" });
        setEditContent(body.content);
      } catch (err) {
        setOpenFile({
          path,
          content: "",
          loading: false,
          error: err instanceof Error ? err.message : "Failed to read file",
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
      if (connectionId) params.set("connectionId", String(connectionId));
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      const res = await fetch(`/api/projects/${projectId}/files/write${suffix}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openFile.path, content: editContent }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save");

      setOpenFile({ ...openFile, content: editContent, loading: false, error: "" });
      setSaveFeedback("Saved");
    } catch (err) {
      setSaveFeedback(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [projectId, connectionId, openFile, editContent]);

  // Load root directory on open
  useEffect(() => {
    if (!open || !projectId) return;
    setCurrentPath("");
    setDirCache({});
    setOpenFile(null);
    setEditContent(null);
    setExpandedFolders(new Set());
    setTreeData({});
    void fetchDir("");
  }, [open, projectId, fetchDir]);

  // Auto-dismiss save feedback
  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

  const currentDir = dirCache[currentPath];

  const filteredEntries = useMemo(() => {
    if (!currentDir?.entries) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentDir.entries;
    return currentDir.entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [currentDir?.entries, searchQuery]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.isDir) {
      setOpenFile(null);
      setEditContent(null);
      setCurrentPath(entry.path);
      if (!dirCache[entry.path]) void fetchDir(entry.path);
    } else {
      void fetchFile(entry.path);
    }
  };

  const handleBack = () => {
    if (openFile) {
      setOpenFile(null);
      setEditContent(null);
      return;
    }
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = parts.join("/");
    setCurrentPath(parentPath);
    if (!dirCache[parentPath]) void fetchDir(parentPath);
  };

  const handleRefresh = () => {
    if (openFile) {
      void fetchFile(openFile.path);
    } else {
      setDirCache((prev) => {
        const next = { ...prev };
        delete next[currentPath];
        return next;
      });
      void fetchDir(currentPath);
    }
  };

  // Tree view helpers
  const toggleTreeFolder = useCallback(
    (path: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!dirCache[path]) void fetchDir(path);
        }
        return next;
      });
    },
    [dirCache, fetchDir],
  );

  const isModified = editContent !== null && openFile && editContent !== openFile.content;

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isText =
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA";

      if (isText) {
        // Cmd/Ctrl+S to save
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          void saveFile();
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (openFile) {
            setOpenFile(null);
            setEditContent(null);
          } else {
            onClose();
          }
          break;
        case "Backspace":
          e.preventDefault();
          handleBack();
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "r":
          e.preventDefault();
          handleRefresh();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, openFile, saveFile, onClose]);

  if (!open) return null;

  const pathSegments = currentPath.split("/").filter(Boolean);

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[28rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          {(openFile || currentPath) && (
            <button
              onClick={handleBack}
              title="Go back"
              className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {openFile ? (
              <FileCode2 size={14} className="shrink-0 text-neutral-300" />
            ) : (
              <Folder size={14} className="shrink-0 text-neutral-300" />
            )}
            <p className="truncate text-[13px] font-medium text-neutral-100">
              {openFile
                ? openFile.path.split("/").pop()
                : pathSegments.length > 0
                  ? pathSegments[pathSegments.length - 1]
                  : "Files"}
            </p>
            {openFile && isModified && (
              <span className="text-[10px] text-amber-400 shrink-0">modified</span>
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
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
            </button>
          )}

          <button
            onClick={handleRefresh}
            title="Refresh"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onClose}
            title="Close file explorer"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* Breadcrumb */}
        {!openFile && pathSegments.length > 0 && (
          <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-1.5 text-[10px] text-neutral-500 overflow-x-auto">
            <button
              onClick={() => {
                setCurrentPath("");
                if (!dirCache[""]) void fetchDir("");
              }}
              className="hover:text-neutral-300 shrink-0 cursor-pointer"
            >
              root
            </button>
            {pathSegments.map((seg, i) => {
              const segPath = pathSegments.slice(0, i + 1).join("/");
              return (
                <span key={segPath} className="flex items-center gap-1 shrink-0">
                  <span>/</span>
                  <button
                    onClick={() => {
                      setCurrentPath(segPath);
                      if (!dirCache[segPath]) void fetchDir(segPath);
                    }}
                    className="hover:text-neutral-300 cursor-pointer"
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Search bar */}
        {!openFile && (
          <div className="border-b border-neutral-800 px-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5">
              <Search size={12} className="shrink-0 text-neutral-500" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter files..."
                className="min-w-0 flex-1 bg-transparent text-xs text-neutral-100 outline-none placeholder:text-neutral-600"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="shrink-0 text-neutral-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {openFile ? (
            /* File viewer/editor */
            <div className="flex h-full flex-col">
              {openFile.loading ? (
                <div className="flex flex-1 items-center justify-center text-neutral-500">
                  <LoaderCircle size={16} className="animate-spin mr-2" />
                  <span className="text-xs">Loading file...</span>
                </div>
              ) : openFile.error ? (
                <div className="p-3">
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
                    {openFile.error}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 text-[10px] text-neutral-500">
                    <span className="font-mono truncate">{openFile.path}</span>
                    <span className="shrink-0 ml-2">
                      {editContent !== null
                        ? `${editContent.split("\n").length} lines`
                        : ""}
                    </span>
                  </div>

                  {saveFeedback && (
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

                  <textarea
                    ref={editorRef}
                    value={editContent ?? openFile.content}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 min-h-0 resize-none bg-transparent p-3 font-mono text-[11px] leading-relaxed text-neutral-200 outline-none"
                    style={{ tabSize: 2 }}
                  />
                </div>
              )}
            </div>
          ) : (
            /* File list */
            <div className="px-1 py-1">
              {currentDir?.loading && currentDir.entries.length === 0 && (
                <div className="flex items-center justify-center py-8 text-neutral-500">
                  <LoaderCircle size={14} className="animate-spin mr-2" />
                  <span className="text-xs">Loading...</span>
                </div>
              )}

              {currentDir?.error && (
                <div className="mx-2 my-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
                  {currentDir.error}
                </div>
              )}

              {filteredEntries.map((entry) => {
                const Icon = entry.isDir
                  ? null
                  : getFileIcon(entry.name, entry.isDir);
                return (
                  <button
                    key={entry.path}
                    onClick={() => handleNavigate(entry)}
                    className="group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[12px] text-neutral-300 transition-colors hover:bg-neutral-800/70 hover:text-white cursor-pointer"
                  >
                    {entry.isDir ? (
                      <Folder size={14} className="shrink-0 text-sky-400" />
                    ) : Icon ? (
                      <Icon
                        size={14}
                        className="shrink-0 text-neutral-500"
                      />
                    ) : (
                      <File size={14} className="shrink-0 text-neutral-500" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {!entry.isDir && (
                      <span className="shrink-0 text-[10px] text-neutral-600 group-hover:text-neutral-500">
                        {formatSize(entry.size)}
                      </span>
                    )}
                  </button>
                );
              })}

              {filteredEntries.length === 0 && !currentDir?.loading && !currentDir?.error && (
                <div className="px-3 py-6 text-center text-xs text-neutral-500">
                  {searchQuery ? "No matching files" : "Empty directory"}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with keyboard hints */}
        {!openFile && (
          <div className="border-t border-neutral-800 px-3 py-1.5 flex items-center gap-3 text-[9px] text-neutral-600">
            <span>/ search</span>
            <span>⌫ back</span>
            <span>r refresh</span>
            <span>esc close</span>
          </div>
        )}
        {openFile && (
          <div className="border-t border-neutral-800 px-3 py-1.5 flex items-center gap-3 text-[9px] text-neutral-600">
            <span>⌘S save</span>
            <span>esc back</span>
          </div>
        )}
      </div>
    </aside>
  );
}
