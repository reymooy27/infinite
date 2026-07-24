
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWsUrl } from "@/lib/ws";
import { useProjectStore } from "@/stores/useProjectStore";
import { useSSHStore } from "@/stores/useSSHStore";

type PickerTarget = "new" | "edit";

type RemoteBrowserEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
};

function projectNameFromPath(value: string) {
  const trimmed = value.replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

export default function ProjectsPanel() {
  const {
    projects,
    activeProjectId,
    loading,
    fetchProjects,
    createProject,
    deleteProject,
    renameProject,
    switchProject,
  } = useProjectStore();
  const {
    connections,
    loading: connectionsLoading,
    fetchConnections,
  } = useSSHStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDir, setNewDir] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDir, setEditDir] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<PickerTarget>("new");
  const [browserConnectionId, setBrowserConnectionId] = useState<number | null>(null);
  const [browserPathInput, setBrowserPathInput] = useState(".");
  const browserRequestedPathRef = useRef(".");
  const [browserCurrentPath, setBrowserCurrentPath] = useState(".");
  const [browserParentPath, setBrowserParentPath] = useState<string | null>(null);
  const [browserEntries, setBrowserEntries] = useState<RemoteBrowserEntry[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [browserSessionKey, setBrowserSessionKey] = useState(0);

  const newNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const browserWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (projects.length === 0 && !loading) fetchProjects();
  }, [fetchProjects, loading, projects.length]);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (editingId) editNameRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (!browserOpen || connections.length > 0 || connectionsLoading) return;
    fetchConnections();
  }, [browserOpen, connections.length, connectionsLoading, fetchConnections]);

  const resolvedBrowserConnectionId = browserConnectionId ?? connections[0]?.id ?? null;

  const browserWsUrl = useMemo(() => {
    if (!browserOpen || resolvedBrowserConnectionId === null) return null;
    return buildWsUrl("/ws/sftp", {
      connectionId: resolvedBrowserConnectionId,
      b: `projects-${browserSessionKey}`,
    });
  }, [browserOpen, browserSessionKey, resolvedBrowserConnectionId]);

  const sendBrowserListRequest = useCallback((ws: WebSocket, targetPath: string) => {
    ws.send(JSON.stringify({
      type: "list_request",
      requestPath: targetPath.trim() || ".",
    }));
  }, []);

  const requestBrowserDirectory = useCallback((targetPath: string, wsOverride?: WebSocket) => {
    const nextPath = targetPath.trim() || ".";
    browserRequestedPathRef.current = nextPath;
    setBrowserLoading(true);
    setBrowserError("");

    const ws = wsOverride ?? browserWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendBrowserListRequest(ws, nextPath);
      return;
    }

    if (resolvedBrowserConnectionId !== null) {
      setBrowserSessionKey((key) => key + 1);
    }
  }, [resolvedBrowserConnectionId, sendBrowserListRequest]);

  useEffect(() => {
    if (!browserWsUrl) return;

    const ws = new WebSocket(browserWsUrl);
    browserWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "connected") {
          requestBrowserDirectory(browserRequestedPathRef.current, ws);
        } else if (msg.type === "list_response") {
          setBrowserCurrentPath(msg.currentPath || browserRequestedPathRef.current);
          setBrowserPathInput(msg.currentPath || browserRequestedPathRef.current);
          setBrowserParentPath(msg.parentPath || null);
          setBrowserEntries(Array.isArray(msg.entries) ? msg.entries : []);
          setBrowserLoading(false);
          setBrowserError("");
        } else if (msg.type === "list_error") {
          setBrowserLoading(false);
          setBrowserError(msg.message || "Failed to list directory");
        } else if (msg.type === "error") {
          setBrowserLoading(false);
          setBrowserError(msg.message || "Connection failed");
        }
      } catch {
        setBrowserLoading(false);
        setBrowserError("Invalid browser response");
      }
    };

    ws.onclose = () => {
      if (browserWsRef.current === ws) {
        browserWsRef.current = null;
      }
      setBrowserLoading(false);
    };

    ws.onerror = () => {
      setBrowserLoading(false);
      setBrowserError("Browser connection failed");
    };

    return () => {
      ws.close();
      if (browserWsRef.current === ws) {
        browserWsRef.current = null;
      }
    };
  }, [browserWsUrl, requestBrowserDirectory]);

  const closeRemotePicker = useCallback(() => {
    browserWsRef.current?.close();
    browserWsRef.current = null;
    setBrowserOpen(false);
    setBrowserLoading(false);
    setBrowserError("");
    setBrowserEntries([]);
    setBrowserParentPath(null);
  }, []);

  const applyPickedDirectory = useCallback((directory: string) => {
    if (browserTarget === "new") {
      setNewDir(directory);
      setNewName((current) => current.trim() || projectNameFromPath(directory));
    } else {
      setEditDir(directory);
      setEditName((current) => current.trim() || projectNameFromPath(directory));
    }
    closeRemotePicker();
  }, [browserTarget, closeRemotePicker]);

  const openRemotePicker = useCallback((target: PickerTarget) => {
    const initialPath = (target === "new" ? newDir : editDir).trim() || ".";
    setBrowserTarget(target);
    setBrowserOpen(true);
    setBrowserError("");
    setBrowserEntries([]);
    setBrowserCurrentPath(initialPath);
    setBrowserParentPath(null);
    setBrowserPathInput(initialPath);
    browserRequestedPathRef.current = initialPath;

    if (connections.length === 0) {
      setBrowserConnectionId(null);
      return;
    }

    setBrowserConnectionId((current) => current ?? connections[0].id);
    setBrowserSessionKey((key) => key + 1);
  }, [connections, editDir, newDir]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName("");
    setNewDir("");
    await createProject(name, newDir.trim() || undefined);
  };

  const handleEditSubmit = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    await renameProject(editingId, name, editDir.trim() || "");
    setEditingId(null);
  };

  const startEditing = (id: string) => {
    const project = projects.find((entry) => entry.id === id);
    if (!project) return;
    setEditingId(id);
    setEditName(project.name);
    setEditDir(project.directory ?? "");
    setDeletingId(null);
  };

  const handleSwitch = async (id: string) => {
    if (id === activeProjectId || switching) return;
    setSwitching(id);
    await switchProject(id);
    setSwitching(null);
  };

  const handleDelete = async (id: string) => {
    if (projects.length <= 1) return;
    setDeletingId(null);
    await deleteProject(id);
  };

  const availableDirectories = browserEntries.filter((entry) => entry.isDirectory);
  const hasConnections = connections.length > 0;

  return (
    <div className="p-2.5 flex flex-col gap-2">
      {browserOpen && (
        <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2.5">
              <div>
                <h3 className="text-[13px] font-semibold text-neutral-100">
                  Select server folder
                </h3>
                <p className="text-[10px] text-neutral-500">
                  Same remote file picker as file transfer.
                </p>
              </div>
              <button
                type="button"
                onClick={closeRemotePicker}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 p-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  SSH connection
                </label>
                <select
                  value={resolvedBrowserConnectionId ?? ""}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setBrowserConnectionId(Number.isFinite(value) ? value : null);
                    setBrowserSessionKey((key) => key + 1);
                  }}
                  disabled={!hasConnections}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[12px] text-neutral-100 outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  {hasConnections ? (
                    connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name} ({connection.username}@{connection.host})
                      </option>
                    ))
                  ) : (
                    <option value="">
                      {connectionsLoading ? "Loading connections..." : "No SSH connections"}
                    </option>
                  )}
                </select>
              </div>

              {hasConnections && (
                <>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => browserParentPath && requestBrowserDirectory(browserParentPath)}
                      disabled={!browserParentPath || browserLoading}
                      className="px-2 py-2 rounded-md border border-neutral-700 bg-neutral-950 text-neutral-300 disabled:text-neutral-600 disabled:border-neutral-800 cursor-pointer disabled:cursor-not-allowed"
                      title="Go up"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                    <input
                      type="text"
                      value={browserPathInput}
                      onChange={(event) => setBrowserPathInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") requestBrowserDirectory(browserPathInput);
                      }}
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[12px] text-neutral-100 outline-none focus:border-blue-500 font-mono"
                      placeholder="."
                    />
                    <button
                      type="button"
                      onClick={() => requestBrowserDirectory(browserPathInput)}
                      disabled={browserLoading}
                      className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      Go
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-400">
                      {browserCurrentPath}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyPickedDirectory(browserCurrentPath)}
                      disabled={browserLoading}
                      className="ml-2 rounded-md bg-blue-600 px-2.5 py-1 text-[10px] text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      Use this folder
                    </button>
                  </div>

                  <div className="h-64 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
                    {browserLoading ? (
                      <div className="flex h-full items-center justify-center text-[12px] text-neutral-500">
                        Loading folders...
                      </div>
                    ) : browserError ? (
                      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-red-400">
                        {browserError}
                      </div>
                    ) : availableDirectories.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-[12px] text-neutral-500">
                        No subfolders here
                      </div>
                    ) : (
                      <div className="divide-y divide-neutral-800">
                        {availableDirectories.map((entry) => (
                          <div key={entry.path} className="flex items-center gap-2 px-2.5 py-2">
                            <button
                              type="button"
                              onClick={() => requestBrowserDirectory(entry.path)}
                              className="min-w-0 flex-1 text-left text-[12px] text-neutral-300 transition-colors hover:text-white cursor-pointer"
                            >
                              <div className="truncate">{entry.name}</div>
                              <div className="truncate text-[10px] text-neutral-500">
                                {entry.path}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => applyPickedDirectory(entry.path)}
                              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
                            >
                              Select
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {!hasConnections && !connectionsLoading && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                  Add SSH connection first. Remote folder picker reads server filesystem.
                </div>
              )}

              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={closeRemotePicker}
                  className="rounded-md px-3 py-1.5 text-[12px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {creating ? (
        <form
          onSubmit={(event) => { event.preventDefault(); handleCreate(); }}
          className="flex flex-col gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/50 p-2.5"
        >
          <input
            ref={newNameRef}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCreating(false);
                setNewName("");
                setNewDir("");
              }
            }}
            placeholder="Project name"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
          />
          <div className="relative">
            <input
              value={newDir}
              onChange={(event) => setNewDir(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                  setNewDir("");
                }
              }}
              placeholder="/home/user/myproject  (optional)"
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 pl-7 pr-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500 font-mono"
            />
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => openRemotePicker("new")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
          >
            Browse server folder
          </button>
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={!newName.trim()}
              className="flex-1 rounded-md bg-blue-600 py-1.5 text-[12px] text-white transition-colors hover:bg-blue-500 disabled:opacity-40 cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewDir("");
              }}
              className="rounded-md px-3 py-1.5 text-[12px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-neutral-700 px-3 py-2 text-left text-[12px] text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200 cursor-pointer"
        >
          <span className="text-base leading-none">+</span>
          <span>New project</span>
        </button>
      )}

      <div className="space-y-1">
        {loading && projects.length === 0 && (
          <p className="px-1 py-2 text-[12px] text-neutral-500">Loading…</p>
        )}
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          const isEditing = editingId === project.id;
          const isDeleting = deletingId === project.id;
          const isSwitching = switching === project.id;

          return (
            <div
              key={project.id}
              className={`group rounded-lg border transition-colors ${
                isActive
                  ? "border-blue-600 bg-blue-950/40"
                  : "border-neutral-700 bg-neutral-800/50 hover:border-neutral-600 hover:bg-neutral-800"
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-blue-400" : "bg-transparent"}`} />

                <button
                  onClick={() => handleSwitch(project.id)}
                  disabled={isActive || !!switching}
                  className="flex-1 text-left cursor-pointer disabled:cursor-default"
                >
                  <div className="truncate text-[13px] font-medium text-neutral-100">
                    {isSwitching ? <span className="text-neutral-400">Switching…</span> : project.name}
                  </div>
                  {project.directory && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-500">
                      {project.directory}
                    </div>
                  )}
                </button>

                {!isEditing && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => startEditing(project.id)}
                      title="Edit"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-neutral-200 cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>

                    {isDeleting ? (
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => handleDelete(project.id)} className="h-5 px-1.5 text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
                          Delete
                        </button>
                        <button onClick={() => setDeletingId(null)} className="h-5 px-1 text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer">
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(project.id)}
                        disabled={projects.length <= 1}
                        title={projects.length <= 1 ? "Cannot delete last project" : "Delete"}
                        className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isEditing && (
                <form
                  onSubmit={(event) => { event.preventDefault(); handleEditSubmit(); }}
                  className="flex flex-col gap-1.5 px-3 pb-2.5"
                >
                  <input
                    ref={editNameRef}
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    placeholder="Project name"
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
                  />
                  <div className="relative">
                    <input
                      value={editDir}
                      onChange={(event) => setEditDir(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      placeholder="/home/user/myproject  (optional)"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 pl-7 pr-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500 font-mono"
                    />
                    <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    onClick={() => openRemotePicker("edit")}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
                  >
                    Browse server folder
                  </button>
                  <div className="flex gap-1.5">
                    <button
                      type="submit"
                      disabled={!editName.trim()}
                      className="flex-1 rounded-md bg-blue-600 py-1.5 text-[12px] text-white transition-colors hover:bg-blue-500 disabled:opacity-40 cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-md px-3 py-1.5 text-[12px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
