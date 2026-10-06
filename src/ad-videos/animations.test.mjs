// The animation planner and the overlay / finalize argument lists
// (src/ad-videos/animations.mjs, spec §9.4 and §9.1 step 11), rule by rule.
//
// No ffmpeg, no Remotion, no database, no network. Cut plans come from the
// real aligner (src/ad-videos/align.mjs) on fake transcripts, or are built by
// hand when a test needs exact times. The catalog is the committed
// marketing/broll/catalog.json.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  ANIMATION_DEFAULTS, FULLFRAME_LONGER, OVERLAY_DRAW_ZONE,
  planAnimations, cacheKey, canonicalJson, fullframeMaxSeconds, captionZoneFrom, captionsClear,
  submagicSpoken, remapThroughWords, overlayArgs, needsLoudnessFix, finalizeArgs, finalizeChecks, faststartFromHead
} from "./animations.mjs";
import { alignTakes, resolveAnchor } from "./align.mjs";
import { FINAL_VIDEO, FINAL_AUDIO, NotAnAdError, snapPiece } from "./ffmpeg-plan.mjs";
import { take, wordAt } from "./fixtures/align-takes.mjs";
import { BULLETS_PARTS } from "./fixtures/align-scripts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "marketing/broll/catalog.json"), "utf8"));
const T0 = "2026-10-06T10:00:00Z";
const T1 = "2026-10-06T10:05:00Z";
const AD = "ad";

const frameOf = (t) => Math.round(t * 30);
const close = (a, b, tol = 1e-6, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);

/* ─── A cut plan by hand: exact times, so every limit has a boundary test. ───
   lines: [[kind, at, text]]. One take, played as it is, so the cut's clock
   is the take's clock. Each word lasts 0.28 s and starts 0.3 s after the last. */
function handCut(lines, duration, pieces = null) {
  const words = [];
  lines.forEach(([, at, text], line_idx) => {
    String(text).split(/\s+/).forEach((w, k) => words.push({ w, start: at + 0.3 * k, end: at + 0.3 * k + 0.28, line_idx }));
  });
  const ps = pieces || [[0, duration]];
  let out = 0;
  const cutPieces = ps.map(([start, end]) => {
    const p = {
      take_id: "t1", start, end, line_idx: 0, lines: [],
      out_start: out, out_end: out + (end - start),
      words: words.filter((w) => w.start >= start && w.start < end)
    };
    out += end - start;
    return p;
  });
  const cutPlan = {
    version: 1, style: "words", pieces: cutPieces,
    missing_lines: [], said_differently: [], coverage: 1, stalls: [], ok: true, hold_reasons: [], rematch: false,
    lines: lines.map(([kind, , text], i) => ({ line_idx: i, part_idx: i, kind, text, planned_pause: true, state: "kept", take_id: "t1", coverage: 1, heard: null })),
    cues: [], takes: [{ take_id: "t1", recorded_at: T0, order: 0 }], duration: out
  };
  const parts = lines.map(([kind, , text]) => ({ kind, text }));
  return { cutPlan, parts, words };
}

/** One animation row. */
const row = (phrase, template = "HiddenDataPoints", seconds = 3, props = {}) => ({ anchor: { phrase }, template, props, seconds });

function planFull(cut, rows, extra = {}) {
  return planAnimations({
    cutPlan: cut.cutPlan, animationPlan: rows, catalog: CATALOG, parts: cut.parts, style: "words",
    exportDuration: cut.cutPlan.duration, mode: "fullframe", ...extra
  });
}

const codes = (r) => r.skipped.map((s) => [s.index, s.code]);
const kept = (r) => r.items.map((i) => [i.index, i.start_frame, i.frames]);

/* ─── A real script, cut by the real aligner. ─── */
const LINES = [
  ["hook", "Lenders read two files before they ever say yes to you."],
  ["line2", "Most people never even know the second file exists."],
  ["body", "Your score hides the thirteen data points that cap your funding."],
  ["body", "Banks pull a business file and a personal file together."],
  ["reveal", "That is how one clean file turns into real funding."],
  ["cta", "Tap below and grab your roadmap today."]
];
const PARTS = LINES.map(([kind, text]) => ({ kind, text }));
const spoken = (lines) => lines.map((l) => l[1]).join(" |0.5| ");

describe("anchors resolve to times on the cut", () => {
  test("a words anchor lands on its phrase's first word, on the master's snapped clock, across a take switch", () => {
    /* Take A says every line but line 2 (it says something else there);
       take B says line 2. The cut plays A, then B, then A again. */
    const a = take("tA", T0, spoken([LINES[0], ["line2", "um so anyway here we go now"], ...LINES.slice(2)]));
    const b = take("tB", T1, `${LINES[1][1]}`);
    const cutPlan = alignTakes({ takes: [a, b], parts: PARTS, style: "words" });
    assert.equal(cutPlan.ok, true);
    assert.deepEqual([...new Set(cutPlan.pieces.map((p) => p.take_id))], ["tA", "tB"]);
    assert.ok(cutPlan.pieces.some((p, i) => i > 0 && p.take_id === "tA" && cutPlan.pieces[i - 1].take_id === "tB"), "A, B, then A again");

    /* The expected time, worked out from the pieces as the master is built:
       every piece snapped to the 1/30 s grid, played one after another. */
    const w = wordAt(a, "thirteen");
    let out = 0, expected = null;
    for (const p of cutPlan.pieces) {
      const s = snapPiece(p);
      if (p.take_id === "tA" && s.start <= w.start && w.start <= s.end) expected = out + (w.start - s.start);
      out += s.duration;
    }
    assert.ok(expected !== null);
    const r = planAnimations({
      cutPlan, animationPlan: [row("thirteen data points")], catalog: CATALOG, parts: PARTS, style: "words",
      exportDuration: out, mode: "fullframe"
    });
    assert.deepEqual(r.skipped, []);
    const it = r.items[0];
    assert.equal(it.start_frame, frameOf(expected));
    close(it.anchor_time, expected, 0.0011);
    close(it.start, it.start_frame / 30, 0.0006);
    assert.equal(it.line_idx, 2);
    assert.equal(it.fallback, false);
    /* Within 0.3 s of its anchor (spec §9.4 done-test), and the aligner's own
       unsnapped answer agrees to within a few frames. */
    assert.ok(Math.abs(it.start - expected) < 0.3);
    close(it.start, resolveAnchor(cutPlan, { phrase: "thirteen data points" }).time, 0.1);
  });

  test("times are read on the snapped pieces, not the plan's unsnapped clock", () => {
    /* Three pieces, each 0.0233 s longer once snapped. The third piece starts
       0.0467 s later on the master than the plan's own out_start says. */
    const cut = handCut([
      ["hook", 1.1, "Lenders read two files before they say yes."],
      ["body", 10.1, "Banks pull a business file first."],
      ["body", 21.0, "Your score hides thirteen data points."],
      ["cta", 24.2, "Tap below."]
    ], 30, [[1.01, 6.02], [10.01, 15.02], [20.01, 25.0]]);
    const r = planFull(cut, [row("Your score hides")], { exportDuration: 5.0333 + 5.0333 + 5 });
    assert.deepEqual(r.skipped, []);
    /* snapped: 151 + 151 frames, then piece 3 from 20.0 s: 302 + 30 = 332.
       The unsnapped clock would say 10.02 + 0.99 = 11.01 s = frame 330. */
    assert.equal(r.items[0].start_frame, 332);
  });

  test("a bullets anchor is its cue plus a keyword; a keyword not heard falls back to the cue's start, flagged", () => {
    const OPEN = "Most lenders read two files before they say yes. |0.4| If one is a mess, they never open the other. |0.5|";
    const CLOSE = "|0.5| We check both before you apply anywhere. |0.5| Tap below and see what both files say today.";
    const MIDDLE = "so the personal one is the first thing they check |0.6| then the business file |0.6| and which one they read first matters.";
    const t = take("t1", T0, `${OPEN} ${MIDDLE} ${CLOSE}`);
    const cutPlan = alignTakes({ takes: [t], parts: BULLETS_PARTS, style: "bullets" });
    const r = planAnimations({
      cutPlan, catalog: CATALOG, parts: BULLETS_PARTS, style: "bullets", exportDuration: cutPlan.duration, mode: "overlay",
      captionZone: { top: 1300, bottom: 1500 },
      animationPlan: [
        { anchor: { cue: 2, keyword: "business" }, template: "FileItems", props: {}, seconds: 2 },
        { anchor: { cue: 1, keyword: "file" }, template: "HiddenDataPoints", props: {}, seconds: 2 }
      ]
    });
    assert.deepEqual(r.skipped, []);
    const biz = r.items.find((i) => i.index === 0);
    const personal = r.items.find((i) => i.index === 1);
    const piece = cutPlan.pieces.find((p) => p.start <= wordAt(t, "business").start && wordAt(t, "business").start <= p.end);
    assert.equal(biz.fallback, false);
    close(biz.anchor_time, piece.out_start + (wordAt(t, "business").start - piece.start), 0.05);
    assert.equal(personal.fallback, true, "the take said 'personal one', not 'personal file'");
    close(personal.anchor_time, cutPlan.cues[0].out_start, 0.05);
  });

  test("an anchor whose line was cut is skipped and flagged", () => {
    const t = take("t1", T0, spoken([LINES[0], LINES[1], LINES[3], LINES[4], LINES[5]]));
    const cutPlan = alignTakes({ takes: [t], parts: PARTS, style: "words" });
    assert.deepEqual(cutPlan.missing_lines, [2]);
    const r = planAnimations({
      cutPlan, catalog: CATALOG, parts: PARTS, style: "words", exportDuration: cutPlan.duration, mode: "fullframe",
      animationPlan: [row("thirteen data points"), row("business file", "FileItems")]
    });
    assert.deepEqual(codes(r), [[0, "anchor_cut"]]);
    assert.match(r.skipped[0].reason, /its line was cut/);
    assert.deepEqual(r.skipped[0].anchor, { phrase: "thirteen data points" });
    assert.equal(r.items.length, 1);
  });

  test("a bullets cue never said is skipped and flagged", () => {
    const OPEN = "Most lenders read two files before they say yes. |0.4| If one is a mess, they never open the other. |0.5|";
    const CLOSE = "|0.5| We check both before you apply anywhere. |0.5| Tap below and see what both files say today.";
    const t = take("t1", T0, `${OPEN} so the personal file is the first thing they check, and which one they read first matters. ${CLOSE}`);
    const cutPlan = alignTakes({ takes: [t], parts: BULLETS_PARTS, style: "bullets" });
    const r = planAnimations({
      cutPlan, catalog: CATALOG, parts: BULLETS_PARTS, style: "bullets", exportDuration: cutPlan.duration, mode: "fullframe",
      animationPlan: [{ anchor: { cue: 2, keyword: "business" }, template: "FileItems", props: {}, seconds: 2 }]
    });
    assert.deepEqual(codes(r), [[0, "anchor_cut"]]);
    assert.match(r.skipped[0].reason, /its cue was cut/);
  });

  test("a phrase not heard word for word on a kept line lands on that line's start, flagged as a fallback", () => {
    const changed = ["body", "Your score hides the thirteen hidden points that cap your funding."];
    const t = take("t1", T0, spoken([LINES[0], LINES[1], changed, ...LINES.slice(3)]));
    const cutPlan = alignTakes({ takes: [t], parts: PARTS, style: "words" });
    assert.equal(cutPlan.lines[2].state, "kept", "10 of 11 words is a kept line");
    const r = planAnimations({
      cutPlan, catalog: CATALOG, parts: PARTS, style: "words", exportDuration: cutPlan.duration, mode: "fullframe",
      animationPlan: [row("thirteen data points")]
    });
    assert.deepEqual(r.skipped, []);
    assert.equal(r.items[0].fallback, true);
    const first = resolveAnchor(cutPlan, { phrase: "Your score hides" }).time;
    close(r.items[0].anchor_time, first, 0.05);
  });
});

describe("re-mapped through Submagic's words when the export's length moved", () => {
  const SCRIPT = [
    ["hook", 0.0, "Lenders read two files before they say yes."],
    ["line2", 3.0, "Your score hides thirteen data points."],
    ["body", 10.0, "Banks pull the business file first."],
    ["body", 17.0, "Then the inquiries come off between rounds."],
    ["cta", 24.0, "Tap below and grab your roadmap today."]
  ];
  /** Submagic's words: the cut's words, shifted by `shift` from `after` on, with a silence and punctuation mixed in. */
  const submagic = (words, shift, after) => {
    const out = [];
    for (const w of words) {
      const d = w.start >= after ? shift : 0;
      out.push({ id: out.length, text: w.w, type: "word", startTime: w.start + d, endTime: w.end + d });
      if (w.w.endsWith(".")) out.push({ id: out.length, text: "", type: "silence", startTime: w.end + d, endTime: w.end + d + 0.2 });
    }
    out.push({ id: out.length, text: ".", type: "punctuation", startTime: 0, endTime: 0 });
    return out;
  };

  test("within 0.1 s the master's clock is used as is", () => {
    const cut = handCut(SCRIPT, 30);
    const r = planFull(cut, [row("Banks pull"), row("Then the inquiries", "InquiriesOff")], {
      exportDuration: 30.1, submagicWords: submagic(cut.words, 2, 12)
    });
    assert.deepEqual(kept(r), [[0, 300, 90], [1, 510, 90]]);
  });

  test("more than 0.1 s off: every time is read through Submagic's words", () => {
    const cut = handCut(SCRIPT, 30);
    const r = planFull(cut, [row("Banks pull"), row("Then the inquiries", "InquiriesOff")], {
      exportDuration: 30.5, submagicWords: submagic(cut.words, 0.5, 12)
    });
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(kept(r), [[0, 300, 90], [1, frameOf(17.5), 90]], "before the moved spot unchanged, after it +0.5 s");
    close(r.items[1].anchor_time, 17.5, 0.0011);
  });

  test("the CTA window moves with the words too", () => {
    /* A clip at 21.1 s runs to 24.1 s. On the master the CTA starts at 24.0 s,
       so the clip would be cut to 2.9 s. Submagic's words put the CTA at
       24.6 s (0.6 s added after 23 s), so on the export it fits whole. */
    const cut = handCut([...SCRIPT.slice(0, 4), ["body", 21.1, "Lenders list who approves you."], SCRIPT[4]], 30);
    const same = planFull(cut, [row("Lenders list", "LenderList")]);
    assert.deepEqual(kept(same), [[0, frameOf(21.1), 87]]);
    const r = planFull(cut, [row("Lenders list", "LenderList")], {
      exportDuration: 30.6, submagicWords: submagic(cut.words, 0.6, 23)
    });
    assert.deepEqual(kept(r), [[0, frameOf(21.1), 90]]);
  });

  test("off by more than 0.1 s with no Submagic words: every clip is skipped, with the reason", () => {
    const cut = handCut(SCRIPT, 30);
    const r = planFull(cut, [row("Banks pull"), row("Then the inquiries", "InquiriesOff")], { exportDuration: 30.5 });
    assert.deepEqual(codes(r), [[0, "cannot_remap"], [1, "cannot_remap"]]);
    assert.match(r.skipped[0].reason, /30\.50 s and the master 30\.00 s/);
  });

  test("Submagic words that do not match the cut are not trusted", () => {
    const cut = handCut(SCRIPT, 30);
    const junk = cut.words.map((w, i) => ({ text: i % 2 ? "banana" : w.w, startTime: w.start, endTime: w.end }));
    const r = planFull(cut, [row("Banks pull")], { exportDuration: 30.5, submagicWords: junk.slice(0, 8) });
    assert.deepEqual(codes(r), [[0, "cannot_remap"]]);
    assert.match(r.skipped[0].reason, /words were found in Submagic's words/);
  });

  test("a word Submagic misheard is placed between its neighbours", () => {
    const master = [
      { w: "banks", start: 10, end: 10.3, line_idx: 0 },
      { w: "pull", start: 10.4, end: 10.7, line_idx: 0 },
      { w: "the", start: 11.0, end: 11.2, line_idx: 0 },
      { w: "file", start: 12.0, end: 12.3, line_idx: 0 }
    ];
    const sm = [
      { word: "banks", start: 11, end: 11.3 },
      { word: "pole", start: 11.4, end: 11.7 },
      { word: "the", start: 12.2, end: 12.4 },
      { word: "file", start: 13.0, end: 13.3 }
    ];
    const r = remapThroughWords(master, sm);
    assert.equal(r.ok, true);
    assert.equal(r.aligned, 3);
    close(r.map(10), 11);
    close(r.map(10.4), 11 + 0.4 * (1.2 / 1.0), 1e-9, "between banks (10→11) and the (11→12.2)");
    close(r.map(12), 13);
    close(r.map(20), 21, 1e-9, "after the last pair, shifted like it");
    close(r.map(5), 6, 1e-9, "before the first pair, shifted like it");
  });

  test("Submagic's word shapes: text or word, startTime or start; silences, punctuation and timeless words dropped", () => {
    assert.deepEqual(submagicSpoken([
      { text: "Hi", startTime: 1, endTime: 1.2, type: "word" },
      { text: "", startTime: 1.2, endTime: 1.5, type: "silence" },
      { text: ",", startTime: 1.2, endTime: 1.2, type: "punctuation" },
      { word: "there", start: 0.5, end: 0.8 },
      { text: "lost", startTime: null },
      "nope"
    ]), [{ text: "there", start: 0.5, end: 0.8 }, { text: "Hi", start: 1, end: 1.2 }]);
  });
});

describe("full-frame limits (spec §9.4)", () => {
  test("nothing in the first 3 s: 2.9 s is skipped, 3.0 s is allowed", () => {
    const at29 = handCut([["hook", 0, "Lenders read two files."], ["line2", 2.9, "Your score hides thirteen data points."], ["cta", 20, "Tap below today."]], 24);
    const r29 = planFull(at29, [row("Your score hides")]);
    assert.deepEqual(codes(r29), [[0, "in_the_hook"]]);
    assert.match(r29.skipped[0].reason, /2\.90 s\. No animation goes in the first 3 seconds/);
    const at30 = handCut([["hook", 0, "Lenders read two files."], ["line2", 3.0, "Your score hides thirteen data points."], ["cta", 20, "Tap below today."]], 24);
    assert.deepEqual(kept(planFull(at30, [row("Your score hides")])), [[0, 90, 90]]);
  });

  test("nothing on the CTA line; a clip running into it is cut short, or skipped when it would be too short", () => {
    const cut = handCut([
      ["hook", 0, "Lenders read two files."],
      ["body", 5.0, "Banks pull the business file first and then the personal one."],
      ["body", 11.6, "Then the inquiries come off between rounds."],
      ["cta", 15.0, "Tap below and grab your roadmap today."]
    ], 18);
    /* "grab your roadmap" is on the CTA. "inquiries come off" (12.2 s) would
       run to 15.2 s: cut to 2.8 s (84 frames). */
    const r = planFull(cut, [row("grab your roadmap", "BookCall"), row("inquiries come off", "InquiriesOff")]);
    assert.deepEqual(codes(r), [[0, "on_the_cta"]]);
    assert.deepEqual(kept(r), [[1, frameOf(12.2), frameOf(15.0) - frameOf(12.2)]]);
    assert.equal(r.items[0].end, 15);
    assert.equal(r.items[0].props.durationInFrames, 84);
    /* "between rounds" (13.4 s) would have 1.6 s left: under FileItems' 2 s. */
    const r2 = planFull(cut, [row("between rounds", "FileItems")]);
    assert.deepEqual(codes(r2), [[0, "runs_into_the_cta"]]);
    /* A clip that ends exactly as the CTA starts is fine. */
    const r3 = planFull(handCut([["hook", 0, "Lenders read two files."], ["body", 9, "Banks pull files."], ["cta", 12, "Tap below today."]], 15), [row("Banks pull")]);
    assert.deepEqual(kept(r3), [[0, 270, 90]]);
  });

  test("at least 4 s of face between clips: exactly 4 s is allowed, 3.9 s is not", () => {
    const cut = handCut([
      ["hook", 0, "Lenders read two files."],
      ["line2", 3.0, "Your score hides thirteen data points."],
      ["body", 9.9, "Banks pull the business file first."],
      ["body", 13.0, "Then the inquiries come off between rounds."],
      ["cta", 25, "Tap below and grab your roadmap today."]
    ], 28);
    /* Clip 1: 3.0–6.0 s. "Banks pull" at 9.9 s is 3.9 s later: skipped.
       "Then the inquiries" at 13.0 s is 7 s later: kept. */
    const r = planFull(cut, [row("Your score hides"), row("Banks pull", "FileItems"), row("Then the inquiries", "InquiriesOff")]);
    assert.deepEqual(kept(r), [[0, 90, 90], [2, 390, 90]]);
    assert.deepEqual(codes(r), [[1, "too_close"]]);
    assert.match(r.skipped[0].reason, /3\.90 s after the animation before it/);
    const ok = handCut([
      ["hook", 0, "Lenders read two files."],
      ["line2", 3.0, "Your score hides thirteen data points."],
      ["body", 10.0, "Banks pull the business file first."],
      ["cta", 25, "Tap below and grab your roadmap today."]
    ], 28);
    assert.deepEqual(kept(planFull(ok, [row("Your score hides"), row("Banks pull", "FileItems")])), [[0, 90, 90], [1, 300, 90]]);
  });

  test("at most 3 s a clip; ProofWall 4 s; ProofFlood 6 s; a template that cannot be that short is skipped", () => {
    assert.equal(fullframeMaxSeconds("CompanyLine"), 3);
    assert.equal(fullframeMaxSeconds("ProofWall"), 4);
    assert.equal(fullframeMaxSeconds("ProofFlood"), 6);
    assert.equal(fullframeMaxSeconds("ProofFloodWide"), 6);
    assert.deepEqual(FULLFRAME_LONGER, { ProofWall: 4, ProofFlood: 6 });
    const cut = handCut([
      ["hook", 0, "Lenders read two files."],
      ["line2", 3.0, "Your score hides thirteen data points."],
      ["body", 10.0, "Banks pull the business file first."],
      ["body", 18.0, "Then the inquiries come off between rounds."],
      ["body", 28.0, "Our clients got approved again and again."],
      ["cta", 40, "Tap below and grab your roadmap today."]
    ], 60);
    const r = planFull(cut, [
      row("Your score hides", "CompanyLine", 3.5),
      row("Banks pull", "ProofWall", 4),
      row("Then the inquiries", "LenderMatchScroll", 4),
      row("Our clients got", "ProofFlood", 6)
    ]);
    assert.deepEqual(kept(r), [[0, 90, 90], [1, 300, 120], [3, 840, 180]]);
    assert.deepEqual(codes(r), [[2, "too_long_for_fullframe"]]);
    assert.match(r.skipped[0].reason, /LenderMatchScroll runs at least 3\.50 s/);
    assert.equal(r.items[0].props.durationInFrames, 90, "CompanyLine asked for 3.5 s, renders 3 s");
  });

  test("at most 35% of the runtime: the clip that would pass it is cut short, or skipped when too short", () => {
    const lines = [
      ["hook", 0, "Lenders read two files."],
      ["line2", 3.0, "Your score hides thirteen data points."],
      ["body", 10.0, "Banks pull the business file first."],
      ["body", 17.0, "Then the inquiries come off between rounds."],
      ["body", 24.0, "The lender list shows who approves you."],
      ["cta", 27.0, "Tap below and grab your roadmap today."]
    ];
    const rows = [row("Your score hides"), row("Banks pull", "FileItems"), row("Then the inquiries", "InquiriesOff"), row("The lender list", "LenderList")];
    /* 30 s: 35% is 10.5 s = 315 frames. Three clips use 270; 45 left < 60. */
    const r30 = planFull(handCut(lines, 30), rows);
    assert.deepEqual(kept(r30), [[0, 90, 90], [1, 300, 90], [2, 510, 90]]);
    assert.deepEqual(codes(r30), [[3, "over_the_share"]]);
    assert.match(r30.skipped[0].reason, /more than 35% of the video \(10\.5 of 30\.0 s\)/);
    /* 33 s: 346 frames; 76 left, so the fourth runs 76 frames and ends before the CTA. */
    const r33 = planFull(handCut(lines, 33), rows);
    assert.deepEqual(kept(r33), [[0, 90, 90], [1, 300, 90], [2, 510, 90], [3, 720, 76]]);
    const total = r33.items.reduce((s, i) => s + i.frames, 0);
    assert.ok(total / 30 <= 0.35 * 33 + 1e-9);
  });

  test("a clip running past the end of the video is cut short, or skipped", () => {
    const cut = handCut([["hook", 0, "Lenders read two files."], ["body", 9.0, "Banks pull files."], ["body", 10.6, "Last words here."]], 12);
    const r = planFull(cut, [row("Banks pull", "FileItems", 2.5)]);
    assert.deepEqual(kept(r), [[0, 270, 75]]);
    const r2 = planFull(cut, [row("Last words here", "FileItems", 2.5)]);
    assert.deepEqual(codes(r2), [[0, "past_the_end"]]);
  });

  test("the overlay mode does not use the full-frame limits, but two clips never overlap", () => {
    const cut = handCut([
      ["hook", 0, "Lenders read two files."],
      ["body", 3.6, "Banks pull the business file first."],
      ["body", 5.0, "Then the inquiries come off between rounds."],
      ["cta", 8.0, "Tap below and grab your roadmap today."]
    ], 11);
    const r = planAnimations({
      cutPlan: cut.cutPlan, catalog: CATALOG, parts: cut.parts, style: "words", exportDuration: 11, mode: "overlay",
      captionZone: { top: 1300, bottom: 1500 },
      animationPlan: [
        row("Lenders read two", "CompanyLine", 3.5),
        row("Banks pull", "FileItems", 2),
        row("Then the inquiries", "InquiriesOff", 2),
        row("grab your roadmap", "FileItems", 2)
      ]
    });
    /* 0.0–3.5 kept (the hook is allowed in overlay mode), 3.6 kept (no 4 s
       gap), 5.0 overlaps 3.6–5.6: skipped; the CTA clip at 8.9 s is kept. */
    assert.deepEqual(kept(r), [[0, 0, 105], [1, 108, 60], [3, frameOf(8.9), 60]]);
    assert.deepEqual(codes(r), [[2, "overlaps"]]);
  });
});

describe("overlay mode keeps clear of the captions (caption_position_y)", () => {
  const cut = handCut([["hook", 0, "Lenders read two files."], ["body", 4.0, "Banks pull files."], ["cta", 9, "Tap below today."]], 12);
  const overlay = (captionZone) => planAnimations({
    cutPlan: cut.cutPlan, catalog: CATALOG, parts: cut.parts, style: "words", exportDuration: 12, mode: "overlay",
    captionZone, animationPlan: [row("Banks pull", "FileItems", 2)]
  });

  test("captions below the band the animations draw in: kept, rendered see-through", () => {
    for (const zone of [{ top: 1300, bottom: 1500 }, { top: 1248, bottom: 1400 }, { top: 0, bottom: 269 }, 65, { caption_position_y: 70 }]) {
      const r = overlay(zone);
      assert.deepEqual(r.skipped, [], JSON.stringify(zone));
      assert.equal(r.items[0].props.transparent, true);
    }
  });

  test("captions inside the band: every clip is skipped with the reason", () => {
    for (const zone of [{ top: 1100, bottom: 1300 }, { top: 200, bottom: 300 }, 50, 0]) {
      const r = overlay(zone);
      assert.deepEqual(codes(r), [[0, "captions_in_the_way"]], JSON.stringify(zone));
      assert.match(r.skipped[0].reason, /inside the band the animations draw in \(y 269-1248\)/);
    }
  });

  test("caption position not set: skipped, never guessed", () => {
    const r = overlay(null);
    assert.deepEqual(codes(r), [[0, "no_caption_zone"]]);
    assert.match(r.skipped[0].reason, /Set caption_position_y from a test export/);
  });

  test("full-frame mode ignores the caption zone (the clip covers the captions for its 2–3 s)", () => {
    const r = planFull(cut, [row("Banks pull", "FileItems", 2)], { captionZone: { top: 900, bottom: 1100 } });
    assert.deepEqual(kept(r), [[0, 120, 60]]);
    assert.equal(r.items[0].props.transparent, false);
  });

  test("the mode owns the see-through switch: a writer's transparent never decides it", () => {
    /* After U29 every template's default_props carries transparent, so the
       writer may send it. Full frame must stay opaque; overlay must be see-through. */
    const cat = CATALOG.map((e) => ({ ...e, default_props: { ...e.default_props, transparent: false } }));
    const base = { cutPlan: cut.cutPlan, catalog: cat, parts: cut.parts, style: "words", exportDuration: 12, captionZone: { top: 1300, bottom: 1500 } };
    const full = planAnimations({ ...base, mode: "fullframe", animationPlan: [row("Banks pull", "FileItems", 2, { transparent: true })] });
    assert.deepEqual(full.items[0].props, { transparent: false, durationInFrames: 60 });
    const over = planAnimations({ ...base, mode: "overlay", animationPlan: [row("Banks pull", "FileItems", 2, { transparent: false })] });
    assert.deepEqual(over.items[0].props, { transparent: true, durationInFrames: 60 });
    const tied = planAnimations({ ...base, mode: "overlay", animationPlan: [row("Banks pull", "ProofWall", 4)] });
    assert.deepEqual(tied.items[0].props, { durationInFrames: 120, transparent: true }, "a data-tied template gets the switch too");
  });

  test("captionZoneFrom: pixels, Submagic's 0–80 number (15% band), or not set", () => {
    assert.deepEqual(OVERLAY_DRAW_ZONE, { top: 269, bottom: 1248 });
    assert.deepEqual(captionZoneFrom({ top: 1300, bottom: 1500 }), { top: 1300, bottom: 1500 });
    assert.deepEqual(captionZoneFrom(65), { top: 1248, bottom: 1536 });
    assert.deepEqual(captionZoneFrom({ caption_position_y: 70 }), { top: 1344, bottom: 1632 });
    assert.equal(captionZoneFrom(null), null);
    assert.equal(captionZoneFrom({ top: 5, bottom: 1 }), null);
    assert.equal(captionsClear({ top: 1248, bottom: 1900 }), true);
    assert.equal(captionsClear({ top: 1247, bottom: 1900 }), false);
  });
});

describe("each clip: the catalog's checks, the size, the cache key", () => {
  const cut = handCut([
    ["hook", 0, "Lenders read two files."],
    ["line2", 3.0, "Your score hides thirteen data points."],
    ["body", 10.0, "Banks pull the business file first."],
    ["cta", 20, "Tap below and grab your roadmap today."]
  ], 24);

  test("a row the catalog refuses is skipped with the validator's own words", () => {
    const r = planFull(cut, [
      row("Your score hides", "NoSuchTemplate"),
      row("Your score hides", "ProofWall", 4, { approvals: ["fake"] }),
      row("Your score hides", "FileItems", 3, { colour: "red" }),
      row("Your score hides", "FileItems", 9),
      row("words never written", "FileItems", 3)
    ]);
    assert.deepEqual(codes(r), [
      [0, "unknown_template"], [1, "data_tied_props"], [2, "unknown_props"], [3, "seconds_out_of_range"], [4, "anchor_not_in_body"]
    ]);
    assert.equal(r.items.length, 0);
  });

  test("a wide template, or a wide format, cannot go over a tall ad", () => {
    const r = planFull(cut, [
      row("Your score hides", "BankPocketsWide", 3),
      row("Banks pull", "BankPockets", 3, { format: "wide" })
    ]);
    assert.deepEqual(codes(r), [[0, "wrong_size"], [1, "wrong_size"]]);
  });

  test("cache_key = sha256(template + canonical props); props carry the length and the see-through switch", () => {
    const r = planFull(cut, [row("Your score hides", "HiddenDataPoints", 3, { label: "hidden data points", count: 13 })]);
    const it = r.items[0];
    assert.deepEqual(it.props, { label: "hidden data points", count: 13, durationInFrames: 90, transparent: false });
    const canonical = '{"count":13,"durationInFrames":90,"label":"hidden data points","transparent":false}';
    assert.equal(canonicalJson(it.props), canonical);
    assert.equal(it.cache_key, createHash("sha256").update("HiddenDataPoints" + canonical).digest("hex"));
    assert.equal(cacheKey("HiddenDataPoints", { transparent: false, durationInFrames: 90, label: "hidden data points", count: 13 }), it.cache_key, "key order does not matter");
    assert.notEqual(cacheKey("HiddenDataPoints", { ...it.props, durationInFrames: 75 }), it.cache_key, "another length renders again");
    assert.notEqual(cacheKey("HiddenDataPoints", { ...it.props, transparent: true }), it.cache_key, "see-through renders again");
    assert.notEqual(cacheKey("FileItems", it.props), it.cache_key);
    assert.equal(canonicalJson({ b: [3, { y: 1, x: undefined, a: null }], a: "s" }), '{"a":"s","b":[3,{"a":null,"y":1}]}');
  });

  test("a data-tied template gets no props but its length and the see-through switch", () => {
    const r = planFull(cut, [row("Banks pull", "ProofWall", 4)]);
    assert.deepEqual(r.items[0].props, { durationInFrames: 120, transparent: false });
  });

  test("the same plan twice gives the same answer (pure)", () => {
    const rows = [row("Your score hides"), row("Banks pull", "FileItems")];
    assert.deepEqual(planFull(cut, rows), planFull(cut, rows));
  });

  test("inputs that cannot be planned at all are refused", () => {
    const base = { cutPlan: cut.cutPlan, animationPlan: [], catalog: CATALOG, parts: cut.parts, style: "words", exportDuration: 24, mode: "fullframe" };
    assert.throws(() => planAnimations({ ...base, mode: "both" }), /fullframe or overlay/);
    assert.throws(() => planAnimations({ ...base, style: "prose" }), /words or bullets/);
    assert.throws(() => planAnimations({ ...base, cutPlan: { pieces: [] } }), /no cut plan/);
    assert.throws(() => planAnimations({ ...base, catalog: [] }), /catalog is missing/);
    assert.throws(() => planAnimations({ ...base, exportDuration: null }), /length is unknown/);
    assert.throws(() => planAnimations({ ...base, parts: null }), /parts are missing/);
    assert.deepEqual(planAnimations(base), { items: [], skipped: [] });
  });

  test("the defaults are the spec's numbers", () => {
    const o = ANIMATION_DEFAULTS;
    assert.deepEqual(
      [o.noClipsBefore, o.minFaceBetween, o.maxClipSeconds, o.maxShare, o.remapOver, o.durationTolerance, o.loudnessTolerance],
      [3, 4, 3, 0.35, 0.1, 0.3, 1]
    );
  });
});

describe("overlayArgs: one video encode, the sound copied", () => {
  const items = [
    { src: "/w/clips/b.webm", start_frame: 300, frames: 90 },
    { src: "/w/clips/a.mov", start_frame: 120, frames: 60 }
  ];

  test("the exact argv", () => {
    assert.deepEqual(overlayArgs({ video_kind: AD, base: "/w/export.mp4", items, out: "/w/over.mp4" }), [
      "-hide_banner", "-nostats", "-y", "-i", "/w/export.mp4",
      "-i", "/w/clips/a.mov",
      "-c:v", "libvpx-vp9", "-i", "/w/clips/b.webm",
      "-filter_complex",
      "[1:v]trim=end_frame=60,setpts=PTS-STARTPTS+120/(30*TB)[a0];" +
      "[0:v][a0]overlay=x=0:y=0:eof_action=pass:enable='between(t,3.983333,5.983333)'[v1];" +
      "[2:v]trim=end_frame=90,setpts=PTS-STARTPTS+300/(30*TB)[a1];" +
      "[v1][a1]overlay=x=0:y=0:eof_action=pass:enable='between(t,9.983333,12.983333)'[v2]",
      "-map", "[v2]", "-map", "0:a:0",
      ...FINAL_VIDEO,
      "-c:a", "copy",
      "-map_metadata", "-1",
      "-f", "mp4", "/w/over.mp4"
    ]);
  });

  test("the video is encoded once with the master's settings; the sound is never encoded", () => {
    const a = overlayArgs({ video_kind: AD, base: "b.mp4", items, out: "o.mp4" });
    assert.equal(a.filter((x) => x === "libx264").length, 1);
    assert.equal(a.filter((x) => x === "-c:a").length, 1);
    assert.equal(a[a.indexOf("-c:a") + 1], "copy");
    assert.equal(a.includes("-af"), false);
    for (const s of ["high", "18", "12M", "24M", "yuv420p", "bt709", "cfr"]) assert.ok(a.includes(s), s);
  });

  test("items from planAnimations work as they are (start / end without frames read on the grid)", () => {
    const a = overlayArgs({ video_kind: AD, base: "b.mp4", items: [{ src: "c.mov", start: 4.0, end: 6.0 }], out: "o.mp4" });
    assert.ok(a.join(" ").includes("trim=end_frame=60,setpts=PTS-STARTPTS+120/(30*TB)"));
  });

  test("no clips: a stream copy, nothing encoded", () => {
    assert.deepEqual(overlayArgs({ video_kind: AD, base: "b.mp4", items: [], out: "o.mp4" }), [
      "-hide_banner", "-nostats", "-y", "-i", "b.mp4", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-map_metadata", "-1", "-f", "mp4", "o.mp4"
    ]);
  });

  test("refuses a video that is not an ad, and a clip with no file", () => {
    assert.throws(() => overlayArgs({ video_kind: "vsl", base: "b.mp4", items, out: "o.mp4" }), NotAnAdError);
    assert.throws(() => overlayArgs({ video_kind: undefined, base: "b.mp4", items, out: "o.mp4" }), NotAnAdError);
    assert.throws(() => overlayArgs({ video_kind: AD, base: "b.mp4", items: [{ start_frame: 1, frames: 2 }], out: "o.mp4" }), /clip 1 has no src/);
  });
});

describe("finalize: loudness re-fixed only when off, +faststart, then checked", () => {
  const loud = (input_i) => ({ ok: true, input_i, input_tp: -2, input_lra: 5, input_thresh: -25, target_offset: 0.1, output_i: null, output_tp: null, normalization_type: null });

  test("more than 1 LU off: the sound is re-levelled, the picture copied, +faststart", () => {
    assert.equal(needsLoudnessFix(loud(-16.2)), true);
    const a = finalizeArgs({ video_kind: AD, src: "o.mp4", out: "f.mp4", loudness: loud(-16.2) });
    assert.deepEqual(a.slice(0, 11), ["-hide_banner", "-nostats", "-y", "-i", "o.mp4", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"]);
    assert.equal(a[11], "-af");
    assert.match(a[12], /^loudnorm=I=-14:TP=-1\.5:LRA=11:measured_I=-16\.20:.*:linear=true:print_format=json,aresample=48000$/);
    assert.deepEqual(a.slice(13, 13 + FINAL_AUDIO.length), [...FINAL_AUDIO]);
    assert.deepEqual(a.slice(-7), ["-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", "f.mp4"]);
    assert.equal(a.includes("libx264"), false, "the picture is not encoded again");
  });

  test("within 1 LU: everything copied, only +faststart", () => {
    assert.equal(needsLoudnessFix(loud(-14.9)), false);
    assert.equal(needsLoudnessFix(-13.0), false);
    assert.deepEqual(finalizeArgs({ video_kind: AD, src: "o.mp4", out: "f.mp4", loudness: loud(-14.9) }), [
      "-hide_banner", "-nostats", "-y", "-i", "o.mp4", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
      "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", "f.mp4"
    ]);
  });

  test("unmeasured loudness, or a video that is not an ad, is refused", () => {
    assert.equal(needsLoudnessFix(null), null);
    assert.throws(() => finalizeArgs({ video_kind: AD, src: "o.mp4", out: "f.mp4", loudness: { ok: false, input_i: null } }), /not measured/);
    assert.throws(() => finalizeArgs({ video_kind: "testimonial", src: "o.mp4", out: "f.mp4", loudness: loud(-14) }), NotAnAdError);
  });

  const probe = (o = {}) => ({ ok: true, width: 1080, height: 1920, rotation: 0, fps: 30, color_transfer: "bt709", creation_time: null, duration: 30.0, has_audio: true, ...o });

  test("a good finished file passes", () => {
    assert.deepEqual(finalizeChecks({ probe: probe(), expectedDuration: 30.0, loudness: loud(-14.2), faststart: true }), { ok: true, reasons: [] });
  });

  test("1080x1920, within 0.3 s, within 1 LU, +faststart — each failure has its own plain reason", () => {
    const bad = finalizeChecks({ probe: probe({ width: 1920, height: 1080, duration: 30.31 }), expectedDuration: 30.0, loudness: loud(-15.2), faststart: false });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.reasons, [
      "The finished file is 1920x1080. An ad must be 1080x1920.",
      "The finished file runs 30.31 s and the master 30.00 s. They must be within 0.3 s.",
      "The finished file is at -15.2 LUFS. It must be within 1 of -14 LUFS.",
      "The file does not start fast: its index (moov) sits after the video (mdat). Remux it with +faststart."
    ]);
    assert.equal(finalizeChecks({ probe: probe({ duration: 29.71 }), expectedDuration: 30, loudness: -13.1, faststart: true }).ok, true);
    assert.equal(finalizeChecks({ probe: probe({ duration: 29.69 }), expectedDuration: 30, loudness: -14, faststart: true }).ok, false);
  });

  test("unknowns fail, never pass by default", () => {
    const r = finalizeChecks({ probe: null, expectedDuration: null, loudness: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.reasons, [
      "The finished file could not be read (no picture or no length).",
      "The finished file's loudness was not measured.",
      "It could not be told whether the file starts fast (+faststart)."
    ]);
    assert.match(finalizeChecks({ probe: probe(), expectedDuration: undefined, loudness: -14, faststart: true }).reasons[0], /master's length is unknown/);
  });

  test("raw ffprobe JSON and the file's first bytes are read too", () => {
    const raw = {
      streams: [
        { codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30/1", color_transfer: "bt709" },
        { codec_type: "audio" }
      ],
      format: { duration: "30.033" }
    };
    const head = box("ftyp", 24, box("moov", 1000));
    assert.deepEqual(finalizeChecks({ probe: raw, expectedDuration: 30, loudness: -14, head }), { ok: true, reasons: [] });
    assert.equal(finalizeChecks({ probe: JSON.stringify(raw), expectedDuration: 30, loudness: -14, head }).ok, true);
  });

  /** Top-level MP4 box headers: [size, type] followed by the rest. */
  function box(type, size, rest = new Uint8Array(0), large = false) {
    const h = new Uint8Array(large ? 16 : 8);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, large ? 1 : size);
    for (let i = 0; i < 4; i++) h[4 + i] = type.charCodeAt(i);
    if (large) { dv.setUint32(8, 0); dv.setUint32(12, size); }
    const body = new Uint8Array(Math.max(0, size - h.length));
    const out = new Uint8Array(h.length + body.length + rest.length);
    out.set(h, 0); out.set(body, h.length); out.set(rest, h.length + body.length);
    return out;
  }

  test("faststartFromHead: moov before mdat, after it, or cannot tell", () => {
    assert.equal(faststartFromHead(box("ftyp", 32, box("moov", 64))), true);
    assert.equal(faststartFromHead(box("ftyp", 32, box("free", 8, box("mdat", 4096)))), false);
    assert.equal(faststartFromHead(box("ftyp", 32, box("mdat", 16, box("moov", 64), true))), false);
    assert.equal(faststartFromHead(box("ftyp", 32, box("wide", 16, box("moov", 64), true))), true, "a 64-bit size is read");
    assert.equal(faststartFromHead(box("ftyp", 32).slice(0, 20)), null);
    assert.equal(faststartFromHead(null), null);
    assert.equal(faststartFromHead(Buffer.from(box("ftyp", 32, box("moov", 64)))), true, "a Buffer works");
  });
});

describe("not wired into any live path", () => {
  test("nothing but this test imports animations.mjs", () => {
    const hits = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(mjs|js|cjs)$/.test(name) && /animations\.mjs["']/.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(ROOT, full));
      }
    };
    for (const d of ["src", "api", "netlify", "scripts", "video-worker"]) {
      if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
    }
    assert.deepEqual(hits, ["src/ad-videos/animations.test.mjs"],
      "animations.mjs is not wired in yet (U30). The change that wires it must switch off the old Submagic " +
      "B-roll placement (src/ad-videos/broll.mjs via pipeline.mjs placeBrollAndExport) in the same change, " +
      "or the animations land twice; then add the new importer to this list.");
  });

  test("it reads no file, calls nobody and reaches for no credential", () => {
    const src = fs.readFileSync(path.join(HERE, "animations.mjs"), "utf8");
    const imports = [...src.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ["../marketing/animation-plan.mjs", "./align.mjs", "./ffmpeg-plan.mjs", "node:crypto"]);
    assert.equal(/\bfetch\(|credentials\/|process\.env/.test(src), false);
  });
});
