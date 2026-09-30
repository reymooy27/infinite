import { create } from "zustand";
import { api } from "@/lib/api";
import { markProjectSwitch } from "@/lib/switchFocusGuard";
import type { Project } from "@/types";

const RECENT_PROJECTS_KEY = "infinite-recent-projects";
const PREVIOUS_PROJECT_KEY = "infinite-previous-project";

export function readRecentProjectIds(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function markProjectOpened(projectId: string) {
  if (typeof window === "undefined") return;

  const nextIds = [projectId, ...readRecentProjectIds().filter((id) => id !== projectId)];
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(nextIds.slice(0, 100)));
}

function readPreviousProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PREVIOUS_PROJECT_KEY);
  } catch {
    return null;
  }
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  previousProjectId: string | null;
  loading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  createProject: (name: string, directory?: string) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string, directory?: string) => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  toggleLastProject: () => Promise<void>;
  saveCurrentProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  previousProjectId: readPreviousProjectId(),
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await api.get<Project[]>("/api/projects");

      if (!Array.isArray(projects) || projects.length === 0) {
        const newProject = await api.post<Project>("/api/projects", { name: "Default" });
        set({ projects: [newProject], activeProjectId: newProject.id, loading: false });
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
      markProjectOpened(active.id);

      const { useWindowStore } = await import("@/stores/useWindowStore");
      await useWindowStore.getState().loadProjectCanvas(active.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      set({ error, loading: false });
    }
  },

  createProject: async (name, directory) => {
    try {
      const project = await api.post<Project>("/api/projects", { name, ...(directory && { directory }) });
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
      await api.delete(`/api/projects/${id}`);

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
      await api.patch(`/api/projects/${id}`, { name, ...(directory !== undefined && { directory }) });
    } catch {
      const projects = await api.get<Project[]>("/api/projects");
      set({ projects });
    }
  },

  switchProject: async (id) => {
    const { activeProjectId } = get();
    if (id === activeProjectId) return;

    (document.activeElement as HTMLElement | null)?.blur();
    markProjectSwitch();

    const { useWindowStore } = await import("@/stores/useWindowStore");
    // Snapshot is taken synchronously inside saveProjectCanvas before its
    // first await, so firing it without awaiting cannot race loadProjectCanvas.
    // ponytail: save failures only reach console.error; upgrade path is to
    // await Promise.allSettled and surface a toast on rejection.
    if (activeProjectId) {
      void useWindowStore.getState().saveProjectCanvas(activeProjectId);
    }

    set({ activeProjectId: id, previousProjectId: activeProjectId });
    if (typeof window !== "undefined") {
      localStorage.setItem("infinite-active-project", id);
      if (activeProjectId) {
        localStorage.setItem(PREVIOUS_PROJECT_KEY, activeProjectId);
      }
    }
    markProjectOpened(id);
    await useWindowStore.getState().loadProjectCanvas(id);
  },

  toggleLastProject: async () => {
    const { activeProjectId, previousProjectId, projects } = get();
    const exists = (id: string | null) =>
      !!id && id !== activeProjectId && projects.some((p) => p.id === id);

    const target = exists(previousProjectId)
      ? previousProjectId
      : readRecentProjectIds().find((id) => exists(id)) ?? null;

    if (target) await get().switchProject(target);
  },

  saveCurrentProject: async () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    const { useWindowStore } = await import("@/stores/useWindowStore");
    await useWindowStore.getState().saveProjectCanvas(activeProjectId);
  },
}));
