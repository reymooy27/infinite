import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/connections/[id]";

  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);

    if (isNaN(connectionId)) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "Invalid connection ID" }, { status: 400 });
    }

    const existing = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { userId: true },
    });

    if (!existing || existing.userId !== LOCAL_USER_ID) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.connection.delete({ where: { id: connectionId } });

    const duration = Date.now() - start;
    logger.info(`[${method}] ${path} Deleted connection ${connectionId}`);
    logApiRequest(method, path, 200, duration);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
