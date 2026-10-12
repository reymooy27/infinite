import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Star, Wrench, X } from "lucide-react";

export interface PickableModel {
  providerID: string;
  providerName: string;
  modelID: string;
  label: string;
  name?: string;
  isDefault?: boolean;
  context?: number;
  toolcall?: boolean;
}

interface ModelPickerProps {
  models: PickableModel[];
  selected: PickableModel | null;
  onSelect: (model: PickableModel) => void;
  onClose: () => void;
}

function fmtContext(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export default function ModelPicker({ models, selected, onSelect, onClose }: ModelPickerProps) {
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
    const list = q
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            (m.name ?? "").toLowerCase().includes(q) ||
            m.providerName.toLowerCase().includes(q),
        )
      : models;
    return [...list].sort((a, b) =>
      a.isDefault === b.isDefault
        ? a.providerName.localeCompare(b.providerName) || a.label.localeCompare(b.label)
        : a.isDefault
          ? -1
          : 1,
    );
  }, [models, query]);

  return (
    <div className="fixed inset-0 z-[10020] flex items-start justify-center p-4 pt-16">
      <button
        type="button"
        aria-label="Close model picker"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Select model"
        className="relative z-[10021] flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900/95 shadow-2xl backdrop-blur-md"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-neutral-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${models.length} models…`}
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
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
              {models.length === 0 ? "No models available." : "No models match your search."}
            </div>
          ) : (
            filtered.map((m) => {
              const active = selected?.label === m.label;
              return (
                <button
                  key={m.label}
                  onClick={() => onSelect(m)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                    active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                  }`}
                >
                  <Check
                    size={13}
                    className={`shrink-0 ${active ? "text-emerald-400" : "text-transparent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-neutral-100">
                        {m.name || m.modelID}
                      </span>
                      {m.isDefault && (
                        <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" />
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 truncate text-[10px] text-neutral-500">
                      <span className="truncate">{m.providerName}</span>
                      {m.context ? <span>· {fmtContext(m.context)} ctx</span> : null}
                      {m.toolcall ? (
                        <span className="inline-flex items-center gap-0.5">
                          · <Wrench size={9} /> tools
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="shrink-0 truncate font-mono text-[10px] text-neutral-600">
                    {m.modelID}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}