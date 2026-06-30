"use client";

import { useEffect, useState } from "react";
import {
  useSettingsStore,
  AVAILABLE_SHORTCUTS,
  AVAILABLE_TMUX_SHORTCUTS,
} from "@/stores/useSettingsStore";
import type { AIProviderKeyRecord } from "@/types/aiProvider";

interface SettingsPanelProps {
  currentPage: "root" | "terminal" | "api-management";
  onOpenTerminal: () => void;
  onOpenApiManagement: () => void;
}

const PROVIDER_SUGGESTIONS = [
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "xAI",
  "Mistral",
  "Groq",
  "DeepSeek",
  "OpenRouter",
];

interface TestState {
  kind: "idle" | "loading" | "success" | "error";
  message: string;
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-neutral-100">{title}</h3>
          <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
            {description}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
            checked ? "bg-blue-600" : "bg-neutral-700"
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function maskApiKey(value: string) {
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}${"•".repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

function formatProviderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export default function SettingsPanel({
  currentPage,
  onOpenTerminal,
  onOpenApiManagement,
}: SettingsPanelProps) {
  const showTerminalShortcuts = useSettingsStore(
    (s) => s.showTerminalShortcuts,
  );
  const setShowTerminalShortcuts = useSettingsStore(
    (s) => s.setShowTerminalShortcuts,
  );
  const showTmuxShortcuts = useSettingsStore((s) => s.showTmuxShortcuts);
  const setShowTmuxShortcuts = useSettingsStore((s) => s.setShowTmuxShortcuts);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const setBgColor = useSettingsStore((s) => s.setBgColor);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const setQuickBarSlots = useSettingsStore((s) => s.setQuickBarSlots);

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<AIProviderKeyRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  useEffect(() => {
    if (currentPage !== "root" && currentPage !== "api-management") return;

    let cancelled = false;

    async function loadKeys() {
      if (currentPage === "api-management") {
        setLoading(true);
        setError("");
      }

      try {
        const res = await fetch("/api/ai-provider-keys");
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load provider keys");
        }

        if (!cancelled) {
          setItems(data);
        }
      } catch (err) {
        if (!cancelled && currentPage === "api-management") {
          setError(err instanceof Error ? err.message : "Failed to load provider keys.");
        }
      } finally {
        if (!cancelled && currentPage === "api-management") {
          setLoading(false);
        }
      }
    }

    loadKeys();

    return () => {
      cancelled = true;
    };
  }, [currentPage]);

  useEffect(() => {
    if (!copiedId) return;
    const timeout = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedId]);

  const resetForm = () => {
    setProvider("");
    setApiKey("");
    setEditingId(null);
    setError("");
  };

  const handleSubmit = () => {
    void (async () => {
      const nextProvider = formatProviderName(provider);
      const nextApiKey = apiKey.trim();

      if (!nextProvider || !nextApiKey) {
        setError("Provider and API key are required.");
        return;
      }

      setSaving(true);
      setError("");

      try {
        const res = await fetch(
          editingId
            ? `/api/ai-provider-keys/${editingId}`
            : "/api/ai-provider-keys",
          {
            method: editingId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: nextProvider,
              apiKey: nextApiKey,
            }),
          },
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to save provider key");
        }

        setItems((prev) =>
          editingId
            ? prev.map((item) => (item.id === editingId ? data : item))
            : [data, ...prev],
        );
        resetForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save provider key.");
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleDelete = (id: string) => {
    void (async () => {
      setError("");
      try {
        const res = await fetch(`/api/ai-provider-keys/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to delete provider key");
        }

        setItems((prev) => prev.filter((item) => item.id !== id));
        if (editingId === id) resetForm();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to delete provider key.",
        );
      }
    })();
  };

  const handleEdit = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    setProvider(item.provider);
    setApiKey(item.apiKey);
    setEditingId(item.id);
    setError("");
  };

  const handleCopy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
    } catch {
      setError("Clipboard copy failed.");
    }
  };

  const handleTest = (id: string) => {
    void (async () => {
      setTestStates((prev) => ({
        ...prev,
        [id]: { kind: "loading", message: "Testing..." },
      }));

      try {
        const res = await fetch(`/api/ai-provider-keys/${id}/test`, {
          method: "POST",
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to test provider key");
        }

        setTestStates((prev) => ({
          ...prev,
          [id]: {
            kind: data.ok ? "success" : "error",
            message: data.message || (data.ok ? "Key valid" : "Key invalid"),
          },
        }));
      } catch (err) {
        setTestStates((prev) => ({
          ...prev,
          [id]: {
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to test provider key.",
          },
        }));
      }
    })();
  };

  const canTestProvider = (providerName: string) => {
    const normalized = providerName.trim().toLowerCase();
    return normalized === "openai" || normalized === "anthropic";
  };

  const filteredItems = items.filter((item) =>
    item.provider.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  if (currentPage === "root") {
    return (
      <div className="space-y-2.5 p-2.5">
        <button
          onClick={onOpenTerminal}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5 text-left transition-colors cursor-pointer hover:border-neutral-600 hover:bg-neutral-800"
        >
          <div>
            <div className="text-[13px] font-medium text-neutral-100">
              Terminal
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Shortcut rows, tmux controls, and terminal UI options.
            </div>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-neutral-500"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        <button
          onClick={onOpenApiManagement}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5 text-left transition-colors cursor-pointer hover:border-neutral-600 hover:bg-neutral-800"
        >
          <div>
            <div className="text-[13px] font-medium text-neutral-100">
              API Management
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Save provider names and API keys. Copy, edit, or delete entries.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">
              {items.length}
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-neutral-500"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </button>
      </div>
    );
  }

  if (currentPage === "api-management") {
    return (
      <div className="space-y-2.5 p-2.5 overflow-y-auto max-h-full">
        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
          <h3 className="text-[13px] font-medium text-neutral-100">
            {editingId ? "Edit provider" : "Add provider"}
          </h3>
          <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
            Keys are stored in database and encrypted at rest.
          </p>

          <div className="mt-3 space-y-2">
            <div>
              <label
                htmlFor="provider-name"
                className="mb-1 block text-[11px] text-neutral-400"
              >
                Provider
              </label>
              <input
                id="provider-name"
                list="provider-suggestions"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="OpenAI"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
              />
              <datalist id="provider-suggestions">
                {PROVIDER_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="provider-key"
                className="mb-1 block text-[11px] text-neutral-400"
              >
                API Key
              </label>
              <textarea
                id="provider-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                rows={4}
                className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
              />
            </div>
          </div>

          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-medium text-white transition-colors cursor-pointer hover:bg-blue-500"
            >
              {saving
                ? "Saving..."
                : editingId
                  ? "Save changes"
                  : "Add provider"}
            </button>
            {(editingId || provider || apiKey) && (
              <button
                onClick={resetForm}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium text-neutral-100">
                Saved providers
              </h3>
              <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
                Copy key, edit provider, or delete row.
              </p>
            </div>
            <span className="rounded-full bg-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">
              {items.length}
            </span>
          </div>

          <div className="mt-3">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search provider..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
            />
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                Loading providers...
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                No provider saved yet.
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                No provider match search.
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-neutral-700 bg-neutral-900/80 p-3"
                >
                  {testStates[item.id] && (
                    <div
                      className={`mb-2 rounded-md px-2 py-1 text-[10px] ${
                        testStates[item.id].kind === "success"
                          ? "bg-emerald-950/70 text-emerald-300"
                          : testStates[item.id].kind === "error"
                            ? "bg-red-950/70 text-red-300"
                            : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {testStates[item.id].message}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-neutral-100">
                        {item.provider}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">
                        {visibleId === item.id
                          ? item.apiKey
                          : maskApiKey(item.apiKey)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() =>
                          setVisibleId((prev) => (prev === item.id ? null : item.id))
                        }
                        className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
                      >
                        {visibleId === item.id ? "Hide" : "Show"}
                      </button>
                      {canTestProvider(item.provider) && (
                        <button
                          onClick={() => handleTest(item.id)}
                          disabled={testStates[item.id]?.kind === "loading"}
                          className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {testStates[item.id]?.kind === "loading"
                            ? "Testing"
                            : "Test"}
                        </button>
                      )}
                      <button
                        onClick={() => handleCopy(item.apiKey, item.id)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
                      >
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={() => handleEdit(item.id)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="rounded-md border border-red-900/70 px-2 py-1 text-[11px] text-red-300 transition-colors cursor-pointer hover:border-red-700 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5 overflow-y-auto max-h-full">
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">Font size</h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Adjust the terminal text size (8-24px).
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() =>
              setTerminalFontSize(Math.max(8, terminalFontSize - 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded bg-neutral-700 text-sm font-medium text-neutral-200 transition-colors cursor-pointer hover:bg-neutral-600"
          >
            -
          </button>
          <span className="w-8 text-center font-mono text-sm text-neutral-200">
            {terminalFontSize}
          </span>
          <button
            onClick={() =>
              setTerminalFontSize(Math.min(24, terminalFontSize + 1))
            }
            className="flex h-7 w-7 items-center justify-center rounded bg-neutral-700 text-sm font-medium text-neutral-200 transition-colors cursor-pointer hover:bg-neutral-600"
          >
            +
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          Background color
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Choose app background and canvas color.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            "#171717",
            "#1a1a1a",
            "#0a0a0a",
            "#1e1e2e",
            "#1a1a2e",
            "#0d1117",
            "#0f1923",
            "#2d1b2e",
          ].map((c) => (
            <button
              key={c}
              onClick={() => setBgColor(c)}
              className={`h-7 w-7 rounded-full border-2 transition-all cursor-pointer ${
                bgColor === c
                  ? "scale-110 border-white"
                  : "border-transparent hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-neutral-600 hover:border-neutral-400">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="pointer-events-none text-xs leading-none text-neutral-500">
              +
            </span>
          </label>
        </div>
      </div>

      <ToggleRow
        title="Terminal button shortcuts"
        description="Show or hide on-screen terminal shortcut buttons for control keys, arrows, and enter/tab actions."
        checked={showTerminalShortcuts}
        onChange={setShowTerminalShortcuts}
      />
      <ToggleRow
        title="tmux shortcut row"
        description="Show or hide separate tmux action row while keeping main terminal shortcut row available."
        checked={showTmuxShortcuts}
        onChange={setShowTmuxShortcuts}
      />
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          Quick bar buttons
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Choose which shortcuts appear in mobile quick bar. Terminal shortcuts
          shown at top, tmux shortcuts below.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {AVAILABLE_SHORTCUTS.map((s) => {
            const active = quickBarSlots.some((q) => q.data === s.data);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (active) {
                    setQuickBarSlots(
                      quickBarSlots.filter((q) => q.data !== s.data),
                    );
                  } else if (quickBarSlots.length < 9) {
                    setQuickBarSlots([...quickBarSlots, s]);
                  }
                }}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-neutral-700 pt-1.5">
          {AVAILABLE_TMUX_SHORTCUTS.map((s) => {
            const active = quickBarSlots.some((q) => q.data === s.data);
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (active) {
                    setQuickBarSlots(
                      quickBarSlots.filter((q) => q.data !== s.data),
                    );
                  } else if (quickBarSlots.length < 9) {
                    setQuickBarSlots([...quickBarSlots, s]);
                  }
                }}
                className={`rounded px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-neutral-500">
          {quickBarSlots.length}/9 selected
        </p>
      </div>
    </div>
  );
}
