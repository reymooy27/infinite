"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { useProjectStore } from "@/stores/useProjectStore";

type PickerTarget = "new" | "edit";
type PickerMode = "file" | "folder";

type BrowserFileWithPath = File & {
  path?: string;
  webkitRelativePath?: string;
};

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function dirname(filePath: string) {
  return filePath.replace(/[\\/][^\\/]+$/, "");
}

function inferPickedProject(files: FileList | null, mode: PickerMode) {
  if (!files || files.length === 0) return null;

  const firstFile = files[0] as BrowserFileWithPath;
  const fullPath =
    typeof firstFile.path === "string" && firstFile.path.trim()
      ? firstFile.path
      : "";

  if (mode === "file") {
    return {
      directory: fullPath ? dirname(fullPath) : "",
      suggestedName: stripExtension(firstFile.name),
      limited: !fullPath,
    };
  }

  const relativePath =
    typeof firstFile.webkitRelativePath === "string"
      ? firstFile.webkitRelativePath
      : "";
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const rootName = normalizedRelative.split("/").find(Boolean) || stripExtension(firstFile.name);

  if (!fullPath || !normalizedRelative) {
    return {
      directory: "",
      suggestedName: rootName,
      limited: true,
    };
  }

  const normalizedFull = fullPath.replace(/\\/g, "/");
  const relativeIndex = normalizedFull.lastIndexOf(normalizedRelative);

  if (relativeIndex === -1) {
    return {
      directory: dirname(fullPath),
      suggestedName: rootName,
      limited: true,
    };
  }

  return {
    directory: fullPath.slice(0, relativeIndex + rootName.length),
    suggestedName: rootName,
    limited: false,
  };
}

export default function ProjectsPanel() {
  const { projects, activeProjectId, loading, fetchProjects, createProject, deleteProject, renameProject, switchProject } =
    useProjectStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDir, setNewDir] = useState("");
  const [createPickerNote, setCreatePickerNote] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDir, setEditDir] = useState("");
  const [editPickerNote, setEditPickerNote] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const newNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const pickerTargetRef = useRef<PickerTarget>("new");
  const filePickerRef = useRef<HTMLInputElement>(null);
  const folderPickerRef = useRef<HTMLInputElement>(null);

  const folderPickerProps: DirectoryInputProps = {
    webkitdirectory: "",
    directory: "",
    multiple: true,
  };

  useEffect(() => {
    if (projects.length === 0 && !loading) fetchProjects();
  }, []);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (editingId) editNameRef.current?.focus();
  }, [editingId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName("");
    setNewDir("");
    setCreatePickerNote("");
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
    const p = projects.find((p) => p.id === id);
    if (!p) return;
    setEditingId(id);
    setEditName(p.name);
    setEditDir(p.directory ?? "");
    setEditPickerNote("");
    setDeletingId(null);
  };

  const openPicker = (target: PickerTarget, mode: PickerMode) => {
    pickerTargetRef.current = target;
    if (target === "new") setCreatePickerNote("");
    else setEditPickerNote("");

    if (mode === "file") filePickerRef.current?.click();
    else folderPickerRef.current?.click();
  };

  const handlePickerSelect = (event: ChangeEvent<HTMLInputElement>, mode: PickerMode) => {
    const target = pickerTargetRef.current;
    const picked = inferPickedProject(event.target.files, mode);
    event.target.value = "";

    if (!picked) return;

    const setName = target === "new" ? setNewName : setEditName;
    const setDir = target === "new" ? setNewDir : setEditDir;
    const setNote = target === "new" ? setCreatePickerNote : setEditPickerNote;

    if (picked.directory) setDir(picked.directory);
    if (picked.suggestedName) {
      setName((current) => (current.trim() ? current : picked.suggestedName));
    }

    setNote(
      picked.limited
        ? "Browser hide full path. Name filled from selection. Directory still manual."
        : "",
    );
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

  return (
    <div className="p-2.5 flex flex-col gap-2">
      <input
        type="file"
        ref={filePickerRef}
        onChange={(event) => handlePickerSelect(event, "file")}
        className="hidden"
      />
      <input
        type="file"
        ref={folderPickerRef}
        onChange={(event) => handlePickerSelect(event, "folder")}
        className="hidden"
        {...folderPickerProps}
      />

      {/* Create button / inline form */}
      {creating ? (
        <form
          onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
          className="flex flex-col gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/50 p-2.5"
        >
          <input
            ref={newNameRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setCreating(false), setNewName(""), setNewDir(""), setCreatePickerNote(""))}
            placeholder="Project name"
            className="rounded-md bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
          />
          <div className="relative">
            <input
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setCreating(false), setNewName(""), setNewDir(""), setCreatePickerNote(""))}
              placeholder="/home/user/myproject  (optional)"
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 pl-7 pr-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500 font-mono"
            />
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => openPicker("new", "file")}
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
            >
              Pick file
            </button>
            <button
              type="button"
              onClick={() => openPicker("new", "folder")}
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
            >
              Pick folder
            </button>
          </div>
          {createPickerNote && (
            <p className="text-[10px] text-amber-300">{createPickerNote}</p>
          )}
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={!newName.trim()}
              className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-[12px] text-white transition-colors cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(""); setNewDir(""); setCreatePickerNote(""); }}
              className="px-3 py-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 text-[12px] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 w-full rounded-lg border border-dashed border-neutral-700 px-3 py-2 text-left text-[12px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
        >
          <span className="text-base leading-none">+</span>
          <span>New project</span>
        </button>
      )}

      {/* Project list */}
      <div className="space-y-1">
        {loading && projects.length === 0 && (
          <p className="text-[12px] text-neutral-500 px-1 py-2">Loading…</p>
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
              {/* Main row */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-blue-400" : "bg-transparent"}`} />

                {/* Name */}
                <button
                  onClick={() => handleSwitch(project.id)}
                  disabled={isActive || !!switching}
                  className="flex-1 text-left cursor-pointer disabled:cursor-default"
                >
                  <div className="text-[13px] font-medium text-neutral-100 truncate">
                    {isSwitching ? <span className="text-neutral-400">Switching…</span> : project.name}
                  </div>
                  {project.directory && (
                    <div className="text-[10px] text-neutral-500 font-mono truncate mt-0.5">{project.directory}</div>
                  )}
                </button>

                {/* Actions */}
                {!isEditing && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => startEditing(project.id)}
                      title="Edit"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-colors cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>

                    {isDeleting ? (
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => handleDelete(project.id)} className="px-1.5 h-5 text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
                          Delete
                        </button>
                        <button onClick={() => setDeletingId(null)} className="px-1 h-5 text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer">
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(project.id)}
                        disabled={projects.length <= 1}
                        title={projects.length <= 1 ? "Cannot delete last project" : "Delete"}
                        className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
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

              {/* Inline edit form */}
              {isEditing && (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleEditSubmit(); }}
                  className="px-3 pb-2.5 flex flex-col gap-1.5"
                >
                  <input
                    ref={editNameRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                    placeholder="Project name"
                    className="rounded-md bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
                  />
                  <div className="relative">
                    <input
                      value={editDir}
                      onChange={(e) => setEditDir(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && (setEditingId(null), setEditPickerNote(""))}
                      placeholder="/home/user/myproject  (optional)"
                      className="w-full rounded-md bg-neutral-900 border border-neutral-700 pl-7 pr-2.5 py-1.5 text-[12px] text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500 font-mono"
                    />
                    <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => openPicker("edit", "file")}
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
                    >
                      Pick file
                    </button>
                    <button
                      type="button"
                      onClick={() => openPicker("edit", "folder")}
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white cursor-pointer"
                    >
                      Pick folder
                    </button>
                  </div>
                  {editPickerNote && (
                    <p className="text-[10px] text-amber-300">{editPickerNote}</p>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      type="submit"
                      disabled={!editName.trim()}
                      className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-[12px] text-white transition-colors cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setEditPickerNote(""); }}
                      className="px-3 py-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 text-[12px] transition-colors cursor-pointer"
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
