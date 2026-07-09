import { create } from "zustand";

interface TerminalSessionState {
  terminalCwds: Record<string, string>;
  setTerminalCwd: (sessionId: string, directory: string) => void;
}

export const useTerminalSessionStore = create<TerminalSessionState>((set) => ({
  terminalCwds: {},
  setTerminalCwd: (sessionId, directory) =>
    set((state) => {
      const nextDirectory = directory.trim();
      if (!sessionId || !nextDirectory) return state;
      if (state.terminalCwds[sessionId] === nextDirectory) return state;
      return {
        terminalCwds: {
          ...state.terminalCwds,
          [sessionId]: nextDirectory,
        },
      };
    }),
}));
