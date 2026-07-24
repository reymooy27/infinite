import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
const LOCAL_USER_ID = "local-user";
const router = Router();
// GET /api/layout
router.get("/", async (_req, res) => {
    try {
        const layout = await prisma.layout.findFirst({
            where: { userId: LOCAL_USER_ID },
            orderBy: { updatedAt: "desc" },
        });
        res.json(layout?.data || { windows: [] });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch layout";
        logger.error("[Layout] GET Error", { error: message });
        res.status(500).json({ error: message });
    }
});
// POST /api/layout
router.post("/", async (req, res) => {
    try {
        const existing = await prisma.layout.findFirst({
            where: { userId: LOCAL_USER_ID },
            orderBy: { updatedAt: "desc" },
        });
        const layout = existing
            ? await prisma.layout.update({ where: { id: existing.id }, data: { data: req.body } })
            : await prisma.layout.create({ data: { userId: LOCAL_USER_ID, data: req.body } });
        res.json(layout.data);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save layout";
        logger.error("[Layout] POST Error", { error: message });
        res.status(500).json({ error: message });
    }
});
export default router;
