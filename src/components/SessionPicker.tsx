import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MessagesSquare, Plus, Search, Trash2, X } from "lucide-react";

export interface PickableSession {
  id: string;
  title?: string;
  busy?: boolean;
  updated?: number;
}

interface SessionPickerProps {
  sessions: PickableSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function relTime(ts?: number): string {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SessionPicker({
  sessions,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: SessionPickerProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sessions.filter((s) => (s.title ?? "").toLowerCase().includes(q)) : sessions;
  }, [sessions, query]);

  return (
    <div className="fixed inset-0 z-[10020] flex items-start justify-center p-4 pt-16">
      <button
        type="button"
        aria-label="Close session picker"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Select session"
        className="relative z-[10021] flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900/95 shadow-2xl backdrop-blur-md"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-neutral-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${sessions.length} sessions…`}
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <button
            onClick={onNew}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950/70 px-2 text-[11px] text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
            title="New session"
          >
            <Plus size={13} />
            <span>New</span>
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">
              {sessions.length === 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <MessagesSquare size={13} /> No sessions yet.
                </span>
              ) : (
                "No sessions match your search."
              )}
            </div>
          ) : (
            filtered.map((s) => {
              const active = s.id === selectedId;
              return (
                <div
                  key={s.id}
                  className={`group flex items-center gap-2.5 px-3 py-2 transition-colors ${
                    active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                  }`}
                >
                  <button
                    onClick={() => onSelect(s.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
                  >
                    <Check
                      size={13}
                      className={`shrink-0 ${active ? "text-emerald-400" : "text-transparent"}`}
                    />
                    {s.busy && (
                      <Loader2
                        size={12}
                        aria-label="Running"
                        className="shrink-0 animate-spin text-indigo-300"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-100">
                        {s.title || "Untitled"}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-neutral-500">
                        {relTime(s.updated)}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-rose-300 group-hover:opacity-100 cursor-pointer"
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
