import { create } from "zustand";

interface SysMonUIState {
  open: boolean;
  connectionId: number | null;
  statsCache: Record<number, unknown>;
  openPanel: (connectionId?: number | null) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setConnectionId: (id: number | null) => void;
  setCachedStats: (connectionId: number, stats: unknown) => void;
}

export const useSysMonStore = create<SysMonUIState>((set) => ({
  open: false,
  connectionId: null,
  statsCache: {},
  openPanel: (connectionId) =>
    set((state) => ({
      open: true,
      connectionId:
        connectionId !== undefined ? connectionId : state.connectionId,
    })),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((state) => ({ open: !state.open })),
  setConnectionId: (id) => set({ connectionId: id }),
  setCachedStats: (connectionId, stats) =>
    set((state) => ({ statsCache: { ...state.statsCache, [connectionId]: stats } })),
}));
