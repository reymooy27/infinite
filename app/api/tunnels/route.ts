import { NextRequest, NextResponse } from "next/server";

function getRelayHttpBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_WS_URL;

  if (configured) {
    if (configured.startsWith("http://") || configured.startsWith("https://")) {
      return configured;
    }
    if (configured.startsWith("ws://") || configured.startsWith("wss://")) {
      return configured.replace(/^ws/, "http");
    }
    return `https://${configured.replace(/^https?:\/\//, "")}`;
  }

  return "http://127.0.0.1:7891";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(`${getRelayHttpBaseUrl()}/api/tunnels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const contentType = res.headers.get("content-type") ?? "application/json";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: {
          "Content-Type": contentType,
        },
      });
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return NextResponse.json(
        { error: "Invalid relay tunnel response" },
        { status: 502 },
      );
    }

    const relayBaseUrl = getRelayHttpBaseUrl().replace(/\/+$/, "");
    const nextData = { ...data } as Record<string, unknown>;
    if (typeof nextData.url === "string") {
      try {
        const parsed = new URL(nextData.url);
        nextData.url = `${relayBaseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch {
        nextData.url = `${relayBaseUrl}/${String(nextData.url).replace(/^\/+/, "")}`;
      }
    }

    return NextResponse.json(nextData, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach relay tunnel service" },
      { status: 502 },
    );
  }
}
