import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface QuickBarSlot {
  label: string;
  data: string;
}

export const AVAILABLE_SHORTCUTS: QuickBarSlot[] = [
  { label: "C-c", data: "\x03" },
  { label: "C-d", data: "\x04" },
  { label: "C-u", data: "\x15" },
  { label: "C-w", data: "\x17" },
  { label: "C-l", data: "\x0c" },
  { label: "C-a", data: "\x01" },
  { label: "C-e", data: "\x05" },
  { label: "C-r", data: "\x12" },
  { label: "C-z", data: "\x1a" },
  { label: "C-k", data: "\x0b" },
  { label: "Tab", data: "\x09" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "Esc", data: "\x1b" },
  { label: "Enter", data: "\r" },
];

const DEFAULT_QUICK_BAR: QuickBarSlot[] = [
  { label: "C-c", data: "\x03" },
  { label: "C-d", data: "\x04" },
  { label: "Tab", data: "\x09" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
];

interface SettingsState {
  showTerminalShortcuts: boolean;
  showTmuxShortcuts: boolean;
  terminalFontSize: number;
  quickBarSlots: QuickBarSlot[];
  setShowTerminalShortcuts: (value: boolean) => void;
  setShowTmuxShortcuts: (value: boolean) => void;
  setTerminalFontSize: (value: number) => void;
  setQuickBarSlots: (slots: QuickBarSlot[]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showTerminalShortcuts: true,
      showTmuxShortcuts: true,
      terminalFontSize: 13,
      quickBarSlots: DEFAULT_QUICK_BAR,
      setShowTerminalShortcuts: (value) =>
        set({ showTerminalShortcuts: value }),
      setShowTmuxShortcuts: (value) => set({ showTmuxShortcuts: value }),
      setTerminalFontSize: (value) => set({ terminalFontSize: value }),
      setQuickBarSlots: (slots) => set({ quickBarSlots: slots }),
    }),
    {
      name: "infinite-settings",
    },
  ),
);
