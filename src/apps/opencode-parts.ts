export interface OcToolState {
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
  title?: string;
  metadata?: { diff?: string };
}

export interface OcPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  mime?: string;
  filename?: string;
  url?: string;
  state?: OcToolState;
}

export interface OcMessageEntry {
  info: {
    id: string;
    role?: string;
    time?: { created?: number; completed?: number };
    error?: { name?: string; data?: { message?: string } };
  };
  parts: OcPart[];
}

// opencode puts model/turn failures on the assistant message as
// { name, data: { message } } (e.g. ApiError on timeout, MessageAbortedError).
// Without extracting it the thread renders an empty bubble and looks hung.
export function ocErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { name?: string; message?: string; data?: { message?: string } };
  return e.data?.message || e.message || e.name || null;
}

export function upsertPartIn(prev: OcMessageEntry[], messageID: string, part: OcPart): OcMessageEntry[] {
  const idx = entryIndex(prev, messageID);
  if (idx === -1)
    return [
      ...prev,
      { info: { id: messageID, role: "assistant", time: { created: Date.now() } }, parts: [part] },
    ];
  const entry = prev[idx];
  const pi = entry.parts.findIndex((p) => p.id === part.id);
  if (pi !== -1 && entry.parts[pi] === part) return prev;
  const parts = pi === -1 ? [...entry.parts, part] : entry.parts.map((p, i) => (i === pi ? part : p));
  const next = prev.slice();
  next[idx] = { ...entry, parts };
  return next;
}

export function appendDeltaIn(
  prev: OcMessageEntry[],
  messageID: string,
  partID: string,
  field: string,
  delta: string,
): OcMessageEntry[] | null {
  if (field !== "text") return null;
  const idx = entryIndex(prev, messageID);
  if (idx === -1) return null;
  const entry = prev[idx];
  const pi = entry.parts.findIndex((p) => p.id === partID);
  if (pi === -1) return null;
  const next = prev.slice();
  next[idx] = {
    ...entry,
    parts: entry.parts.map((p, i) => (i === pi ? { ...p, text: (p.text ?? "") + delta } : p)),
  };
  return next;
}

export function upsertInfoIn(prev: OcMessageEntry[], info: OcMessageEntry["info"]): OcMessageEntry[] {
  const base = info.role === "user" ? prev.filter((m) => !m.info.id.startsWith("optimistic-")) : prev;
  const idx = entryIndex(base, info.id);
  if (idx === -1) return [...base, { info, parts: [] }];
  const entry = base[idx];
  const next = base.slice();
  next[idx] = { ...entry, info: { ...entry.info, ...info } };
  return next;
}

function entryIndex(prev: OcMessageEntry[], messageID: string): number {
  for (let i = prev.length - 1; i >= 0; i--) if (prev[i].info.id === messageID) return i;
  return -1;
}

export function extractLastTodos(messages: OcMessageEntry[]): unknown[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const p = messages[i].parts[j];
      if (p.type === "tool" && p.tool === "todowrite") {
        const t = (p.state?.input as { todos?: unknown } | undefined)?.todos;
        return Array.isArray(t) ? (t as unknown[]) : [];
      }
    }
  }
  return null;
}

export interface OcFilePart {
  type: "file";
  mime: string;
  filename: string;
  url: string;
}

const MENTION_MIME: Record<string, string> = {
  ts: "text/typescript",
  tsx: "text/tsx",
  js: "text/javascript",
  jsx: "text/jsx",
  mjs: "text/javascript",
  cjs: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  css: "text/css",
  html: "text/html",
  py: "text/x-python",
  rs: "text/rust",
  go: "text/x-go",
  sh: "text/x-shellscript",
  yml: "text/yaml",
  yaml: "text/yaml",
  sql: "text/x-sql",
  txt: "text/plain",
};

function mimeFor(path: string): string {
  const ext = (/\.([\w+]+)$/.exec(path)?.[1] ?? "").toLowerCase();
  return MENTION_MIME[ext] ?? "text/plain";
}

// ponytail: mentions become file:// parts only when the same user picked them
// from the picker AND the @token is still in the text — no filesystem check.
// Ceiling: a renamed/picked-stale path 502s from opencode. Upgrade path:
// validate via /find/file exact match before send.
export function buildMentionParts(input: string, tracked: string[], root: string): OcFilePart[] {
  if (!root) return [];
  const cleanRoot = root.replace(/\/+$/, "");
  const out: OcFilePart[] = [];
  for (const p of tracked) {
    if (!input.includes(`@${p}`)) continue;
    const full = `${cleanRoot}/${p}`.split("/").map(encodeURIComponent).join("/");
    out.push({ type: "file", mime: mimeFor(p), filename: p, url: `file://${full}` });
  }
  return out;
}

export interface SessionEdit {
  messageID: string;
  tool: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface SessionFileDiff {
  file: string;
  edits: SessionEdit[];
  additions: number;
  deletions: number;
}

const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "multi_edit", "patch", "apply_patch"]);

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

// ponytail: no hunk algorithm — the fallback lists old lines then new lines.
// opencode's edit/write tools ship metadata.diff, so this only covers old or
// odd parts. Upgrade path: an LCS diff if a tool ever lands without metadata.
function synthesizePatch(file: string, oldText: string, newText: string): string {
  const lines = [`--- a/${file}`, `+++ b/${file}`];
  for (const l of oldText.split("\n")) lines.push(`-${l}`);
  for (const l of newText.split("\n")) lines.push(`+${l}`);
  return lines.join("\n");
}

export function collectSessionDiffs(messages: OcMessageEntry[]): SessionFileDiff[] {
  const byFile = new Map<string, SessionFileDiff>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool" || !p.tool || !EDIT_TOOLS.has(p.tool)) continue;
      const st = p.state;
      if (!st || st.status !== "completed") continue;
      const input = (st.input ?? {}) as Record<string, unknown>;
      const file = String(input.filePath ?? input.path ?? input.filename ?? "");
      if (!file) continue;
      let patch = typeof st.metadata?.diff === "string" ? st.metadata.diff : "";
      if (!patch) {
        if (p.tool === "write") {
          patch = synthesizePatch(file, "", String(input.content ?? ""));
        } else if (p.tool === "edit") {
          patch = synthesizePatch(file, String(input.oldString ?? ""), String(input.newString ?? ""));
        } else if (Array.isArray(input.edits)) {
          patch = (input.edits as { oldString?: string; newString?: string }[])
            .map((e) => synthesizePatch(file, String(e?.oldString ?? ""), String(e?.newString ?? "")))
            .join("\n");
        }
      }
      if (!patch.trim()) continue;
      const counts = countPatchLines(patch);
      let entry = byFile.get(file);
      if (!entry) {
        entry = { file, edits: [], additions: 0, deletions: 0 };
        byFile.set(file, entry);
      }
      entry.edits.push({ messageID: m.info.id, tool: p.tool, patch, ...counts });
      entry.additions += counts.additions;
      entry.deletions += counts.deletions;
    }
  }
  return [...byFile.values()];
}
