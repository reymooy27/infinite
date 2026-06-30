import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

function normalizeProvider(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "PATCH";
  const path = "/api/ai-provider-keys/[id]";

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
    const provider = normalizeProvider(body.provider);
    const apiKey = String(body.apiKey ?? "").trim();

    if (!provider || !apiKey) {
      logApiRequest(method, path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Provider and API key are required" },
        { status: 400 },
      );
    }

    const existing = await prisma.aIProviderKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const duplicate = await prisma.aIProviderKey.findFirst({
      where: {
        id: { not: id },
        userId: LOCAL_USER_ID,
        provider: { equals: provider, mode: "insensitive" },
      },
    });

    if (duplicate) {
      logApiRequest(method, path, 409, Date.now() - start);
      return NextResponse.json(
        { error: "Provider already exists" },
        { status: 409 },
      );
    }

    const row = await prisma.aIProviderKey.update({
      where: { id },
      data: {
        provider,
        apiKeyEncrypted: encrypt(apiKey, secret),
      },
    });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({
      id: row.id,
      provider: row.provider,
      apiKey,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to update AI provider key" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "DELETE";
  const path = "/api/ai-provider-keys/[id]";

  try {
    const { id } = await params;
    const existing = await prisma.aIProviderKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true },
    });

    if (!existing) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.aIProviderKey.delete({ where: { id } });

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to delete AI provider key" },
      { status: 500 },
    );
  }
}
