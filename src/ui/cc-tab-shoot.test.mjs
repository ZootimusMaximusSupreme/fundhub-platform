// The Shoot tab's pure helpers (unit X5), run in a bare VM with no document:
// the headline, the film-order moves, the row words and the plan view. The
// browser half is e2e/cc-tab-shoot.spec.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { CONTRACT } from "../marketing/api-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/cc-tab-shoot.js"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);

describe("the Shoot tab, pure", () => {
  test("registers as the shoot tab, fourth, whether or not the frame loaded first", () => {
    const ctx = load();
    assert.equal(ctx.FundhubCC._q.length, 1);
    const tab = ctx.FundhubCC._q[0];
    assert.equal(tab.id, "shoot");
    assert.equal(tab.label, "Shoot");
    assert.equal(tab.order, 4);
    assert.equal(typeof tab.render, "function");

    const seen = [];
    const frame = createContext({ console, FundhubCC: { registerTab: (t) => seen.push(t.id) } });
    runInContext(SRC, frame);
    assert.deepEqual(seen, ["shoot"]);
  });

  test("the teleprompter link is the film key, and a strange path is ignored", () => {
    const T = load().FundhubShootTab;
    const key = "/app/teleprompter.html?k=abc.def";
    assert.equal(T.filmHref({ film: { path: key } }), key);
    assert.equal(T.filmHref({ film: { path: key } }, "root-1"), key + "&script=root-1");
    assert.equal(T.filmHref({}), "/app/teleprompter.html");
    assert.equal(T.filmHref({ film: { path: "https://evil.example/teleprompter.html?k=abc" } }), "/app/teleprompter.html");
  });

  test("the headline counts scripts and minutes in plain words", () => {
    const T = load().FundhubShootTab;
    assert.deepEqual(plain(T.headline(PAGE)), { title: "Today's shoot: 2 scripts, about 5 minutes", sub: "At 150 words a minute, plus 2 minutes an ad for takes and resets." });
    assert.equal(T.headline({ ...PAGE, shoot: null }).title, "Ready to film: 1 script, about 3 minutes");
    assert.equal(T.headline({ shoot: null, plan_candidates: [], wpm: 150 }).title, "Nothing to film yet");
  });

  test("up, down and Film first move one script and keep the rest in order", () => {
    const T = load().FundhubShootTab;
    assert.deepEqual(plain(T.moveId(["a", "b", "c"], "b", -1)), ["b", "a", "c"]);
    assert.deepEqual(plain(T.moveId(["a", "b", "c"], "b", 1)), ["a", "c", "b"]);
    assert.deepEqual(plain(T.moveId(["a", "b", "c"], "a", -1)), ["a", "b", "c"]);
    assert.deepEqual(plain(T.filmFirst(["a", "b", "c"], "c")), ["c", "a", "b"]);
    assert.deepEqual(plain(T.filmFirst(["a", "b"], "z")), ["a", "b"]);
  });

  test("each row names the ad, the angle and the exact take file name, or why there is none", () => {
    const T = load().FundhubShootTab;
    const [one, two] = PAGE.shoot.scripts;
    assert.equal(T.rowName(one), "Ad 91 · Lenders read two files");
    assert.deepEqual(plain(T.fileLine(one)), { ok: true, text: "SLO Ad 91 — Lenders read two files Take 3.mp4" });
    assert.equal(T.fileLine(two).ok, false);
    assert.match(T.fileLine(two).text, /^File name unknown: The Funding, done-for-you offer has no file-name word yet/);
    assert.deepEqual(plain(T.chipsFor(one)), [{ cls: "on", word: "Got it" }]);
    assert.deepEqual(plain(T.chipsFor({ takes: 1, needs_retake: true })), [{ cls: "wip", word: "1 take" }, { cls: "wip", word: "Retake" }]);
    assert.deepEqual(plain(T.chipsFor({ first_line_only: true, needs_retake: true })), [{ cls: "wip", word: "First line only" }]);
    assert.equal(T.readClock(22), "0:22");
    assert.equal(T.readClock(125), "2:05");
  });

  test("the plan: the shoot's order plus approved scripts not on it; before a shoot, the order set on screen", () => {
    const T = load().FundhubShootTab;
    const withShoot = T.planView(PAGE, {});
    assert.deepEqual(plain(withShoot.rows.map((s) => s.ad_id)), ["91", "92"]);
    assert.deepEqual(plain(withShoot.extra), []);

    const extra = { ...PAGE.plan_candidates[0], root_script_id: "r9", ad_id: "99" };
    assert.deepEqual(plain(T.planView({ ...PAGE, plan_candidates: [...PAGE.plan_candidates, extra] }, {}).extra.map((s) => s.ad_id)), ["99"]);

    const a = { root_script_id: "a", ad_id: "91" }, b = { root_script_id: "b", ad_id: "92" }, c = { root_script_id: "c", ad_id: "93" };
    const before = { shoot: null, plan_candidates: [a, b, c] };
    assert.deepEqual(plain(T.planView(before, {}).rows.map((s) => s.ad_id)), ["91", "92", "93"]);
    assert.deepEqual(plain(T.planView(before, { order: ["c", "a", "gone"] }).rows.map((s) => s.ad_id)), ["93", "91", "92"]);
  });

  test("board steps carry a word and a shape, never colour alone", () => {
    const T = load().FundhubShootTab;
    assert.equal(T.stepClass("failed"), "bad");
    assert.equal(T.stepClass("approved"), "on");
    assert.equal(T.stepClass("cutting"), "wip");
    assert.equal(T.statusWord("filming"), "Filming");
    assert.equal(T.DRIVE_SLO_ADS, "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ");
  });

  test("no px font size is written in the tab (UI-STANDARDS §12.7) and no shadow value (§12.2)", () => {
    assert.doesNotMatch(SRC, /font-size\s*:/);
    assert.doesNotMatch(SRC, /font:\s*\d/);
    assert.doesNotMatch(SRC, /box-shadow/);
    assert.doesNotMatch(SRC, /FundHub/);
  });
});
