// Quick copy's verdict: the repo's own ad checker on the saved words, in
// Chris's words (design §2 J9, unit X3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { quickCopyVerdict } from "./quick-copy.mjs";

test("clean words pass, in one plain sentence", () => {
  const v = quickCopyVerdict("Two lenders read your business file before they read the personal one. See what they see first.");
  assert.equal(v.ok, true, JSON.stringify(v.failures));
  assert.equal(v.words, "Checked against the ad rules: it passes.");
});

test("an em dash and a banned word are named, counted, and never hidden", () => {
  const v = quickCopyVerdict("We leverage our lenders — and you get funded.");
  assert.equal(v.ok, false);
  assert.ok(v.failures.some((f) => f.rule === "em-dash"));
  assert.ok(v.failures.some((f) => f.rule === "banned-word"));
  assert.match(v.words, /^Checked against the ad rules: \d+ problems\. /);
});

test("empty text is a problem, not a pass", () => {
  assert.equal(quickCopyVerdict("").ok, false);
});
