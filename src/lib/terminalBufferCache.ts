interface TerminalSnapshot {
  lines: string[];
  scrollOffsetFromBottom: number;
}

const cache = new Map<string, TerminalSnapshot>();
const MAX_LINES = 200;
const STORAGE_PREFIX = "infinite-terminal-buffer:";

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveBuffer(
  key: string,
  lines: string[],
  scrollOffsetFromBottom = 0,
) {
  const trimmed = lines.slice(-MAX_LINES);
  const snapshot: TerminalSnapshot = {
    lines: trimmed,
    scrollOffsetFromBottom: Math.max(0, scrollOffsetFromBottom),
  };

  cache.set(key, snapshot);

  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(snapshot));
  } catch {}
}

export function getBuffer(key: string): TerminalSnapshot | undefined {
  const cached = cache.get(key);
  if (cached) return cached;

  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const legacy = parsed.filter((line): line is string => typeof line === "string");
      const snapshot = { lines: legacy, scrollOffsetFromBottom: 0 };
      cache.set(key, snapshot);
      return snapshot;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lines)) {
      return undefined;
    }
    const normalized = (parsed.lines as unknown[]).filter(
      (line: unknown): line is string => typeof line === "string",
    );
    const snapshot = {
      lines: normalized,
      scrollOffsetFromBottom:
        typeof parsed.scrollOffsetFromBottom === "number"
          ? Math.max(0, parsed.scrollOffsetFromBottom)
          : 0,
    };
    cache.set(key, snapshot);
    return snapshot;
  } catch {
    return undefined;
  }
}

export function deleteBuffer(key: string) {
  cache.delete(key);

  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {}
}
