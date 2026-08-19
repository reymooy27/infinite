import { Router } from "express";
import webpush from "web-push";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const LOCAL_USER_ID = "local-user";
const router = Router();

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const PUSH_TOKEN = process.env.PUSH_TOKEN || "";
const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@localhost",
    PUBLIC_KEY,
    PRIVATE_KEY,
  );
} else {
  logger.warn("[Push] VAPID keys missing — push disabled");
}

// GET /api/push/key — public VAPID key for the browser's subscribe() call
router.get("/key", (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY, enabled: configured });
});

// POST /api/push/subscribe — store a browser push subscription
router.post("/subscribe", async (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (
    typeof endpoint !== "string" ||
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 1000 ||
    typeof keys?.p256dh !== "string" ||
    keys.p256dh.length > 200 ||
    typeof keys?.auth !== "string" ||
    keys.auth.length > 100
  ) {
    res.status(400).json({ error: "Invalid subscription" });
    return;
  }

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: LOCAL_USER_ID },
      update: { p256dh: keys.p256dh, auth: keys.auth },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save subscription";
    logger.error("[Push] subscribe Error", { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/push/subscribe — drop a subscription (user turned notifications off)
router.delete("/subscribe", async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== "string") {
    res.status(400).json({ error: "endpoint required" });
    return;
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  res.json({ ok: true });
});

// POST /api/push/notify — fan out to every stored subscription.
// Bearer PUSH_TOKEN required: this endpoint is what the Claude Code Stop hook calls.
router.post("/notify", async (req, res) => {
  if (!PUSH_TOKEN || req.headers.authorization !== `Bearer ${PUSH_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!configured) {
    res.status(503).json({ error: "Push not configured" });
    return;
  }

  const title = String(req.body?.title ?? "Claude Code").slice(0, 100);
  const body = String(req.body?.body ?? "Proses selesai").slice(0, 300);
  const url = typeof req.body?.url === "string" ? req.body.url.slice(0, 500) : "/";
  const payload = JSON.stringify({ title, body, url });

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: LOCAL_USER_ID },
  });

  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // 404/410 = subscription revoked by the push service; prune it.
        if (code === 404 || code === 410) stale.push(s.endpoint);
        else
          logger.error("[Push] send failed", {
            error: err instanceof Error ? err.message : String(err),
          });
      }
    }),
  );

  if (stale.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: stale } } });
  }

  res.json({ sent, pruned: stale.length, total: subs.length });
});

export default router;
