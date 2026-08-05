import { create } from "zustand";

interface CodeEditorUIState {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

export const useCodeEditorStore = create<CodeEditorUIState>((set) => ({
  open: false,
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((state) => ({ open: !state.open })),
}));
