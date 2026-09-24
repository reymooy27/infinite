// Command suggestion history for the SSH terminal (Termius-style).
// Stores the most-used commands in localStorage; rank = count + recency bonus.
const STORAGE_KEY = "infinite.cmd-suggestions";
const MAX_ENTRIES = 200;

const COMMON_COMMANDS = [
  "ls", "pwd", "cd", "cat", "grep", "sudo", "top", "ps", "htop", "df",
  "du", "tail", "less", "rm", "cp", "mv", "mkdir", "touch", "chmod", "git",
  "git status", "git log", "git pull", "git push", "docker", "docker ps",
  "docker compose", "npm", "npm run dev", "npm install", "pm2", "pm2 list",
  "pm2 restart", "systemctl", "journalctl", "nginx -t", "curl", "wget",
  "apt", "apt update", "apt upgrade", "apt install", "ssh", "scp", "rsync",
  "tar", "find", "which", "whoami", "env", "history", "clear", "echo",
  "free", "ip", "ping", "ss", "netstat", "tmux", "tmux ls", "vim", "nano",
  "make", "nvm", "node", "python3", "pip", "kubectl", "helm",
];

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
  const matches = load()
    .filter((e) => e.cmd.toLowerCase().startsWith(p))
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
    .slice(0, limit);
  if (matches.length > 0) return matches;
  return COMMON_COMMANDS.filter((c) => c.toLowerCase().startsWith(p))
    .slice(0, limit)
    .map((cmd) => ({ cmd, count: 0, lastUsed: 0 }));
}

/**
 * Heuristic: does this last-visible terminal line look like a plain shell
 * prompt (vs. a TUI input box like opencode / claude code)?
 *
 * Matches `user@host:` (bash/zsh default, incl. root & conda-wrapped),
 * oh-my-zsh `➜`, starship/fish `❯`, conda `(base)`, and bare `"$ "` / `# ` /
 * `"% "` minimal prompts.
 *
 * ponytail: deliberately does NOT match a bare `>` — that's the input-prompt
 * character TUIs (opencode, claude code) use, so matching it would re-enable
 * suggestions exactly where we want them off. Exotic prompts that use `>` or
 * no recognizable signature simply get no suggestions; the upgrade path is a
 * per-user prompt-regex in Settings.
 */
export function isShellPromptLine(line: string): boolean {
  const l = line.trimEnd();
  if (l === "") return false;
  if (/[\w.-]+@[\w.-]+:/.test(l)) return true; // user@host:
  if (/^[❯➜]|^\(base\)/.test(l)) return true; // oh-my-zsh / starship / fish / conda
  // Bare prompt char followed by whitespace OR end-of-line (no input typed yet).
  // ponytail: (?:\s|$) covers both "prompt with space" and "trimmed prompt line".
  if (/^[$#%](?:\s|$)/.test(l)) return true; // minimal bare-prompt chars
  return false;
}
