// Run: node_modules/.bin/tsx src/apps/opencode-parts.check.ts
import assert from "node:assert/strict";
import {
  appendDeltaIn,
  buildMentionParts,
  extractLastTodos,
  upsertInfoIn,
  upsertPartIn,
  type OcMessageEntry,
} from "./opencode-parts";

const userMsg: OcMessageEntry = {
  info: { id: "msg_u", role: "user" },
  parts: [{ id: "p_u", type: "text", text: "hello" }],
};
const base: OcMessageEntry[] = [userMsg];

// upsertPartIn: unknown message creates assistant placeholder, refs shared elsewhere
const p1 = { id: "p_a", type: "text", text: "wor" };
const s1 = upsertPartIn(base, "msg_a", p1);
assert.equal(s1.length, 2);
assert.equal(s1[0], userMsg);
assert.equal(s1[1].info.role, "assistant");

// upsertPartIn: replace by id keeps other parts by reference, idempotent on same ref
const p2 = { id: "p_b", type: "text", text: "ld" };
const s2 = upsertPartIn(s1, "msg_a", p2);
const s2b = upsertPartIn(s2, "msg_a", p1);
assert.equal(s2b[1].parts[0], p1);
assert.equal(upsertPartIn(s2b, "msg_a", p1), s2b);

// appendDeltaIn: appends, non-text/unknown → null (fallback trigger)
const s3 = appendDeltaIn(s2, "msg_a", "p_a", "text", "k!")!;
assert.equal(s3[1].parts[0].text, "work!");
assert.equal(s3[0], userMsg);
assert.equal(appendDeltaIn(s3, "msg_a", "p_a", "metadata", "x"), null);
assert.equal(appendDeltaIn(s3, "nope", "p_a", "text", "x"), null);
assert.equal(appendDeltaIn(s3, "msg_a", "nope", "text", "x"), null);

// upsertInfoIn: placeholder merged (parts kept), completed flips busy off
const s4 = upsertInfoIn(s3, { id: "msg_a", role: "assistant", time: { created: 1, completed: 2 } });
assert.equal(s4[1].parts, s3[1].parts);
assert.equal(s4[1].info.time?.completed, 2);

// upsertInfoIn: real user message drops the optimistic entry
const withOptimistic = [...s4, { info: { id: `optimistic-1`, role: "user" }, parts: [] }];
const s5 = upsertInfoIn(withOptimistic, { id: "msg_u2", role: "user", time: { created: 3 } });
assert.ok(!s5.some((m) => m.info.id.startsWith("optimistic-")));
assert.equal(s5.length, 3);

// extractLastTodos: last todowrite wins, other tools ignored, none → null
const mkTodos = (a: string, b: string): OcMessageEntry => ({
  info: { id: `m_${a}`, role: "assistant" },
  parts: [
    { id: `t_${a}`, type: "tool", tool: "todowrite", state: { status: "completed", input: { todos: [{ content: a }, { content: b }] } } },
  ],
});
const history: OcMessageEntry[] = [
  mkTodos("first", "one"),
  { info: { id: "m_edit", role: "assistant" }, parts: [{ id: "t_e", type: "tool", tool: "edit", state: { status: "completed" } }] },
  mkTodos("second", "two"),
];
assert.deepEqual(extractLastTodos(history), [{ content: "second" }, { content: "two" }]);
assert.equal(extractLastTodos([history[1]]), null);
assert.deepEqual(extractLastTodos([{ info: { id: "x", role: "assistant" }, parts: [{ id: "t", type: "tool", tool: "todowrite", state: { status: "completed" } }] }]), []);

// buildMentionParts: only tracked paths still present as @tokens; file:// url,
// ext-based mime, empty root → nothing
const parts = buildMentionParts(
  "fix @src/a.ts and bye",
  ["src/a.ts", "gone.ts"],
  "/home/dev/proj/",
);
assert.equal(parts.length, 1);
assert.equal(parts[0].url.replace(/%2F/g, "/"), "file:///home/dev/proj/src/a.ts");
assert.equal(parts[0].filename, "src/a.ts");
assert.equal(parts[0].mime, "text/typescript");
assert.deepEqual(buildMentionParts("hello", ["src/a.ts"], ""), []);

console.log("opencode-parts: all checks passed");
