import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import type { WebSocket } from "ws";

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
      }
    }, 30000);
  }
}

export function createBrowserSession(
  ws: WebSocket,
  viewportWidth: number,
  viewportHeight: number,
) {
  let page: Page | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let isActive = false;
  let width = viewportWidth;
  let height = viewportHeight;
  let closed = false;
  let ready = false;
  const pendingMessages: BrowserMessage[] = [];

  function flushPending() {
    ready = true;
    const msgs = pendingMessages.splice(0);
    for (const m of msgs) {
      handleMessage(m);
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
  }

  async function sendFrame() {
    if (closed || !page) return;
    try {
      const loading = await page.evaluate(() => {
        try {
          return document.readyState !== "complete";
        } catch {
          return false;
        }
      }).catch(() => false);

      if (loading) {
        ws.send(JSON.stringify({ type: "loading", loading: true }));
        return;
      }

      const frameData = await page.screenshot({
        type: "jpeg",
        quality: 55,
        encoding: "base64",
      });
      ws.send(JSON.stringify({ type: "frame", data: frameData }));

      const currentUrl = page.url();
      if (
        currentUrl &&
        !currentUrl.startsWith("chrome://") &&
        !currentUrl.startsWith("chrome-error://")
      ) {
        ws.send(JSON.stringify({ type: "url", url: currentUrl }));
      }

      const title = await page.title().catch(() => "");
      if (title) {
        ws.send(JSON.stringify({ type: "title", title }));
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

      page.on("load", () => {
        ws.send(JSON.stringify({ type: "loading", loading: false }));
        markActive();
      });

      adjustFrameRate();
      flushPending();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to launch browser";
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

    handleMessage(msg);
  });

  async function handleMessage(msg: BrowserMessage) {
    if (!page || closed) return;

    try {
      switch (msg.type) {
        case "navigate": {
          if (!msg.url) break;
          ws.send(JSON.stringify({ type: "loading", loading: true }));
          await page.goto(msg.url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          ws.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "goBack": {
          ws.send(JSON.stringify({ type: "loading", loading: true }));
          await page.goBack({ waitUntil: "networkidle2", timeout: 15000 });
          ws.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "goForward": {
          ws.send(JSON.stringify({ type: "loading", loading: true }));
          await page.goForward({ waitUntil: "networkidle2", timeout: 15000 });
          ws.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "refresh": {
          ws.send(JSON.stringify({ type: "loading", loading: true }));
          await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
          ws.send(JSON.stringify({ type: "loading", loading: false }));
          markActive();
          break;
        }

        case "click": {
          const x = msg.x ?? 0;
          const y = msg.y ?? 0;
          const count = msg.clickCount ?? 1;
          await page.mouse.click(x, y, { clickCount: count });
          markActive();
          break;
        }

        case "wheel": {
          const deltaX = msg.deltaX ?? 0;
          const deltaY = msg.deltaY ?? 0;
          if (msg.x !== undefined && msg.y !== undefined) {
            await page.mouse.move(msg.x, msg.y);
          }
          await page.mouse.wheel({
            deltaX,
            deltaY,
          });
          markActive();
          break;
        }

        case "keydown": {
          const keyName = codeToPuppeteerKey(msg.code || "", msg.key || "");
          await page.keyboard.down(keyName);
          break;
        }

        case "keyup": {
          const keyName = codeToPuppeteerKey(msg.code || "", msg.key || "");
          await page.keyboard.up(keyName);
          break;
        }

        case "resize": {
          width = msg.width || width;
          height = msg.height || height;
          await page.setViewport({ width, height });
          markActive();
          break;
        }

        case "text": {
          if (msg.key) {
            await page.keyboard.type(msg.key);
            markActive();
          }
          break;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      ws.send(JSON.stringify({ type: "error", message: errMsg }));
    }
  }

  ws.on("close", async () => {
    closed = true;
    if (frameTimer) clearInterval(frameTimer);
    if (activeTimer) clearTimeout(activeTimer);
    if (page) {
      await page.close().catch(() => {});
      page = null;
    }
    releaseBrowserRef();
  });

  ws.on("error", async () => {
    closed = true;
    if (frameTimer) clearInterval(frameTimer);
    if (activeTimer) clearTimeout(activeTimer);
    if (page) {
      await page.close().catch(() => {});
      page = null;
    }
    releaseBrowserRef();
  });
}
