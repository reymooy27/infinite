import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/bookmarks/[id]";

  try {
    const { id } = await params;
    const bookmarkId = parseInt(id, 10);

    if (isNaN(bookmarkId)) {
      const duration = Date.now() - start;
      logger.warn(`[${method}] ${path} Invalid ID: ${id}`);
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid bookmark ID" }, { status: 400 });
    }

    logger.info(`[${method}] ${path} Deleting bookmark ${bookmarkId}`);

    await prisma.bookmark.delete({ where: { id: bookmarkId } });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Deleted bookmark ${bookmarkId}`);
    logApiRequest(method, path, 200, duration);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);

    if (err instanceof Error && err.message.includes("Record to delete does not exist")) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to delete bookmark" }, { status: 500 });
  }
}
