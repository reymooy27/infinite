export const DEFAULT_ROUTER_USAGE_BASE_URL = "http://127.0.0.1:20128";

export const ROUTER_USAGE_PERIODS = ["today", "24h", "7d", "30d", "60d"] as const;

export type RouterUsagePeriod = (typeof ROUTER_USAGE_PERIODS)[number];

export function isRouterUsagePeriod(value: string): value is RouterUsagePeriod {
  return ROUTER_USAGE_PERIODS.includes(value as RouterUsagePeriod);
}

export function normalizeRouterUsageBaseUrl(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_ROUTER_USAGE_BASE_URL;
  return raw.replace(/\/+$/, "");
}
