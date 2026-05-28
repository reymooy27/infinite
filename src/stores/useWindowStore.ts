import { create } from "zustand";
import type { AppId, WindowData } from "@/types";
import { canvasTransform } from "@/lib/canvasTransform";

interface WindowState {
  windows: WindowData[];
  topZ: number;
  draggingId: string | null;
  focusTargetId: string | null;
  placingAppId: AppId | null;
  minimizedWindows: string[];
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
  loadLayout: () => Promise<void>;
  saveLayout: () => Promise<void>;
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

  openApp: (appId, x = Math.random() * 400 + 100, y = Math.random() * 300 + 100, metadata) => {
    // Generate a unique numeric ID for the session
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
    }));
    // We don't necessarily need to save layout on every focus, but maybe on z-order changes
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
        w.id === id ? { ...w, metadata: { ...w.metadata, title } } : w
      ),
    }));
    get().saveLayout();
  },

  loadLayout: async () => {
    try {
      const res = await fetch("/api/layout");
      const data = await res.json();
      if (data.windows) {
        set({ 
          windows: data.windows,
          topZ: Math.max(0, ...data.windows.map((w: any) => w.z || 0))
        });
      }
    } catch (err) {
      console.error("Failed to load layout", err);
    }
  },

  saveLayout: async () => {
    try {
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
}));
