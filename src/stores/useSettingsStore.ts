import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  showTerminalShortcuts: boolean;
  showTmuxShortcuts: boolean;
  setShowTerminalShortcuts: (value: boolean) => void;
  setShowTmuxShortcuts: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showTerminalShortcuts: true,
      showTmuxShortcuts: true,
      setShowTerminalShortcuts: (value) =>
        set({ showTerminalShortcuts: value }),
      setShowTmuxShortcuts: (value) => set({ showTmuxShortcuts: value }),
    }),
    {
      name: "infinite-settings",
    },
  ),
);
