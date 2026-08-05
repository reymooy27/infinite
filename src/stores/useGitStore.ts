import { create } from "zustand";

interface GitUIState {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useGitStore = create<GitUIState>((set) => ({
  open: false,
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((state) => ({ open: !state.open })),
}));
