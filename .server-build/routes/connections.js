import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { encrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
const LOCAL_USER_ID = "local-user";
const router = Router();
const connectionSelect = {
    id: true,
    name: true,
    host: true,
    port: true,
    username: true,
    authType: true,
    agentId: true,
    createdAt: true,
};
// GET /api/connections
router.get("/", async (_req, res) => {
    try {
        const connections = await prisma.connection.findMany({
            where: { userId: LOCAL_USER_ID },
            orderBy: { createdAt: "desc" },
            select: connectionSelect,
        });
        res.json({ connections, limit: 999, plan: "local" });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch connections";
        logger.error("[Connections] GET Error", { error: message });
        res.status(500).json({ error: message });
    }
});
// POST /api/connections
router.post("/", async (req, res) => {
    const { name, host, port, username, authType, password, privateKey, agentId } = req.body;
    if (!name || !host || !username) {
        res.status(400).json({ error: "Missing required fields: name, host, username" });
        return;
    }
    const trimmedName = String(name).trim().slice(0, 100);
    const rawHost = String(host).trim();
    const trimmedHost = (rawHost.includes("://") ? new URL(rawHost.startsWith("http") ? rawHost : `https://${rawHost}`).hostname : rawHost).slice(0, 255);
    const trimmedUsername = String(username).trim().slice(0, 64);
    const parsedPort = Math.min(65535, Math.max(1, parseInt(port) || 22));
    if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmedHost)) {
        res.status(400).json({ error: "Invalid hostname" });
        return;
    }
    if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedUsername)) {
        res.status(400).json({ error: "Invalid username" });
        return;
    }
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
        logger.error("[Connections] POST Error: ENCRYPTION_SECRET not set");
        res.status(500).json({ error: "Server configuration error" });
        return;
    }
    try {
        const connection = await prisma.connection.create({
            data: {
                name: trimmedName,
                host: trimmedHost,
                port: parsedPort,
                username: trimmedUsername,
                authType: authType === "key" ? "key" : "password",
                passwordEncrypted: password ? encrypt(password, secret) : null,
                privateKeyEncrypted: privateKey ? encrypt(privateKey, secret) : null,
                agentId: agentId || null,
                userId: LOCAL_USER_ID,
            },
            select: connectionSelect,
        });
        logger.info(`[Connections] Created connection ${connection.id}`);
        res.status(201).json(connection);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create connection";
        logger.error("[Connections] POST Error", { error: message });
        res.status(500).json({ error: message });
    }
});
// PATCH /api/connections/:id
router.patch("/:id", async (req, res) => {
    const connectionId = parseInt(req.params.id, 10);
    if (isNaN(connectionId)) {
        res.status(400).json({ error: "Invalid connection ID" });
        return;
    }
    try {
        const existing = await prisma.connection.findUnique({
            where: { id: connectionId },
            select: { id: true, userId: true, authType: true, passwordEncrypted: true, privateKeyEncrypted: true },
        });
        if (!existing || existing.userId !== LOCAL_USER_ID) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        const { name, host, port, username, authType, password, privateKey, agentId } = req.body;
        if (!name || !host || !username) {
            res.status(400).json({ error: "Missing required fields: name, host, username" });
            return;
        }
        const trimmedName = String(name).trim().slice(0, 100);
        const rawHost = String(host).trim();
        const trimmedHost = (rawHost.includes("://") ? new URL(rawHost.startsWith("http") ? rawHost : `https://${rawHost}`).hostname : rawHost).slice(0, 255);
        const trimmedUsername = String(username).trim().slice(0, 64);
        const parsedPort = Math.min(65535, Math.max(1, parseInt(port) || 22));
        const normalizedAuthType = authType === "key" ? "key" : "password";
        if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmedHost)) {
            res.status(400).json({ error: "Invalid hostname" });
            return;
        }
        if (!/^[a-zA-Z0-9._\-]+$/.test(trimmedUsername)) {
            res.status(400).json({ error: "Invalid username" });
            return;
        }
        const secret = process.env.ENCRYPTION_SECRET;
        if (!secret) {
            logger.error("[Connections] PATCH Error: ENCRYPTION_SECRET not set");
            res.status(500).json({ error: "Server configuration error" });
            return;
        }
        let passwordEncrypted = null;
        let privateKeyEncrypted = null;
        if (normalizedAuthType === "password") {
            if (typeof password === "string" && password.trim()) {
                passwordEncrypted = encrypt(password, secret);
            }
            else if (existing.authType === "password" && existing.passwordEncrypted) {
                passwordEncrypted = existing.passwordEncrypted;
            }
            else {
                res.status(400).json({ error: "Password is required for password auth" });
                return;
            }
        }
        else {
            if (typeof privateKey === "string" && privateKey.trim()) {
                privateKeyEncrypted = encrypt(privateKey, secret);
            }
            else if (existing.authType === "key" && existing.privateKeyEncrypted) {
                privateKeyEncrypted = existing.privateKeyEncrypted;
            }
            else {
                res.status(400).json({ error: "Private key is required for key auth" });
                return;
            }
        }
        const connection = await prisma.connection.update({
            where: { id: connectionId },
            data: {
                name: trimmedName,
                host: trimmedHost,
                port: parsedPort,
                username: trimmedUsername,
                authType: normalizedAuthType,
                passwordEncrypted,
                privateKeyEncrypted,
                agentId: agentId || null,
            },
            select: connectionSelect,
        });
        logger.info(`[Connections] Updated connection ${connectionId}`);
        res.json(connection);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update connection";
        logger.error("[Connections] PATCH Error", { error: message });
        res.status(500).json({ error: message });
    }
});
// DELETE /api/connections/:id
router.delete("/:id", async (req, res) => {
    const connectionId = parseInt(req.params.id, 10);
    if (isNaN(connectionId)) {
        res.status(400).json({ error: "Invalid connection ID" });
        return;
    }
    try {
        const existing = await prisma.connection.findUnique({
            where: { id: connectionId },
            select: { userId: true },
        });
        if (!existing || existing.userId !== LOCAL_USER_ID) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        await prisma.connection.delete({ where: { id: connectionId } });
        logger.info(`[Connections] Deleted connection ${connectionId}`);
        res.json({ ok: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete connection";
        logger.error("[Connections] DELETE Error", { error: message });
        res.status(500).json({ error: message });
    }
});
export default router;
