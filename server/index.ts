import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import url from "url";
import { prisma } from "./lib/prisma";
import { decrypt } from "./lib/crypto";
import { createSSHSocket } from "./lib/ssh";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/ssh" });

app.use(cors());
app.use(express.json());

function proxyErrorPage(message: string, url?: string): string {
  const encoded = url ? encodeURIComponent(url) : "";
  const safe = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Proxy Error</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1a1a1a; color: #e0e0e0; }
  .card { text-align: center; padding: 2rem; max-width: 480px; }
  h1 { font-size: 1.125rem; color: #f87171; margin-bottom: 0.5rem; font-weight: 600; }
  p { font-size: 0.8125rem; color: #a0a0a0; margin-bottom: 1.5rem; line-height: 1.5; }
  a { display: inline-block; padding: 0.5rem 1rem; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 0.375rem; font-size: 0.8125rem; }
  a:hover { background: #2563eb; }
</style>
</head>
<body>
<div class="card">
  <h1>Cannot Load Page</h1>
  <p>${safe}</p>
  ${encoded ? `<a href="${encoded}" target="_blank" rel="noopener noreferrer">Open in New Tab</a>` : ""}
</div>
</body>
</html>`;
}

app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    res.status(400).send(proxyErrorPage("Missing URL parameter"));
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).send(proxyErrorPage("Invalid URL", targetUrl));
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    res.status(400).send(proxyErrorPage("Only HTTP and HTTPS URLs are supported", targetUrl));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; InfiniteBrowser/1.0)",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timeout);

    const finalUrl = response.url;
    const contentType =
      response.headers.get("content-type") || "text/html";

    const bodyBuffer = Buffer.from(await response.arrayBuffer());

    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml")
    ) {
      let html = bodyBuffer.toString("utf-8");

      html = html.replace(
        /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*\/?>/gi,
        "",
      );

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(
          /(<head[^>]*>)/i,
          `$1<base href="${finalUrl}">`,
        );
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(
          /(<html[^>]*>)/i,
          `$1<head><base href="${finalUrl}"></head>`,
        );
      } else {
        html = `<html><head><base href="${finalUrl}"></head><body>${html}</body></html>`;
      }

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } else {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.send(bodyBuffer);
    }
  } catch (err) {
    clearTimeout(timeout);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out after 15 seconds"
          : err.message
        : "Unknown error";
    res.status(502).send(proxyErrorPage(message, targetUrl));
  }
});

interface ConnectionRow {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  passwordEncrypted: string | null;
  privateKeyEncrypted: string | null;
}

wss.on("connection", async (ws, req) => {
  const params = new URLSearchParams(url.parse(req.url).query);
  const connId = parseInt(params.get("connectionId"), 10);

  if (!connId) {
    ws.send(JSON.stringify({ type: "error", message: "Missing connectionId" }));
    ws.close();
    return;
  }

  const row = await prisma.connection.findUnique({ where: { id: connId } }) as ConnectionRow | null;
  if (!row) {
    ws.send(JSON.stringify({ type: "error", message: "Connection not found" }));
    ws.close();
    return;
  }

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    ws.send(JSON.stringify({ type: "error", message: "ENCRYPTION_SECRET not set" }));
    ws.close();
    return;
  }

  const connection: {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: "password" | "key";
    password?: string;
    privateKey?: string;
  } = {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType as "password" | "key",
  };

  if (row.passwordEncrypted) {
    connection.password = decrypt(row.passwordEncrypted, secret);
  }
  if (row.privateKeyEncrypted) {
    connection.privateKey = decrypt(row.privateKeyEncrypted, secret);
  }

  createSSHSocket(connection, ws as Parameters<typeof createSSHSocket>[1]);
});

const PORT = process.env.WS_PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
