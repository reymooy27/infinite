import { create } from "zustand";

// Terminal "busy" heuristic: output seen within BUSY_WINDOW_MS.
// ponytail: silent long-running commands (e.g. `sleep 600`) read as idle;
// upgrade path is shell integration (OSC 133 prompt markers) per terminal.
const BUSY_WINDOW_MS = 3000;
const BUMP_THROTTLE_MS = 500;

interface ActivityState {
  terminals: Record<string, number>;
  bumpTerminal: (id: string) => void;
}

const lastBump: Record<string, number> = {};

export const useActivityStore = create<ActivityState>((set) => ({
  terminals: {},
  bumpTerminal: (id) => {
    const now = Date.now();
    if (now - (lastBump[id] ?? 0) < BUMP_THROTTLE_MS) return;
    lastBump[id] = now;
    set((s) => ({ terminals: { ...s.terminals, [id]: now } }));
  },
}));

export function anyTerminalBusy(terminals: Record<string, number>) {
  const cutoff = Date.now() - BUSY_WINDOW_MS;
  return Object.values(terminals).some((ts) => ts > cutoff);
}
