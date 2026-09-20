// E2E regression test: voice-input "double chat" (duplicated terminal content).
//
// Run: npx tsx --test src/apps/voiceDoubleChat.e2e.test.ts
//
// Drives the REAL client-side buffer cache module (src/lib/terminalBufferCache)
// and models the server's replay-on-attach behaviour
// (server/lib/ssh.ts: createSSHSocket -> replayRecentOutput), reproducing the
// sequence that used to double the chat:
//
//   1. Terminal has content; the WS drops -> snapshotTerminalBuffer() saves lines.
//   2. Component remounts; the snapshot restore is DEFERRED (registry.tsx).
//   3. WS re-attaches with ?replay=1 -> server replays the SAME raw PTY output.
//      The first server message CANCELS the deferred snapshot write.
//   => the chat renders once.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { saveBuffer, getBuffer, deleteBuffer } from "../lib/terminalBufferCache.ts";

// ── Minimal in-memory sessionStorage (the module reads window.sessionStorage) ──
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const storage = new MemoryStorage();
// @ts-expect-error test shim for a browser global the module probes
globalThis.window = { sessionStorage: storage };

// ── Model of the server side (server/lib/ssh.ts) ─────────────────────────────
class FakeServerSession {
  recentOutput: string[] = [];

  pushPtyOutput(chunk: string, client: FakeClient) {
    this.recentOutput.push(chunk);
    client.receive(chunk);
  }

// createSSHSocket(): if the session already exists, it replays recent output
  // to the socket. Returns the bytes so the caller can route them through the
  // pane's message handler (which is where the snapshot cancellation happens).
  attach(replayOnAttach: boolean): string {
    if (replayOnAttach && this.recentOutput.length > 0) {
      return this.recentOutput.join("");
    }
    return "";
  }
}

class FakeClient {
  screen = "";
  receive(data: string) { this.screen += data; }
}

// ── Model of the FIXED client remount (registry.tsx) ─────────────────────────
// Snapshot restore is deferred; the first server message cancels it.
const SNAPSHOT_DELAY_MS = 400;

class FixedPane {
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private term: FakeClient) {}

  onMount(bufferKey: string) {
    const cached = getBuffer(bufferKey);
    deleteBuffer(bufferKey);
    if (cached && cached.lines.length > 0) {
      this.snapshotTimer = setTimeout(() => {
        this.snapshotTimer = null;
        this.term.receive(cached.lines.join("\r\n"));
      }, SNAPSHOT_DELAY_MS);
    }
  }

  onServerMessage(data: string) {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.term.receive(data);
  }
}

const KEY = "session-1";
const COUNT = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

beforeEach(() => {
  storage.clear();
  deleteBuffer(KEY);
});

test("live server session: replay wins, snapshot is cancelled -> no double chat", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const first = new FakeClient();
  const server = new FakeServerSession();
  server.pushPtyOutput("user@host:~$ echo hi\r\nhi\r\n", first);
  saveBuffer(KEY, first.screen.split("\r\n").filter(Boolean), 0);

  const reopened = new FakeClient();
  const pane = new FixedPane(reopened);
  pane.onMount(KEY);

  // Server replays on attach; the pane routes that replay through
  // onServerMessage, which cancels the deferred snapshot.
  const replay = server.attach(/* replayOnAttach */ true);
  pane.onServerMessage(replay);

  await t.mock.timers.tick(SNAPSHOT_DELAY_MS * 2);

  assert.equal(
    COUNT(reopened.screen, "echo hi"),
    1,
    `expected a single render; got:\n${JSON.stringify(reopened.screen)}`,
  );
});

test("dead server session: snapshot is the last-resort fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const first = new FakeClient();
  first.receive("user@host:~$ ls\r\nfile\r\n");
  saveBuffer(KEY, first.screen.split("\r\n").filter(Boolean), 0);

  const reopened = new FakeClient();
  const pane = new FixedPane(reopened);
  pane.onMount(KEY);

  // No server message arrives (session gone) -> deferred snapshot renders.
  await t.mock.timers.tick(SNAPSHOT_DELAY_MS * 2);

  assert.equal(
    COUNT(reopened.screen, "ls"),
    1,
    `expected the snapshot fallback; got:\n${JSON.stringify(reopened.screen)}`,
  );
});