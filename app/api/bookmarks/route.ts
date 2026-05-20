import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/bookmarks";

  try {
    logger.info(`[${method}] ${path} Start`);

    const bookmarks = await prisma.bookmark.findMany({
      orderBy: { createdAt: "desc" },
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(bookmarks);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to fetch bookmarks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/bookmarks";

  try {
    logger.info(`[${method}] ${path} Start`);

    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      const duration = Date.now() - start;
      logger.warn(`[${method}] ${path} Validation failed: missing url`);
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Missing required field: url" }, { status: 400 });
    }

    const existing = await prisma.bookmark.findFirst({ where: { url } });
    if (existing) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 200, duration);
      return NextResponse.json(existing);
    }

    const bookmark = await prisma.bookmark.create({ data: { url } });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Created bookmark ${bookmark.id}`);
    logApiRequest(method, path, 201, duration);
    return NextResponse.json(bookmark, { status: 201 });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to create bookmark" }, { status: 500 });
  }
}
