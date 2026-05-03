import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import type { WebSocket } from "ws";
import { logger } from "./logger.js";

interface BrowserMessage {
  type: string;
  url?: string;
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  width?: number;
  height?: number;
  clickCount?: number;
}

const FRAME_INTERVAL_ACTIVE = 60;
const FRAME_INTERVAL_IDLE = 500;
const IDLE_TIMEOUT = 2000;

let sharedBrowser: Browser | null = null;
let browserRefs = 0;
let browserCloseTimer: ReturnType<typeof setTimeout> | null = null;

function codeToPuppeteerKey(code: string, key: string): string {
  if (code.startsWith("Key")) return key.toLowerCase();
  if (code.startsWith("Digit")) return code.replace("Digit", "");
  if (code.startsWith("Arrow")) return code;
  if (code === "Space") return " ";
  if (code.startsWith("Control")) return "Control";
  if (code.startsWith("Shift")) return "Shift";
  if (code.startsWith("Alt")) return "Alt";
  if (code.startsWith("Meta")) return "Meta";
  if (["Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End",
       "PageUp", "PageDown", "Insert", "CapsLock", "NumLock", "ScrollLock",
       "Pause", "ContextMenu"].includes(code)) return code;
  if (code.startsWith("F") && code.length <= 4) return code;
  return key.length === 1 ? key : code;
}

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  logger.info("[Browser] Launching Chromium...");
  sharedBrowser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
  });
  logger.info("[Browser] Chromium launched");
  return sharedBrowser;
}

function clearBrowserCloseTimer() {
  if (browserCloseTimer) {
    clearTimeout(browserCloseTimer);
    browserCloseTimer = null;
  }
}

async function releaseBrowserRef() {
  browserRefs = Math.max(0, browserRefs - 1);
  if (browserRefs === 0 && sharedBrowser) {
    browserCloseTimer = setTimeout(async () => {
      if (browserRefs === 0 && sharedBrowser) {
        await sharedBrowser.close();
        sharedBrowser = null;
        logger.info("[Browser] Closed shared browser (idle)");
      }
    }, 30000);
  }
}

interface ActiveBrowserSession {
  page: Page;
  ws?: WebSocket;
  frameTimer?: ReturnType<typeof setInterval>;
  activeTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  width: number;
  height: number;
}

const browserSessions = new Map<string, ActiveBrowserSession>();
const BROWSER_SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes

export function createBrowserSession(
  ws: WebSocket,
  viewportWidth: number,
  viewportHeight: number,
  windowId?: string
) {
  if (windowId && browserSessions.has(windowId)) {
    const session = browserSessions.get(windowId)!;
    logger.info(`[Browser] Re-attaching to session ${windowId}`);

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = undefined;
    }

    session.ws = ws;

    // Restart frame rate timer with new WS
    const sendFrame = async () => {
      if (!session.ws || !session.page) return;
      try {
        const loading = await session.page.evaluate(() => {
          try {
            return document.readyState !== "complete";
          } catch {
            return false;
          }
        }).catch(() => false);

        if (loading) {
          session.ws.send(JSON.stringify({ type: "loading", loading: true }));
          return;
        }

        const frameData = await session.page.screenshot({
          type: "jpeg",
          quality: 55,
          encoding: "base64",
        });
        session.ws.send(JSON.stringify({ type: "frame", data: frameData }));

        const currentUrl = session.page.url();
        if (
          currentUrl &&
          !currentUrl.startsWith("chrome://") &&
          !currentUrl.startsWith("chrome-error://")
        ) {
          session.ws.send(JSON.stringify({ type: "url", url: currentUrl }));
        }

        const title = await session.page.title().catch(() => "");
        if (title) {
          session.ws.send(JSON.stringify({ type: "title", title }));
        }
      } catch {
        // ignore
      }
    };

    if (session.frameTimer) clearInterval(session.frameTimer);
    session.frameTimer = setInterval(sendFrame, FRAME_INTERVAL_IDLE);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw as string);
        handleMessage(msg, session.page, ws, session);
      } catch {
        // ignore
      }
    });

    ws.on("close", () => {
      logger.info(`[Browser] WebSocket closed for session ${windowId}, detaching...`);
      session.ws = undefined;
      if (session.frameTimer) clearInterval(session.frameTimer);
      session.cleanupTimer = setTimeout(async () => {
        logger.info(`[Browser] Cleaning up idle session ${windowId}`);
        await session.page.close().catch(() => {});
        browserSessions.delete(windowId);
        releaseBrowserRef();
      }, BROWSER_SESSION_TIMEOUT);
    });

    return;
  }

  let page: Page | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let isActive = false;
  let width = viewportWidth;
  let height = viewportHeight;
  let closed = false;
  let ready = false;
  const pendingMessages: BrowserMessage[] = [];

  const sessionObj: Partial<ActiveBrowserSession> = { width, height };

  function flushPending() {
    ready = true;
    const msgs = pendingMessages.splice(0);
    for (const m of msgs) {
      if (page) handleMessage(m, page, ws, sessionObj as ActiveBrowserSession);
    }
  }

  function markActive() {
    isActive = true;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(() => {
      isActive = false;
    }, IDLE_TIMEOUT);
    adjustFrameRate();
  }

  function adjustFrameRate() {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
    const interval = isActive ? FRAME_INTERVAL_ACTIVE : FRAME_INTERVAL_IDLE;
    frameTimer = setInterval(sendFrame, interval);
    if (windowId && browserSessions.has(windowId)) {
      browserSessions.get(windowId)!.frameTimer = frameTimer;
    }
  }

  async function sendFrame() {
    const targetWs = windowId ? browserSessions.get(windowId)?.ws : ws;
    if (closed || !page || !targetWs) return;
    try {
      const loading = await page.evaluate(() => {
        try {
          return document.readyState !== "complete";
        } catch {
          return false;
        }
      }).catch(() => false);

      if (loading) {
        targetWs.send(JSON.stringify({ type: "loading", loading: true }));
        return;
      }

      const frameData = await page.screenshot({
        type: "jpeg",
        quality: 55,
        encoding: "base64",
      });
      targetWs.send(JSON.stringify({ type: "frame", data: frameData }));

      const currentUrl = page.url();
      if (
        currentUrl &&
        !currentUrl.startsWith("chrome://") &&
        !currentUrl.startsWith("chrome-error://")
      ) {
        targetWs.send(JSON.stringify({ type: "url", url: currentUrl }));
      }

      const title = await page.title().catch(() => "");
      if (title) {
        targetWs.send(JSON.stringify({ type: "title", title }));
      }
    } catch {
      // Page may have closed; ignore frame errors
    }
  }

  async function init() {
    try {
      const browser = await getBrowser();
      browserRefs++;
      clearBrowserCloseTimer();

      page = await browser.newPage();
      await page.setViewport({ width, height });

      if (windowId) {
        browserSessions.set(windowId, {
          page,
          ws,
          width,
          height,
        });
      }

      page.on("load", () => {
        const targetWs = windowId ? browserSessions.get(windowId)?.ws : ws;
        targetWs?.send(JSON.stringify({ type: "loading", loading: false }));
        markActive();
      });

      adjustFrameRate();
      flushPending();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to launch browser";
      logger.error("[Browser] Init failed", { error: msg });
      ws.send(JSON.stringify({ type: "error", message: msg }));
      ready = true;
    }
  }

  init();

  ws.on("message", (raw) => {
    let msg: BrowserMessage;
    try {
      msg = JSON.parse(raw as string);
    } catch {
      return;
    }

    if (!ready) {
      pendingMessages.push(msg);
      return;
    }

    if (page) handleMessage(msg, page, ws, sessionObj as ActiveBrowserSession);
  });

  async function handleMessage(msg: BrowserMessage, p: Page, w: WebSocket, session: ActiveBrowserSession) {
    if (!p || closed) return;

    try {
      switch (msg.type) {
        case "navigate": {
          if (!msg.url) break;
          w.send(JSON.stringify({ type: "loading", loading: true }));
          await p.goto(msg.url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          w.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "goBack": {
          w.send(JSON.stringify({ type: "loading", loading: true }));
          await p.goBack({ waitUntil: "networkidle2", timeout: 15000 });
          w.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "goForward": {
          w.send(JSON.stringify({ type: "loading", loading: true }));
          await p.goForward({ waitUntil: "networkidle2", timeout: 15000 });
          w.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "refresh": {
          w.send(JSON.stringify({ type: "loading", loading: true }));
          await p.reload({ waitUntil: "networkidle2", timeout: 30000 });
          w.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "click": {
          const x = msg.x ?? 0;
          const y = msg.y ?? 0;
          const count = msg.clickCount ?? 1;
          await p.mouse.click(x, y, { clickCount: count });
          markActive();
          break;
        }

        case "wheel": {
          const deltaX = msg.deltaX ?? 0;
          const deltaY = msg.deltaY ?? 0;
          if (msg.x !== undefined && msg.y !== undefined) {
            await p.mouse.move(msg.x, msg.y);
          }
          await p.mouse.wheel({
            deltaX,
            deltaY,
          });
          markActive();
          break;
        }

        case "keydown": {
          const keyName = codeToPuppeteerKey(msg.code || "", msg.key || "");
          await p.keyboard.down(keyName);
          break;
        }

        case "keyup": {
          const keyName = codeToPuppeteerKey(msg.code || "", msg.key || "");
          await p.keyboard.up(keyName);
          break;
        }

        case "resize": {
          session.width = msg.width || session.width;
          session.height = msg.height || session.height;
          await p.setViewport({ width: session.width, height: session.height });
          markActive();
          break;
        }

        case "text": {
          if (msg.key) {
            await p.keyboard.type(msg.key);
            markActive();
          }
          break;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.error("[Browser] Handle message error", { error: errMsg, type: msg.type });
      w.send(JSON.stringify({ type: "error", message: errMsg }));
    }
  }

  ws.on("close", async () => {
    if (windowId) {
      logger.info(`[Browser] WebSocket closed for session ${windowId}, detaching...`);
      const session = browserSessions.get(windowId);
      if (session) {
        session.ws = undefined;
        if (session.frameTimer) clearInterval(session.frameTimer);
        session.cleanupTimer = setTimeout(async () => {
          logger.info(`[Browser] Cleaning up idle session ${windowId}`);
          await session.page.close().catch(() => {});
          browserSessions.delete(windowId);
          releaseBrowserRef();
        }, BROWSER_SESSION_TIMEOUT);
      }
    } else {
      logger.info("[Browser] Session closed (ephemeral)");
      closed = true;
      if (frameTimer) clearInterval(frameTimer);
      if (activeTimer) clearTimeout(activeTimer);
      if (page) {
        await page.close().catch(() => {});
        page = null;
      }
      releaseBrowserRef();
    }
  });

  ws.on("error", async () => {
    // Same as close
    ws.emit("close");
  });
}