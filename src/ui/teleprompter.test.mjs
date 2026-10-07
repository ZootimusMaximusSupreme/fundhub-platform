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

/* The touch rules (owner, 2026-10-06): one tap pauses, a tap again rolls on,
   a double tap is scroll mode, drag moves the words, hold a line to edit. */
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

  test("one tap while rolling pauses, at once (no waiting for a second tap)", () => {
    const T = load();
    const r = run(T, tap(0), "rolling");
    assert.deepEqual(r.acts, [{ do: "pause" }]);
  });

  test("one tap while paused rolls on; one tap in scroll mode rolls on from there", () => {
    const T = load();
    assert.deepEqual(run(T, tap(0), "paused").acts, [{ do: "resume" }]);
    assert.deepEqual(run(T, tap(0), "scroll").acts, [{ do: "resume" }]);
  });

  test("two taps far apart in time are two single taps: pause, then roll on", () => {
    const T = load();
    let mode = "rolling";
    const seen = [];
    let g = T.gestureStart();
    for (const ev of [...tap(0), ...tap(1000)]) {
      const r = T.gestureStep(g, ev, mode);
      g = r.g;
      for (const a of plain(r.acts)) { seen.push(a.do); if (a.do === "pause") mode = "paused"; if (a.do === "resume") mode = "rolling"; }
    }
    assert.deepEqual(seen, ["pause", "resume"]);
  });

  test("a double tap turns scroll mode on (undoing the first tap), and a double tap in scroll mode turns it off", () => {
    const T = load();
    let mode = "rolling";
    const seen = [];
    let g = T.gestureStart();
    const step = (ev) => {
      const r = T.gestureStep(g, ev, mode);
      g = r.g;
      for (const a of plain(r.acts)) {
        seen.push(a.do);
        if (a.do === "pause") mode = "paused";
        if (a.do === "resume") mode = "rolling";
        if (a.do === "scroll-on") mode = "scroll";
        if (a.do === "scroll-off") mode = "paused";
      }
    };
    [...tap(0), ...tap(200)].forEach(step);
    assert.deepEqual(seen, ["pause", "scroll-on"]);
    assert.equal(mode, "scroll");
    [...tap(2000), ...tap(2200)].forEach(step);
    assert.deepEqual(seen, ["pause", "scroll-on", "resume", "scroll-off"]);
    assert.equal(mode, "paused");
  });

  test("a second tap too far away is not a double tap", () => {
    const T = load();
    const r = run(T, [...tap(0, 100, 300), ...tap(150, 300, 600)], "paused");
    assert.deepEqual(r.acts.map((a) => a.do), ["resume", "resume"]);
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

describe("teleprompter page", () => {
  test("the page: no shell, no sign-in, the mirror switches, the remote words, Fundhub spelled right", () => {
    assert.doesNotMatch(HTML, /shell\.js/);
    assert.doesNotMatch(HTML, /login\.html/);
    assert.doesNotMatch(HTML + SRC, /sign in/i);
    assert.doesNotMatch(SRC, /showWall/);
    assert.match(SRC, /x-shoot-film/);
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
    assert.match(HTML, /id="b-slow"/);
    assert.match(HTML, /id="b-fast"/);
    assert.doesNotMatch(HTML, /body\.rolling #bar,body\.rolling #top\{opacity:0/);
    assert.match(HTML, /body\.rolling #top,body\.rolling #status,body\.rolling #tools\{opacity:0;pointer-events:none\}/);
    assert.match(SRC, /\$\("b-fast"\)\.onclick = function \(\) \{ setWpm\(S\.wpm \+ 5\); \}/);
    assert.match(SRC, /\$\("b-slow"\)\.onclick = function \(\) \{ setWpm\(S\.wpm - 5\); \}/);
  });

  test("Save the video sends the original file to this Mac", () => {
    assert.match(SRC, /http:\/\/127\.0\.0\.1:8787/);
    assert.match(SRC, /http:\/\/CHRISs-Mac-mini\.local:8787/);
    assert.match(SRC, /method:\s*"PUT"/);
    assert.match(SRC, /\$\("b-save"\)\.onclick = saveClick/);
    assert.doesNotMatch(SRC, /ffmpeg/);
  });
});
