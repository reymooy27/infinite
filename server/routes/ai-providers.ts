import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
}
function normalizeBaseUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}
function getSecret() {
  return process.env.ENCRYPTION_SECRET;
}

// GET /api/ai-providers
router.get("/", async (_req, res) => {
  try {
    const secret = getSecret();
    if (!secret) {
      res.status(500).json({ error: "Server configuration error" });
      return;
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

    res.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch AI providers";
    logger.error("[AIProviders] GET Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/ai-providers
router.post("/", async (req, res) => {
  const name = normalizeName(req.body.name);
  const baseUrl = normalizeBaseUrl(req.body.baseUrl);

  if (!name) {
    res.status(400).json({ error: "Provider name is required" });
    return;
  }

  try {
    const existing = await prisma.aIProvider.findFirst({
      where: { userId: LOCAL_USER_ID, name: { equals: name } },
    });

    if (!existing) {
      const matches = await prisma.aIProvider.findMany({
        where: { userId: LOCAL_USER_ID },
        select: { name: true },
      });
      if (matches.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
        res.status(409).json({ error: "Provider already exists" });
        return;
      }
    }

    if (existing) {
      res.status(409).json({ error: "Provider already exists" });
      return;
    }

    const row = await prisma.aIProvider.create({
      data: { name, baseUrl, userId: LOCAL_USER_ID },
    });

    res.status(201).json({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      keys: [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create AI provider";
    logger.error("[AIProviders] POST Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// PATCH /api/ai-providers/:id
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const name = normalizeName(req.body.name);
  const baseUrl = normalizeBaseUrl(req.body.baseUrl);

  if (!name) {
    res.status(400).json({ error: "Provider name is required" });
    return;
  }

  try {
    const existing = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const matches = await prisma.aIProvider.findMany({
      where: { userId: LOCAL_USER_ID, id: { not: id } },
      select: { name: true },
    });
    if (matches.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ error: "Provider name already exists" });
      return;
    }

    const row = await prisma.aIProvider.update({ where: { id }, data: { name, baseUrl } });

    res.json({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update AI provider";
    logger.error("[AIProviders] PATCH Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/ai-providers/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await prisma.aIProvider.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete AI provider";
    logger.error("[AIProviders] DELETE Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/ai-providers/:id/keys
router.post("/:id/keys", async (req, res) => {
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
    const provider = await prisma.aIProvider.findFirst({
      where: { id, userId: LOCAL_USER_ID },
    });

    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    const row = await prisma.aIKey.create({
      data: {
        label,
        apiKeyEncrypted: encrypt(apiKey, secret),
        providerId: id,
        userId: LOCAL_USER_ID,
      },
    });

    res.status(201).json({
      id: row.id,
      label: row.label,
      apiKey,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add API key";
    logger.error("[AIProviders] POST key Error", { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
