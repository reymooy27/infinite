import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { GitActionError, getGitStatus, getCommitDiff, runGitAction, } from "./git-lib.js";
const LOCAL_USER_ID = "local-user";
const router = Router();
// GET /api/projects
router.get("/", async (_req, res) => {
    try {
        const projects = await prisma.project.findMany({
            where: { userId: LOCAL_USER_ID },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, directory: true, isDefault: true, createdAt: true, updatedAt: true },
        });
        res.json(projects);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch projects" });
    }
});
// POST /api/projects
router.post("/", async (req, res) => {
    try {
        const { name, directory } = req.body;
        if (!name || typeof name !== "string") {
            res.status(400).json({ error: "name is required" });
            return;
        }
        const existing = await prisma.project.count({ where: { userId: LOCAL_USER_ID } });
        let canvasData = { windows: [] };
        if (existing === 0) {
            const layout = await prisma.layout.findFirst({
                where: { userId: LOCAL_USER_ID },
                orderBy: { updatedAt: "desc" },
            });
            if (layout?.data)
                canvasData = layout.data;
        }
        const project = await prisma.project.create({
            data: {
                name,
                userId: LOCAL_USER_ID,
                isDefault: existing === 0,
                canvasData,
                ...(directory && typeof directory === "string" && { directory }),
            },
        });
        res.json(project);
    }
    catch {
        res.status(500).json({ error: "Failed to create project" });
    }
});
// GET /api/projects/:id
router.get("/:id", async (req, res) => {
    try {
        const project = await prisma.project.findFirst({
            where: { id: req.params.id, userId: LOCAL_USER_ID },
        });
        if (!project) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        res.json(project);
    }
    catch {
        res.status(500).json({ error: "Failed to fetch project" });
    }
});
// PATCH /api/projects/:id
router.patch("/:id", async (req, res) => {
    try {
        const { name, directory } = req.body;
        if (!name || typeof name !== "string") {
            res.status(400).json({ error: "name is required" });
            return;
        }
        const updated = await prisma.project.updateMany({
            where: { id: req.params.id, userId: LOCAL_USER_ID },
            data: {
                name,
                ...(directory !== undefined && { directory: directory || null }),
            },
        });
        if (updated.count === 0) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        res.json({ ok: true });
    }
    catch {
        res.status(500).json({ error: "Failed to update project" });
    }
});
// DELETE /api/projects/:id
router.delete("/:id", async (req, res) => {
    try {
        const count = await prisma.project.count({ where: { userId: LOCAL_USER_ID } });
        if (count <= 1) {
            res.status(409).json({ error: "Cannot delete the last project" });
            return;
        }
        await prisma.project.deleteMany({ where: { id: req.params.id, userId: LOCAL_USER_ID } });
        res.json({ ok: true });
    }
    catch {
        res.status(500).json({ error: "Failed to delete project" });
    }
});
// GET /api/projects/:id/canvas
router.get("/:id/canvas", async (req, res) => {
    try {
        const project = await prisma.project.findFirst({
            where: { id: req.params.id, userId: LOCAL_USER_ID },
            select: { canvasData: true, canvasTransform: true },
        });
        if (!project) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        const canvasData = project.canvasData;
        res.json({
            windows: Array.isArray(canvasData?.windows) ? canvasData.windows : [],
            canvasTransform: project.canvasTransform ?? null,
        });
    }
    catch {
        res.status(500).json({ error: "Failed to fetch canvas" });
    }
});
// POST /api/projects/:id/canvas
router.post("/:id/canvas", async (req, res) => {
    try {
        const { windows, canvasTransform } = req.body;
        const updated = await prisma.project.updateMany({
            where: { id: req.params.id, userId: LOCAL_USER_ID },
            data: {
                canvasData: { windows: windows ?? [] },
                ...(canvasTransform !== undefined && { canvasTransform }),
            },
        });
        if (updated.count === 0) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        res.json({ ok: true });
    }
    catch {
        res.status(500).json({ error: "Failed to save canvas" });
    }
});
// GET /api/projects/:id/git-status
router.get("/:id/git-status", async (req, res) => {
    try {
        const requestedDirectory = req.query.directory?.trim() || null;
        const connectionIdParam = req.query.connectionId;
        const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;
        const payload = await getGitStatus({
            projectId: req.params.id,
            requestedDirectory,
            connectionId,
        });
        res.json(payload);
    }
    catch (error) {
        if (error instanceof GitActionError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Failed to fetch git status" });
    }
});
// GET /api/projects/:id/git/diff
router.get("/:id/git/diff", async (req, res) => {
    try {
        const file = req.query.file?.trim();
        const directory = req.query.directory?.trim() || null;
        const connectionIdParam = req.query.connectionId;
        const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;
        const staged = req.query.staged === "true";
        if (!file) {
            res.status(400).json({ error: "File path is required" });
            return;
        }
        const { createExecutionContext, execGitOrThrow } = await import("./git-lib.js");
        const ctx = await createExecutionContext(req.params.id, directory, connectionId);
        const statusOutput = await execGitOrThrow(ctx, ["status", "--short", "--", file]);
        const isUntracked = statusOutput.startsWith("??");
        let diff;
        if (isUntracked) {
            diff = await execGitOrThrow(ctx, ["diff", "--no-color", "--no-index", "/dev/null", file]).catch(() => {
                return execGitOrThrow(ctx, ["show", `:${file}`]).catch(() => "Unable to read file content");
            });
        }
        else {
            const args = ["diff", "--no-color"];
            if (staged)
                args.push("--cached");
            args.push("--", file);
            diff = await execGitOrThrow(ctx, args);
        }
        res.json({ diff });
    }
    catch (error) {
        if (error instanceof GitActionError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Failed to fetch diff" });
    }
});
// GET /api/projects/:id/git/commit-diff
router.get("/:id/git/commit-diff", async (req, res) => {
    try {
        const hash = req.query.hash?.trim();
        const directory = req.query.directory?.trim() || null;
        const connectionIdParam = req.query.connectionId;
        const connectionId = connectionIdParam ? Number.parseInt(connectionIdParam, 10) : null;
        if (!hash) {
            res.status(400).json({ error: "Commit hash is required" });
            return;
        }
        const result = await getCommitDiff({
            projectId: req.params.id,
            hash,
            requestedDirectory: directory,
            connectionId,
        });
        res.json(result);
    }
    catch (error) {
        if (error instanceof GitActionError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Failed to fetch commit diff" });
    }
});
// POST /api/projects/:id/git/action
router.post("/:id/git/action", async (req, res) => {
    try {
        const body = req.body;
        if (!body.action) {
            res.status(400).json({ error: "Git action is required" });
            return;
        }
        const result = await runGitAction({
            projectId: req.params.id,
            requestedDirectory: body.directory?.trim() || null,
            connectionId: typeof body.connectionId === "number" && Number.isFinite(body.connectionId)
                ? body.connectionId
                : null,
            action: body.action,
            paths: body.paths,
            message: body.message,
            branch: body.branch,
        });
        res.json(result);
    }
    catch (error) {
        if (error instanceof GitActionError) {
            res.status(error.statusCode).json({
                ok: false,
                error: error.message,
                stdout: error.stdout,
                stderr: error.stderr,
            });
            return;
        }
        res.status(500).json({ ok: false, error: "Failed to run git action", stdout: "", stderr: "" });
    }
});
export default router;
