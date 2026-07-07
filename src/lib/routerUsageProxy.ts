import { NextResponse } from "next/server";
import { logger, logApiRequest } from "@/lib/logger";
import {
  DEFAULT_ROUTER_USAGE_BASE_URL,
  isRouterUsagePeriod,
  normalizeRouterUsageBaseUrl,
  type RouterUsagePeriod,
} from "@/lib/routerUsage";

function buildUpstreamUrl(baseUrl: string, path: string, period: RouterUsagePeriod) {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("period", period);
  return url;
}

export async function proxyRouterUsage(
  request: Request,
  path: "/api/usage/stats" | "/api/usage/chart",
  apiPath: "/api/router-usage/stats" | "/api/router-usage/chart",
) {
  const start = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!isRouterUsagePeriod(period)) {
      logApiRequest("GET", apiPath, 400, Date.now() - start);
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const baseUrl = normalizeRouterUsageBaseUrl(
      searchParams.get("baseUrl") || DEFAULT_ROUTER_USAGE_BASE_URL,
    );

    let upstream: URL;
    try {
      upstream = buildUpstreamUrl(baseUrl, path, period);
      if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      logApiRequest("GET", apiPath, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Invalid 9router URL" },
        { status: 400 },
      );
    }

    const res = await fetch(upstream, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const errorMessage =
        typeof body === "object" && body && "error" in body
          ? String(body.error)
          : `9router responded with ${res.status}`;
      logApiRequest("GET", apiPath, res.status, Date.now() - start);
      return NextResponse.json(
        {
          error: errorMessage,
          upstreamStatus: res.status,
          baseUrl,
        },
        { status: res.status },
      );
    }

    logApiRequest("GET", apiPath, 200, Date.now() - start);
    return NextResponse.json(body, {
      status: 200,
      headers: {
        "x-router-usage-base-url": baseUrl,
      },
    });
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Failed to reach 9router";
    logger.error(`[GET] ${apiPath} Error`, { error });
    logApiRequest("GET", apiPath, 502, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to reach 9router", details: error },
      { status: 502 },
    );
  }
}
