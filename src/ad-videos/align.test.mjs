// The spec §9.2 aligner (src/ad-videos/align.mjs), rule by rule.
//
// Fake transcripts only — no ffmpeg, no whisper, no database, no network.
// The fixtures build whisper-shaped words and silencedetect-shaped silences
// from plain text (src/ad-videos/fixtures/align-takes.mjs); the scripts are in
// the ad_scripts.parts shape (src/ad-videos/fixtures/align-scripts.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  alignTakes, spokenWords, numberToWords, editSimilarity, wordsMatch, linesFromParts,
  prepareTake, findAttempts, resolveAnchor, cueKeywords, ALIGN_DEFAULTS
} from "./align.mjs";
import { say, take, wordAt } from "./fixtures/align-takes.mjs";
import { BULLETS_PARTS, THREE_LINES, ONE_LINE } from "./fixtures/align-scripts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = "2026-10-06T10:00:00Z";
const T1 = "2026-10-06T10:05:00Z";
const T2 = "2026-10-06T10:10:00Z";

const HOOK = "Lenders read two files before they ever say yes to you.";
const BODY = "Your score hides the thirteen data points that cap your funding.";
const CTA = "Tap below and grab your roadmap today.";

const spoken = (s) => spokenWords(s).map((t) => t.t + (t.opt ? "?" : "")).join(" ");
const keptText = (plan) => plan.pieces.flatMap((p) => p.words.map((w) => w.w)).join(" ");
const playsAt = (plan, takeId, t) => plan.pieces.some((p) => p.take_id === takeId && p.start <= t && t <= p.end);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} expected ${b}, got ${a}`);

/* Every plan obeys these, whatever the takes: no inserted silence (every
   second comes from a take), no moment of a take played twice, words inside
   their piece, and the master's clock adds up. */
function assertSane(plan, takes) {
  const byId = new Map(takes.map((t) => [t.take_id, t]));
  let out = 0;
  for (const p of plan.pieces) {
    const t = byId.get(p.take_id);
    assert.ok(t, "piece from a known take");
    assert.ok(p.start >= 0 && p.end > p.start, "piece has length");
    assert.ok(p.end <= t.duration + 1e-6, "piece inside its take");
    close(p.out_start, out, "out_start");
    out += p.end - p.start;
    close(p.out_end, Math.round(out * 1000) / 1000, "out_end");
    for (const w of p.words) assert.ok(w.start >= p.start - 1e-6 && w.end <= p.end + 1e-6, `word ${w.w} inside its piece`);
  }
  close(plan.duration, Math.round(out * 1000) / 1000, "duration");
  for (const id of byId.keys()) {
    const mine = plan.pieces.filter((p) => p.take_id === id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i].start >= mine[i - 1].end - 1e-6, "no moment played twice");
  }
}

function plan(parts, takes, extra = {}) {
  const p = alignTakes({ takes, parts, ...extra });
  assertSane(p, takes);
  return p;
}

/* ═════════════════════════════════════════════════════════════════════════ */

describe("spoken words: both sides normalized the same way", () => {
  test("$300,000, 300K and 300 grand are all three hundred thousand (dollars optional)", () => {
    assert.equal(spoken("$300,000"), "three hundred thousand dollars?");
    assert.equal(spoken("300 grand"), "three hundred thousand dollars?");
    assert.equal(spoken("$300K"), "three hundred thousand dollars?");
    assert.equal(spoken("300K"), "three hundred thousand");
    assert.equal(spoken("300k"), "three hundred thousand");
    assert.equal(spoken("$1.5 million"), "one point five million dollars?");
    assert.equal(spoken("$1.5M"), "one point five million dollars?");
  });

  test("the forms match each other in a real alignment, with or without 'dollars'", () => {
    const parts = [{ kind: "hook", text: "Get $300,000 in funding today." }];
    for (const said of ["Get three hundred grand in funding today.", "Get 300K in funding today.",
      "Get three hundred thousand dollars in funding today.", "Get $300,000 in funding today."]) {
      const t = [take("t1", T0, said)];
      const p = plan(parts, t);
      assert.equal(p.coverage, 1, said);
      assert.equal(p.lines[0].state, "kept", said);
    }
  });

  test("'a' counts as 'one' before hundred, thousand or million", () => {
    assert.equal(spoken("a hundred thousand"), "one hundred thousand");
    assert.equal(spoken("a million"), "one million");
    assert.equal(spoken("a hundred grand"), "one hundred thousand dollars?");
    assert.equal(spoken("a house"), "a house");
    assert.equal(spoken("$100,000"), "one hundred thousand dollars?");
  });

  test("% becomes percent", () => {
    assert.equal(spoken("10%"), "ten percent");
    assert.equal(spoken("ten percent"), "ten percent");
    assert.equal(spoken("3.75%"), "three point seven five percent");
  });

  test("contractions are expanded", () => {
    assert.equal(spoken("don't"), "do not");
    assert.equal(spoken("You're"), "you are");
    assert.equal(spoken("it's"), "it is");
    assert.equal(spoken("can't"), "can not");
    assert.equal(spoken("won't"), "will not");
    assert.equal(spoken("I'm"), "i am");
    assert.equal(spoken("we'll"), "we will");
    assert.equal(spoken("they've"), "they have");
    assert.equal(spoken("let's"), "let us");
    assert.equal(spoken("I’d"), "i would");
    assert.equal(spoken("Chris's"), "chriss", "a possessive stays one word");
  });

  test("CAPS and ↑ marks are dropped", () => {
    assert.equal(spoken("↑MOST lenders read TWO files"), "most lenders read two files");
    assert.equal(spoken("low-interest"), "low interest");
  });

  test("numbers read the way they are said", () => {
    assert.deepEqual(numberToWords(760), ["seven", "hundred", "sixty"]);
    assert.deepEqual(numberToWords(2023), ["two", "thousand", "twenty", "three"]);
    assert.deepEqual(numberToWords(1500000), ["one", "million", "five", "hundred", "thousand"]);
    assert.deepEqual(numberToWords(0), ["zero"]);
    assert.equal(spoken("a hundred and fifty"), spoken("150"));
  });
});

describe("edit similarity 0.8 for words of 5+ letters", () => {
  test("the similarity number", () => {
    close(editSimilarity("lenders", "lender"), 1 - 1 / 7);
    close(editSimilarity("loans", "loan"), 0.8);
    assert.equal(editSimilarity("same", "same"), 1);
  });

  test("close words of 5+ letters match; short words must be the same word", () => {
    assert.equal(wordsMatch("files", "files"), 2);
    assert.equal(wordsMatch("lenders", "lender"), 1);
    assert.equal(wordsMatch("loans", "loan"), 1, "the longer word has 5 letters, 0.8 similar");
    assert.equal(wordsMatch("where", "were"), 1);
    assert.equal(wordsMatch("fund", "find"), 0, "4 letters: no fuzzy match");
    assert.equal(wordsMatch("their", "there"), 0, "0.6 similar");
    assert.equal(wordsMatch("fundable", "fundability"), 0);
  });

  test("a close word counts toward coverage", () => {
    const p = plan([{ kind: "hook", text: "Lenders approve fundable files fast." }],
      [take("t1", T0, "Lender approves fundable files fast.")]);
    assert.equal(p.coverage, 1);
  });
});

describe("lines from parts, with the planned pauses", () => {
  test("the U01 bullets script: 7 lines, cues freestyle, blank lines where the body has them", () => {
    const lines = linesFromParts(BULLETS_PARTS, "bullets");
    assert.deepEqual(lines.map((l) => l.kind), ["hook", "line2", "cue", "cue", "cue", "reveal", "cta"]);
    assert.deepEqual(lines.map((l) => l.planned_pause), [true, true, false, false, true, true, false]);
    assert.deepEqual(lines.map((l) => l.verbatim), [true, true, false, false, false, true, true]);
  });

  test("in words style every part is said word for word", () => {
    assert.ok(linesFromParts(BULLETS_PARTS, "words").every((l) => l.verbatim));
  });

  test("rows of a part are lines; a blank row after a line is a planned pause", () => {
    const lines = linesFromParts([
      { kind: "hook", text: "One two three." },
      { kind: "body", text: "Four five six.\nSeven eight nine.\n\nTen eleven twelve." },
      { kind: "cta", text: "Thirteen fourteen." }
    ]);
    assert.deepEqual(lines.map((l) => l.text), ["One two three.", "Four five six.", "Seven eight nine.", "Ten eleven twelve.", "Thirteen fourteen."]);
    assert.deepEqual(lines.map((l) => l.planned_pause), [true, false, true, true, false]);
    assert.deepEqual(lines.map((l) => l.line_idx), [0, 1, 2, 3, 4]);
  });

  test("a row with no spoken words is not a line", () => {
    const lines = linesFromParts([{ kind: "body", text: "↑\n\nReal words here." }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, "Real words here.");
  });
});

describe("attempts, with takes ordered by recorded_at", () => {
  test("takes are put in filming order; an even tie goes to the latest take", () => {
    const takes = [take("late", T2, HOOK), take("early", T0, HOOK)];
    const p = plan(ONE_LINE, takes);
    assert.deepEqual(p.takes.map((t) => t.take_id), ["early", "late"]);
    assert.equal(p.pieces[0].take_id, "late");
  });

  test("a take with no recorded_at goes after the dated ones", () => {
    const p = plan(ONE_LINE, [take("undated", null, HOOK), take("dated", T0, HOOK)]);
    assert.deepEqual(p.takes.map((t) => t.take_id), ["dated", "undated"]);
  });

  test("every attempt at a line is found", () => {
    const t = prepareTake(take("t1", T0, `${HOOK} |1.5| ${HOOK} |1.5| ${HOOK}`));
    const found = findAttempts(linesFromParts(ONE_LINE), t).get(0);
    assert.equal(found.filter((c) => !c.stitched && c.coverage === 1).length, 3);
  });

  test("a short line inside a longer line: the longer line said 6 of 7 keeps its attempt", () => {
    const parts = [{ kind: "hook", text: HOOK }, { kind: "body", text: "Grab your roadmap." }, { kind: "cta", text: CTA }];
    const t = take("t1", T0, `${HOOK} |0.6| Grab your roadmap. |0.6| Tap below and grab your roadmap.`);
    const p = plan(parts, [t]);
    assert.equal(p.ok, true);
    assert.deepEqual(p.missing_lines, []);
    assert.deepEqual(p.hold_reasons, []);
    assert.equal(p.lines[2].state, "kept");
    assert.equal(p.lines[2].coverage, 0.857);
    assert.deepEqual(p.pieces.map((x) => x.line_idx), [0, 1, 2]);
    /* The short line plays from its own reading, not from inside the CTA. */
    const body = p.pieces.find((x) => x.line_idx === 1);
    assert.ok(body.start <= wordAt(t, "grab", 0).start && body.end < wordAt(t, "tap").start);
    assert.ok(playsAt(p, "t1", wordAt(t, "grab", 1).start), "the CTA's own 'grab' plays");
  });

  test("a 2-word CTA inside a body line said 8 of 9: the body stays kept", () => {
    const parts = [{ kind: "hook", text: HOOK }, { kind: "body", text: "So tap below and see what both files say." },
      { kind: "cta", text: "Tap below." }];
    const t = take("t1", T0, `${HOOK} |0.6| So tap below and see what both files. |0.6| Tap below.`);
    const p = plan(parts, [t]);
    assert.equal(p.ok, true);
    assert.equal(p.lines[1].state, "kept");
    assert.equal(p.lines[1].coverage, 0.889);
    assert.deepEqual(p.said_differently, []);
    const cta = p.pieces.find((x) => x.line_idx === 2);
    assert.ok(cta.start >= wordAt(t, "tap", 1).start - 0.04 - 1e-6, "the CTA plays its own reading");
  });

  test("the hook said again as the last line: each line gets its own copy", () => {
    const parts = [{ kind: "hook", text: HOOK }, { kind: "body", text: "Grab your roadmap today." }, { kind: "cta", text: HOOK }];
    const t = take("t1", T0, `${HOOK} |0.6| Grab your roadmap today. |0.6| ${HOOK}`);
    const p = plan(parts, [t]);
    assert.equal(p.ok, true);
    assert.deepEqual(p.missing_lines, []);
    assert.deepEqual(p.lines.map((l) => l.state), ["kept", "kept", "kept"]);
    assert.deepEqual(p.pieces.map((x) => x.line_idx), [0, 1, 2]);
    for (let i = 1; i < p.pieces.length; i++) assert.ok(p.pieces[i].start >= p.pieces[i - 1].end, "pieces in time order");
    assert.ok(playsAt(p, "t1", wordAt(t, "lenders", 0).start));
    assert.ok(playsAt(p, "t1", wordAt(t, "lenders", 1).start));
  });

  test("identical lines: a hook retake stays the hook's, the copy after the body is the CTA's", () => {
    const parts = [{ kind: "hook", text: HOOK }, { kind: "body", text: "Grab your roadmap today." }, { kind: "cta", text: HOOK }];
    const t = take("t1", T0, `${HOOK} |0.6| ${HOOK} |0.6| Grab your roadmap today. |0.6| ${HOOK}`);
    const p = plan(parts, [t]);
    assert.equal(p.ok, true);
    assert.deepEqual(p.pieces.map((x) => x.line_idx), [0, 1, 2]);
    const hook = p.pieces.find((x) => x.line_idx === 0);
    const cta = p.pieces.find((x) => x.line_idx === 2);
    assert.ok(hook.start >= wordAt(t, "lenders", 1).start - 0.04 - 1e-6 && hook.end < wordAt(t, "grab").start,
      "the hook plays its latest try before the body");
    assert.ok(cta.start >= wordAt(t, "lenders", 2).start - 0.04 - 1e-6, "the CTA plays the copy after the body");
  });
});

describe("restarts are stitched within 8 s", () => {
  test("a restart in the middle of a line keeps the second copy only", () => {
    const t = take("t1", T0, "Lenders read two files before they |0.6| before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.equal(keptText(p), "Lenders read two files before they ever say yes to you.");
    assert.equal(p.coverage, 1);
    assert.equal(playsAt(p, "t1", wordAt(t, "before", 0).start + 0.1), false, "the abandoned copy is cut");
    assert.equal(p.pieces.length, 2);
  });

  test("a restart from the top keeps the full second read", () => {
    const t = take("t1", T0, `Lenders read two files before |0.5| ${HOOK}`);
    const p = plan(ONE_LINE, [t]);
    assert.equal(keptText(p), HOOK);
    close(p.pieces[0].start, wordAt(t, "lenders", 1).start - 0.04);
  });

  test("attempt A (words 1..k) and a later attempt B starting at word j ≤ k+1 join at word j", () => {
    const t = take("t1", T0, "Lenders read two files |0.8| uh |0.8| read two files before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.equal(p.coverage, 1);
    assert.equal(keptText(p), "Lenders read two files before they ever say yes to you.");
    assert.equal(playsAt(p, "t1", wordAt(t, "read", 0).start + 0.1), false, "A's copy of 'read two files' is cut");
    assert.equal(playsAt(p, "t1", wordAt(t, "lenders", 0).start + 0.1), true, "A's word before j is kept");
  });

  test("more than 8 s apart, it is not a restart: the two attempts stay apart", () => {
    const t = take("t1", T0, "Lenders read two files |9| read two files before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.equal(keptText(p), "read two files before they ever say yes to you.");
    assert.equal(p.lines[0].coverage, 0.909);
  });

  test("a cut-off word ('hid-') before the restart is dropped with it", () => {
    const parts = [{ kind: "hook", text: "There are thirteen hidden data points in your file." }];
    const t = take("t1", T0, "There are thirteen hid- |0.5| hidden data points in your file.");
    const p = plan(parts, [t]);
    assert.equal(keptText(p), "There are thirteen hidden data points in your file.");
    /* Without the dash whisper puts on a cut-off word, "hid" is just a word
       that was said: it stays. */
    const plain = take("t1", T0, "There are thirteen hid |0.5| hidden data points in your file.");
    assert.match(keptText(plan(parts, [plain])), /thirteen hid hidden/);
  });
});

describe("pick: the latest attempt with 90%+ coverage and no stall over 1.0 s", () => {
  test("two clean attempts: the later one", () => {
    const t = take("t1", T0, `${HOOK} |1.5| ${HOOK}`);
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, wordAt(t, "lenders", 1).start - 0.04);
  });

  test("the later attempt stalls for 1.2 s: the earlier one", () => {
    const t = take("t1", T0, `${HOOK} |1.5| Lenders read two files |1.2| before they ever say yes to you.`);
    const p = plan(ONE_LINE, [t]);
    assert.equal(p.pieces.length, 1);
    close(p.pieces[0].start, wordAt(t, "lenders", 0).start - 0.04);
    assert.deepEqual(p.stalls, []);
  });

  test("the later attempt is at 82% (9 of 11): the earlier one", () => {
    const t = take("t1", T0, `${HOOK} |1.5| Lenders read two files before they say yes you.`);
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, wordAt(t, "lenders", 0).start - 0.04);
  });

  test("the later attempt is at 91% (10 of 11): it qualifies, so the later one", () => {
    const t = take("t1", T0, `${HOOK} |1.5| Lenders read two files before they say yes to you.`);
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, wordAt(t, "lenders", 1).start - 0.04);
    assert.equal(p.lines[0].coverage, 0.909);
  });

  test("none qualifies: the highest coverage is kept, marked said differently", () => {
    const t = take("t1", T0, "Lenders read two files before they say yes you. |1.5| Lenders read two files they say yes.");
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, wordAt(t, "lenders", 0).start - 0.04);
    assert.equal(p.lines[0].state, "said_differently");
    assert.equal(p.said_differently[0].how, "best_attempt");
  });

  test("a kept attempt's stall over 1.0 s is reported and cut down", () => {
    const t = take("t1", T0, "Lenders read two files |1.5| before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.equal(p.stalls.length, 1);
    close(p.stalls[0].seconds, 1.5);
    assert.equal(p.pieces.length, 2);
    const kept = (p.pieces[0].end - wordAt(t, "files").end) + (wordAt(t, "before").start - p.pieces[1].start);
    close(kept, 0.08 + 0.25 + 0.04, "the pause left is the two edges plus the 250 ms tail");
  });
});

describe("the dynamic program across takes: (1 − coverage) + 0.15 per switch", () => {
  const missing = (line, word) => line.replace(new RegExp(`\\b${word}\\b `), "");

  test("a slightly better line in another take is not worth two switches", () => {
    const t1 = take("t1", T0, `${missing(HOOK, "ever")} |0.3| ${BODY} |0.3| ${CTA}`);
    const t2 = take("t2", T1, HOOK);
    const p = plan(THREE_LINES, [t1, t2]);
    assert.deepEqual(p.pieces.map((x) => x.take_id), ["t1"]);
    assert.equal(p.lines[0].coverage, 0.909);
  });

  test("two better lines in a row are worth one switch", () => {
    const t1 = take("t1", T0, `${missing(HOOK, "ever")} |0.3| ${missing(BODY, "the")} |0.3| ${CTA}`);
    const t2 = take("t2", T1, `${HOOK} |0.3| ${BODY}`);
    const p = plan(THREE_LINES, [t1, t2]);
    assert.deepEqual(p.lines.map((l) => l.take_id), ["t2", "t2", "t1"]);
    assert.equal(p.coverage, 1);
  });

  test("an even tie stays in the take it is already in, even when the other take is later", () => {
    const t1 = take("t1", T0, `${HOOK} |0.3| ${BODY} |0.3| Tap below and grab your roadmap.`);
    const t2 = take("t2", T1, "Tap below and grab your roadmap.");
    const p = plan(THREE_LINES, [t1, t2]);
    assert.deepEqual(p.lines.map((l) => l.take_id), ["t1", "t1", "t1"]);
  });
});

describe("edges: 40 ms before, 80 ms after, snapped to silence within 250 ms", () => {
  test("a clean line: 40 ms before the first word, 80 ms after the last, no tail at the end", () => {
    const t = take("t1", T0, HOOK);
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, 0.5 - 0.04);
    close(p.pieces[0].end, wordAt(t, "you").end + 0.08);
  });

  test("an edge that lands in sound moves to the nearest silence within 250 ms", () => {
    const t = take("t1", T0, HOOK, { start: 2.0 });
    const last = t.words[t.words.length - 1].end;
    t.silences = [{ start: 1.5, end: 1.9 }, { start: last + 0.15, end: t.duration }];
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, 1.9, "the speech really started at 1.9");
    close(p.pieces[0].end, last + 0.15, "the speech really ran to the silence");
  });

  test("a silence more than 250 ms away is ignored", () => {
    const t = take("t1", T0, HOOK, { start: 2.0 });
    t.silences = [{ start: 1.5, end: 1.7 }];
    const p = plan(ONE_LINE, [t]);
    close(p.pieces[0].start, 2.0 - 0.04);
  });
});

describe("gaps: the source's own pause, up to 250 ms (450 ms at a planned pause)", () => {
  const twoRows = (sep) => [{ kind: "body", text: `${HOOK}${sep}${BODY}` }];

  test("between lines: the tail runs 250 ms into the pause, the next line starts 40 ms early", () => {
    const t = take("t1", T0, `${HOOK} |1.0| ${BODY}`);
    const p = plan(twoRows("\n"), [t]);
    assert.equal(p.pieces.length, 2);
    close(p.pieces[0].end, wordAt(t, "you").end + 0.08 + 0.25);
    close(p.pieces[1].start, wordAt(t, "your").start - 0.04);
  });

  test("at a planned pause (a blank line): 450 ms", () => {
    const t = take("t1", T0, `${HOOK} |1.0| ${BODY}`);
    const p = plan(twoRows("\n\n"), [t]);
    close(p.pieces[0].end, wordAt(t, "you").end + 0.08 + 0.45);
  });

  test("a short pause between lines stays as it is (one piece)", () => {
    const t = take("t1", T0, `${HOOK} |0.3| ${BODY}`);
    const p = plan(twoRows("\n"), [t]);
    assert.equal(p.pieces.length, 1);
  });

  test("the tail never runs into sound: a breath in the pause stops it", () => {
    const t = take("t1", T0, `${HOOK} |1.0| ${BODY}`);
    const you = wordAt(t, "you");
    t.silences = t.silences.map((s) => (Math.abs(s.start - you.end) < 1e-6 ? { start: s.start, end: s.start + 0.2 } : s));
    const p = plan(twoRows("\n"), [t]);
    close(p.pieces[0].end, you.end + 0.2);
  });

  test("lines from two takes: each keeps its own pause, nothing is inserted", () => {
    const t1 = take("t1", T0, `${HOOK} |1.0| Something else entirely here.`);
    const t2 = take("t2", T1, `Warm up words. |1.0| ${BODY}`);
    const p = plan(twoRows("\n"), [t1, t2]);
    assert.deepEqual(p.pieces.map((x) => x.take_id), ["t1", "t2"]);
    close(p.pieces[0].end, wordAt(t1, "you").end + 0.33);
    close(p.pieces[1].start, wordAt(t2, "your").start - 0.04);
  });

  test("no silences and no file length: a take's last word gets the 80 ms edge and no tail", () => {
    const parts = [{ kind: "hook", text: "Grab your roadmap." }, { kind: "cta", text: "Tap below now." }];
    const t1 = take("t1", T0, "Grab your roadmap.", { noSilences: true });
    const t2 = take("t2", T1, "Tap below now.", { noSilences: true });
    delete t1.duration;
    const p = alignTakes({ takes: [t1, t2], parts });
    assert.deepEqual(p.pieces.map((x) => x.take_id), ["t1", "t2"]);
    close(p.pieces[0].end, wordAt(t1, "roadmap").end + 0.08);
  });
});

describe("fillers: cut only inside silence", () => {
  test("'um' with 150 ms+ of silence on both sides is cut", () => {
    const t = take("t1", T0, "Lenders read two files |0.2| um |0.2| before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.equal(keptText(p), HOOK);
    assert.equal(playsAt(p, "t1", wordAt(t, "um").start + 0.15), false);
  });

  test("'um' without the silence stays (cutting it would chop the sentence)", () => {
    const t = take("t1", T0, "Lenders read two files |0.1| um |0.1| before they ever say yes to you.");
    const p = plan(ONE_LINE, [t]);
    assert.match(keptText(p), /files um before/);
  });

  test("'like' needs 250 ms: kept with 200 ms, cut with 300 ms", () => {
    const short = take("t1", T0, "Lenders read two files |0.2| like |0.2| before they ever say yes to you.");
    assert.match(keptText(plan(ONE_LINE, [short])), /files like before/);
    const long = take("t1", T0, "Lenders read two files |0.3| like |0.3| before they ever say yes to you.");
    assert.equal(keptText(plan(ONE_LINE, [long])), HOOK);
  });

  test("'you know' with 250 ms on both sides is cut, both words", () => {
    const t = take("t1", T0, "Lenders read two files |0.3| you know |0.3| before they ever say yes to you.");
    assert.equal(keptText(plan(ONE_LINE, [t])), HOOK);
  });

  test("a 'like' the script says is never a filler", () => {
    const parts = [{ kind: "hook", text: "It works like a ladder for your funding." }];
    const t = take("t1", T0, "It works |0.3| like |0.3| a ladder for your funding.");
    assert.match(keptText(plan(parts, [t])), /works like a/);
  });

  test("with no silence measured, the transcript's own gaps decide", () => {
    const t = take("t1", T0, "Lenders read two files |0.2| um |0.2| before they ever say yes to you.", { noSilences: true });
    assert.equal(keptText(plan(ONE_LINE, [t])), HOOK);
  });
});

describe("lines said differently (under 85%)", () => {
  test("the speech between kept neighbours is kept when it runs under 2x the line", () => {
    const said = "Your credit score hides some numbers that limit you.";
    const t = take("t1", T0, `${HOOK} |0.3| ${said} |0.3| ${CTA}`);
    const p = plan(THREE_LINES, [t]);
    assert.equal(p.lines[1].state, "said_differently");
    assert.deepEqual(p.said_differently.map((s) => [s.line_idx, s.how, s.said]), [[1, "between_neighbors", said]]);
    assert.equal(keptText(p), `${HOOK} ${said} ${CTA}`);
    assert.deepEqual(p.missing_lines, []);
  });

  test("too long (2x the line or more): the line is missing", () => {
    const said = "Your credit score is hiding a whole bunch of numbers and data points that nobody ever tells you about and they all cap how much money you can get from any bank.";
    const t = take("t1", T0, `${HOOK} |0.3| ${said} |0.3| ${CTA}`);
    const p = plan(THREE_LINES, [t]);
    assert.deepEqual(p.missing_lines, [1]);
    assert.equal(p.lines[1].state, "missing");
    assert.equal(playsAt(p, "t1", wordAt(t, "bunch").start), false);
  });

  test("a stretch with none of the line's words is not the line: missing", () => {
    const t = take("t1", T0, `${HOOK} |0.3| Anyway moving along now. |0.3| ${CTA}`);
    const p = plan(THREE_LINES, [t]);
    assert.deepEqual(p.missing_lines, [1]);
  });

  test("neighbours in different takes: the best attempt is kept and marked", () => {
    const t1 = take("t1", T0, `${HOOK} |0.3| Your score hides the thirteen data points that cap.`);
    const t2 = take("t2", T1, CTA);
    const p = plan(THREE_LINES, [t1, t2]);
    assert.equal(p.lines[1].state, "said_differently");
    assert.equal(p.said_differently[0].how, "best_attempt");
    assert.equal(p.lines[1].coverage, 0.818);
  });
});

describe("bullets style", () => {
  const OPEN = "Most lenders read two files before they say yes. |0.4| If one is a mess, they never open the other. |0.5|";
  const CLOSE = "|0.5| We check both before you apply anywhere. |0.5| Tap below and see what both files say today.";
  const MIDDLE = "so the personal file is the first thing they check, then the business file, and which one they read first matters.";

  test("a 4+ word restart (400 ms of silence, back within 6 s) keeps the last copy", () => {
    const t = take("t1", T0, `${OPEN} So the personal file is the first thing they pull |0.6| ${MIDDLE} ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(p.ok, true);
    assert.equal(playsAt(p, "t1", wordAt(t, "pull").start + 0.1), false, "the first copy is cut");
    assert.equal(playsAt(p, "t1", wordAt(t, "personal", 1).start + 0.1), true, "the last copy is kept");
    assert.deepEqual(p.cues.map((c) => c.heard), [true, true, true]);
  });

  test("a 3-word repeat is not a restart", () => {
    const t = take("t1", T0, `${OPEN} the personal file |0.6| the personal file is what they check, then the business file, and which one they read first. ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(playsAt(p, "t1", wordAt(t, "personal", 0).start + 0.1), true);
    assert.equal(playsAt(p, "t1", wordAt(t, "personal", 1).start + 0.1), true);
  });

  test("under 400 ms of silence is not a restart", () => {
    const t = take("t1", T0, `${OPEN} So the personal file is the first thing they pull |0.3| ${MIDDLE} ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(playsAt(p, "t1", wordAt(t, "pull").start + 0.1), true);
  });

  test("back after more than 6 s is not a restart", () => {
    const t = take("t1", T0, `${OPEN} So the personal file is the first thing they pull |6.5| ${MIDDLE} ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(playsAt(p, "t1", wordAt(t, "pull").start + 0.1), true);
  });

  test("a false start of the reveal inside the middle is caught too", () => {
    const close = "|0.5| We check both before you |0.5| We check both before you apply anywhere. |0.5| Tap below and see what both files say today.";
    const t = take("t1", T0, `${OPEN} ${MIDDLE} ${close}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(playsAt(p, "t1", wordAt(t, "check", 1).start + 0.1), false, "the first 'We check both before you' is cut");
    assert.equal(playsAt(p, "t1", wordAt(t, "check", 2).start + 0.1), true);
  });

  test("cue anchors: cue index (from 1) plus a keyword, falling back to the cue's start", () => {
    const t = take("t1", T0, `${OPEN} So the personal file is the first thing they pull |0.6| ${MIDDLE} ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    const personal = wordAt(t, "personal", 1);
    const piece = p.pieces.find((x) => x.start <= personal.start && personal.start <= x.end);
    const a = resolveAnchor(p, { cue: 1, keyword: "personal" });
    assert.equal(a.found, true);
    assert.equal(a.fallback, false);
    close(a.time, piece.out_start + (personal.start - piece.start));
    const b = resolveAnchor(p, { cue: 2, keyword: "zebra" });
    assert.equal(b.fallback, true);
    close(b.time, p.cues[1].out_start);
    assert.equal(resolveAnchor(p, { cue: 9, keyword: "x" }).found, false);
  });

  test("a cue's keywords are the words only that cue has", () => {
    assert.deepEqual(cueKeywords("the business file", ["the personal file"]), ["business"]);
    assert.deepEqual(cueKeywords("which one they read first"), ["one", "read", "first"]);
  });

  test("a cue never mentioned is missing, and its anchor says so", () => {
    const t = take("t1", T0, `${OPEN} so the personal file is the first thing they check, and which one they read first matters. ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.equal(p.lines[3].state, "missing");
    assert.deepEqual(p.cues.map((c) => c.heard), [true, false, true]);
    assert.equal(resolveAnchor(p, { cue: 2, keyword: "business" }).found, false);
  });

  test("no middle at all: the cues are missing and coverage counts them", () => {
    const t = take("t1", T0, `${OPEN} ${CLOSE}`);
    const p = plan(BULLETS_PARTS, [t], { style: "bullets" });
    assert.deepEqual(p.missing_lines, [2, 3, 4]);
    assert.ok(p.coverage < 1 && p.coverage > 0.7);
  });
});

describe("the cut plan: shape, the hold rule, anchors", () => {
  test("the contract shape", () => {
    const p = plan(THREE_LINES, [take("t1", T0, `${HOOK} |0.3| ${BODY} |0.3| ${CTA}`)]);
    for (const k of ["pieces", "missing_lines", "said_differently", "coverage", "stalls", "ok"]) assert.ok(k in p, k);
    for (const k of ["take_id", "start", "end", "line_idx"]) assert.ok(k in p.pieces[0], k);
    assert.equal(p.ok, true);
    assert.equal(p.coverage, 1);
    assert.deepEqual(p.hold_reasons, []);
    assert.equal(p.rematch, false);
    assert.deepEqual(p.lines.map((l) => l.state), ["kept", "kept", "kept"]);
  });

  test("the hook missing parks the take (§9.1 step 7)", () => {
    const p = plan(THREE_LINES, [take("t1", T0, `${BODY} |0.3| ${CTA}`)]);
    assert.equal(p.ok, false);
    assert.ok(p.hold_reasons.includes("the hook is missing"));
    assert.deepEqual(p.missing_lines, [0]);
  });

  test("under 70% parks it; under 50% sends it back to the match", () => {
    const p = plan(THREE_LINES, [take("t1", T0, CTA)]);
    assert.equal(p.ok, false);
    assert.equal(p.rematch, true);
    assert.ok(p.hold_reasons.some((r) => r.startsWith("only 24% of the script was said")));
  });

  test("no takes: every line is missing", () => {
    const p = alignTakes({ takes: [], parts: THREE_LINES });
    assert.deepEqual(p.missing_lines, [0, 1, 2]);
    assert.deepEqual(p.pieces, []);
    assert.equal(p.coverage, 0);
    assert.equal(p.ok, false);
  });

  test("no script: nothing to cut", () => {
    const p = alignTakes({ takes: [take("t1", T0, HOOK)], parts: [] });
    assert.deepEqual(p.hold_reasons, ["the script has no lines"]);
  });

  test("a words-style anchor is the phrase's first word in the finished cut", () => {
    const t1 = take("t1", T0, `${HOOK} |0.3| Your score hides |1.5| the thirteen data points that cap your funding. |0.3| ${CTA}`);
    const p = plan(THREE_LINES, [t1]);
    const w = wordAt(t1, "thirteen");
    const piece = p.pieces.find((x) => x.start <= w.start && w.start <= x.end);
    const a = resolveAnchor(p, "thirteen data points");
    assert.equal(a.found, true);
    assert.equal(a.line_idx, 1);
    close(a.time, piece.out_start + (w.start - piece.start));
    assert.equal(resolveAnchor(p, "never said at all").found, false);
  });

  test("the defaults are the spec's numbers", () => {
    const o = ALIGN_DEFAULTS;
    assert.deepEqual(
      [o.similarity, o.fuzzyMinLetters, o.restartWithin, o.qualifyCoverage, o.stallOver, o.switchCost, o.edgeBefore,
        o.edgeAfter, o.snapWithin, o.gapTail, o.plannedGapTail, o.umSilence, o.likeSilence, o.saidDifferentlyUnder,
        o.saidDifferentlyMaxRatio, o.bulletsRestartWords, o.bulletsRestartSilence, o.bulletsRestartWithin,
        o.holdCoverage, o.rematchCoverage],
      [0.8, 5, 8, 0.9, 1.0, 0.15, 0.04, 0.08, 0.25, 0.25, 0.45, 0.15, 0.25, 0.85, 2, 4, 0.4, 6, 0.7, 0.5]
    );
  });

  test("the fixture builder makes the silences silencedetect would", () => {
    const s = say("one two |0.5| three");
    assert.deepEqual(s.silences.map((x) => [x.start, x.end]), [[0, 0.5], [1.16, 1.66], [1.96, 2.96]]);
  });
});

describe("messy takes never break the safety rules", () => {
  /* A seeded shuffle of the things Chris really does: false starts, fillers
     in and out of silence, a skipped word, a long pause, a line said twice,
     a line left out. Every plan must still play each moment of a take at
     most once, never add a second the takes do not hold, and keep the
     script's order. */
  const sentences = [HOOK, BODY, CTA];
  function noisy(rnd, lines) {
    const out = [];
    for (const s of lines) {
      if (rnd() < 0.1) continue;
      const w = s.split(/\s+/);
      if (rnd() < 0.3) out.push(...w.slice(0, 2 + Math.floor(rnd() * 4)), rnd() < 0.5 ? "|0.6|" : "|0.2|");
      for (const x of w) {
        if (rnd() < 0.08) out.push(rnd() < 0.5 ? "|0.3|" : "|0.1|", rnd() < 0.5 ? "um" : "like", rnd() < 0.5 ? "|0.3|" : "|0.1|");
        if (rnd() > 0.04) out.push(x);
        if (rnd() < 0.03) out.push("|1.3|");
      }
      out.push(rnd() < 0.3 ? "|1.1|" : "|0.35|");
      if (rnd() < 0.15) out.push(...w, "|0.5|");
    }
    return out.length ? out.join(" ") : "hello";
  }

  test("120 seeded random shoots, words and bullets", () => {
    let seed = 20261006;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const bullets = ["Most lenders read two files before they say yes.", "If one is a mess, they never open the other.",
      "so the personal file comes first, then the business file, and which one they read first.",
      "We check both before you apply anywhere.", "Tap below and see what both files say today."];
    for (let n = 0; n < 120; n++) {
      const isBullets = n % 3 === 0;
      const lines = isBullets ? bullets : sentences;
      const takes = [];
      const count = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < count; k++) takes.push(take(`t${k}`, `2026-10-06T10:0${k}:00Z`, noisy(rnd, lines)));
      const p = plan(isBullets ? BULLETS_PARTS : THREE_LINES, takes, isBullets ? { style: "bullets" } : {});
      const order = p.pieces.map((x) => x.line_idx);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `shoot ${n}: script order`);
      assert.ok(p.coverage >= 0 && p.coverage <= 1);
      for (const i of p.missing_lines) assert.ok(!p.pieces.some((x) => x.lines.includes(i)), `shoot ${n}: a missing line plays`);
    }
  });
});

describe("pure, and not wired into the live joiner", () => {
  const src = fs.readFileSync(path.join(HERE, "align.mjs"), "utf8");

  test("align.mjs imports nothing: no database, no network, no AI", () => {
    assert.equal(/^\s*import\s/m.test(src), false);
    assert.equal(/\bfetch\s*\(|process\.env|require\(/.test(src), false);
  });

  test("the live aligner (merge-takes.mjs) is not imported", () => {
    assert.equal(/from\s+["'][^"']*merge-takes/.test(src), false);
  });
});
