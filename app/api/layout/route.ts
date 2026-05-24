import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/layout";

  try {
    const layout = await prisma.layout.findFirst({
      where: { userId: LOCAL_USER_ID },
      orderBy: { updatedAt: "desc" },
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
    const body = await req.json();

    const existing = await prisma.layout.findFirst({
      where: { userId: LOCAL_USER_ID },
      orderBy: { updatedAt: "desc" },
    });

    const layout = existing
      ? await prisma.layout.update({
          where: { id: existing.id },
          data: { data: body },
        })
      : await prisma.layout.create({
          data: { userId: LOCAL_USER_ID, data: body },
        });

    const duration = Date.now() - start;
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
