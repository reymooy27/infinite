// Pure transcript-merge logic for continuous SpeechRecognition.
// Kept React-free module-level helpers so they are unit-testable.

// Lowercase, strip punctuation, collapse whitespace — so comparisons against
// browser re-emissions survive Chrome's inconsistent capitalization/punctuation.
export function normalizeTranscript(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MergeResult {
  accumulated: string;
  appended: string;
}

// Merge a new finalized chunk into the accumulated transcript without ever
// duplicating text. Handles the three real-world behaviors of
// SpeechRecognition final results:
//   incremental — incoming is new speech only            -> append
//   cumulative  — incoming re-emits everything said so far -> replace with latest
//   re-emitted  — incoming is the same text again          -> ignore
export function mergeFinalTranscript(prev: string, incoming: string): MergeResult {
  const clean = incoming.trim();
  if (!clean) return { accumulated: prev, appended: "" };
  if (!prev.trim()) return { accumulated: clean, appended: clean };

  const nPrev = normalizeTranscript(prev);
  const nIn = normalizeTranscript(clean);

  if (nIn === nPrev) return { accumulated: prev, appended: "" };

  // Word-boundary guarded: "katak kerja" must not match prefix "kata".
  if (nIn.startsWith(nPrev + " ")) {
    // Cumulative re-emission: incoming is a superset, latest raw text wins.
    // ponytail: appends the raw word-tail only for onResult consumers; word
    // counts can misalign if punctuation splits/merges tokens. Upgrade path:
    // return segments instead of a joined string if a consumer ever needs it.
    const tail = clean.split(/\s+/).slice(nPrev.split(/\s+/).length).join(" ");
    return { accumulated: clean, appended: tail };
  }

  return { accumulated: prev + " " + clean, appended: clean };
}
