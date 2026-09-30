// Record-only demo choreography for Infinite → demo/infinite-demo.mp4
// Run: npx tsx scripts/demo.ts   (FAST=1 npx tsx scripts/demo.ts for quick debug timing)
import { chromium, type Page, type BrowserContext } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.DEMO_URL || "http://localhost:9871";
const DEMO_DIR = "demo";
const FRAMES_DIR = join(DEMO_DIR, "frames");
const RAW_DIR = join(DEMO_DIR, "raw");
const FAST = !!process.env.FAST;
const T = FAST ? 0.25 : 1;

mkdirSync(FRAMES_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

const results: { step: string; status: "PASS" | "SKIPPED"; reason?: string }[] = [];
let frameNo = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * T));

async function shot(page: Page, name: string) {
  frameNo += 1;
  await page.screenshot({ path: join(FRAMES_DIR, `step${frameNo}-${name}.png`) }).catch(() => {});
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ step: name, status: "PASS" });
    console.log(`PASS: ${name}`);
  } catch (e) {
    const reason = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : String(e);
    results.push({ step: name, status: "SKIPPED", reason });
    console.log(`SKIPPED: ${name} — ${reason}`);
  }
}

// Smooth interpolated pointer motion (video-friendly, ~60fps)
async function glide(page: Page, x1: number, y1: number, x2: number, y2: number, n = 30) {
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    await sleep(16);
  }
}

async function moveTo(page: Page, x: number, y: number) {
  const p = page.mouse["__pos"] || { x: 640, y: 360 };
  await glide(page, p.x, p.y, x, y, 25);
  page.mouse["__pos"] = { x, y };
}

// tracked wrapper so glide knows where the mouse is
const origMove = (page: Page) => page.mouse.move.bind(page.mouse);
function trackMouse(page: Page) {
  const real = origMove(page);
  (page.mouse as any).move = async (x: number, y: number, opts?: any) => {
    await real(x, y, opts);
    (page.mouse as any).__pos = { x, y };
  };
}

// Fake cursor (Playwright video has no cursor). Injected into every page.
const CURSOR_SCRIPT = `(() => {
  const mk = () => {
    if (document.getElementById("__demo_cursor")) return;
    const ring = document.createElement("div");
    ring.id = "__demo_cursor";
    ring.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:9999px;border:2.5px solid #38bdf8;background:rgba(56,189,248,.15);pointer-events:none;z-index:2147483647;transition:transform .06s linear,border-color .15s;will-change:transform;display:none;";
    const dot = document.createElement("div");
    dot.style.cssText = "position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:9999px;background:#38bdf8;";
    ring.appendChild(dot);
    const place = (x, y, s) => { ring.style.display = "block"; ring.style.transform = "translate(" + x + "px," + y + "px)" + (s ? " scale(" + s + ")" : ""); };
    window.addEventListener("mousemove", (e) => place(e.clientX, e.clientY), true);
    window.addEventListener("mousedown", (e) => {
      place(e.clientX, e.clientY, 0.7); ring.style.borderColor = "#fbbf24";
      const rip = document.createElement("div");
      rip.style.cssText = "position:fixed;left:" + (e.clientX - 13) + "px;top:" + (e.clientY - 13) + "px;width:26px;height:26px;border-radius:9999px;border:2px solid #fbbf24;pointer-events:none;z-index:2147483646;transition:transform .45s ease-out,opacity .45s;";
      document.documentElement.appendChild(rip);
      requestAnimationFrame(() => { rip.style.transform = "scale(2.2)"; rip.style.opacity = "0"; });
      setTimeout(() => rip.remove(), 500);
    }, true);
    window.addEventListener("mouseup", (e) => { place(e.clientX, e.clientY, 1); ring.style.borderColor = "#38bdf8"; }, true);
    document.documentElement.appendChild(ring);
  };
  if (document.body) mk(); else document.addEventListener("DOMContentLoaded", mk);
})();`;

async function centerOf(page: Page, selector: string, nth = 0) {
  const box = await page.locator(selector).nth(nth).boundingBox({ timeout: 4000 });
  if (!box) throw new Error(`no box: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickBtn(page: Page, title: string) {
  const pt = await centerOf(page, `button[title="${title}"]`);
  await moveTo(page, pt.x, pt.y);
  await sleep(200);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(350);
}

// Place the app currently in "placing" mode: click empty canvas spots until the
// "Click on canvas to place" banner is gone.
async function placeOnCanvas(page: Page) {
  const banner = page.locator("text=Click on canvas to place");
  const spots = [
    { x: 1000, y: 220 }, { x: 950, y: 480 }, { x: 300, y: 160 },
  ];
  for (const s of spots) {
    await moveTo(page, ptX(page, s.x), ptY(page, s.y));
    await sleep(200);
    await page.mouse.down(); await sleep(90); await page.mouse.up();
    await sleep(600);
    if ((await banner.count()) === 0) return;
  }
  if ((await banner.count()) > 0) {
    await page.keyboard.press("Escape").catch(() => {});
    throw new Error("placement never completed");
  }
}
const ptX = (_p: Page, x: number) => x;
const ptY = (_p: Page, y: number) => y;

interface WinInfo {
  title: string;
  hasTerm: boolean;
  connected: boolean;
  connecting: boolean;
  disconnected: boolean;
  rect: { x: number; y: number; w: number; h: number };
  closeBtn: { x: number; y: number } | null;
}

// Snapshot of every canvas window (header's parent = Rnd frame root)
async function winInfos(page: Page): Promise<WinInfo[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".window-drag-handle")].map((h) => {
      const el = (h.parentElement || h) as HTMLElement;
      const r = el.getBoundingClientRect();
      const cb = el.querySelector('button[title="Close"]')?.getBoundingClientRect();
      const text = el.textContent || "";
      return {
        title: (h.querySelector("span")?.textContent || "").slice(0, 40),
        hasTerm: !!el.querySelector(".xterm"),
        // desktop terminal toolbar (Copy button) only renders while WS is connected
        connected: !!el.querySelector('button[title="Copy selected text"]'),
        connecting: text.includes("Connecting..."),
        disconnected: text.includes("Disconnected"),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        closeBtn: cb ? { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 } : null,
      };
    });
  });
}

async function dismissOverlays(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(400);
  // SysMon/Docker/Git panels paint a fixed inset-0 backdrop; click it if still up
  const backdrop = page.locator('[aria-label="Close System Monitor panel"]');
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await sleep(400);
  }
  const cancel = page.locator("text=Click on canvas to place").locator("..").getByText("Cancel", { exact: true });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click().catch(() => {});
    await sleep(300);
  }
}

async function boxCenter(loc: import("playwright").Locator): Promise<[number, number]> {
  const b = await loc.boundingBox({ timeout: 4000 });
  if (!b) throw new Error("no box");
  return [b.x + b.width / 2, b.y + b.height / 2];
}

async function clickText(page: Page, text: string, exact = true) {
  const loc = page.getByText(text, { exact }).first();
  const box = await loc.boundingBox({ timeout: 4000 });
  if (!box) throw new Error(`no text: ${text}`);
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(200);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(350);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  trackMouse(page);

  // 1. Open app, dismiss onboarding (fresh profile => "Welcome to Infinite")
  await step("open-app", async () => {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("text=Got it", { timeout: 10000 }).catch(() => {});
    const gotIt = page.getByText("Got it", { exact: true });
    if (await gotIt.isVisible().catch(() => false)) {
      await clickText(page, "Got it");
    }
    await sleep(2500);
    await shot(page, "loaded");
  });

  // 2. Pan the canvas (middle-mouse drag — Canvas.tsx custom handler) and back
  await step("canvas-pan", async () => {
    const a = { x: 350, y: 260 };
    const b = { x: 850, y: 520 };
    await moveTo(page, a.x, a.y);
    await sleep(250);
    await page.mouse.down({ button: "middle" });
    await sleep(250);
    await glide(page, a.x, a.y, b.x, b.y, 45);
    await sleep(400);
    await page.mouse.up({ button: "middle" });
    await sleep(600);
    await shot(page, "panned");
    // pan back
    await moveTo(page, b.x, b.y);
    await page.mouse.down({ button: "middle" });
    await sleep(250);
    await glide(page, b.x, b.y, a.x, a.y, 45);
    await sleep(400);
    await page.mouse.up({ button: "middle" });
    await sleep(500);
  });

  // 3. Zoom out then in via canvas zoom controls (Canvas.tsx bottom-left)
  await step("canvas-zoom", async () => {
    for (let i = 0; i < 2; i++) { await clickBtn(page, "Zoom out"); await sleep(600); }
    await shot(page, "zoomed-out");
    await sleep(600);
    for (let i = 0; i < 3; i++) { await clickBtn(page, "Zoom in"); await sleep(600); }
    await shot(page, "zoomed-in");
  });

  // 4. Dock: open Notes window, drag by title bar, resize via SE handle
  await step("dock-open-notes", async () => {
    await clickBtn(page, "Notes");
    await sleep(400);
    await placeOnCanvas(page);
    await page.waitForSelector(".window-drag-handle", { timeout: 5000 });
    await sleep(800);
    await shot(page, "notes-open");
  });

  await step("window-drag-resize", async () => {
    const header = page.locator(".window-drag-handle", { hasText: "Notes" }).last();
    const hb = await header.boundingBox({ timeout: 4000 });
    if (!hb) throw new Error("notes header missing");
    const start = { x: hb.x + 60, y: hb.y + hb.height / 2 };
    await moveTo(page, start.x, start.y);
    await sleep(250);
    await page.mouse.down();
    await sleep(350); // clear WindowFrame long-press guard (>200ms)
    await glide(page, start.x, start.y, start.x + 220, start.y + 140, 40);
    await sleep(300);
    await page.mouse.up();
    await sleep(600);
    await shot(page, "window-dragged");

    const frame = header.locator("xpath=..");
    // runtime selector .react-resizable-handle-se never matched; the SE handle
    // always lives at the frame's bottom-right corner, so aim by rect instead
    const fb = await frame.boundingBox({ timeout: 4000 });
    if (!fb) throw new Error("window frame missing");
    const hs = { x: fb.x + fb.width - 6, y: fb.y + fb.height - 6 };
    await moveTo(page, hs.x, hs.y);
    await sleep(250);
    await page.mouse.down();
    await sleep(250);
    await glide(page, hs.x, hs.y, hs.x + 160, hs.y + 110, 30);
    await sleep(300);
    await page.mouse.up();
    await sleep(600);
    await shot(page, "window-resized");
  });

  // 5. SSH terminal: reuse a live restored terminal, else open one per stored
  // connection (max 2 tries). Never types credentials.
  await step("ssh-terminal", async () => {
    const visibleLive = async () => {
      const ws = await winInfos(page);
      return ws.filter((w) => w.hasTerm && w.connected && w.rect.w > 50 && w.rect.x > -500);
    };
    let live = (await visibleLive())[0] || null;
    for (let t = 0; !live && t < 10; t++) {
      await sleep(1000); // restored windows re-attach their WS within a few seconds
      live = (await visibleLive())[0] || null;
    }

    if (!live) {
      for (let attempt = 0; attempt < 2 && !live; attempt++) {
        await clickBtn(page, "SSH");
        await sleep(600);
        const picker = page.getByText("Open SSH", { exact: true });
        const hadPicker = await picker.isVisible().catch(() => false);
        if (hadPicker) {
          const conns = page.locator("button:visible").filter({ hasText: "@" });
          if ((await conns.count()) <= attempt) throw new Error("no more stored connections");
          const btn = conns.nth(attempt);
          await moveTo(page, ...await boxCenter(btn));
          await sleep(150);
          await page.mouse.down(); await sleep(90); await page.mouse.up();
          await sleep(500);
          const banner = page.locator("text=Click on canvas to place");
          if (!(await banner.isVisible().catch(() => false))) {
            await btn.click({ timeout: 3000 }).catch(() => {}); // retry mid-animation miss
            await banner.waitFor({ state: "visible", timeout: 3000 }).catch(() => {
              throw new Error("SSH picker click did not enter placement mode");
            });
          }
        }
        await placeOnCanvas(page);
        // offline host => .xterm may never render (only a Connecting… overlay);
        // don't abort the whole step, fall through to close + next connection
        if (await page.waitForSelector(".xterm", { timeout: 6000 }).then(() => true).catch(() => false)) {
          for (let t = 0; t < 40 && !live; t++) {
            await sleep(500);
            const cand = (await winInfos(page)).filter((w) => w.hasTerm).pop();
            if (cand?.connected) live = cand;
            else if (cand?.disconnected) break;
          }
        }
        if (!live) {
          // close the dead/hung window before trying the next stored connection
          const all = await winInfos(page);
          const dead = all.filter((w) => w.hasTerm).pop() ?? all[all.length - 1];
          if (dead?.closeBtn && attempt === 0) {
            await moveTo(page, dead.closeBtn.x, dead.closeBtn.y);
            await sleep(150);
            await page.mouse.down(); await sleep(90); await page.mouse.up();
            await sleep(800);
          }
          if (!hadPicker) break; // single/no connection: second attempt is pointless
        }
      }
    }
    if (!live) throw new Error("no live terminal — all stored connections offline");

    await shot(page, "terminal-live");
    const cx = live.rect.x + live.rect.w / 2;
    const cy = live.rect.y + live.rect.h / 2;
    await moveTo(page, cx, cy);
    await sleep(200);
    await page.mouse.down(); await sleep(80); await page.mouse.up();
    await sleep(500);
    await page.keyboard.type("echo hello from infinite demo", { delay: FAST ? 10 : 65 });
    await sleep(400);
    await page.keyboard.press("Enter");
    await sleep(2200);
    await shot(page, "terminal-typed");
  });

  // 6. SysMonitor panel: select stored connection, Scan disk cleanup, hover rows
  await step("sysmonitor-scan", async () => {
    await clickBtn(page, "System Monitor");
    const panel = page.locator("aside");
    await panel.waitFor({ state: "visible", timeout: 5000 });
    await sleep(800);
    // stored hosts can be offline (stats never arrive); rotate through the
    // picker via "Change server" until one renders the Disk cleanup card
    const disk = panel.getByText("Disk cleanup", { exact: true }).first();
    const conns = panel.locator("button:visible").filter({ hasText: "@" }).filter({ hasNotText: /change server/i });
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
      if (i > 0 || (await conns.count()) === 0) {
        await panel.getByRole("button", { name: /change server/i }).first().click({ timeout: 3000 }).catch(() => {});
      }
      await conns.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if ((await conns.count()) === 0) {
        if (i === 0) throw new Error("no saved connections to monitor");
        break;
      }
      await conns.nth(i).click({ timeout: 4000 }).catch(() => {});
      opened = await disk.waitFor({ state: "visible", timeout: i === 0 ? 12000 : 25000 }).then(() => true, () => false);
    }
    if (!opened) {
      const snippet = (await panel.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
      throw new Error(`Disk cleanup never rendered — panel shows: "${snippet}"`);
    }
    await disk.scrollIntoViewIfNeeded({ timeout: 6000 });
    await sleep(500);
    await shot(page, "sysmonitor-open");
    const scan = panel.getByRole("button", { name: "Scan", exact: true }).first();
    if (await scan.isVisible().catch(() => false)) {
      const sb = await scan.boundingBox();
      if (sb) {
        await moveTo(page, sb.x + sb.width / 2, sb.y + sb.height / 2);
        await sleep(200);
        await page.mouse.down(); await sleep(90); await page.mouse.up();
      }
      await panel.getByRole("button", { name: "Scan", exact: true }).first()
        .waitFor({ state: "visible", timeout: 12000 }).catch(() => {}); // wait out "Scanning…"
      await sleep(1200);
      await shot(page, "scan-results");
      // hover a couple of result rows (NEVER Clean/Delete)
      const rows = panel.locator("input[type=checkbox]").locator("xpath=ancestor::*[self::div or self::label][1]");
      const n = Math.min(await rows.count(), 3);
      for (let i = 0; i < n; i++) {
        const rb = await rows.nth(i).boundingBox().catch(() => null);
        if (rb) { await moveTo(page, rb.x + rb.width / 2, rb.y + rb.height / 2); await sleep(650); }
      }
    } else {
      await sleep(1500);
      await shot(page, "sysmonitor-no-scan");
    }
    await page.keyboard.press("Escape"); // closes SysMonPanel
    await sleep(600);
  });

  // 7. Focus mode: enter, switch project tabs if >=2, exit
  await step("focus-mode", async () => {
    await dismissOverlays(page);
    await clickBtn(page, "Focus mode");
    const exit = page.locator('button[title="Switch to canvas mode"]');
    await exit.waitFor({ state: "visible", timeout: 6000 });
    await sleep(1800);
    await shot(page, "focus-mode");

    const tabs = page.locator('[class*="45vw"] button');
    const count = await tabs.count().catch(() => 0);
    if (count >= 2) {
      await step("project-switch", async () => {
        const home = await tabs.evaluateAll((els) => {
          const i = els.findIndex((e) => e.className.includes("bg-neutral-800"));
          return i;
        });
        const homeTab = await tabs.nth(home >= 0 ? home : 0).innerText();
        const other = tabs.nth(home >= 0 && home === 0 ? 1 : 0);
        const ob = await other.boundingBox();
        if (!ob) throw new Error("tab box missing");
        await moveTo(page, ob.x + ob.width / 2, ob.y + ob.height / 2);
        await sleep(200);
        await page.mouse.down(); await sleep(90); await page.mouse.up();
        await sleep(2500);
        await shot(page, "project-switched");
        // switch back to the original project
        const back = tabs.filter({ hasText: homeTab }).first();
        const bb = await back.boundingBox({ timeout: 4000 });
        if (bb) {
          await moveTo(page, bb.x + bb.width / 2, bb.y + bb.height / 2);
          await sleep(200);
          await page.mouse.down(); await sleep(90); await page.mouse.up();
          await sleep(2500);
        }
      });
    } else {
      console.log(`SKIPPED: project-switch — only ${count} project tab(s)`);
      results.push({ step: "project-switch", status: "SKIPPED", reason: `${count} tab(s)` });
    }

    const eb = await exit.boundingBox();
    if (!eb) throw new Error("exit button gone");
    await moveTo(page, eb.x + eb.width / 2, eb.y + eb.height / 2);
    await sleep(200);
    await page.mouse.down(); await sleep(90); await page.mouse.up();
    await sleep(1500);
    await shot(page, "focus-exited");
  });

  // 8. End card: cursor to center, hold
  await step("outro", async () => {
    await moveTo(page, 640, 360);
    await sleep(2500);
    await shot(page, "end");
  });

  const video = page.video();
  await context.close(); // flushes video
  const videoPath = video ? await video.path() : "unknown";
  await browser.close();

  console.log("\n=== DEMO SUMMARY ===");
  for (const r of results) console.log(`${r.status}: ${r.step}${r.reason ? ` — ${r.reason}` : ""}`);
  console.log(`raw video: ${videoPath}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
