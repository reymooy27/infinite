export async function resolveTerminalLinkTarget(
  rawUrl: string,
  connectionId?: number,
): Promise<string | null> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const isLocalhost =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(trimmed);
  const hasProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://");

  let formatted = trimmed;
  if (isLocalhost) {
    formatted = `http://${trimmed}`;
  } else if (!hasProtocol) {
    formatted = `http://${trimmed}`;
  }

  const parsed = new URL(formatted);
  const isParsedLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "0.0.0.0";

  if (!isParsedLocalhost || !connectionId) {
    return formatted;
  }

  const targetPort = parsed.port
    ? parseInt(parsed.port, 10)
    : parsed.protocol === "https:"
      ? 443
      : 80;

  const res = await fetch("/api/tunnels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId,
      scheme: parsed.protocol.replace(":", ""),
      targetHost: "127.0.0.1",
      targetPort,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create localhost tunnel");
  }

  const data = await res.json();
  return `${data.url}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
