export interface OcToolState {
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
  title?: string;
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
  };
  parts: OcPart[];
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
