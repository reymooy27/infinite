import { auth } from "@/lib/auth";
import type { NextRequest } from "next/server";

export default auth((req: NextRequest) => {
  // Allow public routes
  const pathname = req.nextUrl.pathname;
  const publicPaths = [
    "/_next/",
    "/favicon",
    "/manifest.json",
    "/sw.js",
    "/icon.svg",
    "/fonts/",
    "/api/auth/",
    "/",
  ];

  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  if (isPublic) return;

  return Response.json({ error: "Unauthorized" }, { status: 401 });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon).*)"],
};
