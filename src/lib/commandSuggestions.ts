// Command suggestion history for the SSH terminal (Termius-style).
// Stores the most-used commands in localStorage; rank = count + recency bonus.
const STORAGE_KEY = "infinite.cmd-suggestions";
const MAX_ENTRIES = 200;

export interface CommandSuggestion {
  cmd: string;
  count: number;
  lastUsed: number;
}

let cache: CommandSuggestion[] | null = null;

function load(): CommandSuggestion[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as CommandSuggestion[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache ?? []));
  } catch {
    /* quota or privacy mode — suggestions stay in memory */
  }
}

/** Record a command as executed. Trailing/empty input is ignored. */
export function recordCommand(cmd: string) {
  const trimmed = cmd.trim();
  // Skip control chars and shell-internal noise; keep it simple: first word must be printable
  if (!trimmed || trimmed.length > 500 || /[\u0000-\u001f]/.test(trimmed)) return;
  const list = load();
  const entry = list.find((e) => e.cmd === trimmed);
  if (entry) {
    entry.count += 1;
    entry.lastUsed = Date.now();
  } else {
    list.push({ cmd: trimmed, count: 1, lastUsed: Date.now() });
    if (list.length > MAX_ENTRIES) {
      list.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
      cache = list.slice(0, MAX_ENTRIES);
    }
  }
  save();
}

/** Top `limit` commands that start with `prefix` (case-insensitive). */
export function suggest(prefix: string, limit = 5): CommandSuggestion[] {
  const p = prefix.toLowerCase();
  return load()
    .filter((e) => e.cmd.toLowerCase().startsWith(p))
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}

/** Top `limit` most-used commands — shown when the user hasn't typed anything. */
export function topCommands(limit = 5): CommandSuggestion[] {
  return [...load()]
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
}
