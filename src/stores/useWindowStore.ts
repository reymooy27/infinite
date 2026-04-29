import { create } from "zustand";
import type { AppId, WindowData } from "@/types";

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
}

const DEFAULT_DIMENSIONS: Record<AppId, { width: number; height: number }> = {
  "code-editor": { width: 550, height: 400 },
  terminal: { width: 500, height: 320 },
  notes: { width: 380, height: 350 },
  ssh: { width: 600, height: 400 },
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
  clearDragging: () => set({ draggingId: null }),

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
    const id = `window-${++windowCounter}`;
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
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    }));
  },

  bringToFront: (id) => {
    const topZ = get().topZ + 1;
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, z: topZ } : w
      ),
      topZ,
    }));
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
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: false } : w
      ),
      minimizedWindows: state.minimizedWindows.filter((wId) => wId !== id),
    }));
  },

  maximizeWindow: (id) => {
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
  },

  focusLastWindow: () => {
    const last = get().windows.filter((w) => !w.minimized).at(-1);
    if (last) get().focusWindow(last.id);
  },
}));
