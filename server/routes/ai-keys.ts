import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

const ANTHROPIC_VERSION = "2023-06-01";
const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

function detectProviderType(name: string): "openai" | "anthropic" | null {
  const n = name.trim().toLowerCase();
  if (n === "openai") return "openai";
  if (n === "anthropic") return "anthropic";
  return null;
}

function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

// PATCH /api/ai-keys/:id
router.patch("/:id", async (req, res) => {
  const secret = getSecret();
  if (!secret) {
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const { id } = req.params;
  const label = String(req.body.label ?? "").trim();
  const apiKey = String(req.body.apiKey ?? "").trim();

  if (!apiKey) {
    res.status(400).json({ error: "API key is required" });
    return;
  }

  try {
    const existing = await prisma.aIKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const row = await prisma.aIKey.update({
      where: { id },
      data: { label, apiKeyEncrypted: encrypt(apiKey, secret) },
    });

    res.json({
      id: row.id,
      label: row.label,
      apiKey,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update API key";
    logger.error("[AIKeys] PATCH Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/ai-keys/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await prisma.aIKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await prisma.aIKey.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete API key";
    logger.error("[AIKeys] DELETE Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/ai-keys/:id/test
router.post("/:id/test", async (_req, res) => {
  const secret = getSecret();
  if (!secret) {
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const { id } = _req.params;

  try {
    const row = await prisma.aIKey.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: {
        id: true,
        apiKeyEncrypted: true,
        provider: { select: { name: true, baseUrl: true } },
      },
    });

    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const providerName = row.provider.name;
    const providerType = detectProviderType(providerName);

    if (!providerType) {
      res.status(400).json({
        error: "Key test only supported for providers named 'openai' or 'anthropic'. For custom providers, use the base URL directly.",
      });
      return;
    }

    const apiKey = decrypt(row.apiKeyEncrypted, secret);
    const baseUrl = row.provider.baseUrl || KNOWN_BASE_URLS[providerType];

    if (providerType === "openai") {
      const apiRes = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });

      if (!apiRes.ok) {
        const body = await apiRes.text();
        res.json({ ok: false, provider: providerName, status: apiRes.status, message: body || "OpenAI key test failed" });
        return;
      }

      const data = (await apiRes.json()) as { data?: unknown[] };
      res.json({
        ok: true,
        provider: providerName,
        status: 200,
        message: "OpenAI key valid",
        modelCount: Array.isArray(data.data) ? data.data.length : undefined,
      });
      return;
    }

    // anthropic
    const apiRes = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(8000),
    });

    if (!apiRes.ok) {
      const body = await apiRes.text();
      res.json({ ok: false, provider: providerName, status: apiRes.status, message: body || "Anthropic key test failed" });
      return;
    }

    const data = (await apiRes.json()) as { data?: unknown[] };
    res.json({
      ok: true,
      provider: providerName,
      status: 200,
      message: "Anthropic key valid",
      modelCount: Array.isArray(data.data) ? data.data.length : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to test API key";
    logger.error("[AIKeys] TEST Error", { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
