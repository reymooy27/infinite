"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ROUTER_USAGE_PERIODS,
  normalizeRouterUsageBaseUrl,
  type RouterUsagePeriod,
} from "@/lib/routerUsage";
import { useSettingsStore } from "@/stores/useSettingsStore";

type UsageGroupEntry = {
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  rawModel?: string;
  provider?: string;
  keyName?: string;
  endpoint?: string;
  lastUsed?: string;
  accountName?: string;
  apiKeyMasked?: string | null;
};

type RecentRequest = {
  timestamp: string;
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  status?: string;
};

type UsageStatsResponse = {
  totalRequests?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalCachedTokens?: number;
  totalCost?: number;
  byProvider?: Record<string, UsageGroupEntry>;
  byModel?: Record<string, UsageGroupEntry>;
  byApiKey?: Record<string, UsageGroupEntry>;
  byEndpoint?: Record<string, UsageGroupEntry>;
  recentRequests?: RecentRequest[];
};

type TableView = "model" | "provider" | "apiKey" | "endpoint";

type TableRow = {
  label: string;
  sublabel: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  lastUsed: string;
};

const PERIOD_LABELS: Record<RouterUsagePeriod, string> = {
  today: "Today",
  "24h": "24h",
  "7d": "7D",
  "30d": "30D",
  "60d": "60D",
};

function fmtNumber(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function fmtCompact(value: number | undefined) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function fmtCost(value: number | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function fmtDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function pickText(...values: Array<string | undefined | null>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }

  return "";
}

function buildRows(
  tableView: TableView,
  stats: UsageStatsResponse | null,
): TableRow[] {
  if (!stats) return [];

  const source =
    tableView === "provider"
      ? stats.byProvider
      : tableView === "apiKey"
        ? stats.byApiKey
        : tableView === "endpoint"
          ? stats.byEndpoint
          : stats.byModel;

  return Object.entries(source ?? {})
    .map(([key, entry]) => {
      const normalizedKey = pickText(key);
      const normalizedRawModel = pickText(entry.rawModel);
      const normalizedProvider = pickText(entry.provider);
      const normalizedEndpoint = pickText(entry.endpoint);
      const modelLabel = pickText(
        normalizedRawModel,
        normalizedKey,
        normalizedEndpoint,
        "Unknown model",
      );
      const label =
        tableView === "provider"
          ? pickText(normalizedKey, "Unknown provider")
          : tableView === "apiKey"
            ? pickText(entry.keyName, entry.apiKeyMasked, "Unknown key")
            : tableView === "endpoint"
              ? pickText(normalizedEndpoint, normalizedKey, "Unknown endpoint")
              : modelLabel;

      const sublabel =
        tableView === "provider"
          ? `${fmtCompact(entry.promptTokens)} in / ${fmtCompact(entry.completionTokens)} out`
          : tableView === "apiKey"
            ? pickText(normalizedProvider, "Unknown provider")
            : tableView === "endpoint"
              ? [normalizedProvider, normalizedRawModel]
                  .filter(Boolean)
                  .join(" · ")
              : [
                  normalizedProvider,
                  normalizedKey !== modelLabel ? normalizedKey : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Unknown provider";

      return {
        label,
        sublabel,
        requests: entry.requests ?? 0,
        promptTokens: entry.promptTokens ?? 0,
        completionTokens: entry.completionTokens ?? 0,
        cost: entry.cost ?? 0,
        lastUsed: entry.lastUsed ?? "",
      };
    })
    .sort((a, b) => {
      if (b.requests !== a.requests) return b.requests - a.requests;
      if (b.cost !== a.cost) return b.cost - a.cost;
      return (
        b.promptTokens +
        b.completionTokens -
        (a.promptTokens + a.completionTokens)
      );
    });
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold text-neutral-100">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-neutral-400">{hint}</div>
    </div>
  );
}

export default function UsagePanel() {
  const storedBaseUrl = useSettingsStore((s) => s.routerUsageBaseUrl);
  const baseUrl = useMemo(
    () => normalizeRouterUsageBaseUrl(storedBaseUrl),
    [storedBaseUrl],
  );

  const [period, setPeriod] = useState<RouterUsagePeriod>("today");
  const [tableView, setTableView] = useState<TableView>("model");
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          period,
          baseUrl,
        });
        const statsRes = await fetch(
          `/api/router-usage/stats?${query.toString()}`,
          {
            cache: "no-store",
          },
        );
        const statsBody = await statsRes.json();

        if (!statsRes.ok) {
          throw new Error(statsBody.error || "Failed to load usage stats");
        }

        if (cancelled) return;
        setStats(statsBody);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to reach 9router",
        );
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, period]);

  async function handleRefresh() {
    setRefreshing(true);
    setError("");

    try {
      const query = new URLSearchParams({
        period,
        baseUrl,
      });
      const statsRes = await fetch(
        `/api/router-usage/stats?${query.toString()}`,
        {
          cache: "no-store",
        },
      );
      const statsBody = await statsRes.json();

      if (!statsRes.ok) {
        throw new Error(statsBody.error || "Failed to load usage stats");
      }

      setStats(statsBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach 9router");
    } finally {
      setRefreshing(false);
    }
  }

  const tableOptions: Array<{ id: TableView; label: string }> = useMemo(() => {
    const options: Array<{ id: TableView; label: string }> = [
      { id: "model", label: "Model" },
      { id: "provider", label: "Provider" },
      { id: "apiKey", label: "API Key" },
    ];

    if (stats?.byEndpoint && Object.keys(stats.byEndpoint).length > 0) {
      options.push({ id: "endpoint", label: "Endpoint" });
    }

    return options;
  }, [stats]);

  const resolvedTableView = tableOptions.some(
    (option) => option.id === tableView,
  )
    ? tableView
    : "model";

  const rows = useMemo(
    () => buildRows(resolvedTableView, stats),
    [resolvedTableView, stats],
  );
  const recentRequests = useMemo(
    () => (stats?.recentRequests ?? []).slice(0, 6),
    [stats],
  );
  const statusTone = error
    ? "text-red-300 bg-red-950/60 border-red-900/70"
    : "text-emerald-300 bg-emerald-950/60 border-emerald-900/70";

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <div className="flex flex-col gap-3 sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-medium text-neutral-100">
                9router usage
              </h3>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone}`}
              >
                {error ? "Unreachable" : loading ? "Checking" : "Connected"}
              </span>
            </div>
            <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">
              {baseUrl}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              Source of truth stays in 9router. Infinite only reads the summary.
            </div>
            {error && (
              <div className="mt-2 text-[11px] text-red-300">{error}</div>
            )}
            {!error && (
              <div className="mt-3 rounded-lg border border-neutral-700 bg-neutral-900/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                    {PERIOD_LABELS[period]} usage
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    Input {fmtCompact(stats?.totalPromptTokens)}
                  </div>
                </div>
                {loading ? (
                  <div className="mt-2 text-[11px] text-neutral-500">
                    Loading usage...
                  </div>
                ) : !stats?.totalPromptTokens ? (
                  <div className="mt-2 text-[11px] text-neutral-500">
                    No usage yet.
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-neutral-300">
                    Total input:{" "}
                    <span className="font-mono text-neutral-100">
                      {fmtCompact(stats.totalPromptTokens)}
                    </span>
                  </div>
                )}

                {!loading && recentRequests.length > 0 && (
                  <div className="mt-3 border-t border-neutral-800 pt-3">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                      Recent usage
                    </div>
                    <div className="mt-2 space-y-2">
                      {recentRequests.map((item, index) => (
                        <div
                          key={`${item.timestamp}-${item.model}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-neutral-100">
                              {item.model}
                            </div>
                            <div className="truncate text-[11px] text-neutral-500">
                              {pickText(
                                stats?.byModel?.[item.model]?.provider,
                                item.provider,
                              ) || "Unknown provider"}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-[11px] text-neutral-400">
                            <div>
                              {fmtCompact(item.promptTokens)} /{" "}
                              {fmtCompact(item.completionTokens)}
                            </div>
                            <div>{fmtDate(item.timestamp)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => void handleRefresh()}
            disabled={loading || refreshing}
            className="w-full shrink-0 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-600 hover:text-neutral-100 disabled:opacity-50 sm:w-auto"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 rounded-lg border border-neutral-700 bg-neutral-800/70 p-1">
        {ROUTER_USAGE_PERIODS.map((item) => (
          <button
            key={item}
            onClick={() => setPeriod(item)}
            className={`rounded-md px-2 py-1.5 text-[11px] transition-colors ${
              period === item
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
            }`}
          >
            {PERIOD_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <MetricCard
          label="Requests"
          value={fmtNumber(stats?.totalRequests)}
          hint={`${PERIOD_LABELS[period]} total`}
        />
        <MetricCard
          label="Prompt"
          value={fmtCompact(stats?.totalPromptTokens)}
          hint="Input tokens"
        />
        <MetricCard
          label="Completion"
          value={fmtCompact(stats?.totalCompletionTokens)}
          hint="Output tokens"
        />
        <MetricCard
          label="Cached"
          value={fmtCompact(stats?.totalCachedTokens)}
          hint="Cache read tokens"
        />
        <MetricCard
          label="Estimated Cost"
          value={fmtCost(stats?.totalCost)}
          hint="From 9router"
        />
      </div>

      <div className="rounded-lg border border-neutral-700 bg-neutral-800/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-medium text-neutral-100">
              Breakdown
            </h3>
            <p className="mt-1 text-[11px] text-neutral-400">
              Grouped summary from 9router stats payload.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {tableOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setTableView(option.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  resolvedTableView === option.id
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-700">
          <div className="grid min-w-[720px] grid-cols-[minmax(180px,1.8fr)_80px_110px_90px_140px] gap-3 bg-neutral-900/80 px-3 py-2 text-[10px] uppercase tracking-wide text-neutral-500">
            <div>
              {
                tableOptions.find((option) => option.id === resolvedTableView)
                  ?.label
              }
            </div>
            <div className="text-right">Req</div>
            <div className="text-right">In / Out</div>
            <div className="text-right">Cost</div>
            <div className="text-right">Last used</div>
          </div>
          {loading ? (
            <div className="px-3 py-6 text-center text-[12px] text-neutral-500">
              Loading breakdown...
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-neutral-500">
              No usage data yet. Make sure 9router is running and has recorded
              usage.
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {rows.slice(0, 20).map((row) => (
                <div
                  key={`${resolvedTableView}-${row.label}-${row.sublabel}`}
                  className="grid min-w-[720px] grid-cols-[minmax(180px,1.8fr)_80px_110px_90px_140px] gap-3 px-3 py-2.5 text-[12px]"
                >
                  <div className="min-w-0" title={row.label}>
                    <div className="truncate font-medium text-neutral-100">
                      {row.label}
                    </div>
                    <div
                      className="truncate text-[11px] text-neutral-500"
                      title={row.sublabel}
                    >
                      {row.sublabel || "—"}
                    </div>
                  </div>
                  <div className="text-right text-neutral-200">
                    {fmtNumber(row.requests)}
                  </div>
                  <div className="text-right text-neutral-300">
                    {fmtCompact(row.promptTokens)} /{" "}
                    {fmtCompact(row.completionTokens)}
                  </div>
                  <div className="text-right text-neutral-300">
                    {fmtCost(row.cost)}
                  </div>
                  <div className="text-right text-neutral-500">
                    {fmtDate(row.lastUsed)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
