import { create } from "zustand";

interface DockerUIState {
  open: boolean;
  connectionId: number | null;
  openPanel: (connectionId?: number | null) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setConnectionId: (id: number | null) => void;
}

export const useDockerStore = create<DockerUIState>((set) => ({
  open: false,
  connectionId: null,
  openPanel: (connectionId) =>
    set((state) => ({
      open: true,
      connectionId:
        connectionId !== undefined ? connectionId : state.connectionId,
    })),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((state) => ({ open: !state.open })),
  setConnectionId: (id) => set({ connectionId: id }),
}));
