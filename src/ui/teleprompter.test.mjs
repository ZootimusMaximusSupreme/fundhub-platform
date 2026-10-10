// The teleprompter's pure helpers (unit X5), run in a bare VM with no
// document: the take file name matches the server's, the remote keys do what
// spec §8.1 says, bullets mode holds on cues, and a press moves the take on.
// The browser half is e2e/teleprompter.spec.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { CONTRACT } from "../marketing/api-contract.mjs";
import { takeFileName, planFields } from "../marketing/shoot-plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "teleprompter.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "teleprompter.html"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx.FundhubTeleprompter;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;

describe("teleprompter, pure", () => {
  test("2160×3840 and 3840×2160 are 4K; 1920×1080 is not", () => {
    const T = load();
    const tall = T.cameraReport({ width: 2160, height: 3840, frameRate: 30 }, "4k");
    const wide = T.cameraReport({ width: 3840, height: 2160, frameRate: 30 }, "4k");
    const hd = T.cameraReport({ width: 1920, height: 1080, frameRate: 30 }, "4k");
    assert.match(tall.line, /^4K/);
    assert.equal(tall.short, "");
    assert.match(wide.line, /^4K/);
    assert.equal(wide.short, "");
    assert.doesNotMatch(hd.line, /4K/);
    assert.match(hd.short, /not 4K/);
    const asked = T.cameraReport({ width: 1920, height: 1080, frameRate: 60 }, "1080p");
    assert.match(asked.line, /^1080p/);
    assert.equal(asked.short, "");
    assert.doesNotMatch(asked.line, /4K/);
  });

  test("front camera asks for real 4K at the highest frame rate", () => {
    const T = load();
    const tries = T.cameraTries("user", "4k");
    assert.equal(tries[0].facingMode.ideal, "user");
    assert.equal(tries[0].width.ideal, 3840);
    assert.equal(tries[0].height.ideal, 2160);
    assert.equal(tries[0].width.max, undefined);
    assert.equal(tries[0].height.max, undefined);
    assert.equal(tries[0].frameRate.ideal, 60);
    assert.equal(tries[0].frameRate.max, undefined);
    assert.equal(tries[0].focusMode, undefined);
    const four = tries.filter((c) => c.width && c.width.ideal === 3840);
    const rates = four.map((c) => c.frameRate && c.frameRate.ideal);
    assert.ok(rates.indexOf(60) < rates.indexOf(30));
    assert.notEqual(tries[0].facingMode.ideal, "environment");
  });

  test("settings 1080p asks for 1920x1080 at 60 fps", () => {
    const T = load();
    const tries = T.cameraTries("user", "1080p");
    assert.equal(tries[0].facingMode.ideal, "user");
    assert.equal(tries[0].width.ideal, 1920);
    assert.equal(tries[0].width.max, 1920);
    assert.equal(tries[0].height.ideal, 1080);
    assert.equal(tries[0].height.max, 1080);
    assert.equal(tries[0].frameRate.min, 60);
    assert.equal(tries[0].frameRate.ideal, 60);
    assert.equal(tries[0].frameRate.max, 60);
    for (const c of tries) {
      const blob = JSON.stringify(c);
      assert.equal(blob.includes("3840"), false);
      assert.equal(blob.includes("2160"), false);
      if (c.width && c.width.max) assert.ok(c.width.max <= 1920);
      if (c.height && c.height.max) assert.ok(c.height.max <= 1920);
      assert.notEqual(c.facingMode.ideal || c.facingMode, "environment");
    }
  });

  test("back camera asks are steady 1080p and never 4K", () => {
    const T = load();
    const tries = T.cameraTries("environment");
    assert.equal(tries[0].facingMode.ideal, "environment");
    assert.equal(tries[0].width.ideal, 1920);
    assert.equal(tries[0].height.ideal, 1080);
    assert.equal(tries[0].frameRate.min, 60);
    assert.equal(tries[0].focusMode, "continuous");
    const rates = tries.map((c) => c.frameRate && c.frameRate.ideal).filter((n) => n);
    assert.ok(rates.indexOf(60) < rates.indexOf(30));
    for (const c of tries) {
      const blob = JSON.stringify(c);
      assert.equal(blob.includes("3840"), false);
      assert.equal(blob.includes("2160"), false);
      if (c.width && c.width.max) assert.ok(c.width.max <= 1920);
      if (c.height && c.height.max) assert.ok(c.height.max <= 1920);
    }
  });

  test("the wide back camera is chosen, not the ultra-wide", () => {
    const T = load();
    const devices = [
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
      { kind: "videoinput", deviceId: "ultra", label: "Back Ultra Wide Camera" },
      { kind: "videoinput", deviceId: "wide", label: "Back Camera" },
      { kind: "videoinput", deviceId: "tele", label: "Back Telephoto Camera" }
    ];
    assert.equal(T.pickVideoDevice(devices, "environment"), "wide");
    assert.equal(T.pickVideoDevice(devices, "user"), "front");
    assert.equal(T.pickVideoDevice([{ kind: "videoinput", deviceId: "x", label: "" }], "environment"), "");
  });

  test("the file name is the server's NAMING.md name, letter for letter", () => {
    const T = load();
    for (const n of [1, 2, 3, 12]) {
      assert.equal(T.fileName(ONE, n), takeFileName({ offerWord: "SLO", adId: "91", angle: "Lenders read two files", takeNo: n }));
    }
    assert.equal(T.fileName(TWO, 1), null, "no offer word on file, no name");
    assert.equal(T.fileName({ ...ONE, ad_id: null }, 1), null);
    assert.equal(T.fileName(ONE, 0), null);
  });

  test("a press counts the take the way the server does (applyMark), so the next name is right offline", () => {
    const T = load();
    const fresh = { ...ONE, takes: 0, got_it: false, take_no: 1, take_file_name: T.fileName(ONE, 1) };
    const again = plain(T.afterMark(fresh, "another_take"));
    assert.equal(again.takes, 1);
    assert.equal(again.got_it, false);
    assert.equal(again.take_no, 2);
    assert.equal(again.last_take_file_name, "SLO Ad 91 — Lenders read two files Take 1.mp4");
    assert.equal(again.take_file_name, "SLO Ad 91 — Lenders read two files Take 2.mp4");
    const kept = plain(T.afterMark(again, "got_it"));
    assert.equal(kept.got_it, true);
    assert.equal(kept.take_no, 3);
    // the server agrees: same takes, same next take
    const server = planFields({ ...ONE, offer_key: "slo_roadmap" }, { priorTake: 0, mark: { takes: 2, got_it: true } });
    assert.equal(kept.take_file_name, server.take_file_name);
    assert.equal(kept.last_take_file_name, server.last_take_file_name);
  });

  test("v1's keys stay; at the end of a script play keys are Got it and Page Up is Another take", () => {
    const T = load();
    const k = (key) => T.keyId({ key });
    assert.equal(T.actionFor(k(" "), {}, false), "play");
    assert.equal(T.actionFor(k("Enter"), {}, false), "play");
    assert.equal(T.actionFor(k("PageDown"), {}, false), "play");
    assert.equal(T.actionFor(k("ArrowUp"), {}, false), "faster");
    assert.equal(T.actionFor(k("ArrowRight"), {}, false), "faster");
    assert.equal(T.actionFor(k("ArrowDown"), {}, false), "slower");
    assert.equal(T.actionFor(k("PageUp"), {}, false), "restart");
    assert.equal(T.actionFor(k(" "), {}, true), "got_it");
    assert.equal(T.actionFor(k("PageDown"), {}, true), "got_it");
    assert.equal(T.actionFor(k("PageUp"), {}, true), "another_take");
    assert.equal(T.actionFor(k("x"), {}, false), null);
  });

  test("Learn remote: a learned button wins, per slot, and an odd remote is still named", () => {
    const T = load();
    const learned = { got_it: ["key:b"], another_take: ["code:MediaTrackPrevious"], play: ["key:a"] };
    assert.equal(T.actionFor("key:b", learned, true), "got_it");
    assert.equal(T.actionFor("key:b", learned, false), "play", "mid-script the Got it button plays and pauses");
    assert.equal(T.actionFor("code:MediaTrackPrevious", learned, true), "another_take");
    assert.equal(T.actionFor("key:a", learned, false), "play");
    assert.equal(T.actionFor("key:a", learned, true), "got_it");
    assert.equal(T.keyId({ key: "Unidentified", code: "MediaPlayPause" }), "code:MediaPlayPause");
    assert.equal(T.keyId({ key: "Unidentified", code: "", keyCode: 179 }), "keyCode:179");
  });

  test("bullets mode: each cue is its own paragraph that holds; words mode splits on blank lines", () => {
    const T = load();
    const paras = plain(T.paragraphsFor(ONE));
    assert.deepEqual(paras.map((p) => p.cue), [false, false, true, true, true, false, false]);
    assert.equal(paras[2].text, "the personal file");
    const words = plain(T.paragraphsFor(TWO));
    assert.deepEqual(words, [
      { text: "Every hard pull you did not need is still sitting on your file.", cue: false },
      { text: "And lenders count them.", cue: false }
    ]);
    assert.deepEqual(plain(T.paragraphsFor({ ...ONE, first_line_only: true, teleprompter_text: "MOST lenders read TWO files before they say yes." })),
      [{ text: "MOST lenders read TWO files before they say yes.", cue: false }]);
    assert.equal(T.isCaps("TWO"), true);
    assert.equal(T.isCaps("LLC"), false);
  });

  test("it starts at the first script with no Got it and moves to the next one", () => {
    const T = load();
    assert.equal(T.firstToRoll(PAGE.shoot.scripts), 1);
    assert.equal(T.nextToRoll([{ got_it: false }, { got_it: true }, { got_it: false }], 0), 2);
    assert.equal(T.nextToRoll([{ got_it: false }, { got_it: true }, { got_it: false }], 2), 0);
    assert.equal(T.nextToRoll([{ got_it: true }, { got_it: true }], 0), -1);
    assert.equal(T.clock(65), "1:05");
  });

  test("Next goes on in film order: the next with no Got it, else simply the next; -1 at the end", () => {
    const T = load();
    assert.equal(T.nextInOrder([{ got_it: false }, { got_it: true }, { got_it: false }], 0), 2);
    assert.equal(T.nextInOrder([{ got_it: false }, { got_it: true }, { got_it: true }], 0), 1, "only this one is left: just the next");
    assert.equal(T.nextInOrder([{ got_it: true }, { got_it: true }], 1), -1);
  });

  test("a blank gap keeps the same pixel speed as the words", () => {
    const T = load();
    // Words move 20px in 2s (10 px per second). The gap of 40px was given 0.4s
    // (100 px per second). That is the race. After the fix it takes 4s.
    const raw = [
      { t: 0, y: 0 },
      { t: 2, y: 20 },
      { t: 2.4, y: 60, blank: true },
      { t: 4.4, y: 80 }
    ];
    const out = T.paceThroughBlanks(raw);
    const speed = (a, b) => (b.y - a.y) / (b.t - a.t);
    assert.equal(speed(out[0], out[1]), 10);
    assert.equal(speed(out[1], out[2]), 10);
    assert.equal(out[2].t, 6);
    assert.equal(out[2].y, 60);
    assert.equal(out[3].t, 8);
    // A word that started when the old gap ended now starts when the blank is done.
    assert.equal(T.scrollTime(raw, out, 2.4), 6);
    assert.equal(T.scrollTime(raw, out, 0), 0);
    assert.equal(T.scrollTime(raw, out, 4.4), 8);
  });

  test("a taller blank takes longer, still at the word speed, and a slow blank is not sped up", () => {
    const T = load();
    const raw = [
      { t: 0, y: 0 },
      { t: 2, y: 20 },
      { t: 2.2, y: 40, blank: true },
      { t: 4.2, y: 60 },
      { t: 4.4, y: 100, blank: true }
    ];
    const out = T.paceThroughBlanks(raw);
    const speed = (a, b) => (b.y - a.y) / (b.t - a.t);
    const words = speed(out[0], out[1]);
    assert.ok(Math.abs(speed(out[1], out[2]) - words) < 1e-9);
    assert.ok(Math.abs(speed(out[3], out[4]) - words) < 1e-9);
    assert.ok(out[4].t - out[3].t > out[2].t - out[1].t);
    const slow = [
      { t: 0, y: 0 },
      { t: 2, y: 20 },
      { t: 10, y: 40, blank: true }
    ];
    assert.equal(T.paceThroughBlanks(slow)[2].t, 10);
  });

  test("after an edit it rolls on from the same word, or from the start of the line that changed", () => {
    const T = load();
    // paragraphs of 4, 5, 3 words; paragraph 1 grew to 7
    assert.equal(T.wordAfterEdit(2, 1, [4, 5, 3], [4, 7, 3]), 2, "before the change: same word");
    assert.equal(T.wordAfterEdit(6, 1, [4, 5, 3], [4, 7, 3]), 4, "inside the change: the start of that line");
    assert.equal(T.wordAfterEdit(10, 1, [4, 5, 3], [4, 7, 3]), 12, "after the change: moved by the words added");
    assert.equal(T.wordAfterEdit(11, 1, [4, 5, 3], [4, 2, 3]), 8, "after the change: moved back by the words taken out");
    assert.equal(T.wordAfterEdit(50, 0, [4], [2]), 1, "never past the last word");
  });
});

/* The touch rules: one tap plays or pauses after a short wait. Two quick taps
   put a cursor in the words and do not play or pause. A drag reports the
   finger's own movement. Hold a line to edit. */
describe("teleprompter touch rules (gestureStep)", () => {
  function run(T, events, mode) {
    let g = T.gestureStart();
    const all = [];
    let m = mode;
    for (const ev of events) {
      const r = T.gestureStep(g, ev, typeof m === "function" ? m() : m);
      g = r.g;
      for (const a of plain(r.acts)) all.push(a);
    }
    return { g, acts: all };
  }
  const tap = (t, x = 100, y = 300) => [{ type: "down", x, y, t }, { type: "up", x, y, t: t + 60 }];
  const settle = (T, t) => ({ type: "settle", t: t + 60 + T.DBL_MS });

  test("one tap while rolling does not pause until the double-tap wait ends", () => {
    const T = load();
    assert.deepEqual(run(T, tap(0), "rolling").acts, []);
    assert.deepEqual(run(T, [...tap(0), { type: "settle", t: 60 + T.DBL_MS - 1 }], "rolling").acts, []);
    assert.deepEqual(run(T, [...tap(0), settle(T, 0)], "rolling").acts, [{ do: "pause" }]);
  });

  test("one tap while paused rolls on; one tap in scroll mode rolls on from there", () => {
    const T = load();
    assert.deepEqual(run(T, [...tap(0), settle(T, 0)], "paused").acts, [{ do: "resume" }]);
    assert.deepEqual(run(T, [...tap(0), settle(T, 0)], "scroll").acts, [{ do: "resume" }]);
  });

  test("two taps far apart in time are two single taps: pause, then roll on", () => {
    const T = load();
    let mode = "rolling";
    const seen = [];
    let g = T.gestureStart();
    for (const ev of [...tap(0), settle(T, 0), ...tap(1000), settle(T, 1000)]) {
      const r = T.gestureStep(g, ev, mode);
      g = r.g;
      for (const a of plain(r.acts)) { seen.push(a.do); if (a.do === "pause") mode = "paused"; if (a.do === "resume") mode = "rolling"; }
    }
    assert.deepEqual(seen, ["pause", "resume"]);
  });

  test("two quick taps place a cursor in every mode: paused, rolling, scrolling (owner call 2026-10-09)", () => {
    const T = load();
    for (const mode of ["paused", "rolling", "scroll"]) {
      const r = run(T, [...tap(0), ...tap(200), settle(T, 200)], mode);
      assert.deepEqual(r.acts.map((a) => a.do), ["caret"], mode);
      assert.equal(r.acts[0].x, 100);
      assert.equal(r.acts[0].y, 300);
    }
  });

  test("the second tap is marked so the page can skip play and pause", () => {
    const T = load();
    let g = T.gestureStart();
    for (const ev of tap(0)) g = T.gestureStep(g, ev, "rolling").g;
    const down = T.gestureStep(g, { type: "down", x: 104, y: 304, t: 200 }, "rolling");
    assert.equal(down.g.down.dbl, true);
    assert.deepEqual(plain(down.acts), []);
  });

  test("a second tap too far away is not a double tap", () => {
    const T = load();
    const r = run(T, [...tap(0, 100, 300), ...tap(150, 300, 600), settle(T, 150)], "paused");
    assert.deepEqual(r.acts.map((a) => a.do), ["resume", "pause"]);
  });

  test("thumb up rolls the words up; thumb down moves them down with the hand", () => {
    const T = load();
    assert.equal(T.scriptDelta(-80, false), 80, "thumb up: next lines come from below");
    assert.equal(T.scriptDelta(80, false), -80, "thumb down: the words go down with the hand");
    assert.equal(T.scriptDelta(80, true), 80, "upside-down glass: the thumb still matches");
    assert.equal(T.scriptDelta(-30, true), -30);
  });

  test("a drag grabs the words, then moves them by the finger's distance; a tap is not a drag", () => {
    const T = load();
    const r = run(T, [
      { type: "down", x: 100, y: 400, t: 0 },
      { type: "move", x: 101, y: 395, t: 10 },  // inside the slop: still a tap
      { type: "move", x: 101, y: 380, t: 20 },  // now a drag: 20 px from the start
      { type: "move", x: 101, y: 350, t: 40 },
      { type: "up", x: 101, y: 350, t: 300 }
    ], "rolling");
    assert.deepEqual(r.acts, [{ do: "grab" }, { do: "drag", dy: -20 }, { do: "drag", dy: -30 }]);
  });

  test("a flick in scroll mode keeps the words moving; the same flick while paused does not", () => {
    const T = load();
    const flick = [
      { type: "down", x: 100, y: 500, t: 0 },
      { type: "move", x: 100, y: 450, t: 16 },
      { type: "move", x: 100, y: 380, t: 32 },
      { type: "up", x: 100, y: 380, t: 40 }
    ];
    const s = run(T, flick, "scroll").acts;
    const f = s.find((a) => a.do === "fling");
    assert.ok(f, "a fling in scroll mode");
    assert.ok(f.v < -T.FLING_MIN, "upward, faster than the floor");
    assert.equal(run(T, flick, "paused").acts.some((a) => a.do === "fling"), false);
  });

  test("hold still for the long-press time: edit that line; lifting the finger opens the keyboard; no tap fires", () => {
    const T = load();
    const r = run(T, [
      { type: "down", x: 120, y: 260, t: 0 },
      { type: "timer", t: T.LONG_MS - 50 },
      { type: "timer", t: T.LONG_MS + 5 },
      { type: "up", x: 120, y: 260, t: T.LONG_MS + 200 }
    ], "rolling");
    assert.deepEqual(r.acts, [{ do: "edit", x: 120, y: 260 }, { do: "edit-focus" }]);
  });

  test("a finger that moved is never a long press", () => {
    const T = load();
    const r = run(T, [
      { type: "down", x: 120, y: 260, t: 0 },
      { type: "move", x: 120, y: 300, t: 100 },
      { type: "timer", t: T.LONG_MS + 5 },
      { type: "up", x: 120, y: 300, t: T.LONG_MS + 50 }
    ], "paused");
    assert.equal(r.acts.some((a) => a.do === "edit"), false);
  });

  test("a cancelled touch does nothing; an up with no down does nothing", () => {
    const T = load();
    assert.deepEqual(run(T, [{ type: "down", x: 1, y: 1, t: 0 }, { type: "cancel", t: 5 }, { type: "up", x: 1, y: 1, t: 10 }], "rolling").acts, []);
    assert.deepEqual(run(T, [{ type: "up", x: 1, y: 1, t: 10 }], "rolling").acts, []);
  });
});

describe("top edge changes the script", () => {
  function run(T, events, top = 36) {
    let g = T.topEdgeStart();
    const acts = [];
    let claim = false;
    for (const ev of events) {
      const r = T.topEdgeStep(g, ev, top);
      g = r.g;
      claim = r.claim;
      for (const a of r.acts) acts.push(a.do);
    }
    return { g, acts, claim };
  }

  test("only scripts still to film stay in the queue", () => {
    const T = load();
    const list = [{ got_it: false }, { got_it: true }, { got_it: false }];
    assert.deepEqual(plain(T.filmQueue(list)), [0, 2]);
    assert.equal(T.queueStep([0, 2], 0, 1), 2);
    assert.equal(T.queueStep([0, 2], 2, 1), -1);
    assert.equal(T.queueStep([0, 2], 2, -1), 0);
    assert.equal(T.queueStep([0, 2], 1, 1), 0);
    assert.equal(T.nextUnfilmed(list, 0), 2);
    assert.equal(T.nextUnfilmed([{ got_it: true }], 0), -1);
  });

  test("scroll up from the top is the next script, scroll down is the previous, two taps mark it filmed", () => {
    const T = load();
    const up = run(T, [
      { type: "down", x: 100, y: 10, t: 0 },
      { type: "move", x: 100, y: 10 - T.SWAP_PX, t: 40 },
      { type: "up", x: 100, y: 10 - T.SWAP_PX, t: 50 }
    ]);
    assert.deepEqual(plain(up.acts), ["next"]);
    const down = run(T, [
      { type: "down", x: 100, y: 8, t: 0 },
      { type: "move", x: 102, y: 8 + T.SWAP_PX, t: 40 },
      { type: "up", x: 102, y: 8 + T.SWAP_PX, t: 50 }
    ]);
    assert.deepEqual(plain(down.acts), ["prev"]);
    const tap = run(T, [
      { type: "down", x: 80, y: 12, t: 0 },
      { type: "up", x: 80, y: 14, t: 40 }
    ]);
    assert.deepEqual(plain(tap.acts), ["arm"]);
    let g = T.topEdgeStart();
    g = T.topEdgeStep(g, { type: "down", x: 80, y: 12, t: 0 }, 36).g;
    g = T.topEdgeStep(g, { type: "up", x: 80, y: 12, t: 30 }, 36).g;
    const later = T.topEdgeStep(g, { type: "down", x: 90, y: 400, t: 200 }, 36);
    assert.equal(later.claim, true);
    const moved = T.topEdgeStep(later.g, { type: "move", x: 90, y: 400 + T.SWAP_PX, t: 240 }, 36);
    assert.deepEqual(plain(moved.acts.map((a) => a.do)), ["prev"]);
    const miss = T.topEdgeStep(T.topEdgeStart(), { type: "down", x: 90, y: 400, t: 0 }, 36);
    assert.equal(miss.claim, false);
    assert.deepEqual(plain(miss.acts), []);
    const done = run(T, [
      { type: "down", x: 40, y: 10, t: 0 },
      { type: "up", x: 40, y: 10, t: 40 },
      { type: "down", x: 44, y: 12, t: 180 },
      { type: "up", x: 44, y: 12, t: 220 }
    ]);
    assert.deepEqual(plain(done.acts), ["arm", "done"]);
  });

  test("the tiny name button takes two taps and does not stop the camera", () => {
    const T = load();
    assert.equal(T.chipLabel({ take_file_name: "SLO Ad 7 — Haynes Take 1.mp4", title: "Haynes" }), "SLO Ad 7 — Haynes Take 1.mp4");
    assert.equal(T.chipLabel({
      take_file_name: null,
      angle_name: "Inquiries off first",
      take_name_problem: "The Funding, done-for-you offer has no file-name word yet (like SLO for the roadmap), so the file name is unknown."
    }), "Inquiries off first");
    assert.equal(T.chipLabel({ title: "  Ad 14 — It's a skill  " }), "Ad 14 — It's a skill");
    assert.equal(T.chipLabel({}), "Next");
    assert.equal(T.chipLabel(null), "Next");
    assert.doesNotMatch(T.chipLabel({ take_name_problem: "The Funding, done-for-you offer has no file-name word yet" }), /unknown|file-name word/i);
    const one = T.chipStep(T.chipStart(), { type: "up", x: 10, y: 10, t: 0 });
    assert.equal(one.go, false);
    const two = T.chipStep(one.g, { type: "up", x: 12, y: 14, t: 100 });
    assert.equal(two.go, true);
    const late = T.chipStep(one.g, { type: "up", x: 12, y: 14, t: T.DBL_MS + 50 });
    assert.equal(late.go, false);
    const far = T.chipStep(one.g, { type: "up", x: 10 + T.DBL_SLOP + 5, y: 10, t: 80 });
    assert.equal(far.go, false);
    assert.match(HTML, /<button type="button" id="p-file"/);
    assert.doesNotMatch(SRC, /File name unknown/);
    const up = SRC.slice(SRC.indexOf('chipBtn.addEventListener("pointerup"'), SRC.indexOf('chipBtn.addEventListener("click"'));
    assert.match(up, /if \(r\.go\) openQueueMenu\(\)/);
    assert.doesNotMatch(up, /completeFromTop\(/);
    assert.doesNotMatch(up, /markThis\(/);
    assert.doesNotMatch(up, /endRec\(/);
    assert.doesNotMatch(up, /nextScript\(/);
    const menuFn = SRC.slice(SRC.indexOf("function drawQueue"), SRC.indexOf("function pickQueued"));
    assert.match(menuFn, /filmQueue\(scripts\)/);
    assert.doesNotMatch(menuFn, /markThis\(/);
    assert.doesNotMatch(menuFn, /endRec\(/);
    const pickFn = SRC.slice(SRC.indexOf("function pickQueued"), SRC.indexOf("function openQueueMenu"));
    assert.match(pickFn, /open\(i, true\)/);
    assert.doesNotMatch(pickFn, /markThis\(/);
    assert.doesNotMatch(pickFn, /endRec\(/);
    const openMenu = SRC.slice(SRC.indexOf("function openQueueMenu"), SRC.indexOf("function topLimit"));
    assert.match(openMenu, /drawQueue\(\)/);
    assert.match(openMenu, /openSheet\("qmenu"\)/);
    assert.doesNotMatch(openMenu, /markThis\(/);
    assert.doesNotMatch(openMenu, /completeFromTop\(/);
    assert.match(HTML, /id="qmenu"/);
    assert.match(HTML, /id="qmenu-list"/);
  });

  test("a swap from the top does not stop the camera", () => {
    const openFn = SRC.slice(SRC.indexOf("function open(i, keepCamera)"), SRC.indexOf("function redraw("));
    assert.match(openFn, /if \(!keepCamera\) endRec\(\)/);
    assert.match(SRC, /open\(n, true\)/);
    const swapFn = SRC.slice(SRC.indexOf("function swapQueued"), SRC.indexOf("function completeFromTop"));
    const doneFn = SRC.slice(SRC.indexOf("function completeFromTop"), SRC.indexOf("function applyTop"));
    assert.doesNotMatch(swapFn, /endRec\(/);
    assert.doesNotMatch(doneFn, /endRec\(/);
  });
});

describe("teleprompter page", () => {
  test("the page: no shell, no sign-in, the mirror switches, the remote words, Fundhub spelled right", () => {
    assert.doesNotMatch(HTML, /shell\.js/);
    assert.doesNotMatch(HTML, /login\.html/);
    assert.doesNotMatch(HTML + SRC, /sign in/i);
    assert.doesNotMatch(SRC, /showWall/);
    assert.match(SRC, /x-shoot-film/);
    assert.match(SRC, /if \(filmKey\(\)\) return showEmpty\("This film link did not open the shoot\."/);
    assert.match(SRC, /plan\.hidden = !!filmKey\(\)/);
    assert.match(HTML, /id="empty-plan"/);
    assert.match(HTML, /id="t-mirror"/);
    assert.match(HTML, /id="t-flipv"/);
    assert.match(HTML, /#flip\.mirror-x\{transform:scaleX\(-1\)\}/);
    assert.match(HTML, /Learn remote/);
    assert.match(HTML, /13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ/);
    assert.doesNotMatch(HTML + SRC, /FundHub/);
    // Everything read through the glass flips together.
    const flip = HTML.slice(HTML.indexOf('<div id="flip">'), HTML.indexOf('<div id="pulse">'));
    assert.ok(HTML.indexOf('<div id="flip">') < HTML.indexOf('<div id="pulse">'), "the pulse row sits after the glass");
    for (const id of ["stage", "line", "progress", "count", "cuehold", "end", "scrollchip"]) assert.ok(flip.includes(`id="${id}"`), id);
    // The change pulse, the edit bar and the controls are NOT read through the glass.
    for (const id of ["pulse", "p-save", "editbar", "b-edit", "b-hist", "b-next"]) assert.ok(!flip.includes(`id="${id}"`), id);
    // The edit file loads first: teleprompter.js reads window.FundhubTeleprompterEdits.
    assert.ok(HTML.indexOf('src="teleprompter-edits.js"') < HTML.indexOf('src="teleprompter.js"'));
    // Editing turns the glass flip off so the words read the right way round.
    assert.match(HTML, /body\.editing #flip\{transform:none !important\}/);
    assert.match(HTML, /Play rolls the words/);
    assert.match(HTML, /A blank gap keeps that same speed/);
    assert.match(HTML, /id="how"/);
    assert.match(HTML, /id="b-rec"/);
    assert.match(HTML, /id="b-script-save" hidden/);
    assert.match(HTML, />Record</);
    assert.match(HTML, />Play</);
    assert.doesNotMatch(HTML, /id="b-stop"/);
    assert.doesNotMatch(HTML, />Stop</);
    const controlsAt = HTML.indexOf('<div id="controls">');
    const controls = HTML.slice(controlsAt, HTML.indexOf("</div>", controlsAt));
    assert.match(controls, /id="b-rec"/);
    assert.match(controls, /id="play"/);
    assert.doesNotMatch(controls, /id="b-stop"/);
    assert.doesNotMatch(controls, /Save/);
    assert.doesNotMatch(HTML, /id="b-slow"/);
    assert.doesNotMatch(HTML, /id="b-fast"/);
    assert.doesNotMatch(HTML, /id="b-hist"/);
    assert.doesNotMatch(HTML, /id="b-restart"/);
    assert.doesNotMatch(HTML, /id="play-ico"/);
    assert.doesNotMatch(HTML, /body\.rolling #bar,body\.rolling #top\{opacity:0/);
    assert.match(HTML, /body\.rolling #top,body\.rolling #status,body\.rolling #tools\{opacity:0;pointer-events:none\}/);
    assert.match(SRC, /\$\("b-rec"\)\.onclick = recordToggle/);
    assert.match(SRC, /function recordToggle\(\) \{[\s\S]*?if \(wantRec\) stopRecClick\(\);\s*else recordClick\(\)/);
    assert.match(SRC, /scriptSave\.onclick = saveScript/);
    assert.match(SRC, /on \? "Pause" : "Play"/);
    assert.doesNotMatch(SRC, /label\.textContent = "Play"/);
    const startFn = SRC.slice(SRC.indexOf("function start("), SRC.indexOf("function cancelCount("));
    assert.doesNotMatch(startFn, /ensureRecording/);
    assert.match(SRC, /function recordClick\(\) \{[\s\S]*?ensureRecording\(\)/);
    assert.match(SRC, /function stopRecClick\(\) \{\s*endRec\(\);/);
  });

  test("a double tap places a cursor in the words and does not stop the camera", () => {
    assert.match(SRC, /setAttribute\("contenteditable", "true"\)/);
    assert.match(SRC, /caretRangeFromPoint/);
    assert.doesNotMatch(SRC, /word-box/);
    const caret = SRC.slice(SRC.indexOf("function placeCaret"), SRC.indexOf("function flatWords"));
    assert.doesNotMatch(caret, /endRec\(/);
    assert.doesNotMatch(caret, /stop\(\)/);
    assert.match(caret, /playing \|\| countTimer \|\| scrollMode\) return/);
    assert.match(SRC, /function saveScript\(\) \{\s*if \(textEdit\) syncCaretText\(true\)/);
    assert.match(SRC, /function leaveCaret\(redrawNow\) \{\s*if \(!textEdit\) return;\s*syncCaretText\(true\);\s*edits\.commit\(\)/);
    const cancel = SRC.slice(SRC.indexOf("function cancelCaret"), SRC.indexOf("function setRecLabel"));
    assert.doesNotMatch(cancel, /edits\.commit/);
    assert.doesNotMatch(cancel, /endRec\(/);
    assert.match(cancel, /edits\.drop\(snap\.root\)/);
    assert.match(cancel, /withWords\(scripts\[i\], snap\.body, snap\.parts\)/);
    assert.match(HTML, /id="b-cancel"/);
    assert.match(HTML, /aria-label="Cancel"/);
    assert.match(SRC, /\$\("b-cancel"\)\.addEventListener\("pointerdown"/);
    assert.match(SRC, /if \(textEdit\) leaveCaret\(true\)/);
    const editMove = SRC.slice(SRC.indexOf('stage.addEventListener("pointermove"'), SRC.indexOf('stage.addEventListener("pointerup"'));
    assert.match(editMove, /if \(textEdit\)/);
    assert.match(editMove, /moveBy\(/);
    assert.match(SRC, /if \(editing \|\| \(textEdit && !force\)\) return/);
    assert.match(SRC, /apply\(!!textEdit\)/);
    assert.match(SRC, /send: function \(body\) \{ return api\("POST", "marketing\/scripts\/edit", body\); \}/);
  });

  test("a word save uses the script edit route and does not stop the camera", () => {
    assert.match(SRC, /send: function \(body\) \{ return api\("POST", "marketing\/scripts\/edit", body\); \}/);
    const stopFn = SRC.slice(SRC.indexOf("function stop()"), SRC.indexOf("function hold("));
    const begin = SRC.slice(SRC.indexOf("function beginEdit"), SRC.indexOf("function grow"));
    const end = SRC.slice(SRC.indexOf("function endEdit"), SRC.indexOf("function putBack"));
    assert.match(stopFn, /edits\.commit\(\)/);
    assert.match(end, /edits\.commit\(\)/);
    assert.doesNotMatch(stopFn, /endRec\(/);
    assert.doesNotMatch(begin, /endRec\(/);
    assert.doesNotMatch(end, /endRec\(/);
    assert.match(SRC, /if \(cam\.rec && cam\.rec\.state === "recording"\) return;/);
  });

  test("Save the video sends the original file to the live site", () => {
    assert.match(SRC, /\/api\/marketing\/shoot\/take/);
    assert.match(SRC, /method:\s*"PUT"/);
    assert.match(SRC, /file\.slice\(at, end\)/);
    assert.match(SRC, /x-shoot-film/);
    assert.match(SRC, /\$\("b-save"\)\.onclick = saveClick/);
    assert.match(SRC, /setTransform\(-1/);
    assert.doesNotMatch(SRC, /8787/);
    assert.doesNotMatch(SRC, /ffmpeg/);
  });
});

describe("teleprompter film look", () => {
  const CSS = fs.readFileSync(path.join(APP, "teleprompter.css"), "utf8");

  test("the red line is the top reading point, not the middle", () => {
    const T = load();
    assert.equal(T.readingLinePx(0), 8);
    assert.equal(T.readingLinePx(47), 55);
    assert.ok(T.readingLineTop(47, 48) < 844 * 0.2);
    assert.ok(T.readingLineTop(0, 48) < 400);
  });

  test("the script starts four lines down the screen, never past the middle of a short one", () => {
    const T = load();
    assert.equal(T.START_LINES_DOWN, 4);
    const top = T.readingLineTop(47, 48);
    // 48 px words at 1.32 line height: one line is about 63 px, so four lines is about 253 px lower.
    assert.equal(T.readingLineTop(47, 48, 63.36), top + 4 * 63.36);
    assert.ok(T.readingLineTop(47, 48, 63.36) > top + 200);
    // A short sideways screen: the cap holds it at the middle.
    assert.equal(T.readingLineTop(0, 24, 31.68, 100), 100);
    // The cap never lifts the line above the old top line.
    assert.equal(T.readingLineTop(47, 48, 63.36, 10), top);
  });

  test("pause keeps the scroll time", () => {
    const T = load();
    assert.equal(T.pausePlace(4.25), 4.25);
    assert.notEqual(T.pausePlace(4.25), 0);
    const stopFn = SRC.slice(SRC.indexOf("function stop()"), SRC.indexOf("function hold("));
    assert.match(stopFn, /t = pausePlace\(t\)/);
  });

  test("sideways words sit on the front-camera half", () => {
    const T = load();
    assert.equal(T.cameraWordSide({ type: "landscape-primary" }), "left");
    assert.equal(T.cameraWordSide({ type: "landscape-secondary" }), "right");
    assert.equal(T.cameraWordSide({ type: "portrait-primary" }), "full");
    assert.equal(T.cameraWordSide({ angle: 90 }), "left");
    assert.equal(T.cameraWordSide({ angle: -90 }), "right");
    assert.equal(T.cameraWordSide({ angle: 270 }), "right");
    assert.equal(T.cameraWordSide({ landscape: true }), "left");
    assert.equal(T.cameraWordSide({}), "full");
    assert.equal(T.cameraWordSide({ type: "landscape-secondary", angle: 90 }), "right");
    assert.match(CSS, /body\.cam-side-left #content/);
    assert.match(CSS, /width: 50%/);
    assert.match(SRC, /tp-portrait/);
  });

  test("the two film buttons are glass, the shade is a little lighter, and speed is a tiny control", () => {
    assert.match(HTML, /id="wpm-down"/);
    assert.match(HTML, /id="wpm-up"/);
    assert.match(HTML, /aria-label="Slower"/);
    assert.match(HTML, /aria-label="Faster"/);
    assert.match(CSS, /#play/);
    assert.match(CSS, /#b-rec/);
    assert.doesNotMatch(CSS, /#b-stop/);
    assert.match(CSS, /backdrop-filter:\s*blur\(16px\)/);
    assert.match(CSS, /rgba\(12,\s*14,\s*18,\s*0\.28\)/);
    // Owner call 2026-10-10: the dark glass over the camera is 10 points less black (was 0.72).
    assert.match(CSS, /rgba\(0,\s*0,\s*0,\s*0\.62\)/);
    assert.doesNotMatch(CSS, /rgba\(0,\s*0,\s*0,\s*0\.72\)/);
    assert.doesNotMatch(CSS, /rgba\(0,\s*0,\s*0,\s*0\.8\)/);
    assert.match(CSS, /#b-script-save,\s*#b-save \{\s*display: none !important;/);
    assert.match(CSS, /body\.wording #controls \{\s*display: none !important;/);
    assert.match(CSS, /body\.wording #b-cancel \{\s*display: grid;/);
    assert.match(CSS, /#b-cancel \{\s*display: none;/);
    assert.match(CSS, /#controls \{\s*grid-template-columns: repeat\(2, 1fr\);/);
    assert.match(SRC, /\$\("wpm-down"\)\.onclick/);
    assert.match(SRC, /\$\("wpm-up"\)\.onclick/);
    assert.match(SRC, /LS\.set\("wpm", S\.wpm\)/);
  });

  test("a saved speed stays until he changes it", () => {
    const T = load();
    assert.equal(T.storedWpm(null, 150), 150);
    assert.equal(T.storedWpm("", 150), 150);
    assert.equal(T.storedWpm("nope", 150), 150);
    assert.equal(T.storedWpm(180, 150), 180);
    assert.equal(T.storedWpm("165", 150), 165);
    assert.equal(T.storedWpm(153, 150), 155);
    assert.equal(T.storedWpm(10, 150), 80);
    assert.equal(T.storedWpm(9999, 150), 260);
  });

  test("no per-word underline, and the portrait bottom third fades", () => {
    assert.match(CSS, /#content \.w\.start[\s\S]*box-shadow:\s*none/);
    assert.match(CSS, /#content \.w\.read[\s\S]*color:\s*inherit/);
    assert.doesNotMatch(SRC, /classList\.toggle\("read"/);
    assert.doesNotMatch(SRC, /classList\.toggle\("start"/);
    assert.match(HTML, /id="script-fade"/);
    assert.match(CSS, /body\.tp-portrait #script-fade/);
    assert.match(CSS, /height:\s*33%/);
    assert.match(CSS, /body\.cam-side-left #script-fade[\s\S]*display:\s*none/);
  });

  test("volume up is faster and volume down is slower, only when the level actually moves", () => {
    const T = load();
    assert.equal(T.volumeKeyDir("VolumeUp", ""), 1);
    assert.equal(T.volumeKeyDir("VolumeDown", ""), -1);
    assert.equal(T.volumeKeyDir("", "AudioVolumeUp"), 1);
    assert.equal(T.volumeKeyDir("", "AudioVolumeDown"), -1);
    assert.equal(T.volumeKeyDir(" ", ""), 0);
    assert.equal(T.volumeLevelDir(0.4, 0.55), 1);
    assert.equal(T.volumeLevelDir(0.55, 0.4), -1);
    assert.equal(T.volumeLevelDir(0.5, 0.5), 0);
    assert.equal(T.volumeLevelDir(null, 0.5), 0);
    assert.match(SRC, /volumechange/);
    assert.match(SRC, /volumeKeyDir\(e\.key, e\.code\)/);
  });
});

describe("teleprompter, one fixed speed (owner call 2026-10-09)", () => {
  test("script height divided by words per minute: same speed through words and blank gaps", () => {
    const T = load();
    // 300 words at 150 wpm is 120 seconds. 2400 px tall is 20 px per second.
    const raw = [{ t: 0, y: 100 }, { t: 5, y: 300, blank: true }, { t: 90, y: 1000 }, { t: 200, y: 2500 }];
    const out = plain(T.steadyPace(raw, 300, 150));
    assert.equal(out.length, 2);
    assert.equal(out[1].t, 120);
    assert.equal((out[1].y - out[0].y) / (out[1].t - out[0].t), 20);
  });
  test("a faster wpm is a faster scroll; a script with no words does not move", () => {
    const T = load();
    const raw = [{ t: 0, y: 0 }, { t: 1, y: 1200 }];
    const slow = plain(T.steadyPace(raw, 150, 100));
    const fast = plain(T.steadyPace(raw, 150, 200));
    assert.ok(fast[1].t < slow[1].t);
    assert.equal(plain(T.steadyPace(raw, 0, 150)).length, 1);
  });
  test("sideways words are half size, the Save button shows only during a double-tap edit", () => {
    // Owner call 2026-10-10: sideways is 0.6 of the set size (half was a bit small).
    assert.match(SRC, /var SIDEWAYS_FONT = 0\.6;/);
    assert.match(SRC, /Math\.round\(S\.font \* SIDEWAYS_FONT\)/);
    const CSS = fs.readFileSync(path.join(APP, "teleprompter.css"), "utf8");
    assert.match(CSS, /body\.wording #b-script-save\s*\{\s*display:\s*block !important/);
    assert.match(SRC, /syncCaretText\(true\);\s*\/\/ queue the change now/);
  });
});
