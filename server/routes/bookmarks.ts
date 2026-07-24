import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

// GET /api/bookmarks
router.get("/", async (_req, res) => {
  try {
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { createdAt: "desc" },
    });
    res.json(bookmarks);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch bookmarks";
    logger.error("[Bookmarks] GET Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/bookmarks
router.post("/", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing required field: url" });
    return;
  }

  try {
    const existing = await prisma.bookmark.findFirst({ where: { url, userId: LOCAL_USER_ID } });
    if (existing) {
      res.json(existing);
      return;
    }
    const bookmark = await prisma.bookmark.create({ data: { url, userId: LOCAL_USER_ID } });
    res.status(201).json(bookmark);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create bookmark";
    logger.error("[Bookmarks] POST Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/bookmarks/:id
router.delete("/:id", async (req, res) => {
  const bookmarkId = parseInt(req.params.id, 10);
  if (isNaN(bookmarkId)) {
    res.status(400).json({ error: "Invalid bookmark ID" });
    return;
  }

  try {
    await prisma.bookmark.delete({ where: { id: bookmarkId } });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Record to delete does not exist")) {
      res.status(404).json({ error: "Bookmark not found" });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to delete bookmark";
    logger.error("[Bookmarks] DELETE Error", { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
