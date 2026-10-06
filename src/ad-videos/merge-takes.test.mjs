// The pure half of joining takes: names, groups, the decision for one row,
// the script, the alignment, the best-of pick and the edit list.
//
// Fake transcripts only — no ffmpeg, no whisper, no database, no network.
// The media half is merge-takes-media.test.mjs; the sweeper hook is
// merge-takes-step.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseTakeName, parseAdPrefix, groupKey, normalizeAngle, decideJoin, JOINED_PREFIX,
  parseScriptMarkdown, findScript, angleMatches, splitSentences, tokenize,
  findHits, normalizeWords, planBestOf, buildEdl, refineWordsWithSilence, avoidBlack,
  summarizePlan, DEFAULTS
} from "./merge-takes.mjs";
import { loadScripts } from "./merge-takes-step.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const A7 = "Haynes, the call that was never a roadmap";
const name = (ad, angle, take, offer = "SLO") => `${offer} Ad ${ad} — ${angle} Take ${take}.mp4`;

/* A fake transcript. Each word lasts 0.3 s with 0.06 s between words. A "/"
   is a 1.5 s pause (between lines or attempts); a "~" is a 1.0 s pause inside
   a line. Returns whisper-shaped words. */
function say(text, { start = 0.5, word = 0.3, gap = 0.06 } = {}) {
  const out = [];
  let t = start;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (w === "/") { t += 1.5; continue; }
    if (w === "~") { t += 1.0; continue; }
    out.push({ word: w, start: +t.toFixed(3), end: +(t + word).toFixed(3) });
    t += word + gap;
  }
  return out;
}

const T0 = Date.parse("2026-10-05T12:00:00Z");
const LATER = T0 + 2 * 60 * 60 * 1000;
const row = (id, ad, angle, take, extra = {}) => ({
  id, status: "staged", drive_raw_file_id: `d-${id}`, drive_raw_name: name(ad, angle, take),
  created_at: new Date(T0).toISOString(), ...extra
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("names — marketing/ads/NAMING.md", () => {
  test("every take-1 name in NAMING.md's table reads back as its four parts", () => {
    const book = fs.readFileSync(path.join(REPO, "marketing/ads/NAMING.md"), "utf8");
    const rows = [...book.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|$/gm)];
    assert.equal(rows.length, 7, "the book lists the seven SLO ads");
    for (const [, ad, file] of rows) {
      const p = parseTakeName(file);
      assert.ok(p, `${file} must parse`);
      assert.equal(p.offer, "SLO");
      assert.equal(p.adNumber, Number(ad));
      assert.equal(p.takeNo, 1);
      assert.ok(p.angle.length > 5);
    }
  });

  test("the example reads exactly", () => {
    assert.deepEqual(parseTakeName("SLO Ad 7 — Haynes, the call that was never a roadmap Take 2.mp4"),
      { offer: "SLO", adNumber: 7, angle: A7, takeNo: 2, ext: "mp4" });
  });

  test("the book's wrong names are not read as a full name", () => {
    for (const bad of [
      "086_t01_raw_2026-09-24.mp4",
      "SLO Ad 7 Take 1.mp4",
      "SLO Ad 7 Call Pitch.mp4",
      "Ad 7 — Haynes, the call that was never a roadmap.mp4",
      "IMG_4471.mov"
    ]) assert.equal(parseTakeName(bad), null, bad);
    assert.deepEqual(parseAdPrefix("SLO Ad 7 Take 1.mp4"), { offer: "SLO", adNumber: 7 });
  });

  test("same offer + ad + angle words is one group; a different angle is a different video", () => {
    const k1 = groupKey(parseTakeName(name(7, A7, 1)));
    assert.equal(k1, groupKey(parseTakeName(name(7, A7, 2))));
    assert.equal(k1, groupKey(parseTakeName(name(7, A7.toUpperCase() + " ", 3))), "case and spacing do not change the words");
    assert.notEqual(k1, groupKey(parseTakeName(name(7, "Straight offer, max fundability, both sides of the file", 1))),
      "the both-sides tape is Ad 5 — never joined to Ad 7 even if misfiled under 7");
    assert.notEqual(k1, groupKey(parseTakeName(name(7, A7, 1, "ASC"))), "a different offer is a different video");
    assert.equal(normalizeAngle("Straight offer, max fundability, both sides of the file (9/22 rewrite)"),
      "straight offer, max fundability, both sides of the file");
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("decideJoin — one row at staged", () => {
  test("no file name: the old way, alone, said out loud", () => {
    const d = decideJoin({ id: "r1", status: "staged" }, [], { now: LATER });
    assert.equal(d.action, "proceed");
    assert.match(d.note, /no file name/);
  });

  test("the only take of its angle, settled: sent as it is, with a note", () => {
    const r = row("r1", 7, A7, 1);
    const d = decideJoin(r, [r], { now: LATER });
    assert.equal(d.action, "proceed");
    assert.match(d.note, /one take/);
  });

  test("a take is not sent while its angle may still be uploading", () => {
    const r = row("r1", 7, A7, 1);
    const d = decideJoin(r, [r], { now: T0 + 5 * 60 * 1000 });
    assert.equal(d.action, "hold");
    assert.match(d.note, /waiting 25 more minute/);
  });

  test("two takes of one angle: the lowest waiting take carries the join of both", () => {
    const t1 = row("r1", 7, A7, 1);
    const t2 = row("r2", 7, A7, 2);
    const d = decideJoin(t1, [t1, t2], { now: LATER });
    assert.equal(d.action, "join");
    assert.deepEqual(d.members.map((m) => m.takeNo), [1, 2]);
    assert.equal(d.lead.id, "r1");
  });

  test("the other take is closed into the lead's master and never sent alone", () => {
    const t1 = row("r1", 7, A7, 1, { status: "raw_landed" });
    const t2 = row("r2", 7, A7, 2);
    const d = decideJoin(t2, [t1, t2], { now: LATER });
    assert.equal(d.action, "close");
    assert.equal(d.leadId, "r1");
    assert.ok(d.reason.startsWith(JOINED_PREFIX));
  });

  test("a new take after an old lone take went to Submagic: the new one carries ALL takes", () => {
    const t1 = row("r1", 7, A7, 1, { status: "editing", submagic_project_id: "p1" });
    const t2 = row("r2", 7, A7, 2);
    const d = decideJoin(t2, [t1, t2], { now: LATER });
    assert.equal(d.action, "join");
    assert.deepEqual(d.members.map((m) => m.id), ["r1", "r2"], "every take, including the one already sent");
  });

  test("the same ad number with a different angle is NOT joined", () => {
    const a = row("r1", 7, A7, 1);
    const b = row("r2", 7, "Straight offer, max fundability, both sides of the file", 1);
    assert.equal(decideJoin(a, [a, b], { now: LATER }).action, "proceed");
    assert.equal(decideJoin(b, [a, b], { now: LATER }).action, "proceed");
  });

  test("a name with no angle is held while another file shares its ad number", () => {
    const a = { ...row("r1", 7, A7, 1), drive_raw_name: "SLO Ad 7 Take 1.mp4" };
    const b = row("r2", 7, A7, 2);
    const d = decideJoin(a, [a, b], { now: LATER });
    assert.equal(d.action, "hold");
    assert.match(d.note, /no angle/);
    const alone = decideJoin(a, [a], { now: LATER });
    assert.equal(alone.action, "proceed", "the only file for that ad goes the old way");
  });

  test("a name that is not NAMING.md at all is held, not sent alone", () => {
    const a = { ...row("r1", 7, A7, 1), drive_raw_name: "IMG_4471.mov" };
    const d = decideJoin(a, [a], { now: LATER });
    assert.equal(d.action, "hold");
    assert.match(d.note, /NAMING\.md/);
  });

  test("the same take uploaded twice is sent once", () => {
    const a = row("r1", 7, A7, 1, { created_at: new Date(T0).toISOString() });
    const b = row("r2", 7, A7, 1, { created_at: new Date(T0 + 1000).toISOString() });
    const d = decideJoin(b, [a, b], { now: LATER });
    assert.equal(d.action, "close");
    assert.match(d.reason, /duplicate/);
  });

  test("a row that has already moved on is skipped", () => {
    const a = row("r1", 7, A7, 1);
    const d = decideJoin(a, [{ ...a, status: "failed" }], { now: LATER });
    assert.equal(d.action, "skip");
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("the script — lines in order", () => {
  test("headings, labels, meta lines and notes are not spoken lines", () => {
    const md = [
      "# Set",
      "## AD 7 — Haynes, the call that was never a roadmap",
      "`LOCKED 2026-09-19 · 265 words · 1:46 · Haynes DR`",
      "",
      "**HOOK** They told you to hop on a call. You got pitched.",
      "",
      "Reasons. The roadmap was never the product.",
      "",
      "**SHOOT** grey henley, seated.",
      "",
      "### Notes for ad 7",
      "- not spoken",
      "### $297 Ad 6 — Haynes, you already know, 10x your file",
      "Status: Running",
      "Haynes DR. 243 words, about 1:37. Shoot: black tee.",
      "Hook. You already know.",
      ""
    ].join("\n");
    const s = parseScriptMarkdown(md, "x.md");
    assert.equal(s.length, 2);
    assert.deepEqual(s[0].lines, ["They told you to hop on a call.", "You got pitched.", "The roadmap was never the product."]);
    assert.equal(s[1].adNumber, 6);
    assert.deepEqual(s[1].lines, ["You already know."]);
  });

  test("an angle matches its heading exactly, or as the start of a longer heading", () => {
    assert.ok(angleMatches("Haynes, you already know", "Haynes, you already know, 10x your file"));
    assert.ok(angleMatches("Straight offer, max fundability, both sides of the file",
      "Straight offer, max fundability, both sides of the file (9/22 rewrite)"));
    assert.ok(!angleMatches("Straight offer, max fundability, both sides of the file", "Straight offer, max fundability"),
      "Ad 5's older locked opening is a different, shorter heading — not its script");
  });

  test("every SLO ad in NAMING.md finds its script in the repo, in order", () => {
    const scripts = loadScripts();
    const book = fs.readFileSync(path.join(REPO, "marketing/ads/NAMING.md"), "utf8");
    for (const [, , file] of book.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|$/gm)) {
      const p = parseTakeName(file);
      const s = findScript(scripts, p);
      assert.ok(s, `no script for ${file}`);
      assert.ok(s.lines.length >= 10, `${file}: ${s.lines.length} lines`);
    }
    const s7 = findScript(scripts, { adNumber: 7, angle: A7 });
    assert.equal(s7.lines[0], "They told you to hop on a call and they'd walk you through your file.");
    assert.equal(s7.lines.at(-1), "We pull your credit with a soft inquiry, so your score doesn't move.");
  });

  test("sentences split on their ends and numbers survive", () => {
    assert.deepEqual(splitSentences("For $297 I'll tell you. Here's what comes with it."),
      ["For $297 I'll tell you.", "Here's what comes with it."]);
    assert.deepEqual(tokenize("For $297 I'll — low-interest ten"), ["for", "297", "i'll", "low", "interest", "10"]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
const LINES = [
  "They told you to hop on a call and they'd walk you through your file.",
  "Remove your inquiries, show you the roadmap, tell you exactly what to fix.",
  "You got on the call and the whole thing turned into a pitch.",
  "Nobody calls you.",
  "Nobody pitches you."
];
const L = LINES.map((l) => l.replace(/[.,]/g, ""));

describe("alignment — every attempt at every line", () => {
  test("a false start is seen, walled off and never picked", () => {
    const words = normalizeWords(say(`They told you to hop on a / ${L[0]}`));
    const hits = findHits([LINES[0]], words);
    const complete = hits.filter((h) => h.complete);
    assert.equal(complete.length, 1);
    assert.equal(complete[0].jStart, 7, "the complete attempt starts at the second 'They'");
    assert.ok(hits.some((h) => !h.complete), "the false start is a partial hit");
  });

  test("a filler inside a line is marked for cutting, the line still counts as complete", () => {
    const words = normalizeWords(say("They told you to um hop on a call and they'd walk you through your file"));
    const [hit] = findHits([LINES[0]], words);
    assert.equal(hit.complete, true);
    assert.equal(hit.defects.fillers, 1);
    assert.ok(hit.remove.has(4), "the um");
  });

  test("a doubled word and a doubled phrase are cut down to one", () => {
    const w1 = normalizeWords(say("They told you to hop on a a call and they'd walk you through your file"));
    const [h1] = findHits([LINES[0]], w1);
    assert.equal(h1.defects.repeats, 1);
    assert.equal(h1.remove.size, 1);
    const w2 = normalizeWords(say("They told you to hop on a to hop on a call and they'd walk you through your file"));
    const [h2] = findHits([LINES[0]], w2);
    assert.equal(h2.complete, true);
    assert.equal(h2.defects.repeats, 1);
    assert.equal(h2.remove.size, 4);
  });

  test("a scripted 'like' is kept; an extra one is filler", () => {
    const line = "It looks like a roadmap.";
    const [kept] = findHits([line], normalizeWords(say("It looks like a roadmap")));
    assert.equal(kept.defects.fillers, 0);
    const [cut] = findHits([line], normalizeWords(say("It like looks like a roadmap")));
    assert.equal(cut.defects.fillers, 1);
  });

  test("two short lines that differ by one word each find their own words", () => {
    const words = normalizeWords(say(`Nobody calls you / Nobody pitches you`));
    const hits = findHits([LINES[3], LINES[4]], words);
    assert.deepEqual(hits.map((h) => [h.lineIndex, h.jStart]), [[0, 0], [1, 3]]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("best of every take, in script order", () => {
  const take1 = say(`${L[0]} / Remove your inquiries um show you the roadmap tell you exactly what to fix / ${L[2]} / ${L[3]} / ${L[4]}`);
  const take2 = say(`${L[1]} / ${L[0]}`);

  test("each line comes from its cleanest complete attempt, and the lines play in script order", () => {
    const plan = planBestOf({ lines: LINES, takes: [{ takeNo: 1, words: take1 }, { takeNo: 2, words: take2 }] });
    assert.equal(plan.viable, true);
    assert.deepEqual(plan.lines.map((l) => l.pick?.takeNo), [1, 2, 1, 1, 1],
      "line 2 comes from take 2 (no um); line 1 ties and stays with take 1 (lower take)");
    const edl = buildEdl(plan);
    assert.deepEqual([...new Set(edl.map((s) => s.lineIndex))], [0, 1, 2, 3, 4], "script order, each line once");
    assert.equal(edl.filter((s) => s.lineIndex === 1).every((s) => s.takeNo === 2), true);
  });

  test("a take that said the lines out of order still gives a master in script order", () => {
    const plan = planBestOf({ lines: LINES.slice(0, 3), takes: [{ takeNo: 1, words: say(`${L[2]} / ${L[0]} / ${L[1]}`) }] });
    const edl = buildEdl(plan);
    assert.deepEqual(edl.map((s) => s.lineIndex), [0, 1, 2]);
    assert.ok(edl[0].start > edl[2].start, "line 1 is cut from later in the take, and still plays first");
  });

  test("a line no take said completely is left out and named", () => {
    const plan = planBestOf({ lines: LINES, takes: [{ takeNo: 1, words: say(`${L[0]} / ${L[1]} / ${L[2]} / ${L[3]}`) }] });
    assert.equal(plan.viable, true);
    assert.deepEqual(plan.missing, [4]);
    assert.match(summarizePlan(plan, buildEdl(plan)), /left out: line\(s\) 5/);
  });

  test("takes that do not follow the script are refused", () => {
    const plan = planBestOf({ lines: LINES, takes: [{ takeNo: 1, words: say("Hey guys welcome back to the channel today we talk about credit cards") }] });
    assert.equal(plan.viable, false);
    assert.match(plan.why, /do not follow this script/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("the edit list — dead air, pauses, filler", () => {
  test("no line opens on dead air or ends on a hanging tail", () => {
    const words = say(`/ / ${L[0]} / /`);
    const plan = planBestOf({ lines: [LINES[0]], takes: [{ takeNo: 1, words, duration: 30 }] });
    const [seg] = buildEdl(plan);
    assert.equal(seg.start, +(words[0].start - DEFAULTS.padIn).toFixed(3));
    assert.equal(seg.end, +(words.at(-1).end + DEFAULTS.padOut).toFixed(3));
  });

  test("a long pause inside a line is cut down to the pads", () => {
    const words = say("They told you to hop on a call ~ and they'd walk you through your file");
    const plan = planBestOf({ lines: [LINES[0]], takes: [{ takeNo: 1, words }] });
    const segs = buildEdl(plan);
    assert.equal(segs.length, 2);
    assert.ok(words[8].start - words[7].end > 1, "there was a one-second pause");
    const dropped = segs[1].start - segs[0].end;
    assert.ok(dropped > 0.8, `about ${(words[8].start - words[7].end - DEFAULTS.padIn - DEFAULTS.padOut).toFixed(2)} s of the pause is cut out, got ${dropped}`);
  });

  test("the filler's own seconds are cut out of the line", () => {
    const words = say("They told you to um hop on a call and they'd walk you through your file");
    const plan = planBestOf({ lines: [LINES[0]], takes: [{ takeNo: 1, words }] });
    const segs = buildEdl(plan);
    const um = words[4];
    assert.equal(segs.length, 2);
    for (const s of segs) assert.ok(s.end <= um.start || s.start >= um.end, "no cut covers the um");
  });

  test("two lines said back to back in one take stay one cut", () => {
    const words = say(`${L[3]} ${L[4]}`, { gap: 0.06 });
    const plan = planBestOf({ lines: [LINES[3], LINES[4]], takes: [{ takeNo: 1, words }] });
    assert.equal(buildEdl(plan).length, 1);
  });

  test("a word whisper stretched into the silence after it is ended where the silence starts", () => {
    const refined = refineWordsWithSilence([{ word: "call,", start: 1.66, end: 2.45 }], [{ start: 1.98, end: 2.44 }]);
    assert.equal(refined[0].end, 2.01);
    assert.equal(refined[0].start, 1.66);
  });

  test("black frames at a cut's edges are trimmed, an all-black cut is dropped", () => {
    const segs = [{ takeIndex: 0, start: 0, end: 2 }, { takeIndex: 0, start: 3, end: 3.5 }];
    const out = avoidBlack(segs, { 0: [{ start: 0, end: 0.4 }, { start: 2.9, end: 3.6 }] });
    assert.deepEqual(out.map((s) => [s.start, s.end]), [[0.4, 2]]);
  });
});
