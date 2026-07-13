export async function resolveTerminalLinkTarget(
  rawUrl: string,
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

  if (!isParsedLocalhost) {
    return formatted;
  }

  const currentHostname =
    typeof window !== "undefined" ? window.location.hostname : parsed.hostname;
  const targetPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return `${parsed.protocol}//${currentHostname}:${targetPort}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
