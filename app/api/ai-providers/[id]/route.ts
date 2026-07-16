import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

function normalizeName(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function normalizeBaseUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "PATCH";
  const path = "/api/ai-providers/[id]";

  try {
    const { id } = await params;
    const body = await req.json();
    const name = normalizeName(body.name);
    const baseUrl = normalizeBaseUrl(body.baseUrl);

    if (!name) {
      logApiRequest(method, path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Provider name is required" },
        { status: 400 },
      );
    }

    const existing = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const matches = await prisma.aIProvider.findMany({
      where: { userId: LOCAL_USER_ID, id: { not: id } },
      select: { name: true },
    });
    const duplicate = matches.some((m) => m.name.toLowerCase() === name.toLowerCase());

    if (duplicate) {
      logApiRequest(method, path, 409, Date.now() - start);
      return NextResponse.json(
        { error: "Provider name already exists" },
        { status: 409 },
      );
    }

    const row = await prisma.aIProvider.update({
      where: { id },
      data: { name, baseUrl },
    });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to update AI provider" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/ai-providers/[id]";

  try {
    const { id } = await params;
    const existing = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.aIProvider.delete({ where: { id } });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to delete AI provider" },
      { status: 500 },
    );
  }
}
