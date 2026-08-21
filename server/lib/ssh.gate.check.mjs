// Runnable self-check for the output-gate byte logic in ssh.ts.
// Run: node server/lib/ssh.gate.check.mjs   (exits non-zero on failure)
import assert from "node:assert";

const BOOTSTRAP_SENTINEL = "\x1b_INFBOOT\x1b\\";

// Mirror of gateOutput() — kept in sync by hand (pure, ~10 lines).
function makeGate() {
  let gateBuffer = Buffer.alloc(0);
  return (data) => {
    if (gateBuffer === undefined) return data;
    gateBuffer = Buffer.concat([gateBuffer, data]);
    const sentinel = Buffer.from(BOOTSTRAP_SENTINEL, "binary");
    const idx = gateBuffer.indexOf(sentinel);
    if (idx === -1) return null;
    const after = gateBuffer.subarray(idx + sentinel.length);
    gateBuffer = undefined;
    return after.length > 0 ? Buffer.from(after) : null;
  };
}

// 1. Bootstrap before sentinel is withheld; only trailing bytes forwarded.
let g = makeGate();
assert.strictEqual(g(Buffer.from("bootstrap noise")), null);
assert.strictEqual(
  g(Buffer.from(`more${BOOTSTRAP_SENTINEL}VISIBLE`)).toString(),
  "VISIBLE",
);
assert.strictEqual(g(Buffer.from(" after")).toString(), " after"); // gate stays open

// 2. Sentinel split across two chunks is still detected.
g = makeGate();
const s = BOOTSTRAP_SENTINEL;
assert.strictEqual(g(Buffer.from("x" + s.slice(0, 3))), null);
assert.strictEqual(g(Buffer.from(s.slice(3) + "SHOWN")).toString(), "SHOWN");

// 3. Sentinel with nothing after it yields null, then next bytes flow.
g = makeGate();
assert.strictEqual(g(Buffer.from(`boot${s}`)), null);
assert.strictEqual(g(Buffer.from("next")).toString(), "next");

console.log("ssh gate self-check: OK");
