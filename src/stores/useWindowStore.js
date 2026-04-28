import { create } from 'zustand'

let nextWindowId = 1

const useWindowStore = create((set) => ({
  windows: [],
  topZ: 1,
  draggingId: null,
  focusTargetId: null,

  setDragging: (id) => set({ draggingId: id }),
  clearDragging: () => set({ draggingId: null }),

  updateWindowPosition: (id, x, y, width, height) =>
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, x, y, width, height } : w
      ),
    })),

  openApp: (appId, x, y) =>
    set((state) => {
      const newZ = state.topZ + 1
      const id = `win-${nextWindowId++}`
      const offset = (state.windows.length % 8) * 30
      const win = {
        id,
        appId,
        z: newZ,
        x: x ?? 4000 + offset,
        y: y ?? 4000 + offset,
        width: 0,
        height: 0,
      }
      return {
        windows: [...state.windows, win],
        topZ: newZ,
        focusTargetId: null,
      }
    }),

  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    })),

  bringToFront: (id) =>
    set((state) => {
      const newZ = state.topZ + 1
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, z: newZ } : w
        ),
        topZ: newZ,
      }
    }),

  focusLastWindow: () =>
    set((state) => {
      const last = state.windows[state.windows.length - 1]
      if (!last) return state
      return { focusTargetId: last.id }
    }),

  focusWindow: (id) =>
    set({ focusTargetId: id }),
}))

export default useWindowStore
export { useWindowStore }