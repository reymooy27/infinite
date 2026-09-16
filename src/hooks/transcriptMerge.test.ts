// Run: node --test src/hooks/transcriptMerge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFinalTranscript, normalizeTranscript } from "./transcriptMerge.ts";

test("incremental finals append once", () => {
  assert.deepEqual(mergeFinalTranscript("halo", "apa kabar"), {
    accumulated: "halo apa kabar",
    appended: "apa kabar",
  });
});

test("cumulative re-emission with new punctuation does NOT duplicate (the bug)", () => {
  const r = mergeFinalTranscript("halo apa kabar", "Halo apa kabar. Baik-baik saja");
  assert.equal(r.accumulated, "Halo apa kabar. Baik-baik saja");
  assert.equal(normalizeTranscript(r.accumulated), "halo apa kabar baik-baik saja");
  assert.ok(!r.accumulated.toLowerCase().startsWith("halo apa kabar halo"));
  assert.equal(r.appended, "Baik-baik saja");
});

test("exact re-emission is ignored", () => {
  assert.deepEqual(mergeFinalTranscript("halo apa kabar", "Halo apa kabar."), {
    accumulated: "halo apa kabar",
    appended: "",
  });
});

test("word-boundary prefix is not treated as cumulative", () => {
  const r = mergeFinalTranscript("kata", "katak kerja");
  assert.equal(r.accumulated, "kata katak kerja");
  assert.equal(r.appended, "katak kerja");
});

test("first chunk seeds accumulator", () => {
  assert.deepEqual(mergeFinalTranscript("", " halo "), {
    accumulated: "halo",
    appended: "halo",
  });
});

test("empty incoming is a no-op", () => {
  assert.deepEqual(mergeFinalTranscript("halo", "  "), { accumulated: "halo", appended: "" });
});
