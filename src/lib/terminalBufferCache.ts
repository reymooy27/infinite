const cache = new Map<string, string[]>();
const MAX_LINES = 200;

export function saveBuffer(key: string, lines: string[]) {
  cache.set(key, lines.slice(-MAX_LINES));
}

export function getBuffer(key: string): string[] | undefined {
  return cache.get(key);
}

export function deleteBuffer(key: string) {
  cache.delete(key);
}
