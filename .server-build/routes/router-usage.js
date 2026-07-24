import { Router } from "express";
import { logger } from "../lib/logger.js";
const DEFAULT_ROUTER_USAGE_BASE_URL = "https://api.9router.com";
const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);
function isRouterUsagePeriod(value) {
    return VALID_PERIODS.has(value);
}
function normalizeRouterUsageBaseUrl(raw) {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed)
        return DEFAULT_ROUTER_USAGE_BASE_URL;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
        return trimmed;
    return `https://${trimmed}`;
}
const router = Router();
async function proxyRouterUsage(req, res, path, apiPath) {
    const period = req.query.period || "7d";
    if (!isRouterUsagePeriod(period)) {
        res.status(400).json({ error: "Invalid period" });
        return;
    }
    const baseUrl = normalizeRouterUsageBaseUrl(req.query.baseUrl ||
        process.env.ROUTER_USAGE_BASE_URL ||
        DEFAULT_ROUTER_USAGE_BASE_URL);
    let upstream;
    try {
        upstream = new URL(`${baseUrl}${path}`);
        upstream.searchParams.set("period", period);
        if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
            throw new Error("Invalid protocol");
        }
    }
    catch {
        res.status(400).json({ error: "Invalid 9router URL" });
        return;
    }
    try {
        const apiRes = await fetch(upstream, {
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        const text = await apiRes.text();
        let body;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch {
            body = text;
        }
        if (!apiRes.ok) {
            const errorMessage = typeof body === "object" && body && "error" in body
                ? String(body.error)
                : `9router responded with ${apiRes.status}`;
            res.status(apiRes.status).json({ error: errorMessage, upstreamStatus: apiRes.status, baseUrl });
            return;
        }
        res.setHeader("x-router-usage-base-url", baseUrl);
        res.json(body);
    }
    catch (err) {
        const error = err instanceof Error ? err.message : "Failed to reach 9router";
        logger.error(`[RouterUsage] ${apiPath} Error`, { error });
        res.status(502).json({ error: "Failed to reach 9router", details: error });
    }
}
// GET /api/router-usage/chart
router.get("/chart", (req, res) => proxyRouterUsage(req, res, "/api/usage/chart", "/api/router-usage/chart"));
// GET /api/router-usage/stats
router.get("/stats", (req, res) => proxyRouterUsage(req, res, "/api/usage/stats", "/api/router-usage/stats"));
export default router;
