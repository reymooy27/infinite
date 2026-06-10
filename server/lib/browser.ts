import type { Browser, Page } from "puppeteer";
import { WebSocket } from "ws";
import { logger } from "./logger.js";

const ACTIVE_INTERVAL_MS = 100;
const IDLE_INTERVAL_MS = 500;
const IDLE_THRESHOLD_MS = 2000;
const SESSION_CLEANUP_DELAY_MS = 30_000;
const JPEG_QUALITY = 70;

interface BrowserSession {
  page: Page;
  ws: WebSocket | null;
  frameTimer: ReturnType<typeof setInterval> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
}

class BrowserManager {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();

  async init(): Promise<void> {
    const puppeteer = (await import("puppeteer")).default;
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    logger.info("[browser] Puppeteer launched");
  }

  async handleConnection(
    ws: WebSocket,
    windowId: string,
    width: number,
    height: number
  ): Promise<void> {
    const existing = this.sessions.get(windowId);
    if (existing) {
      if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
        existing.cleanupTimer = null;
      }
      existing.ws = ws;
      this.attachListeners(ws, existing, windowId);
      this.startStreaming(existing);
      logger.info("[browser] Session reattached", { windowId });
      return;
    }

    if (!this.browser) {
      await this.init();
    }

    const page = await this.browser!.newPage();
    await page.setViewport({ width, height });

    const session: BrowserSession = {
      page,
      ws,
      frameTimer: null,
      cleanupTimer: null,
      lastActivityAt: Date.now(),
    };
    this.sessions.set(windowId, session);

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.send(session, { type: "url", url: page.url() });
        this.send(session, { type: "loading", loading: false });
        this.sendFrame(session);
      }
    });

    page.on("load", () => {
      this.send(session, { type: "loading", loading: false });
    });

    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        this.send(session, { type: "loading", loading: true });
      }
    });

    this.attachListeners(ws, session, windowId);
    this.startStreaming(session);
    logger.info("[browser] Session created", { windowId, width, height });
  }

  private attachListeners(
    ws: WebSocket,
    session: BrowserSession,
    windowId: string
  ): void {
    ws.on("message", (data) => {
      session.lastActivityAt = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        this.handleClientMessage(session, msg);
      } catch {
        // ignore malformed
      }
    });

    ws.on("close", () => {
      session.ws = null;
      this.stopStreaming(session);
      session.cleanupTimer = setTimeout(() => {
        this.destroySession(windowId);
      }, SESSION_CLEANUP_DELAY_MS);
      logger.info("[browser] WS closed, cleanup scheduled", { windowId });
    });

    ws.on("error", (err) => {
      logger.error("[browser] WS error", { windowId, err: err.message });
    });
  }

  private handleClientMessage(
    session: BrowserSession,
    msg: Record<string, unknown>
  ): void {
    const page = session.page;
    switch (msg.type) {
      case "navigate": {
        const raw = String(msg.url ?? "");
        const url = raw.startsWith("http://") || raw.startsWith("https://")
          ? raw
          : `https://${raw}`;
        page.goto(url).catch(() => {});
        break;
      }
      case "resize": {
        const w = Number(msg.width) || 1024;
        const h = Number(msg.height) || 768;
        page.setViewport({ width: w, height: h }).catch(() => {});
        break;
      }
      case "click": {
        const x = Number(msg.x);
        const y = Number(msg.y);
        const clickCount = (Number(msg.clickCount) === 2 ? 2 : 1) as 1 | 2;
        page.mouse.click(x, y, { clickCount }).catch(() => {});
        break;
      }
      case "wheel": {
        const x = Number(msg.x);
        const y = Number(msg.y);
        page.mouse.move(x, y).then(() =>
          page.mouse.wheel({
            deltaX: Number(msg.deltaX) || 0,
            deltaY: Number(msg.deltaY) || 0,
          })
        ).catch(() => {});
        break;
      }
      case "mousemove": {
        page.mouse.move(Number(msg.x), Number(msg.y)).catch(() => {});
        break;
      }
      case "keydown": {
        page.keyboard.down(String(msg.key)).catch(() => {});
        break;
      }
      case "keyup": {
        page.keyboard.up(String(msg.key)).catch(() => {});
        break;
      }
      case "text": {
        page.keyboard.type(String(msg.key ?? "")).catch(() => {});
        break;
      }
      case "refresh": {
        page.reload().catch(() => {});
        break;
      }
      case "goBack": {
        page.goBack().catch(() => {});
        break;
      }
      case "goForward": {
        page.goForward().catch(() => {});
        break;
      }
    }
  }

  private startStreaming(session: BrowserSession): void {
    this.stopStreaming(session);
    const tick = async () => {
      if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
      await this.sendFrame(session);
      const idle = Date.now() - session.lastActivityAt > IDLE_THRESHOLD_MS;
      const delay = idle ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS;
      session.frameTimer = setTimeout(tick, delay) as unknown as ReturnType<typeof setInterval>;
    };
    session.frameTimer = setTimeout(tick, ACTIVE_INTERVAL_MS) as unknown as ReturnType<typeof setInterval>;
  }

  private stopStreaming(session: BrowserSession): void {
    if (session.frameTimer) {
      clearTimeout(session.frameTimer as unknown as ReturnType<typeof setTimeout>);
      session.frameTimer = null;
    }
  }

  private async sendFrame(session: BrowserSession): Promise<void> {
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
    try {
      const buf = await session.page.screenshot({
        type: "jpeg",
        quality: JPEG_QUALITY,
      });
      const data = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf).toString("base64");
      this.send(session, { type: "frame", data });
    } catch {
      // page may be closing
    }
  }

  private send(session: BrowserSession, payload: unknown): void {
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
    try {
      session.ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  private async destroySession(windowId: string): Promise<void> {
    const session = this.sessions.get(windowId);
    if (!session) return;
    this.stopStreaming(session);
    try {
      await session.page.close();
    } catch {
      // ignore
    }
    this.sessions.delete(windowId);
    logger.info("[browser] Session destroyed", { windowId });
  }

  async shutdown(): Promise<void> {
    for (const [windowId] of this.sessions) {
      await this.destroySession(windowId);
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info("[browser] Puppeteer shutdown");
  }
}

export const browserManager = new BrowserManager();
