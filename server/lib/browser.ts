import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, CDPSession, KeyInput, Page } from "puppeteer";
import { WebSocket } from "ws";
import { logger } from "./logger.js";

const SESSION_CLEANUP_DELAY_MS = 30_000;
const JPEG_QUALITY = 55;
const SCREENCAST_EVERY_NTH_FRAME = 2;
const BROWSER_USER_DATA_DIR_BASE = process.env.BROWSER_USER_DATA_DIR;

interface BrowserSession {
  page: Page;
  client: CDPSession;
  ws: WebSocket | null;
  screencastActive: boolean;
  screencastListenerAttached: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
}

class BrowserManager {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();

  async init(): Promise<void> {
    const puppeteer = (await import("puppeteer")).default;
    const userDataDirBase = BROWSER_USER_DATA_DIR_BASE?.trim();
    let userDataDir: string;
    if (userDataDirBase) {
      await mkdir(userDataDirBase, { recursive: true });
      userDataDir = await mkdtemp(
        path.join(userDataDirBase.replace(/\/+$/, ""), "profile-"),
      );
    } else {
      userDataDir = await mkdtemp(
        path.join(tmpdir(), "infinite-browser-profile-"),
      );
    }
    this.browser = await puppeteer.launch({
      headless: true,
      userDataDir,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-features=Translate,BackForwardCache",
        "--disable-popup-blocking",
        "--disable-renderer-backgrounding",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
    logger.info("[browser] Puppeteer launched", { userDataDir });
  }

  async handleConnection(
    ws: WebSocket,
    windowId: string,
    width: number,
    height: number,
  ): Promise<void> {
    const existing = this.sessions.get(windowId);
    if (existing) {
      if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
        existing.cleanupTimer = null;
      }
      existing.ws = ws;
      this.attachListeners(ws, existing, windowId);
      await this.startScreencast(existing);
      logger.info("[browser] Session reattached", { windowId });
      return;
    }

    if (!this.browser) {
      await this.init();
    }

    const page = await this.browser!.newPage();
    const client = await page.createCDPSession();
    await page.setViewport({ width, height });
    await page.setBypassCSP(true).catch(() => {});
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });
    await page.setUserAgent(
      await this.browser!.userAgent().then((ua) =>
        ua.replace(/\sHeadlessChrome\//, " Chrome/"),
      ),
    );

    const session: BrowserSession = {
      page,
      client,
      ws,
      screencastActive: false,
      screencastListenerAttached: false,
      cleanupTimer: null,
      lastActivityAt: Date.now(),
    };
    this.sessions.set(windowId, session);

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.send(session, { type: "url", url: page.url() });
        this.send(session, { type: "loading", loading: false });
      }
    });

    page.on("load", () => {
      this.send(session, { type: "loading", loading: false });
      this.send(session, { type: "title", title: "" });
      page
        .title()
        .then((title) => this.send(session, { type: "title", title }))
        .catch(() => {});
    });

    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        this.send(session, { type: "loading", loading: true });
      }
    });

    this.attachListeners(ws, session, windowId);
    await this.startScreencast(session);
    logger.info("[browser] Session created", { windowId, width, height });
  }

  private attachListeners(
    ws: WebSocket,
    session: BrowserSession,
    windowId: string,
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
      this.stopScreencast(session).catch(() => {});
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
    msg: Record<string, unknown>,
  ): void {
    const page = session.page;
    switch (msg.type) {
      case "navigate": {
        const raw = String(msg.url ?? "");
        const url =
          raw.startsWith("http://") || raw.startsWith("https://")
            ? raw
            : `http://${raw}`;
        this.navigate(page, url, session);
        break;
      }
      case "resize": {
        const w = Number(msg.width) || 1024;
        const h = Number(msg.height) || 768;
        page
          .setViewport({ width: w, height: h })
          .then(() => this.restartScreencast(session))
          .catch(() => {});
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
        page.mouse
          .move(x, y)
          .then(() =>
            page.mouse.wheel({
              deltaX: Number(msg.deltaX) || 0,
              deltaY: Number(msg.deltaY) || 0,
            }),
          )
          .catch(() => {});
        break;
      }
      case "mousemove": {
        page.mouse.move(Number(msg.x), Number(msg.y)).catch(() => {});
        break;
      }
      case "keydown": {
        page.keyboard.down(String(msg.key) as KeyInput).catch(() => {});
        break;
      }
      case "keyup": {
        page.keyboard.up(String(msg.key) as KeyInput).catch(() => {});
        break;
      }
      case "text": {
        page.keyboard.type(String(msg.key ?? "")).catch(() => {});
        break;
      }
      case "refresh": {
        page
          .reload({ waitUntil: "domcontentloaded", timeout: 30_000 })
          .catch((err) => {
            this.send(session, { type: "error", message: this.errorMessage(err) });
          });
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

  private navigate(page: Page, url: string, session: BrowserSession): void {
    this.send(session, { type: "loading", loading: true });
    page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch((err) => {
        this.send(session, { type: "error", message: this.errorMessage(err) });
      })
      .finally(() => {
        this.send(session, { type: "loading", loading: false });
      });
  }

  private async startScreencast(session: BrowserSession): Promise<void> {
    if (session.screencastActive) return;
    if (!session.screencastListenerAttached) {
      session.client.on("Page.screencastFrame", (event) => {
        session.client
          .send("Page.screencastFrameAck", { sessionId: event.sessionId })
          .catch(() => {});
        this.send(session, { type: "frame", data: event.data });
      });
      session.screencastListenerAttached = true;
    }
    await session.client.send("Page.startScreencast", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      everyNthFrame: SCREENCAST_EVERY_NTH_FRAME,
    });
    session.screencastActive = true;
  }

  private async stopScreencast(session: BrowserSession): Promise<void> {
    if (!session.screencastActive) return;
    try {
      await session.client.send("Page.stopScreencast");
    } catch {
      // page may already be closed
    }
    session.screencastActive = false;
  }

  private async restartScreencast(session: BrowserSession): Promise<void> {
    await this.stopScreencast(session);
    await this.startScreencast(session);
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : "Page failed to load";
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
    await this.stopScreencast(session);
    try {
      await session.client.detach();
    } catch {
      // ignore
    }
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
