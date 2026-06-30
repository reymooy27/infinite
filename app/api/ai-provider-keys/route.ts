import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
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

export async function GET() {
  const start = Date.now();
  const method = "GET";
  const path = "/api/ai-provider-keys";

  try {
    const secret = getSecret();
    if (!secret) {
      logApiRequest(method, path, 500, Date.now() - start);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const rows = await prisma.aIProviderKey.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { updatedAt: "desc" },
    });

    const items = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      apiKey: decrypt(row.apiKeyEncrypted, secret),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));

    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json(items);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to fetch AI provider keys" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/ai-provider-keys";

  try {
    const secret = getSecret();
    if (!secret) {
      logApiRequest(method, path, 500, Date.now() - start);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

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
      where: {
        userId: LOCAL_USER_ID,
        provider: { equals: provider, mode: "insensitive" },
      },
    });

    if (existing) {
      logApiRequest(method, path, 409, Date.now() - start);
      return NextResponse.json(
        { error: "Provider already exists" },
        { status: 409 },
      );
    }

    const row = await prisma.aIProviderKey.create({
      data: {
        provider,
        apiKeyEncrypted: encrypt(apiKey, secret),
        userId: LOCAL_USER_ID,
      },
    });

    logApiRequest(method, path, 201, Date.now() - start);
    return NextResponse.json(
      {
        id: row.id,
        provider: row.provider,
        apiKey,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to create AI provider key" },
      { status: 500 },
    );
  }
}
