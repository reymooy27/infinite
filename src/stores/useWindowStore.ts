import { create } from "zustand";
import type { AppId, WindowData, TerminalTab } from "@/types";
import { normalizeWindow } from "@/types";
import { canvasTransform } from "@/lib/canvasTransform";

interface WindowState {
  windows: WindowData[];
  topZ: number;
  draggingId: string | null;
  focusTargetId: string | null;
  placingAppId: AppId | null;
  minimizedWindows: string[];
  fitViewportKey: number;
  fitViewportWindows: WindowData[];
  setDragging: (id: string | null) => void;
  clearDragging: () => void;
  setPlacingApp: (appId: AppId | null) => void;
  clearPlacing: () => void;
  updateWindowPosition: (id: string, updates: Partial<WindowData>) => void;
  openApp: (
    appId: AppId,
    x?: number,
    y?: number,
    metadata?: Record<string, unknown>
  ) => void;
  closeWindow: (id: string) => void;
  bringToFront: (id: string) => void;
  focusWindow: (id: string) => void;
  clearFocus: () => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusLastWindow: () => void;
  renameWindow: (id: string, title: string) => void;
  setAutoTitle: (id: string, title: string) => void;
  loadLayout: () => Promise<void>;
  saveLayout: () => Promise<void>;
  loadProjectCanvas: (projectId: string) => Promise<void>;
  saveProjectCanvas: (projectId: string) => Promise<void>;
  addTerminalTab: (windowId: string, tab: TerminalTab) => void;
  closeTerminalTab: (windowId: string, tabId: string) => void;
  setActiveTerminalTab: (windowId: string, tabId: string) => void;
  setActiveTabTitle: (windowId: string, tabId: string, title: string) => void;
  markTabNavigated: (windowId: string, tabId: string) => void;
  consumeFitViewport: () => WindowData[];
}

const DEFAULT_DIMENSIONS: Record<AppId, { width: number; height: number }> = {
  notes: { width: 600, height: 450 },
  ssh: { width: 400, height: 350 },
  devBrowser: { width: 1024, height: 768 },
};

let windowCounter = 0;

export const useWindowStore = create<WindowState>((set, get) => ({
  windows: [],
  topZ: 0,
  draggingId: null,
  focusTargetId: null,
  placingAppId: null,
  minimizedWindows: [],
  fitViewportKey: 0,
  fitViewportWindows: [],

  setDragging: (id) => set({ draggingId: id }),
  clearDragging: () => {
    set({ draggingId: null });
    get().saveLayout();
  },

  setPlacingApp: (appId) => set({ placingAppId: appId }),
  clearPlacing: () => set({ placingAppId: null }),

  updateWindowPosition: (id, updates) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, ...updates } : w
      ),
    }));
  },

  openApp: (appId, x, y, metadata) => {
    if (x === undefined || y === undefined) {
      const inst = canvasTransform.current as any;
      const wrapper = inst?.wrapperComponent as HTMLElement | undefined;
      if (wrapper && inst?.state) {
        const scale = inst.state.scale ?? 1;
        const positionX = inst.state.positionX ?? 0;
        const positionY = inst.state.positionY ?? 0;
        if (scale > 0 && isFinite(scale)) {
          const vw = wrapper.offsetWidth;
          const vh = wrapper.offsetHeight;
          const centerX = (vw / 2 - positionX) / scale;
          const centerY = (vh / 2 - positionY) / scale;
          const { width, height } = DEFAULT_DIMENSIONS[appId];
          x = centerX - width / 2 + (Math.random() - 0.5) * 100;
          y = centerY - height / 2 + (Math.random() - 0.5) * 100;
        } else {
          x = Math.random() * 400 + 100;
          y = Math.random() * 300 + 100;
        }
      } else {
        x = Math.random() * 400 + 100;
        y = Math.random() * 300 + 100;
      }
    }
    const id = `window-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { width, height } = DEFAULT_DIMENSIONS[appId];
    const topZ = get().topZ + 1;
    set((state) => ({
      windows: [
        ...state.windows,
        { id, appId, z: topZ, x, y, width, height, metadata },
      ],
      topZ,
      placingAppId: null,
    }));
    get().saveLayout();
    get().focusWindow(id);
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    }));
    get().saveLayout();
  },

  bringToFront: (id) => {
    const topZ = get().topZ + 1;
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, z: topZ } : w
      ),
      topZ,
      focusTargetId: id,
    }));
    get().saveLayout();
  },

  focusWindow: (id) => {
    set({ focusTargetId: id });
    get().bringToFront(id);
  },

  clearFocus: () => set({ focusTargetId: null }),

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: true } : w
      ),
      minimizedWindows: [...state.minimizedWindows, id],
    }));
    get().saveLayout();
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: false } : w
      ),
      minimizedWindows: state.minimizedWindows.filter((wId) => wId !== id),
    }));
    get().saveLayout();
  },

  maximizeWindow: (id) => {
    const win = get().windows.find((w) => w.id === id);
    const isMaximizing = !win?.maximized;
    
    if (isMaximizing) {
      canvasTransform.resetZoom();
    }
    
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          return { ...w, maximized: false, ...w.prevBounds };
        }
        return {
          ...w,
          maximized: true,
          prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
        };
      }),
    }));
    get().saveLayout();
  },

  focusLastWindow: () => {
    const last = get().windows.filter((w) => !w.minimized).at(-1);
    if (last) get().focusWindow(last.id);
  },

  renameWindow: (id, title) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, metadata: { ...w.metadata, title, autoTitle: false } } : w
      ),
    }));
    get().saveLayout();
  },

  setAutoTitle: (id, title) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, metadata: { ...w.metadata, title, autoTitle: true } } : w
      ),
    }));
    get().saveLayout();
  },

  loadLayout: async () => {
    try {
      const { useProjectStore } = await import("@/stores/useProjectStore");
      const { activeProjectId } = useProjectStore.getState();
      if (activeProjectId) {
        await get().loadProjectCanvas(activeProjectId);
        return;
      }
      // Fallback: legacy /api/layout
      const res = await fetch("/api/layout");
      const data = await res.json();
      if (data.windows) {
        const normalized = data.windows.map(normalizeWindow);
        const topZ = Math.max(0, ...normalized.map((w: any) => w.z || 0));
        const topmost = normalized.reduce((best: any, w: any) =>
          (w.z || 0) > (best?.z || 0) ? w : best, null);
        set({ windows: normalized, topZ, focusTargetId: topmost?.id ?? null });
      }
    } catch (err) {
      console.error("Failed to load layout", err);
    }
  },

  saveLayout: async () => {
    try {
      const { useProjectStore } = await import("@/stores/useProjectStore");
      const { activeProjectId } = useProjectStore.getState();
      if (activeProjectId) {
        await get().saveProjectCanvas(activeProjectId);
        return;
      }
      const { windows } = get();
      await fetch("/api/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windows }),
      });
    } catch (err) {
      console.error("Failed to save layout", err);
    }
  },

  loadProjectCanvas: async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/canvas`);
      const data = await res.json();
      if (data.windows) {
        const normalized = data.windows.map(normalizeWindow);
        const topZ = Math.max(0, ...normalized.map((w: any) => w.z || 0));
        const topmost = normalized.reduce((best: any, w: any) =>
          (w.z || 0) > (best?.z || 0) ? w : best, null);
        const visibleTopmost = normalized
          .filter((w: WindowData) => !w.minimized && !w.maximized)
          .reduce((best: WindowData | null, w: WindowData) =>
            (w.z || 0) > (best?.z || 0) ? w : best, null);
        set({
          windows: normalized,
          topZ,
          focusTargetId: topmost?.id ?? null,
          fitViewportKey: Date.now(),
          fitViewportWindows: visibleTopmost ? [visibleTopmost] : normalized,
        });
      }
    } catch (err) {
      console.error("Failed to load project canvas", err);
    }
  },

  saveProjectCanvas: async (projectId) => {
    try {
      const { windows } = get();
      const inst = canvasTransform.current as any;
      const transform = inst?.state
        ? { scale: inst.state.scale, x: inst.state.positionX, y: inst.state.positionY }
        : undefined;
      await fetch(`/api/projects/${projectId}/canvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windows, canvasTransform: transform }),
      });
    } catch (err) {
      console.error("Failed to save project canvas", err);
    }
  },

  addTerminalTab: (windowId, tab) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== windowId || w.appId !== "ssh") return w;
        const tabs = [...((w.metadata?.tabs as TerminalTab[]) ?? []), tab];
        return { ...w, metadata: { ...w.metadata, tabs, activeTabId: tab.id } };
      }),
    }));
    get().saveLayout();
  },

  closeTerminalTab: (windowId, tabId) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== windowId || w.appId !== "ssh") return w;
        const tabs = ((w.metadata?.tabs as TerminalTab[]) ?? []).filter((t) => t.id !== tabId);
        if (tabs.length === 0) return w;
        const activeTabId =
          w.metadata?.activeTabId === tabId ? tabs[tabs.length - 1].id : w.metadata?.activeTabId;
        return { ...w, metadata: { ...w.metadata, tabs, activeTabId } };
      }),
    }));
    get().saveLayout();
  },

  setActiveTerminalTab: (windowId, tabId) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === windowId && w.appId === "ssh"
          ? { ...w, metadata: { ...w.metadata, activeTabId: tabId } }
          : w
      ),
    }));
  },

  setActiveTabTitle: (windowId, tabId, title) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== windowId || w.appId !== "ssh") return w;
        const tabs = ((w.metadata?.tabs as TerminalTab[]) ?? []).map((t) =>
          t.id === tabId ? { ...t, title } : t
        );
        const isActive = w.metadata?.activeTabId === tabId;
        return {
          ...w,
          metadata: {
            ...w.metadata,
            tabs,
            ...(isActive && { title, autoTitle: true }),
          },
        };
      }),
    }));
  },

  markTabNavigated: (windowId, tabId) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== windowId || w.appId !== "ssh") return w;
        const tabs = ((w.metadata?.tabs as TerminalTab[]) ?? []).map((t) =>
          t.id === tabId ? { ...t, hasNavigated: true } : t
        );
        return { ...w, metadata: { ...w.metadata, tabs } };
      }),
    }));
    get().saveLayout();
  },

  consumeFitViewport: () => {
    const { fitViewportKey, fitViewportWindows } = get();
    if (fitViewportKey > 0) {
      set({ fitViewportKey: 0, fitViewportWindows: [] });
      return fitViewportWindows;
    }
    return [];
  },
}));
