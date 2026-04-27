import { create } from 'zustand'

let nextWindowId = 1

const useWindowStore = create((set) => ({
  windows: [],
  topZ: 1,
  draggingId: null,

  setDragging: (id) => set({ draggingId: id }),
  clearDragging: () => set({ draggingId: null }),

  openApp: (appId) =>
    set((state) => {
      const newZ = state.topZ + 1
      const id = `win-${nextWindowId++}`
      const offset = (state.windows.length % 8) * 30
      const win = {
        id,
        appId,
        z: newZ,
        x: 4000 + offset,
        y: 4000 + offset,
      }
      return {
        windows: [...state.windows, win],
        topZ: newZ,
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
}))

export default useWindowStore