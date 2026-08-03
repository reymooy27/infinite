import { useCallback, useEffect, useState } from "react";
import {
  FileCode2,
  GitCompare,
  LoaderCircle,
  Save,
  X,
} from "lucide-react";
import CodeEditor from "./CodeEditor";
import DiffViewer from "./DiffViewer";

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
  initialPath?: string | null;
  onClose: () => void;
}

export default function FocusModeFileExplorer({
  open,
  projectId,
  connectionId,
  initialPath,
  onClose,
}: FocusModeFileExplorerProps) {
  const [openFile, setOpenFile] = useState<FileContent | null>(null);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [headContent, setHeadContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const fetchFile = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setOpenFile({ path, content: "", loading: true, error: "" });
      setEditContent(null);
      setDiffMode(false);
      setHeadContent(null);

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

  const fetchHeadContent = useCallback(async () => {
    if (!projectId || !openFile) return;
    setDiffLoading(true);
    try {
      const params = new URLSearchParams({ path: openFile.path });
      if (connectionId) params.set("connectionId", String(connectionId));
      const res = await fetch(`/api/projects/${projectId}/git/file-head?${params}`);
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

  // Reset on open
  useEffect(() => {
    if (!open || !projectId) return;
    setOpenFile(null);
    setEditContent(null);
    setDiffMode(false);
    setHeadContent(null);
  }, [open, projectId]);

  // Auto-open initialPath
  useEffect(() => {
    if (!open || !projectId || !initialPath) return;
    void fetchFile(initialPath);
    setDiffMode(true);
  }, [open, projectId, initialPath, fetchFile]);

  // Auto-dismiss save feedback
  useEffect(() => {
    if (!saveFeedback) return;
    const t = setTimeout(() => setSaveFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [saveFeedback]);

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
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, saveFile, onClose]);

  // Expose openFile on window for tree sidebar to call
  useEffect(() => {
    if (!open) return;
    (window as any).__focusExplorerOpenFile = fetchFile;
    return () => { delete (window as any).__focusExplorerOpenFile; };
  }, [open, fetchFile]);

  if (!open) return null;

  return (
    <aside className="absolute inset-y-0 right-0 z-40 w-full max-w-[28rem] border-l border-neutral-800 bg-neutral-950/95 backdrop-blur-md shadow-2xl">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {openFile ? (
              <FileCode2 size={14} className="shrink-0 text-neutral-300" />
            ) : (
              <FileCode2 size={14} className="shrink-0 text-neutral-600" />
            )}
            <p className="truncate text-[13px] font-medium text-neutral-100">
              {openFile ? openFile.path.split("/").pop() : "No file open"}
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
            onClick={onClose}
            title="Close editor"
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!openFile ? (
            <div className="flex flex-1 flex-col items-center justify-center h-full gap-2 text-neutral-600">
              <FileCode2 size={32} strokeWidth={1} />
              <p className="text-xs">Select a file from the tree to edit</p>
            </div>
          ) : openFile.loading ? (
            <div className="flex flex-1 items-center justify-center text-neutral-500 h-full">
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
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {editContent !== null && (
                    <span>{editContent.split("\n").length} lines</span>
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
                      <span>{saving ? "Saving..." : "Save"}</span>
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
                    <LoaderCircle size={16} className="animate-spin mr-2" />
                    <span className="text-xs">Loading diff...</span>
                  </div>
                ) : (
                  <DiffViewer
                    path={openFile.path}
                    original={headContent ?? ""}
                    modified={editContent ?? openFile.content}
                  />
                )
              ) : (
                <CodeEditor
                  path={openFile.path}
                  value={editContent ?? openFile.content}
                  onChange={(val) => setEditContent(val)}
                  onSave={saveFile}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {openFile && (
          <div className="border-t border-neutral-800 px-3 py-1.5 flex items-center gap-3 text-[9px] text-neutral-600">
            <span>⌘S save</span>
            <span>esc close</span>
          </div>
        )}
      </div>
    </aside>
  );
}
