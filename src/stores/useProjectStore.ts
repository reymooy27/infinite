import { create } from "zustand";
import type { Project } from "@/types";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  createProject: (name: string, directory?: string) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string, directory?: string) => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  saveCurrentProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/projects");
      const projects: Project[] = await res.json();

      if (!Array.isArray(projects) || projects.length === 0) {
        // No projects yet — create default project (seeds from existing Layout)
        const createRes = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Default" }),
        });
        const newProject: Project = await createRes.json();
        set({ projects: [newProject], activeProjectId: newProject.id, loading: false });
        // Load canvas for this new project
        const { useWindowStore } = await import("@/stores/useWindowStore");
        await useWindowStore.getState().loadProjectCanvas(newProject.id);
        return;
      }

      const storedId =
        typeof window !== "undefined"
          ? localStorage.getItem("infinite-active-project")
          : null;
      const active =
        projects.find((p) => p.id === storedId) ??
        projects.find((p) => p.isDefault) ??
        projects[0];

      set({ projects, activeProjectId: active.id, loading: false });

      const { useWindowStore } = await import("@/stores/useWindowStore");
      await useWindowStore.getState().loadProjectCanvas(active.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      set({ error, loading: false });
    }
  },

  createProject: async (name, directory) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(directory && { directory }) }),
      });
      if (!res.ok) return null;
      const project: Project = await res.json();
      set((state) => ({ projects: [...state.projects, project] }));
      return project;
    } catch {
      return null;
    }
  },

  deleteProject: async (id) => {
    const { projects, activeProjectId } = get();
    if (projects.length <= 1) return;

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) return;

      const remaining = projects.filter((p) => p.id !== id);
      set({ projects: remaining });

      if (activeProjectId === id) {
        const next = remaining[0];
        set({ activeProjectId: next.id });
        if (typeof window !== "undefined") {
          localStorage.setItem("infinite-active-project", next.id);
        }
        const { useWindowStore } = await import("@/stores/useWindowStore");
        await useWindowStore.getState().loadProjectCanvas(next.id);
      }
    } catch {
      // ignore
    }
  },

  renameProject: async (id, name, directory) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, name, ...(directory !== undefined && { directory: directory || undefined }) } : p
      ),
    }));
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(directory !== undefined && { directory }) }),
      });
    } catch {
      // revert on failure
      const res = await fetch("/api/projects");
      const projects: Project[] = await res.json();
      set({ projects });
    }
  },

  switchProject: async (id) => {
    const { activeProjectId } = get();
    if (id === activeProjectId) return;

    const { useWindowStore } = await import("@/stores/useWindowStore");
    if (activeProjectId) {
      await useWindowStore.getState().saveProjectCanvas(activeProjectId);
    }

    set({ activeProjectId: id });
    if (typeof window !== "undefined") {
      localStorage.setItem("infinite-active-project", id);
    }
    await useWindowStore.getState().loadProjectCanvas(id);
  },

  saveCurrentProject: async () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    const { useWindowStore } = await import("@/stores/useWindowStore");
    await useWindowStore.getState().saveProjectCanvas(activeProjectId);
  },
}));
