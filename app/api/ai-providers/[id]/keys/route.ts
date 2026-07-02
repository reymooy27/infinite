import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/ai-providers/[id]/keys";

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

    const provider = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!provider) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const row = await prisma.aIKey.create({
      data: {
        label,
        apiKeyEncrypted: encrypt(apiKey, secret),
        providerId: id,
        userId: LOCAL_USER_ID,
      },
    });

    logApiRequest(method, path, 201, Date.now() - start);
    return NextResponse.json(
      {
        id: row.id,
        label: row.label,
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
      { error: "Failed to add API key" },
      { status: 500 },
    );
  }
}
