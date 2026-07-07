import { proxyRouterUsage } from "@/lib/routerUsageProxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyRouterUsage(request, "/api/usage/chart", "/api/router-usage/chart");
}
