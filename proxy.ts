import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-DNS-Prefetch-Control": "on",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' wss://infinite-server.fly.dev wss://*.ts.net https://accounts.google.com https://github.com",
    "frame-ancestors 'none'",
  ].join("; "),
};

export default auth((req: NextRequest) => {
  const pathname = req.nextUrl.pathname;
  const publicPaths = [
    "/_next/",
    "/favicon",
    "/manifest.json",
    "/sw.js",
    "/icon",
    "/fonts/",
    "/api/auth/",
    "/",
  ];

  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  const response = isPublic ? NextResponse.next() : NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  if (isPublic) return response;
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};
