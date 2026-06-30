import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { logger, logApiRequest } from "@/lib/logger";
import { LOCAL_USER_ID } from "@/lib/auth";

const ANTHROPIC_VERSION = "2023-06-01";

function detectProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai") return "openai";
  if (normalized === "anthropic") return "anthropic";
  return null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const start = Date.now();
  const method = "POST";
  const path = "/api/ai-provider-keys/[id]/test";

  try {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
      logApiRequest(method, path, 500, Date.now() - start);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const { id } = await params;
    const row = await prisma.aIProviderKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: {
        id: true,
        provider: true,
        apiKeyEncrypted: true,
      },
    });

    if (!row) {
      logApiRequest(method, path, 404, Date.now() - start);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const providerType = detectProvider(row.provider);
    if (!providerType) {
      logApiRequest(method, path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Provider test supported only for OpenAI and Anthropic" },
        { status: 400 },
      );
    }

    const apiKey = decrypt(row.apiKeyEncrypted, secret);

    if (providerType === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const body = await res.text();
        logApiRequest(method, path, res.status, Date.now() - start);
        return NextResponse.json(
          {
            ok: false,
            provider: row.provider,
            status: res.status,
            message: body || "OpenAI key test failed",
          },
          { status: 200 },
        );
      }

      const data = await res.json();
      logApiRequest(method, path, 200, Date.now() - start);
      return NextResponse.json({
        ok: true,
        provider: row.provider,
        status: 200,
        message: "OpenAI key valid",
        modelCount: Array.isArray(data.data) ? data.data.length : undefined,
      });
    }

    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const body = await res.text();
      logApiRequest(method, path, res.status, Date.now() - start);
      return NextResponse.json(
        {
          ok: false,
          provider: row.provider,
          status: res.status,
          message: body || "Anthropic key test failed",
        },
        { status: 200 },
      );
    }

    const data = await res.json();
    logApiRequest(method, path, 200, Date.now() - start);
    return NextResponse.json({
      ok: true,
      provider: row.provider,
      status: 200,
      message: "Anthropic key valid",
      modelCount: Array.isArray(data.data) ? data.data.length : undefined,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error(`[${method}] ${path} Error`, { error });
    logApiRequest(method, path, 500, Date.now() - start, err);
    return NextResponse.json(
      { error: "Failed to test AI provider key" },
      { status: 500 },
    );
  }
}
