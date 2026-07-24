import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  useSettingsStore,
  AVAILABLE_SHORTCUTS,
  AVAILABLE_TMUX_SHORTCUTS,
} from "@/stores/useSettingsStore";
import { DEFAULT_ROUTER_USAGE_BASE_URL, normalizeRouterUsageBaseUrl } from "@/lib/routerUsage";
import type { AIProviderRecord } from "@/types/aiProvider";

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
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const bgColor = useSettingsStore((s) => s.bgColor);
  const setBgColor = useSettingsStore((s) => s.setBgColor);
  const quickBarSlots = useSettingsStore((s) => s.quickBarSlots);
  const setQuickBarSlots = useSettingsStore((s) => s.setQuickBarSlots);
  const routerUsageBaseUrl = useSettingsStore((s) => s.routerUsageBaseUrl);
  const setRouterUsageBaseUrl = useSettingsStore((s) => s.setRouterUsageBaseUrl);

  // provider form state
  const [providerName, setProviderName] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);

  // key form state
  const [addKeyLabel, setAddKeyLabel] = useState("");
  const [addKeyValue, setAddKeyValue] = useState("");
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editKeyLabel, setEditKeyLabel] = useState("");
  const [editKeyValue, setEditKeyValue] = useState("");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<AIProviderRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const [loaded, setLoaded] = useState(false);

  const loadProviders = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await api.get<typeof providers>("/api/ai-providers");
      setProviders(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!copiedId) return;
    const timeout = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedId]);

  const resetProviderForm = () => {
    setProviderName("");
    setProviderBaseUrl("");
    setEditingProviderId(null);
    setError("");
  };

  const resetKeyForm = () => {
    setAddKeyLabel("");
    setAddKeyValue("");
    setEditingKeyId(null);
    setEditKeyLabel("");
    setEditKeyValue("");
    setError("");
  };

  // ---- Provider CRUD ----

  const handleSaveProvider = () => {
    void (async () => {
      const name = providerName.trim().replace(/\s+/g, " ");
      const baseUrl = providerBaseUrl.trim() || undefined;

      if (!name) {
        setError("Provider name is required.");
        return;
      }

      setSaving(true);
      setError("");

      try {
        const data = editingProviderId
          ? await api.patch<typeof providers[0]>(`/api/ai-providers/${editingProviderId}`, { name, baseUrl })
          : await api.post<typeof providers[0]>("/api/ai-providers", { name, baseUrl });

        if (editingProviderId) {
          setProviders((prev) =>
            prev.map((p) =>
              p.id === editingProviderId
                ? { ...p, name: data.name, baseUrl: data.baseUrl, updatedAt: data.updatedAt }
                : p,
            ),
          );
        } else {
          setProviders((prev) => [data, ...prev]);
        }
        resetProviderForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save provider.");
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleDeleteProvider = (id: string) => {
    void (async () => {
      setError("");
      try {
        await api.delete(`/api/ai-providers/${id}`);
        setProviders((prev) => prev.filter((p) => p.id !== id));
        if (editingProviderId === id) resetProviderForm();
        if (expandedProviderId === id) setExpandedProviderId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete provider.");
      }
    })();
  };

  const handleEditProvider = (id: string) => {
    const p = providers.find((entry) => entry.id === id);
    if (!p) return;
    setProviderName(p.name);
    setProviderBaseUrl(p.baseUrl || "");
    setEditingProviderId(id);
    setError("");
  };

  // ---- Key CRUD ----

  const handleAddKey = (providerId: string) => {
    void (async () => {
      const apiKey = addKeyValue.trim();
      if (!apiKey) {
        setError("API key is required.");
        return;
      }

      setSaving(true);
      setError("");

      try {
        const data = await api.post<typeof providers[0]["keys"][0]>(`/api/ai-providers/${providerId}/keys`, { label: addKeyLabel.trim(), apiKey });

        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? { ...p, keys: [...p.keys, data] }
              : p,
          ),
        );
        setAddKeyLabel("");
        setAddKeyValue("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add API key.");
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleSaveKey = (keyId: string, providerId: string) => {
    void (async () => {
      const apiKey = editKeyValue.trim();
      if (!apiKey) {
        setError("API key is required.");
        return;
      }

      setSaving(true);
      setError("");

      try {
        const data = await api.patch<typeof providers[0]["keys"][0]>(`/api/ai-keys/${keyId}`, { label: editKeyLabel.trim(), apiKey });

        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? { ...p, keys: p.keys.map((k) => (k.id === keyId ? data : k)) }
              : p,
          ),
        );
        resetKeyForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update API key.");
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleDeleteKey = (keyId: string, providerId: string) => {
    void (async () => {
      setError("");
      try {
        await api.delete(`/api/ai-keys/${keyId}`);
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? { ...p, keys: p.keys.filter((k) => k.id !== keyId) }
              : p,
          ),
        );
        if (editingKeyId === keyId) resetKeyForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete API key.");
      }
    })();
  };

  const handleCopy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
    } catch {
      setError("Clipboard copy failed.");
    }
  };

  const handleTest = (keyId: string) => {
    void (async () => {
      setTestStates((prev) => ({
        ...prev,
        [keyId]: { kind: "loading", message: "Testing..." },
      }));

      try {
        const data = await api.post<{ ok: boolean; provider: string; status: number; message: string; modelCount?: number }>(`/api/ai-keys/${keyId}/test`);

        setTestStates((prev) => ({
          ...prev,
          [keyId]: {
            kind: data.ok ? "success" : "error",
            message: data.message || (data.ok ? "Key valid" : "Key invalid"),
          },
        }));
      } catch (err) {
        setTestStates((prev) => ({
          ...prev,
          [keyId]: {
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to test API key.",
          },
        }));
      }
    })();
  };

  const canTestProvider = (name: string) => {
    const n = name.trim().toLowerCase();
    return n === "openai" || n === "anthropic";
  };

  const totalKeys = providers.reduce((sum, p) => sum + p.keys.length, 0);

  const filteredProviders = providers.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
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

        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 px-3 py-2.5">
          <div className="text-[13px] font-medium text-neutral-100">
            9router usage endpoint
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-400">
            Global source for usage viewer.
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={routerUsageBaseUrl}
              onChange={(e) => setRouterUsageBaseUrl(e.target.value)}
              placeholder={DEFAULT_ROUTER_USAGE_BASE_URL}
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
            />
            <button
              onClick={() =>
                setRouterUsageBaseUrl(DEFAULT_ROUTER_USAGE_BASE_URL)
              }
              className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentPage === "api-management") {
    return (
      <div className="space-y-2.5 p-2.5 overflow-y-auto max-h-full">
        {/* Add / Edit Provider Form */}
        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
          <h3 className="text-[13px] font-medium text-neutral-100">
            {editingProviderId ? "Edit provider" : "Add provider"}
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
                Provider name
              </label>
              <input
                id="provider-name"
                list="provider-suggestions"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
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
                htmlFor="provider-base-url"
                className="mb-1 block text-[11px] text-neutral-400"
              >
                Base URL <span className="text-neutral-600">(optional)</span>
              </label>
              <input
                id="provider-base-url"
                value={providerBaseUrl}
                onChange={(e) => setProviderBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
              />
            </div>
          </div>

          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSaveProvider}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-medium text-white transition-colors cursor-pointer hover:bg-blue-500 disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : editingProviderId
                  ? "Save changes"
                  : "Add provider"}
            </button>
            {(editingProviderId || providerName || providerBaseUrl) && (
              <button
                onClick={resetProviderForm}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Providers List */}
        <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium text-neutral-100">
                Providers
              </h3>
              {loaded && (
                <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
                  {providers.length} providers, {totalKeys} keys
                </p>
              )}
            </div>
            <button
              onClick={loadProviders}
              disabled={loading}
              className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-50"
            >
              {loading ? "Loading..." : loaded ? "Refresh" : "Load"}
            </button>
          </div>

          {loaded && (
            <div className="mt-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search provider..."
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
              />
            </div>
          )}

          <div className="mt-3 space-y-2">
            {!loaded ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                Click Load to fetch providers.
              </div>
            ) : loading ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                Loading providers...
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                No providers saved yet.
              </div>
            ) : filteredProviders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-[11px] text-neutral-500">
                No providers match search.
              </div>
            ) : (
              filteredProviders.map((prov) => {
                const isExpanded = expandedProviderId === prov.id;
                return (
                  <div
                    key={prov.id}
                    className="rounded-lg border border-neutral-700 bg-neutral-900/80"
                  >
                    {/* Provider Header */}
                    <div
                      className="flex items-center justify-between gap-2 p-3 cursor-pointer select-none"
                      onClick={() =>
                        setExpandedProviderId(isExpanded ? null : prov.id)
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`shrink-0 text-neutral-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                          <span className="text-[12px] font-medium text-neutral-100">
                            {prov.name}
                          </span>
                          <span className="rounded-full bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                            {prov.keys.length} {prov.keys.length === 1 ? "key" : "keys"}
                          </span>
                        </div>
                        {prov.baseUrl && (
                          <div className="mt-0.5 ml-[18px] truncate font-mono text-[10px] text-neutral-500">
                            {prov.baseUrl}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleEditProvider(prov.id)}
                          className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(prov.id)}
                          className="rounded-md border border-red-900/70 px-2 py-1 text-[11px] text-red-300 transition-colors cursor-pointer hover:border-red-700 hover:text-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Expanded: Keys List */}
                    {isExpanded && (
                      <div className="border-t border-neutral-800 px-3 pb-3 pt-2 space-y-2">
                        {prov.keys.map((key) => {
                          const isEditing = editingKeyId === key.id;
                          return (
                            <div
                              key={key.id}
                              className="rounded-md border border-neutral-800 bg-neutral-950/60 p-2.5"
                            >
                              {testStates[key.id] && (
                                <div
                                  className={`mb-2 rounded-md px-2 py-1 text-[10px] ${
                                    testStates[key.id].kind === "success"
                                      ? "bg-emerald-950/70 text-emerald-300"
                                      : testStates[key.id].kind === "error"
                                        ? "bg-red-950/70 text-red-300"
                                        : "bg-neutral-800 text-neutral-400"
                                  }`}
                                >
                                  {testStates[key.id].message}
                                </div>
                              )}

                              {isEditing ? (
                                <div className="space-y-1.5">
                                  <input
                                    value={editKeyLabel}
                                    onChange={(e) => setEditKeyLabel(e.target.value)}
                                    placeholder="Label (optional)"
                                    className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                                  />
                                  <textarea
                                    value={editKeyValue}
                                    onChange={(e) => setEditKeyValue(e.target.value)}
                                    placeholder="sk-..."
                                    rows={3}
                                    className="w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                                  />
                                  <div className="flex gap-1.5">
                                    <button
                                      onClick={() => handleSaveKey(key.id, prov.id)}
                                      disabled={saving}
                                      className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white cursor-pointer hover:bg-blue-500 disabled:opacity-50"
                                    >
                                      {saving ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                      onClick={resetKeyForm}
                                      className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 cursor-pointer hover:text-neutral-100"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    {key.label && (
                                      <div className="text-[11px] font-medium text-neutral-300">
                                        {key.label}
                                      </div>
                                    )}
                                    <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-400">
                                      {visibleId === key.id
                                        ? key.apiKey
                                        : maskApiKey(key.apiKey)}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-1">
                                    <button
                                      onClick={() =>
                                        setVisibleId((prev) =>
                                          prev === key.id ? null : key.id,
                                        )
                                      }
                                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 cursor-pointer hover:text-neutral-100"
                                    >
                                      {visibleId === key.id ? "Hide" : "Show"}
                                    </button>
                                    {canTestProvider(prov.name) && (
                                      <button
                                        onClick={() => handleTest(key.id)}
                                        disabled={testStates[key.id]?.kind === "loading"}
                                        className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 cursor-pointer hover:text-neutral-100 disabled:opacity-50"
                                      >
                                        {testStates[key.id]?.kind === "loading"
                                          ? "Testing"
                                          : "Test"}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleCopy(key.apiKey, key.id)}
                                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 cursor-pointer hover:text-neutral-100"
                                    >
                                      {copiedId === key.id ? "Copied" : "Copy"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingKeyId(key.id);
                                        setEditKeyLabel(key.label || "");
                                        setEditKeyValue(key.apiKey);
                                        setError("");
                                      }}
                                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 cursor-pointer hover:text-neutral-100"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteKey(key.id, prov.id)}
                                      className="rounded border border-red-900/70 px-1.5 py-0.5 text-[10px] text-red-300 cursor-pointer hover:text-red-200"
                                    >
                                      Del
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Add Key Form */}
                        <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-950/40 p-2.5 space-y-1.5">
                          <input
                            value={addKeyLabel}
                            onChange={(e) => setAddKeyLabel(e.target.value)}
                            placeholder="Label (optional)"
                            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                          />
                          <textarea
                            value={addKeyValue}
                            onChange={(e) => setAddKeyValue(e.target.value)}
                            placeholder="sk-..."
                            rows={2}
                            className="w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => handleAddKey(prov.id)}
                            disabled={saving || !addKeyValue.trim()}
                            className="rounded bg-neutral-700 px-2 py-1 text-[11px] text-neutral-200 cursor-pointer hover:bg-neutral-600 disabled:opacity-50"
                          >
                            {saving ? "Adding..." : "Add key"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-2.5 overflow-y-auto max-h-full">
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <h3 className="text-[13px] font-medium text-neutral-100">
          9router usage source
        </h3>
        <p className="mt-1 text-[11px] leading-4.5 text-neutral-400">
          Infinite server fetches usage from this 9router base URL.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={routerUsageBaseUrl}
            onChange={(e) => setRouterUsageBaseUrl(e.target.value)}
            placeholder={DEFAULT_ROUTER_USAGE_BASE_URL}
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-100 outline-none transition-colors placeholder:text-neutral-500 focus:border-blue-500"
          />
          <button
            onClick={() =>
              setRouterUsageBaseUrl(DEFAULT_ROUTER_USAGE_BASE_URL)
            }
            className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-300 transition-colors cursor-pointer hover:border-neutral-600 hover:text-neutral-100"
          >
            Default
          </button>
        </div>
        <p className="mt-2 text-[10px] text-neutral-500">
          Normalized: {normalizeRouterUsageBaseUrl(routerUsageBaseUrl)}
        </p>
        <p className="mt-1 text-[10px] text-neutral-500">
          Must be reachable from Infinite runtime. Local default uses port 20128.
        </p>
      </div>

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
