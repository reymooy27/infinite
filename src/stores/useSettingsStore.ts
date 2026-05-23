import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  showTerminalShortcuts: boolean;
  showTmuxShortcuts: boolean;
  terminalFontSize: number;
  setShowTerminalShortcuts: (value: boolean) => void;
  setShowTmuxShortcuts: (value: boolean) => void;
  setTerminalFontSize: (value: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showTerminalShortcuts: true,
      showTmuxShortcuts: true,
      terminalFontSize: 13,
      setShowTerminalShortcuts: (value) =>
        set({ showTerminalShortcuts: value }),
      setShowTmuxShortcuts: (value) => set({ showTmuxShortcuts: value }),
      setTerminalFontSize: (value) => set({ terminalFontSize: value }),
    }),
    {
      name: "infinite-settings",
    },
  ),
);
