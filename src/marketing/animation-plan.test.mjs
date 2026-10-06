// validateAnimationPlan: can the animations the writer planned actually be built?
// Each rule in the spec (§7.3, §7.6, Appendix B) has a case that passes and a
// case that is refused. The last tests run the API contract's own example
// scripts against the real marketing/broll/catalog.json.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateAnimationPlan, isDataTied, DATA_TIED, MIN_ANIMATIONS, DEFAULT_MIN_ANIMATIONS, SCRIPT_FORMATS
} from "./animation-plan.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_CATALOG = JSON.parse(readFileSync(join(REPO, "marketing", "broll", "catalog.json"), "utf8"));

const CATALOG = [
  { id: "StepPath", width: 1080, height: 1920, fps: 30, min_frames: 60, max_frames: 90, default_props: { eyebrow: "x", steps: [] }, purpose: null, data_tied: false },
  { id: "LenderSlots", width: 1080, height: 1920, fps: 30, min_frames: 75, max_frames: 120, default_props: { eyebrow: "x", count: "30–50" }, purpose: null, data_tied: false },
  { id: "QualifyToday", width: 1080, height: 1920, fps: 30, min_frames: 60, max_frames: 90, default_props: { eyebrow: "x", today: {} }, purpose: null, data_tied: true },
  { id: "ProofFlood", width: 1080, height: 1920, fps: 30, min_frames: 120, max_frames: 180, default_props: { eyebrow: "x" }, purpose: null, data_tied: true }
];

const BODY = "Lenders read TWO files before they say yes.\n\nIf one is a mess,\nthey never open the other.\n\nWe check both before you apply.";
const PARTS = [
  { kind: "hook", text: "Lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "cue", text: "Which one they read FIRST" },
  { kind: "reveal", text: "We check both before you apply." },
  { kind: "cta", text: "Tap below." }
];

const words = (plan, over = {}) => validateAnimationPlan(plan, { catalog: CATALOG, body: BODY, parts: PARTS, style: "words", scriptFormat: "sorting", ...over });
const bullets = (plan, over = {}) => validateAnimationPlan(plan, { catalog: CATALOG, body: BODY, parts: PARTS, style: "bullets", scriptFormat: "standard", ...over });
const codes = (r) => r.errors.map((e) => e.code);

const W = (phrase, extra = {}) => ({ anchor: { phrase }, template: "StepPath", props: {}, seconds: 2.5, ...extra });
const B = (cue, keyword, extra = {}) => ({ anchor: { cue, keyword }, template: "StepPath", props: {}, seconds: 2.5, ...extra });

test("a good words-style plan passes", () => {
  const r = words([W("they say yes")]);
  assert.deepEqual(r, { ok: true, errors: [] });
});

test("a good bullets-style plan passes", () => {
  const r = bullets([B(1, "personal"), B(3, "first", { template: "LenderSlots", seconds: 4 })]);
  assert.deepEqual(r, { ok: true, errors: [] });
});

// 1. Template ------------------------------------------------------------------

test("an unknown template is refused", () => {
  const r = words([W("they say yes", { template: "MoneyRain" })]);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["unknown_template"]);
  assert.equal(r.errors[0].item, 0);
  assert.match(r.errors[0].message, /MoneyRain/);
});

test("a missing template is refused", () => {
  assert.deepEqual(codes(words([W("they say yes", { template: undefined })])), ["unknown_template"]);
});

// 2. Seconds -------------------------------------------------------------------

test("seconds inside the template's range pass, at both edges", () => {
  assert.equal(words([W("they say yes", { seconds: 2 })]).ok, true); // 60 frames
  assert.equal(words([W("they say yes", { seconds: 3 })]).ok, true); // 90 frames
  assert.equal(words([W("they say yes", { template: "ProofFlood", seconds: 6 })]).ok, true); // 180 frames
});

test("seconds outside the template's range are refused", () => {
  for (const seconds of [1.9, 3.1, 0, -2]) {
    const r = words([W("they say yes", { seconds })]);
    assert.deepEqual(codes(r), ["seconds_out_of_range"], String(seconds));
    assert.match(r.errors[0].message, /StepPath runs 2 to 3 seconds/);
  }
  assert.deepEqual(codes(words([W("they say yes", { template: "ProofFlood", seconds: 6.5 })])), ["seconds_out_of_range"]);
  assert.deepEqual(codes(words([W("they say yes", { template: "ProofFlood", seconds: 3 })])), ["seconds_out_of_range"]);
});

test("seconds that are not a number are refused", () => {
  for (const seconds of ["2.5", null, undefined, NaN, Infinity]) {
    assert.deepEqual(codes(words([W("they say yes", { seconds })])), ["bad_seconds"], String(seconds));
  }
});

// 3. Props ---------------------------------------------------------------------

test("props keys from the template's default_props pass", () => {
  assert.equal(words([W("they say yes", { props: { eyebrow: "Two files", steps: ["a", "b"] } })]).ok, true);
});

test("props keys outside default_props are refused", () => {
  const r = words([W("they say yes", { props: { eyebrow: "ok", color: "red", durationInFrames: 75 } })]);
  assert.deepEqual(codes(r), ["unknown_props"]);
  assert.match(r.errors[0].message, /color, durationInFrames/);
});

test("props that are not an object are refused; missing props count as none", () => {
  assert.deepEqual(codes(words([W("they say yes", { props: ["eyebrow"] })])), ["bad_props"]);
  assert.deepEqual(codes(words([W("they say yes", { props: "eyebrow" })])), ["bad_props"]);
  assert.equal(words([W("they say yes", { props: undefined })]).ok, true);
});

// 4. Data-tied -----------------------------------------------------------------

test("a data-tied template with no props passes", () => {
  assert.equal(words([W("they say yes", { template: "QualifyToday", props: {} })]).ok, true);
});

test("any props on a data-tied template are refused, even keys it declares", () => {
  const r = words([W("they say yes", { template: "QualifyToday", props: { eyebrow: "How much" } })]);
  assert.deepEqual(codes(r), ["data_tied_props"]);
  assert.match(r.errors[0].message, /QualifyToday/);
  const r2 = words([W("they say yes", { template: "ProofFlood", seconds: 5, props: { approvals: ["made-up"] } })]);
  assert.deepEqual(codes(r2), ["data_tied_props"]);
});

test("the data-tied list holds the kit's tied templates, and future families match by name", () => {
  for (const id of ["QualifyToday", "ProofWall", "ProofFlood", "ProofFloodWide"]) {
    assert.ok(DATA_TIED.has(id) && isDataTied(id), id);
  }
  for (const id of ["ApprovalCarousel", "ApprovalCarouselWide", "LettersWritten", "LettersWrittenSix", "ProofFloodSquare"]) {
    assert.equal(isDataTied(id), true, id);
  }
  // ProofWall is tied by its exact name only; it has no family yet.
  for (const id of ["StepPath", "LenderSlots", "Proof", "ProofWallpaper", undefined, null, 7]) {
    assert.equal(isDataTied(id), false, String(id));
  }
});

test("a template the catalog does not flag is still treated as data-tied when its name says so", () => {
  const catalog = [...CATALOG, { id: "LettersWritten", width: 1080, height: 1920, fps: 30, min_frames: 60, max_frames: 90, default_props: { count: 6 }, purpose: null, data_tied: false }];
  const r = validateAnimationPlan([W("they say yes", { template: "LettersWritten", props: { count: 9 } })],
    { catalog, body: BODY, parts: PARTS, style: "words", scriptFormat: "sorting" });
  assert.deepEqual(codes(r), ["data_tied_props"]);
});

test("every data-tied entry in the real catalog takes no props", () => {
  const tied = REAL_CATALOG.filter((e) => e.data_tied);
  assert.ok(tied.length >= 4);
  for (const e of tied) {
    const key = Object.keys(e.default_props)[0];
    const r = validateAnimationPlan(
      [{ anchor: { phrase: "they say yes" }, template: e.id, props: { [key]: "x" }, seconds: e.min_frames / e.fps }],
      { catalog: REAL_CATALOG, body: BODY, parts: PARTS, style: "words", scriptFormat: "sorting" }
    );
    assert.deepEqual(codes(r), ["data_tied_props"], e.id);
  }
});

// 5. Anchors, words style ------------------------------------------------------

test("words style: the anchor must be an exact phrase in the body", () => {
  assert.equal(words([W("Lenders read TWO files")]).ok, true);
  // A line break in the body counts as a space.
  assert.equal(words([W("a mess, they never open")]).ok, true);
  assert.deepEqual(codes(words([W("lenders read two files")])), ["anchor_not_in_body"], "capital letters count");
  assert.deepEqual(codes(words([W("before they agree")])), ["anchor_not_in_body"]);
  assert.deepEqual(codes(words([W("nders read")])), ["anchor_not_in_body"], "a phrase starts and ends on word edges");
  assert.deepEqual(codes(words([W("Lenders read TWO file")])), ["anchor_not_in_body"]);
});

test("words style: the anchor must be {phrase}", () => {
  for (const anchor of ["they say yes", { cue: 1, keyword: "personal" }, { phrase: "  " }, null]) {
    assert.deepEqual(codes(words([{ anchor, template: "StepPath", props: {}, seconds: 2.5 }])), ["bad_anchor"], JSON.stringify(anchor));
  }
});

// 6. Anchors, bullets style ----------------------------------------------------

test("bullets style: the anchor is a cue number (from 1) and a keyword in that cue", () => {
  assert.equal(bullets([B(1, "personal"), B(2, "business file")]).ok, true);
  assert.equal(bullets([B(3, "first"), B(3, "FIRST")]).ok, true, "the keyword is matched in any case");
  assert.deepEqual(codes(bullets([B(1, "personal"), B(2, "personal")])), ["keyword_not_in_cue"]);
  assert.deepEqual(codes(bullets([B(1, "personal"), B(1, "person")])), ["keyword_not_in_cue"], "whole words only");
});

test("bullets style: a cue number that does not exist is refused", () => {
  assert.deepEqual(codes(bullets([B(1, "personal"), B(4, "file")])), ["no_such_cue"]);
  assert.deepEqual(codes(bullets([B(1, "personal"), B(0, "file")])), ["no_such_cue"]);
});

test("bullets style: the anchor must be {cue, keyword} with a whole cue number", () => {
  for (const anchor of [{ phrase: "the personal file" }, { cue: "1", keyword: "personal" }, { cue: 1.5, keyword: "personal" }, { cue: 1, keyword: "" }]) {
    assert.deepEqual(codes(bullets([B(1, "personal"), { anchor, template: "StepPath", props: {}, seconds: 2.5 }])), ["bad_anchor"], JSON.stringify(anchor));
  }
});

test("bullets style: only cue parts count as cues", () => {
  // The hook says "files", but the hook is not a cue.
  assert.deepEqual(codes(bullets([B(1, "personal"), B(2, "say")])), ["keyword_not_in_cue"]);
});

// 7. How many ------------------------------------------------------------------

test("a standard script needs at least 2 animations", () => {
  assert.equal(MIN_ANIMATIONS.standard, 2);
  const r = bullets([B(1, "personal")]);
  assert.deepEqual(codes(r), ["too_few"]);
  assert.equal(r.errors[0].item, null);
  assert.match(r.errors[0].message, /standard script needs at least 2 animations\. This plan has 1/);
  assert.equal(validateAnimationPlan([W("they say yes"), W("We check both")],
    { catalog: CATALOG, body: BODY, parts: PARTS, style: "words", scriptFormat: "standard" }).ok, true, "words-style standard too");
});

test("a sorting-hat short needs at least 1 animation", () => {
  assert.equal(MIN_ANIMATIONS.sorting, 1);
  assert.deepEqual(codes(words([])), ["too_few"]);
  assert.equal(words([W("they say yes")]).ok, true);
});

test("every other format needs at least 1 animation", () => {
  assert.equal(DEFAULT_MIN_ANIMATIONS, 1);
  for (const scriptFormat of SCRIPT_FORMATS.filter((f) => f !== "standard" && f !== "sorting")) {
    assert.deepEqual(codes(words([], { scriptFormat })), ["too_few"], scriptFormat);
    assert.equal(words([W("they say yes")], { scriptFormat }).ok, true, scriptFormat);
  }
});

test("an unknown format or style is refused, and still counts as an ad needing 1", () => {
  assert.deepEqual(codes(words([W("they say yes")], { scriptFormat: "reel" })), ["unknown_format"]);
  assert.deepEqual(codes(words([], { scriptFormat: undefined })), ["unknown_format", "too_few"]);
  assert.deepEqual(codes(words([W("they say yes")], { style: "notes" })), ["unknown_style"]);
});

// Shape --------------------------------------------------------------------------

test("a plan that is not a list, an item that is not an object, or no catalog is refused", () => {
  assert.deepEqual(codes(words(null)), ["not_a_list"]);
  assert.deepEqual(codes(words({ 0: W("they say yes") })), ["not_a_list"]);
  assert.deepEqual(codes(words([W("they say yes"), "StepPath"])), ["not_an_object"]);
  assert.deepEqual(codes(validateAnimationPlan([W("they say yes")], { body: BODY, style: "words", scriptFormat: "sorting" })), ["no_catalog"]);
});

test("every problem in one item is reported, each with its index", () => {
  const r = bullets([B(1, "personal"), { anchor: { cue: 9, keyword: "x" }, template: "StepPath", props: { color: "red" }, seconds: 9 }]);
  assert.deepEqual(codes(r), ["seconds_out_of_range", "unknown_props", "no_such_cue"]);
  assert.ok(r.errors.every((e) => e.item === 1 && typeof e.message === "string" && e.message.length > 0));
});

// The API contract's example scripts, against the real catalog ------------------

test("the API contract's two example scripts pass against the real catalog.json", () => {
  const standard = {
    body: "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
    parts: [
      { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
      { kind: "line2", text: "If one is a mess, they never open the other." },
      { kind: "cue", text: "the personal file" },
      { kind: "cue", text: "the business file" },
      { kind: "cue", text: "which one they read first" },
      { kind: "reveal", text: "We check both before you apply anywhere." },
      { kind: "cta", text: "Tap below and see what both files say today." }
    ],
    plan: [
      { anchor: { cue: 1, keyword: "personal" }, template: "FileItems", props: {}, seconds: 2.5 },
      { anchor: { cue: 3, keyword: "first" }, template: "StepPath", props: {}, seconds: 3 }
    ]
  };
  assert.deepEqual(validateAnimationPlan(standard.plan,
    { catalog: REAL_CATALOG, body: standard.body, parts: standard.parts, style: "bullets", scriptFormat: "standard" }), { ok: true, errors: [] });

  const sorting = {
    body: "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
    parts: [
      { kind: "hook", text: "Every hard pull you did not need is still sitting on your file." },
      { kind: "line2", text: "And lenders count them." }
    ],
    plan: [{ anchor: { phrase: "lenders count them" }, template: "InquiriesOff", props: {}, seconds: 2.5 }]
  };
  assert.deepEqual(validateAnimationPlan(sorting.plan,
    { catalog: REAL_CATALOG, body: sorting.body, parts: sorting.parts, style: "words", scriptFormat: "sorting" }), { ok: true, errors: [] });
});

test("every template in the real catalog accepts its own default props and its own length range", () => {
  for (const e of REAL_CATALOG) {
    const props = e.data_tied ? {} : e.default_props;
    for (const seconds of [e.min_frames / e.fps, e.max_frames / e.fps]) {
      const r = validateAnimationPlan([{ anchor: { phrase: "they say yes" }, template: e.id, props, seconds }],
        { catalog: REAL_CATALOG, body: BODY, parts: PARTS, style: "words", scriptFormat: "sorting" });
      assert.deepEqual(r, { ok: true, errors: [] }, `${e.id} at ${seconds}s`);
    }
  }
});
