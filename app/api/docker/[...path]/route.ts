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

async function proxy(request: NextRequest, path: string[]) {
  const relayBase = getRelayHttpBaseUrl();
  const search = request.nextUrl.search;
  const targetUrl = `${relayBase}/api/docker/${path.map(encodeURIComponent).join("/")}${search}`;

  const init: RequestInit = {
    method: request.method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body) init.body = body;
  }

  try {
    const res = await fetch(targetUrl, init);
    const contentType = res.headers.get("content-type") ?? "application/json";
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach Docker relay";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}
