// src/marketing/voice.mjs — voice pairs from Chris's edits (spec §7.2, plan
// unit U25). No database.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffVoicePairs, keepMachineLines, squeeze, MAX_SEGMENTS, PART_KINDS } from "./voice.mjs";

const PARTS = [
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
];
const body = (parts) => parts.map((p) => p.text).join("\n\n");
const swap = (parts, i, text) => parts.map((p, j) => (j === i ? { ...p, text } : p));

describe("diffVoicePairs", () => {
  test("one changed part gives one pair, with the machine's part kind", () => {
    const after = swap(PARTS, 5, "Tap below. See both files before a lender does.");
    const pairs = diffVoicePairs({ body: body(PARTS), parts: PARTS }, { body: body(after), parts: after });
    assert.deepEqual(pairs, [{
      before: "Tap below and see what both files say today.",
      after: "Tap below. See both files before a lender does.",
      kind: "cta"
    }]);
  });

  test("nothing changed, or only spaces changed: no pairs", () => {
    assert.deepEqual(diffVoicePairs({ body: body(PARTS), parts: PARTS }, { body: body(PARTS), parts: PARTS }), []);
    const spaced = swap(PARTS, 0, "  MOST lenders  read TWO files before they say yes. ");
    assert.deepEqual(diffVoicePairs({ parts: PARTS }, { parts: spaced }), []);
  });

  test("a removed line or an added line alone is not a pair", () => {
    const removed = PARTS.filter((_, i) => i !== 3);
    assert.deepEqual(diffVoicePairs({ parts: PARTS }, { parts: removed }), []);
    const added = [...PARTS.slice(0, 4), { kind: "cue", text: "a brand new cue" }, ...PARTS.slice(4)];
    assert.deepEqual(diffVoicePairs({ parts: PARTS }, { parts: added }), []);
  });

  test("changes on both sides of a kept line are paired inside their own gaps", () => {
    let after = swap(PARTS, 0, "Lenders read two files. Most people only fix one.");
    after = swap(after, 4, "We read both files first.");
    const pairs = diffVoicePairs({ parts: PARTS }, { parts: after });
    assert.deepEqual(pairs.map((p) => [p.kind, p.after]), [
      ["hook", "Lenders read two files. Most people only fix one."],
      ["reveal", "We read both files first."]
    ]);
  });

  test("with no parts on either side, body lines are compared and the kind is null", () => {
    const oldBody = "Line one stays.\n\nThe machine said this.\nLast line stays.";
    const newBody = "Line one stays.\n\nChris says it his way.\nLast line stays.\n";
    assert.deepEqual(diffVoicePairs({ body: oldBody }, { body: newBody }), [
      { before: "The machine said this.", after: "Chris says it his way.", kind: null }
    ]);
    // parts on one side only: still the body.
    assert.deepEqual(diffVoicePairs({ body: oldBody, parts: PARTS }, { body: newBody, parts: null }), [
      { before: "The machine said this.", after: "Chris says it his way.", kind: null }
    ]);
  });

  test("the same edit twice is one pair; a kind outside the label shape is null", () => {
    const oldBody = "same old line\nkeep\nsame old line";
    const newBody = "same new line\nkeep\nsame new line";
    assert.equal(diffVoicePairs({ body: oldBody }, { body: newBody }).length, 1);
    const weird = [{ kind: "Not A Kind", text: "a" }];
    assert.deepEqual(diffVoicePairs({ parts: weird }, { parts: [{ kind: "cue", text: "b" }] }), [{ before: "a", after: "b", kind: "cue" }]);
  });

  test("past the size cap it gives up quietly instead of slowing the save", () => {
    const huge = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => `line ${i}`).join("\n");
    assert.deepEqual(diffVoicePairs({ body: huge }, { body: huge.replace("line 3", "changed") }), []);
    assert.deepEqual(diffVoicePairs(null, { body: "x" }), []);
  });

  test("PART_KINDS are the six spec kinds", () => {
    assert.deepEqual([...PART_KINDS], ["hook", "line2", "body", "cue", "reveal", "cta"]);
    assert.equal(squeeze("  a \n b  "), "a b");
  });
});

describe("keepMachineLines", () => {
  const machine = { body: body(PARTS), parts: PARTS };

  test("keeps only pairs whose before is a line the machine wrote", () => {
    const pairs = [
      { before: "Tap below and see what both files say today.", after: "Chris's CTA.", kind: "cta" },
      { before: "A line Chris wrote last time.", after: "Chris changed his own line.", kind: "cue" }
    ];
    assert.deepEqual(keepMachineLines(pairs, machine), [pairs[0]]);
  });

  test("a machine line still counts after an earlier edit changed a different line", () => {
    const v2 = swap(PARTS, 0, "Chris's own hook.");
    const v3 = swap(v2, 5, "Chris's own CTA.");
    const pairs = keepMachineLines(diffVoicePairs({ parts: v2 }, { parts: v3 }), machine);
    assert.deepEqual(pairs, [{ before: PARTS[5].text, after: "Chris's own CTA.", kind: "cta" }]);
    // Changing his own hook again teaches the voice file nothing.
    const v4 = swap(v3, 0, "Chris's hook, again.");
    assert.deepEqual(keepMachineLines(diffVoicePairs({ parts: v3 }, { parts: v4 }), machine), []);
  });

  test("a body line of a multi-line part counts as a machine line too", () => {
    const m = { body: "first line\nsecond line", parts: [{ kind: "body", text: "first line\nsecond line" }] };
    const pairs = [{ before: "second line", after: "2nd line", kind: null }];
    assert.deepEqual(keepMachineLines(pairs, m), pairs);
  });

  test("no machine version (a script Chris wrote himself): no pairs", () => {
    assert.deepEqual(keepMachineLines([{ before: "a", after: "b", kind: null }], null), []);
    assert.deepEqual(keepMachineLines([], machine), []);
  });
});
