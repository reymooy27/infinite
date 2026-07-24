import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

// GET /api/agents
router.get("/", async (_req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, token: true, createdAt: true },
    });
    res.json(agents);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch agents";
    res.status(500).json({ error: message });
  }
});

// POST /api/agents
router.post("/", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  try {
    const agent = await prisma.agent.create({
      data: { name: String(name).trim().slice(0, 100), token: randomUUID(), userId: LOCAL_USER_ID },
      select: { id: true, name: true, token: true, createdAt: true },
    });
    res.status(201).json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create agent";
    res.status(500).json({ error: message });
  }
});

// GET /api/agents/status
router.get("/status", async (_req, res) => {
  const wsUrl = process.env.PUBLIC_SERVER_URL || process.env.VITE_WS_URL?.replace("wss://", "https://").replace("ws://", "http://");
  if (!wsUrl) {
    res.json({ online: [] });
    return;
  }

  try {
    const agents = await prisma.agent.findMany({
      where: { userId: LOCAL_USER_ID },
      select: { id: true },
    });
    const ids = agents.map((a) => a.id);

    const statusRes = await fetch(`${wsUrl}/api/agents/online`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(3000),
    });
    if (!statusRes.ok) {
      res.json({ online: [] });
      return;
    }
    res.json(await statusRes.json());
  } catch {
    res.json({ online: [] });
  }
});

// DELETE /api/agents/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await prisma.agent.deleteMany({ where: { id, userId: LOCAL_USER_ID } });
    if (deleted.count === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete agent";
    res.status(500).json({ error: message });
  }
});

export default router;
