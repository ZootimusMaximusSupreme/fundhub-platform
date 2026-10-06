// Shoot Day's pure rules (unit X5): the take file name is NAMING.md's, the
// read time is the v1 teleprompter's clock, the plan order puts retakes first,
// and the board says where each clip is in plain words. No database.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OFFER_WORDS, offerWordFor, angleNameFor, takeFileName, takeNameProblem,
  teleprompterText, isFirstLineOnly, readSeconds, wordCount, estimateMinutes,
  planCompare, planFields, boardRow, sortBoard, applyMark, BOARD_STEPS
} from "./shoot-plan.mjs";
import { parseTakeName } from "../ad-videos/merge-takes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAMING = fs.readFileSync(path.resolve(HERE, "../../marketing/ads/NAMING.md"), "utf8");

const SCRIPT = {
  id: "00000000-0000-4000-8000-000000000101",
  root_script_id: "00000000-0000-4000-8000-000000000101",
  ad_id: "91",
  title: "Lenders read two files",
  offer_key: "slo_roadmap",
  lane: "uwiq",
  body: "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.",
  parts: [
    { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
    { kind: "line2", text: "If one is a mess, they never open the other." }
  ],
  needs_retake: false,
  film_order: null,
  locked_at: "2026-10-12T15:06:00.000Z"
};

describe("the take file name (marketing/ads/NAMING.md)", () => {
  test("matches the law's own example, letter for letter", () => {
    const name = takeFileName({ offerWord: "SLO", adId: "7", angle: "Haynes, the call that was never a roadmap", takeNo: 1 });
    assert.equal(name, "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4");
    assert.ok(NAMING.includes("`" + name + "`"), "NAMING.md prints this exact name");
  });

  test("every name in NAMING.md's table is what this makes", () => {
    const rows = [...NAMING.matchAll(/^\| (\d+) \| `(SLO Ad \d+ — (.+) Take 1\.mp4)` \|$/gm)];
    assert.ok(rows.length >= 7, "found the seven SLO rows");
    for (const [, n, file, angle] of rows) {
      assert.equal(takeFileName({ offerWord: "SLO", adId: n, angle, takeNo: 1 }), file);
    }
  });

  test("reads back through the join step's parser to the same four parts", () => {
    for (const [angle, ad, take] of [["Lenders read two files", "91", 1], ["It's a skill, the 80% plan", "104", 3], ["Take 2 of life", "95", 12]]) {
      const name = takeFileName({ offerWord: "SLO", adId: ad, angle, takeNo: take });
      assert.deepEqual(parseTakeName(name), { offer: "SLO", adNumber: Number(ad), angle, takeNo: take, ext: "mp4" });
    }
  });

  test("a missing part gives no name, never a guess", () => {
    assert.equal(takeFileName({ offerWord: null, adId: "91", angle: "x", takeNo: 1 }), null);
    assert.equal(takeFileName({ offerWord: "SLO", adId: null, angle: "x", takeNo: 1 }), null);
    assert.equal(takeFileName({ offerWord: "SLO", adId: "091", angle: "x", takeNo: 1 }), null);
    assert.equal(takeFileName({ offerWord: "SLO", adId: "91", angle: null, takeNo: 1 }), null);
    assert.equal(takeFileName({ offerWord: "SLO", adId: "91", angle: "x", takeNo: 0 }), null);
  });

  test("the offer word: SLO for the roadmap only; other offers have none on file", () => {
    assert.equal(offerWordFor({ offer_key: "slo_roadmap", lane: "uwiq" }), "SLO");
    assert.equal(offerWordFor({ offer_key: null, lane: "slo" }), "SLO");
    assert.equal(offerWordFor({ offer_key: "funding_dfy", lane: "sorting" }), null);
    assert.equal(offerWordFor({ offer_key: "toString", lane: "__proto__" }), null);
    assert.deepEqual(Object.keys(OFFER_WORDS), ["slo_roadmap"]);
  });

  test("the angle is the title, word for word (spaces folded)", () => {
    assert.equal(angleNameFor({ title: "  Lenders   read two\nfiles " }), "Lenders read two files");
    assert.equal(angleNameFor({ title: "   " }), null);
    assert.equal(angleNameFor({ title: null }), null);
  });

  test("the problem sentence says why there is no name", () => {
    assert.equal(takeNameProblem(SCRIPT), null);
    assert.match(takeNameProblem({ ...SCRIPT, ad_id: null }), /no ad number/);
    assert.match(takeNameProblem({ ...SCRIPT, title: "" }), /no title/);
    assert.match(takeNameProblem({ ...SCRIPT, offer_key: "funding_dfy", lane: "sorting" }), /Funding.*no file-name word/);
    assert.match(takeNameProblem({ ...SCRIPT, offer_key: null, lane: "sorting" }), /names no offer/);
  });
});

describe("what the teleprompter rolls, and how long", () => {
  test("a new opening rolls the hook only; a plain retake rolls everything", () => {
    const opening = { ...SCRIPT, needs_retake: true, idea_kind: "opening" };
    assert.equal(isFirstLineOnly(opening), true);
    assert.equal(teleprompterText(opening), "MOST lenders read TWO files before they say yes.");
    assert.equal(isFirstLineOnly({ ...SCRIPT, needs_retake: true, idea_kind: "script" }), false);
    assert.equal(teleprompterText({ ...SCRIPT, needs_retake: true }), SCRIPT.body);
    assert.equal(teleprompterText({ ...opening, parts: null }), "MOST lenders read TWO files before they say yes.");
  });

  test("read time is v1's clock: 60/wpm a word, +35% at a sentence end, +15% at a comma, a pause per blank line", () => {
    // 4 words: "One," (+15%) "two." (+35%) | blank | "Three four"
    const secs = readSeconds("One, two.\n\nThree four", { wpm: 60, pause: 0.8 });
    assert.equal(Number(secs.toFixed(4)), Number((1.15 + 1.35 + 0.8 + 1 + 1).toFixed(4)));
    assert.equal(readSeconds("↑ hi", { wpm: 60 }), 1);
    assert.equal(wordCount("one ↑ two"), 2);
    assert.equal(readSeconds(""), 0);
  });

  test("the estimate is read time plus 2 minutes an ad, rounded up", () => {
    assert.equal(estimateMinutes([]), 0);
    assert.equal(estimateMinutes([{ read_seconds: 30 }, { read_seconds: 31 }]), 6);
    assert.equal(estimateMinutes([{ read_seconds: 0 }]), 2);
  });
});

describe("plan order and plan fields", () => {
  test("retakes first, then film order, then the ad number", () => {
    const a = { ...SCRIPT, root_script_id: "a", ad_id: "95", film_order: null };
    const b = { ...SCRIPT, root_script_id: "b", ad_id: "93", film_order: 2 };
    const c = { ...SCRIPT, root_script_id: "c", ad_id: "92", film_order: 1 };
    const d = { ...SCRIPT, root_script_id: "d", ad_id: "99", needs_retake: true };
    const e = { ...SCRIPT, root_script_id: "e", ad_id: "94", film_order: null };
    assert.deepEqual([a, b, c, d, e].sort(planCompare).map((x) => x.root_script_id), ["d", "c", "b", "e", "a"]);
  });

  test("the next take counts takes filed before the shoot plus takes rolled on it", () => {
    const fresh = planFields(SCRIPT);
    assert.equal(fresh.take_no, 1);
    assert.equal(fresh.take_file_name, "SLO Ad 91 — Lenders read two files Take 1.mp4");
    assert.equal(fresh.last_take_file_name, null);
    assert.equal(fresh.angle_name, "Lenders read two files");
    assert.equal(fresh.offer_word, "SLO");
    assert.equal(fresh.got_it, false);
    assert.equal(fresh.words, wordCount(SCRIPT.body));

    const retake = planFields(SCRIPT, { priorTake: 2, mark: { takes: 1, got_it: false } });
    assert.equal(retake.take_no, 4);
    assert.equal(retake.take_file_name, "SLO Ad 91 — Lenders read two files Take 4.mp4");
    assert.equal(retake.last_take_file_name, "SLO Ad 91 — Lenders read two files Take 3.mp4");
    assert.equal(retake.takes, 1);
  });

  test("a script with no offer word gets no name and the reason", () => {
    const p = planFields({ ...SCRIPT, offer_key: "funding_dfy", lane: "sorting" });
    assert.equal(p.take_file_name, null);
    assert.match(p.take_name_problem, /no file-name word/);
  });
});

describe("marks", () => {
  test("each press counts the take; Got it keeps it; Another take never un-keeps", () => {
    let m = applyMark({}, "r1", "another_take", "2026-10-13T16:00:00.000Z");
    assert.deepEqual(m, { r1: { takes: 1, got_it: false, at: "2026-10-13T16:00:00.000Z" } });
    m = applyMark(m, "r1", "got_it", "2026-10-13T16:01:00.000Z");
    assert.deepEqual(m.r1, { takes: 2, got_it: true, at: "2026-10-13T16:01:00.000Z" });
    m = applyMark(m, "r1", "another_take", "2026-10-13T16:02:00.000Z");
    assert.equal(m.r1.got_it, true);
    assert.equal(m.r1.takes, 3);
    assert.deepEqual(applyMark(null, "r2", "got_it", "t").r2, { takes: 1, got_it: true, at: "t" });
  });
});

describe("the progress board (spec §8.2 table)", () => {
  test("no Got it and no clip: no row", () => {
    assert.equal(boardRow({ ad_id: "91", angle: "x" }), null);
    assert.equal(boardRow({ ad_id: "91", angle: "x", mark: { takes: 1, got_it: false } }), null);
  });

  test("Got it with no clip yet: Filmed", () => {
    const r = boardRow({ ad_id: "91", angle: "x", mark: { got_it: true, at: "2026-10-13T16:05:00.000Z" } });
    assert.deepEqual(r, { ad_id: "91", angle: "x", step: "filmed", step_word: "Filmed", since: "2026-10-13T16:05:00.000Z", reason: null, can_retry: false, needs_you: false });
  });

  test("every pipeline state lands on a step from the table, in words", () => {
    const want = {
      raw_landed: "matched", staged: "cutting", editing: "captions", transcribed: "captions",
      matched: "captions", rendered: "captions", awaiting_approval: "ready_to_approve",
      approved: "approved", delivered: "approved", failed: "failed", rejected: "failed"
    };
    for (const [status, step] of Object.entries(want)) {
      const r = boardRow({ ad_id: "91", angle: "x", video: { status, updated_at: "2026-10-13T17:00:00Z", failure_reason: "Submagic is out of credits" } });
      assert.equal(r.step, step, status);
      assert.ok(BOARD_STEPS.includes(r.step));
      assert.equal(typeof r.step_word, "string");
      assert.equal(r.since, "2026-10-13T17:00:00.000Z");
      assert.equal(r.can_retry, false, "retry lives with the Videos routes, not here");
    }
    assert.equal(boardRow({ ad_id: "91", angle: "x", video: { status: "staged" } }).reason, "The join step still runs on the Mac.");
    assert.equal(boardRow({ ad_id: "91", angle: "x", video: { status: "awaiting_approval" } }).needs_you, true);
    const failed = boardRow({ ad_id: "91", angle: "x", video: { status: "failed", failure_reason: "  Submagic   is out of credits " } });
    assert.equal(failed.reason, "Submagic is out of credits");
    assert.equal(failed.needs_you, true);
    assert.equal(boardRow({ ad_id: "91", angle: "x", video: { status: "rejected" } }).step_word, "Rejected");
  });

  test("rows that need Chris go on top; the rest keep their order", () => {
    const rows = [{ ad_id: "1", needs_you: false }, { ad_id: "2", needs_you: true }, { ad_id: "3", needs_you: false }, { ad_id: "4", needs_you: true }];
    assert.deepEqual(sortBoard(rows).map((r) => r.ad_id), ["2", "4", "1", "3"]);
  });
});
