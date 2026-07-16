import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
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

function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

export async function GET() {
  const start = Date.now();
  const method = "GET";
  const path = "/api/ai-providers";

  try {
    const secret = getSecret();
    if (!secret) {
      logApiRequest(method, path, 500, Date.now() - start);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const rows = await prisma.aIProvider.findMany({
      where: { userId: LOCAL_USER_ID },
      include: { keys: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });

    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      keys: row.keys.map((k) => ({
        id: k.id,
        label: k.label,
        apiKey: decrypt(k.apiKeyEncrypted, secret),
        createdAt: k.createdAt.toISOString(),
        updatedAt: k.updatedAt.toISOString(),
      })),
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
      { error: "Failed to fetch AI providers" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/ai-providers";

  try {
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
      where: {
        userId: LOCAL_USER_ID,
        name: { equals: name },
      },
    });

    if (!existing) {
      const matches = await prisma.aIProvider.findMany({
        where: { userId: LOCAL_USER_ID },
        select: { name: true },
      });
      if (matches.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
        logApiRequest(method, path, 409, Date.now() - start);
        return NextResponse.json(
          { error: "Provider already exists" },
          { status: 409 },
        );
      }
    }

    if (existing) {
      logApiRequest(method, path, 409, Date.now() - start);
      return NextResponse.json(
        { error: "Provider already exists" },
        { status: 409 },
      );
    }

    const row = await prisma.aIProvider.create({
      data: {
        name,
        baseUrl,
        userId: LOCAL_USER_ID,
      },
    });

    logApiRequest(method, path, 201, Date.now() - start);
    return NextResponse.json(
      {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        keys: [],
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
      { error: "Failed to create AI provider" },
      { status: 500 },
    );
  }
}
