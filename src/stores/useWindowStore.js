import { create } from "zustand";
import registry from "../apps/registry";

let nextWindowId = 1;

const useWindowStore = create((set) => ({
  windows: [],
  topZ: 1,
  draggingId: null,
  focusTargetId: null,
  placingAppId: null,

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

  openApp: (appId, x, y) =>
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
      };
      return {
        windows: [...state.windows, win],
        topZ: newZ,
        placingAppId: null,
      };
    }),

  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    })),

  bringToFront: (id) =>
    set((state) => {
      const newZ = state.topZ + 1;
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, z: newZ } : w,
        ),
        topZ: newZ,
      };
    }),

  focusLastWindow: () =>
    set((state) => {
      const last = state.windows[state.windows.length - 1];
      if (!last) return state;
      console.log("Focusing last window", { last });
      return { focusTargetId: last.id };
    }),

  focusWindow: (id) => set({ focusTargetId: id }),
}));

export default useWindowStore;
export { useWindowStore };
