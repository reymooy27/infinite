import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "PATCH";
  const path = "/api/ai-keys/[id]";

  try {
    const secret = getSecret();
    if (!secret) {
      logApiRequest(method, path, 500, Date.now() - start);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const { id } = await params;
    const body = await req.json();
    const label = String(body.label ?? "").trim();
    const apiKey = String(body.apiKey ?? "").trim();

    if (!apiKey) {
      logApiRequest(method, path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    const existing = await prisma.aIKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = await prisma.aIKey.update({
      where: { id },
      data: {
        label,
        apiKeyEncrypted: encrypt(apiKey, secret),
      },
    });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({
      id: row.id,
      label: row.label,
      apiKey,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to update API key" },
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
  const path = "/api/ai-keys/[id]";

  try {
    const { id } = await params;
    const existing = await prisma.aIKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.aIKey.delete({ where: { id } });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 },
    );
  }
}
