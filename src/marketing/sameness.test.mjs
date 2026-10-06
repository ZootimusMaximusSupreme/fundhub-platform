// Sameness (spec §7.6 check loop step 4): overlap with the last 30 hooks and bodies,
// one hook and one CTA per batch, and the intro caps. Pure, no database.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAP_LIMIT, RECENT_LIMIT, words, sameKey, wordTrigrams, trigramOverlap, maxOverlap,
  introKind, introCaps, hookOf, ctaOf, checkSameness
} from "./sameness.mjs";

const parts = (hook, cta, extra = []) => [{ kind: "hook", text: hook }, ...extra, { kind: "cta", text: cta }];
const script = (hook, cta, middle = "Lenders check the business file before the personal one on bigger lines.") => ({
  body: `${hook}\n\n${middle}\n\n${cta}`,
  parts: parts(hook, cta, [{ kind: "body", text: middle }])
});

describe("words and trigrams", () => {
  test("words drop case, punctuation and the up arrow, keep $ and digits together", () => {
    assert.deepEqual(words("Lenders READ two files ↑ — for $300,000!"), ["lenders", "read", "two", "files", "for", "$300,000"]);
    assert.deepEqual(words("I’m Chris."), ["i'm", "chris"]);
    assert.equal(sameKey("  Tap below, NOW. "), "tap below now");
  });

  test("trigrams of a 4-word text are 2", () => {
    assert.deepEqual([...wordTrigrams("one two three four")], ["one two three", "two three four"]);
  });

  test("overlap is the share of the NEW text's trigrams the old one has", () => {
    assert.equal(trigramOverlap("a b c d", "a b c d"), 1);
    assert.equal(trigramOverlap("a b c d", "x y z"), 0);
    // 2 of the new text's 4 trigrams are in the old one
    assert.equal(trigramOverlap("a b c d e f", "a b c d"), 0.5);
    // a copy with words added is still mostly a copy
    assert.ok(trigramOverlap("lenders read two files before they say yes", "lenders read two files before they say yes today") === 1);
  });

  test("under 3 words: same words is 1, else 0", () => {
    assert.equal(trigramOverlap("Book now", "book NOW."), 1);
    assert.equal(trigramOverlap("Book now", "Book today"), 0);
    assert.equal(trigramOverlap("", ""), 0);
  });

  test("maxOverlap names the closest one", () => {
    const r = maxOverlap("a b c d", ["x y z w", "a b c d", null]);
    assert.deepEqual(r, { overlap: 1, index: 1 });
  });
});

describe("hookOf and ctaOf", () => {
  test("from parts first", () => {
    const s = script("Hook here now.", "Tap below now.");
    assert.equal(hookOf(s), "Hook here now.");
    assert.equal(ctaOf(s), "Tap below now.");
  });
  test("from the body when there are no parts", () => {
    const s = { body: "First sentence here. Second one.\n\nLast line is the ask." };
    assert.equal(hookOf(s), "First sentence here.");
    assert.equal(ctaOf(s), "Last line is the ask.");
  });
});

describe("overlap with the last 30 hooks and bodies", () => {
  const draft = script("Lenders read two files before they say yes to you.", "Tap below to see both of your files today.");

  test("a hook above 0.5 against a recent hook triggers one rewrite", () => {
    const recent = [{ hook: "Lenders read two files before they say yes to anyone.", body: "something else entirely here" }];
    const r = checkSameness(draft, { recent });
    assert.ok(r.hook_overlap > OVERLAP_LIMIT, String(r.hook_overlap));
    assert.equal(r.overlap_too_high, true);
    assert.equal(r.rewrite, true);
    assert.equal(r.refused, false, "overlap with OLD scripts is a rewrite, never a refusal");
    assert.match(r.reasons.join(" "), /The hook repeats \d+% of a recent hook/);
  });

  test("a body above 0.5 (a hook swap on the same body) triggers one rewrite", () => {
    const recent = [{ hook: "A totally different opening line for this one.", body: draft.body.replace("Lenders read two files", "Banks look at two files") }];
    const r = checkSameness(draft, { recent });
    assert.ok(r.body_overlap > OVERLAP_LIMIT);
    assert.equal(r.rewrite, true);
    assert.match(r.reasons.join(" "), /rule 34/);
  });

  test("0.5 or under does not trigger a rewrite", () => {
    const recent = [{ hook: "Lenders read two files and then say no.", body: "Nothing in common with the new script at all, not one phrase." }];
    const r = checkSameness(draft, { recent });
    assert.ok(r.hook_overlap <= OVERLAP_LIMIT, String(r.hook_overlap));
    assert.equal(r.overlap_too_high, false);
    assert.equal(r.rewrite, false);
  });

  test("only the last 30 count: the 31st is not compared", () => {
    const filler = Array.from({ length: RECENT_LIMIT }, (_, i) => ({ hook: `Unrelated hook number ${i} about something else`, body: `body ${i} plain words here` }));
    const r = checkSameness(draft, { recent: [...filler, { hook: hookOf(draft), body: draft.body }] });
    assert.equal(r.overlap_too_high, false);
  });
});

describe("one hook and one CTA per batch", () => {
  const a = script("Lenders read two files before they say yes.", "Tap below to see both files today.");

  test("a hook another script in the batch has is refused", () => {
    const b = script("LENDERS read two files before they say yes!", "A different call to action for this one.");
    const r = checkSameness(a, { batch: [b] });
    assert.equal(r.duplicate_hook, true);
    assert.equal(r.refused, true);
    assert.equal(r.rewrite, true);
    assert.match(r.reasons.join(" "), /already has this hook/);
  });

  test("a CTA another script in the batch has is refused", () => {
    const b = script("A different hook about business files and banks.", "tap below to see BOTH files today");
    const r = checkSameness(a, { batch: [b] });
    assert.equal(r.duplicate_cta, true);
    assert.equal(r.refused, true);
    assert.match(r.reasons.join(" "), /already has this call to action/);
  });

  test("different hooks and CTAs pass", () => {
    const b = script("Your business file gets read first on the big lines.", "Tap below and get the Roadmap.");
    const r = checkSameness(a, { batch: [b] });
    assert.equal(r.refused, false);
    assert.equal(r.rewrite, false);
  });
});

describe("intro caps: long at most 1 in 5, short at most 2 in 5", () => {
  test("introKind", () => {
    assert.equal(introKind("My name is Chris and I fund businesses."), "long");
    assert.equal(introKind("I'm Chris, I run Fundhub."), "short");
    assert.equal(introKind("I am Chris."), "short");
    assert.equal(introKind("Lenders read two files."), null);
  });

  test("introCaps: floor of the ratio, never under 1", () => {
    assert.deepEqual(introCaps(21), { long: 4, short: 8 });
    assert.deepEqual(introCaps(5), { long: 1, short: 2 });
    assert.deepEqual(introCaps(10), { long: 2, short: 4 });
    assert.deepEqual(introCaps(3), { long: 1, short: 1 });
    assert.deepEqual(introCaps(0), { long: 1, short: 1 });
  });

  const withIntro = (intro, n) => script(`${intro} Hook number ${n} is about files.`, `Call to action number ${n} goes here.`);

  test("a second long intro in a batch of 5 is over the cap", () => {
    const batch = [withIntro("My name is Chris.", 1), withIntro("", 2), withIntro("", 3), withIntro("", 4)];
    const r = checkSameness(withIntro("My name is Chris.", 5), { batch, batchTotal: 5 });
    assert.equal(r.intro.kind, "long");
    assert.equal(r.intro.long_used, 2);
    assert.equal(r.intro.long_cap, 1);
    assert.equal(r.intro.over, true);
    assert.equal(r.rewrite, true);
    assert.equal(r.refused, false, "an intro over its cap is a rewrite, then a flag, never a refusal");
    assert.match(r.reasons.join(" "), /rule 31/);
  });

  test("a second short intro in a batch of 5 is fine, a third is over", () => {
    const one = [withIntro("I'm Chris, I run Fundhub.", 1)];
    assert.equal(checkSameness(withIntro("I'm Chris, I run Fundhub.", 2), { batch: one, batchTotal: 5 }).intro.over, false);
    const two = [...one, withIntro("I'm Chris, I run Fundhub.", 2)];
    const r = checkSameness(withIntro("I'm Chris, I run Fundhub.", 3), { batch: two, batchTotal: 5 });
    assert.equal(r.intro.short_used, 3);
    assert.equal(r.intro.over, true);
  });

  test("a batch of 21 takes 4 long intros", () => {
    const batch = [1, 2, 3].map((n) => withIntro("My name is Chris.", n));
    assert.equal(checkSameness(withIntro("My name is Chris.", 4), { batch, batchTotal: 21 }).intro.over, false);
    batch.push(withIntro("My name is Chris.", 4));
    assert.equal(checkSameness(withIntro("My name is Chris.", 5), { batch, batchTotal: 21 }).intro.over, true);
  });

  test("no intro is never over", () => {
    const batch = [1, 2].map((n) => withIntro("My name is Chris.", n));
    assert.equal(checkSameness(withIntro("", 3), { batch, batchTotal: 5 }).intro.over, false);
  });
});
