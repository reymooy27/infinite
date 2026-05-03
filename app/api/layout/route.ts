import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/layout";

  try {
    logger.info(`[${method}] ${path} Start`);

    const layout = await prisma.layout.findUnique({
      where: { id: 1 },
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(layout?.data || { windows: [] });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to fetch layout" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/layout";

  try {
    logger.info(`[${method}] ${path} Start`);

    const body = await req.json();
    
    const layout = await prisma.layout.upsert({
      where: { id: 1 },
      update: { data: body },
      create: { id: 1, data: body },
    });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Saved layout`);
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(layout.data);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to save layout" }, { status: 500 });
  }
}
