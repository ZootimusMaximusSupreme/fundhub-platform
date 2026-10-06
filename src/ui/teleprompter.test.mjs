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

  test("the page: no shell, a sign-in wall, the mirror switches, the remote words, Fundhub spelled right", () => {
    assert.doesNotMatch(HTML, /shell\.js/);
    assert.match(HTML, /href="\/login\.html\?next=\/app\/teleprompter\.html"/);
    assert.match(HTML, /id="t-mirror"/);
    assert.match(HTML, /id="t-flipv"/);
    assert.match(HTML, /#flip\.mirror-x\{transform:scaleX\(-1\)\}/);
    assert.match(HTML, /Learn remote/);
    assert.match(HTML, /13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ/);
    assert.doesNotMatch(HTML + SRC, /FundHub/);
    // Everything read through the glass flips together.
    const flip = HTML.slice(HTML.indexOf('<div id="flip">'), HTML.indexOf('<div id="bar">'));
    for (const id of ["stage", "line", "progress", "count", "cuehold", "end"]) assert.ok(flip.includes(`id="${id}"`), id);
  });
});
