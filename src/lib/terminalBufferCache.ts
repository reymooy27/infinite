const cache = new Map<string, string[]>();
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

export function saveBuffer(key: string, lines: string[]) {
  const trimmed = lines.slice(-MAX_LINES);
  cache.set(key, trimmed);

  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(trimmed));
  } catch {}
}

export function getBuffer(key: string): string[] | undefined {
  const cached = cache.get(key);
  if (cached) return cached;

  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const normalized = parsed.filter((line): line is string => typeof line === "string");
    cache.set(key, normalized);
    return normalized;
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
