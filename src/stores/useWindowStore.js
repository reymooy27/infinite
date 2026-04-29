import { create } from "zustand";
import registry from "../apps/registry";

let nextWindowId = 1;

const useWindowStore = create((set) => ({
  windows: [],
  topZ: 1,
  draggingId: null,
  focusTargetId: null,
  placingAppId: null,
  minimizedWindows: [],

  setDragging: (id) => set({ draggingId: id }),
  clearDragging: () => set({ draggingId: null }),

  setPlacingApp: (appId) => set({ placingAppId: appId }),
  clearPlacing: () => set({ placingAppId: null }),

  updateWindowPosition: (id, x, y, width, height) =>
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, x, y, width, height } : w,
      ),
    })),

  openApp: (appId, x, y, metadata) =>
    set((state) => {
      const newZ = state.topZ + 1;
      const id = `win-${nextWindowId++}`;
      const offset = (state.windows.length % 8) * 30;
      const app = registry[appId];
      const win = {
        id,
        appId,
        z: newZ,
        x: x ?? 5000 + offset,
        y: y ?? 5000 + offset,
        width: app?.defaultWidth || 400,
        height: app?.defaultHeight || 300,
        metadata: metadata || {},
        maximized: false,
        minimized: false,
        prevBounds: null,
      };
      return {
        windows: [...state.windows, win],
        topZ: newZ,
        placingAppId: null,
        focusTargetId: id,
        minimizedWindows: state.minimizedWindows.filter((mId) => mId !== id),
      };
    }),

  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
      minimizedWindows: state.minimizedWindows.filter((mId) => mId !== id),
      focusTargetId: state.focusTargetId === id ? null : state.focusTargetId,
    })),

  bringToFront: (id) =>
    set((state) => {
      const win = state.windows.find((w) => w.id === id);
      if (!win || win.z === state.topZ) return state;
      const newZ = state.topZ + 1;
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, z: newZ } : w,
        ),
        topZ: newZ,
      };
    }),

  focusWindow: (id) => set({ focusTargetId: id }),
  clearFocus: () => set({ focusTargetId: null }),

  minimizeWindow: (id) =>
    set((state) => {
      const win = state.windows.find((w) => w.id === id);
      if (!win || win.minimized) return state;
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, minimized: true } : w,
        ),
        minimizedWindows: [...state.minimizedWindows, id],
        focusTargetId: state.focusTargetId === id ? null : state.focusTargetId,
      };
    }),

  restoreWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: false } : w,
      ),
      minimizedWindows: state.minimizedWindows.filter((mId) => mId !== id),
    })),

  maximizeWindow: (id) =>
    set((state) => {
      const win = state.windows.find((w) => w.id === id);
      if (!win) return state;
      if (win.maximized) {
        return {
          windows: state.windows.map((w) =>
            w.id === id
              ? {
                  ...w,
                  maximized: false,
                  x: w.prevBounds?.x ?? w.x,
                  y: w.prevBounds?.y ?? w.y,
                  width: w.prevBounds?.width ?? w.width,
                  height: w.prevBounds?.height ?? w.height,
                  prevBounds: null,
                }
              : w,
          ),
        };
      }
      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                maximized: true,
                prevBounds: { x: w.x, y: w.y, width: w.width, height: w.height },
              }
            : w,
        ),
      };
    }),

  focusLastWindow: () =>
    set((state) => {
      const visible = state.windows.filter((w) => !w.minimized);
      const last = visible[visible.length - 1];
      if (!last) return state;
      return { focusTargetId: last.id };
    }),
}));

export default useWindowStore;
export { useWindowStore };