import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

// GET /api/notes
router.get("/", async (_req, res) => {
  try {
    const notes = await prisma.note.findMany({
      where: { userId: LOCAL_USER_ID },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });
    res.json(notes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch notes";
    logger.error("[Notes] GET Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/notes
router.post("/", async (req, res) => {
  const { title, content } = req.body;
  try {
    const note = await prisma.note.create({
      data: { title: title || "Untitled", content: content || "", userId: LOCAL_USER_ID },
    });
    res.status(201).json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create note";
    logger.error("[Notes] POST Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/notes/:id
router.get("/:id", async (req, res) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch note";
    logger.error("[Notes] GET by id Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// PATCH /api/notes/:id
router.patch("/:id", async (req, res) => {
  const { title, content } = req.body;
  const data: Record<string, string> = {};
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const note = await prisma.note.update({ where: { id: req.params.id }, data });
    res.json(note);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Record to update does not exist")) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to update note";
    logger.error("[Notes] PATCH Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res) => {
  try {
    await prisma.note.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Record to delete does not exist")) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to delete note";
    logger.error("[Notes] DELETE Error", { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
