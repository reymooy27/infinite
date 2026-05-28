import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "GET";
  const path = "/api/notes/[id]";

  try {
    const { id } = await params;

    const note = await prisma.note.findUnique({ where: { id } });

    if (!note) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 404, duration);
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(note);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, duration, err);
    return NextResponse.json({ error: "Failed to fetch note" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "PATCH";
  const path = "/api/notes/[id]";

  try {
    const { id } = await params;
    const body = await req.json();
    const { title, content } = body;

    const data: Record<string, string> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;

    if (Object.keys(data).length === 0) {
      const duration = Date.now() - start;
      logApiRequest(method, path, 400, duration);
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const note = await prisma.note.update({
      where: { id },
      data,
    });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json(note);
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);

    if (err instanceof Error && err.message.includes("Record to update does not exist")) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/notes/[id]";

  try {
    const { id } = await params;

    await prisma.note.delete({ where: { id } });

    const duration = Date.now() - start;
    logApiRequest(method, path, 200, duration);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = Date.now() - start;
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error, stack: err instanceof Error ? err.stack : undefined });
    logApiRequest(method, path, 500, duration, err);

    if (err instanceof Error && err.message.includes("Record to delete does not exist")) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
