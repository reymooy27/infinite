import { describe, expect, it, vi } from "vitest";
import { useActivityStore, anyTerminalBusy } from "./useActivityStore";

describe("useActivityStore", () => {
  it("marks terminal busy within window and idle after", () => {
    vi.useFakeTimers();
    useActivityStore.setState({ terminals: {} });
    useActivityStore.getState().bumpTerminal("w1-t1");
    expect(anyTerminalBusy(useActivityStore.getState().terminals)).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(anyTerminalBusy(useActivityStore.getState().terminals)).toBe(false);
    vi.useRealTimers();
  });

  it("throttles bumps within 500ms", () => {
    vi.useFakeTimers();
    useActivityStore.setState({ terminals: {} });
    useActivityStore.getState().bumpTerminal("w2-t1");
    const first = useActivityStore.getState().terminals["w2-t1"];
    useActivityStore.getState().bumpTerminal("w2-t1");
    expect(useActivityStore.getState().terminals["w2-t1"]).toBe(first);
    vi.advanceTimersByTime(600);
    useActivityStore.getState().bumpTerminal("w2-t1");
    expect(useActivityStore.getState().terminals["w2-t1"]).toBeGreaterThan(first);
    vi.useRealTimers();
  });
});
