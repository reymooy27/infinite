/**
 * Build a WebSocket URL from the configured NEXT_PUBLIC_WS_URL env var.
 */
export function buildWsUrl(
  path: string,
  params: Record<string, string | number>,
): string {
  const configured = import.meta.env.VITE_WS_URL;
  let base: string;

  if (configured) {
    if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
      base = configured;
    } else {
      const proto = configured.startsWith("https") ? "wss:" : "ws:";
      base = `${proto}//${configured.replace(/^https?:\/\//, "")}`;
    }
  } else if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${window.location.hostname}:7891`;
  } else {
    base = "ws://localhost:7891";
  }

  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  return `${base}${path}${query ? `?${query}` : ""}`;
}

/**
 * Build an HTTP base URL from the configured NEXT_PUBLIC_WS_URL env var.
 * Used for REST API calls to the WS server (e.g., tunnels).
 */
export function buildHttpBaseUrl(): string {
  if (typeof window === "undefined") return "http://localhost:7891";

  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    if (configured.startsWith("http://") || configured.startsWith("https://")) {
      return configured;
    }
    if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
      return configured.replace(/^ws/, "http");
    }
    return `${window.location.protocol}//${configured.replace(/^https?:\/\//, "")}`;
  }
  return `${window.location.protocol}//${window.location.hostname}:7891`;
}
