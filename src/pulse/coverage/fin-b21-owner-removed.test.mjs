// Practice test (fake answers, the real shipped files) for the two teleprompter controls the owner took off
// the phone on purpose: the edit bar (owner call 2026-10-13) and the header bar (hidden 2026-10-07).
// Each is "nothing to judge" only while the live files keep it off the screen, and goes red the day it is back.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OWNER_REMOVED, OWNER_REMOVED_CODE, ownerRemovedFor } from "./fin-b21-owner-removed.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, naVerify } from "./gap-catalog-display.mjs";
import { verifyNa } from "../na-conditions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-f.json"), "utf8"));

const SURFACE = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";
const SETTINGS = "Settings sheet: speed, text size, line width, reading line, extra time on a gap sliders; mirror, flip, countdown toggles; 4K / 1080p pills; Learn remote (6 slots); Clear learned buttons";
const THIS_SHOOT = "'This shoot' script list sheet (tap a script to roll it)";

const JS = "/app/teleprompter.js";
const HTML = "/app/teleprompter.html";
const CSS = "/app/teleprompter.css";

/* A live site made of the shipped files. `edit(pathname, text)` may change what one address says. */
function shippedSite({ edit = (p, text) => text, status = {}, boom = {}, calls = [] } = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET", "owner-removed reads are GET only");
    const p = new URL(url).pathname;
    calls.push(p);
    if (boom[p]) throw new Error(boom[p]);
    if (status[p]) return new Response("", { status: status[p] });
    const file = path.join(ROOT, "public", p);
    if (!p.startsWith("/app/") || !fs.existsSync(file)) return new Response("", { status: 404 });
    return new Response(edit(p, fs.readFileSync(file, "utf8")), { status: 200 });
  };
}
const withEdit = (pathname, change) => shippedSite({ edit: (p, text) => (p === pathname ? change(text) : text) });
const append = (extra) => (text) => `${text}\n${extra}\n`;

const EDIT_BAR = OWNER_REMOVED[0];
const HEADER_BAR = OWNER_REMOVED[1];
const idOf = (rc) => `catalog-display:${rc.sourceFile}:${rc.surface}:${rc.control}`;

/* The row the real display lane prints for one control, with this fake live site. */
async function judge(rc, ctx) {
  const rows = await gapChecks(ctx);
  const row = rows.find((r) => r.id === idOf(rc));
  assert.ok(row, `no lane row for ${rc.control}`);
  return row;
}

test("each owner-removed control is one exact map row and one exact lane row", () => {
  assert.equal(OWNER_REMOVED.length, 2);
  for (const rc of OWNER_REMOVED) {
    const rows = MAP.filter((r) => r.surface === rc.surface && r.control === rc.control);
    assert.equal(rows.length, 1, rc.control);
    assert.equal(rc.surface, SURFACE);
    const entries = DISPLAY_TRACKING_CASES.filter((e) => e.sourceFile === rc.sourceFile && e.surface === rc.surface && e.control === rc.control);
    assert.equal(entries.length, 1, `${rc.control} is not one row of the display lane`);
    assert.equal(ownerRemovedFor(entries[0]), rc);
  }
  assert.equal(ownerRemovedFor({ sourceFile: "desks-f.json", surface: "x", control: "y" }), null);
  assert.equal(ownerRemovedFor(null), null);
  assert.equal(ownerRemovedFor(undefined), null);
});

test("the Settings sheet and the This shoot list are NOT owner-removed: nothing retired them", () => {
  for (const control of [SETTINGS, THIS_SHOOT]) {
    assert.equal(MAP.filter((r) => r.surface === SURFACE && r.control === control).length, 1, control);
    assert.equal(ownerRemovedFor({ sourceFile: "desks-f.json", surface: SURFACE, control }), null, control);
  }
});

test("with the shipped files, both controls are nothing to judge", async () => {
  const calls = [];
  const ctx = { fetchImpl: shippedSite({ calls }) };
  for (const rc of OWNER_REMOVED) {
    const state = await judge(rc, ctx);
    assert.equal(state.status, "na", `${rc.control}: ${state.detail}`);
    assert.match(state.detail, /nothing to judge/);
  }
});

test("the edit bar comes back: a caller, a second place that edits, or a History button turns it red", async () => {
  const cases = [
    [JS, append("function again() { beginEdit(0, true); }"), /a call that opens the edit bar/],
    [JS, append("placeCaret(12, 40);"), /a call that puts a cursor in the words/],
    [JS, append("function other() { editing = { i: 0 }; }"), /a second place that opens an edit/],
    [JS, append('function other() { doc.body.classList.add("wording"); }'), /a second place that puts the words in edit mode/],
    [JS, append('var label = "History";'), /a History button/],
    [HTML, append("<button type=\"button\" class=\"mini\">History</button>"), /a History button/],
  ];
  for (const [pathname, change, what] of cases) {
    const state = await judge(EDIT_BAR, { fetchImpl: withEdit(pathname, change) });
    assert.equal(state.status, "FAIL", `${pathname}: ${what}`);
    assert.match(state.detail, what);
    assert.match(state.detail, new RegExp(pathname.replace(/\./g, "\\.")));
    assert.match(state.detail, /control is back/);
    // The header bar is a different control: it stays nothing to judge.
    assert.equal((await judge(HEADER_BAR, { fetchImpl: withEdit(pathname, change) })).status, "na");
  }
});

test("words that are not a caller do not turn the edit bar red", async () => {
  for (const extra of ["var keep = beginEdit;", "// beginEdit is not called any more", "var x = placeCaretWord;"]) {
    const state = await judge(EDIT_BAR, { fetchImpl: withEdit(JS, append(extra)) });
    assert.equal(state.status, "na", extra);
  }
});

test("the header bar comes back: the hide rule gone, a rule that shows it, or an inline show turns it red", async () => {
  const hideRule = /#top\s*\{\s*display:\s*none\s*!important;\s*\}/;
  const sheet = fs.readFileSync(path.join(ROOT, "public", CSS), "utf8");
  assert.match(sheet, hideRule, "the shipped stylesheet must hold the rule this check reads");
  const cases = [
    [CSS, (text) => text.replace(hideRule, ""), /no longer looks like the file/],
    [CSS, append("#top { display: flex; }"), /a rule that shows the top bar again/],
    [CSS, append("header#top { display: block !important; }"), /a rule that shows the top bar again/],
    [CSS, (text) => text.replace(hideRule, "#top { display: grid; }"), /no longer looks like the file/],
    [HTML, (text) => text.replace('<header id="top">', '<header id="top" style="display:flex">'), /a top bar that is shown by its own style/],
  ];
  for (const [pathname, change, what] of cases) {
    const state = await judge(HEADER_BAR, { fetchImpl: withEdit(pathname, change) });
    assert.equal(state.status, "FAIL", `${pathname}: ${what}`);
    assert.match(state.detail, what);
    // The edit bar is a different control: it stays nothing to judge.
    assert.equal((await judge(EDIT_BAR, { fetchImpl: withEdit(pathname, change) })).status, "na");
  }
  // A rule for something inside the bar does not show the bar.
  const inner = await judge(HEADER_BAR, { fetchImpl: withEdit(CSS, append("#top .row1 { display: flex; }\n#top h1 { display: block; }")) });
  assert.equal(inner.status, "na");
});

test("a file that cannot be read is skipped, never nothing-to-judge", async () => {
  for (const rc of OWNER_REMOVED) {
    for (const ctx of [
      { fetchImpl: shippedSite({ boom: { [CSS]: "offline", [JS]: "offline" } }) },
      { fetchImpl: shippedSite({ status: { [HTML]: 503 } }) },
      { fetchImpl: shippedSite({ status: { [CSS]: 404, [JS]: 404 } }) },
      { fetchImpl: null },
      { fetchImpl: shippedSite(), baseUrl: "not a URL" },
    ]) {
      const state = await judge(rc, ctx);
      assert.equal(state.status, "skip", `${rc.control}: ${state.detail}`);
    }
  }
});

test("a file that reads fine but no longer looks like the file is red, not nothing-to-judge", async () => {
  for (const rc of OWNER_REMOVED) {
    const empty = { fetchImpl: async () => new Response("", { status: 200 }) };
    assert.equal((await judge(rc, empty)).status, "FAIL", rc.control);
    const login = { fetchImpl: async () => new Response("<h1>Sign in</h1>", { status: 200 }) };
    assert.equal((await judge(rc, login)).status, "FAIL", rc.control);
  }
});

test("the lane: both rows are na with the owner-removed code on the shipped files, and each file is read once", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: shippedSite({ calls }) });
  for (const rc of OWNER_REMOVED) {
    const row = rows.find((r) => r.id === idOf(rc));
    assert.equal(row.status, "na", `${rc.control}: ${row.detail}`);
    assert.equal(row.na.code, OWNER_REMOVED_CODE);
    assert.deepEqual(row.na.args, { sourceFile: rc.sourceFile, surface: rc.surface, control: rc.control });
    assert.equal(await naVerify[OWNER_REMOVED_CODE](row.na.args, { fetchImpl: shippedSite() }), true);
    assert.equal((await verifyNa(row, {
      laneNaVerify: (slice, code, args) => (slice === "catalog-display" ? naVerify[code](args, { fetchImpl: shippedSite() }) : undefined),
    })).ok, true);
  }
  // Both rows share the page script, the page and the stylesheet: each is fetched once, not twice.
  for (const file of [JS, HTML, CSS]) assert.equal(calls.filter((p) => p === file).length, 1, file);
});

test("the lane: the day a control is back its row is red and the claim no longer verifies", async () => {
  const site = () => withEdit(JS, append("function again() { beginEdit(0, true); }"));
  const rows = await gapChecks({ fetchImpl: site() });
  const edit = rows.find((r) => r.id === idOf(EDIT_BAR));
  assert.equal(edit.status, "FAIL");
  assert.match(edit.suggestedFix, /attach a real check/);
  assert.equal(edit.na, undefined);
  assert.equal(await naVerify[OWNER_REMOVED_CODE]({ sourceFile: EDIT_BAR.sourceFile, surface: EDIT_BAR.surface, control: EDIT_BAR.control }, { fetchImpl: site() }), false);
  // The header row is untouched by that edit.
  assert.equal(rows.find((r) => r.id === idOf(HEADER_BAR)).status, "na");

  const cssSite = () => withEdit(CSS, append("#top { display: flex; }"));
  const rows2 = await gapChecks({ fetchImpl: cssSite() });
  assert.equal(rows2.find((r) => r.id === idOf(HEADER_BAR)).status, "FAIL");
  assert.equal(await naVerify[OWNER_REMOVED_CODE]({ sourceFile: HEADER_BAR.sourceFile, surface: HEADER_BAR.surface, control: HEADER_BAR.control }, { fetchImpl: cssSite() }), false);
  assert.equal(rows2.find((r) => r.id === idOf(EDIT_BAR)).status, "na");

  // A claim about a control that is not on the list never verifies.
  assert.equal(await naVerify[OWNER_REMOVED_CODE]({ sourceFile: "desks-f.json", surface: SURFACE, control: "invented" }, { fetchImpl: shippedSite() }), false);
  assert.equal(await naVerify[OWNER_REMOVED_CODE]({ sourceFile: "desks-f.json", surface: SURFACE, control: SETTINGS }, { fetchImpl: shippedSite() }), false);
  assert.equal(await naVerify[OWNER_REMOVED_CODE](undefined, { fetchImpl: shippedSite() }), false);
});

test("the lane: the now-wired Settings sheet and This shoot proofs no longer appear as open rows", async () => {
  const rows = await gapChecks({ fetchImpl: shippedSite() });
  for (const control of [SETTINGS, THIS_SHOOT]) {
    const row = rows.find((r) => r.id === `catalog-display:desks-f.json:${SURFACE}:${control}`);
    assert.equal(row, undefined, control);
  }
});

test("a run with no GET client skips both rows and invents no pass", async () => {
  const rows = await gapChecks({ fetchImpl: null });
  for (const rc of OWNER_REMOVED) {
    const row = rows.find((r) => r.id === idOf(rc));
    assert.equal(row.status, "skip");
    assert.equal(row.na, undefined);
  }
});
