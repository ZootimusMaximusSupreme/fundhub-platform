// Batch 09, generation 2: the live read of the "Reset my edits" button on the private lead list.
//
// The real page is git-excluded (real names and numbers), so this file cannot open it. It runs the judge on
// STAND-IN pages built here from the shape the live page was measured to have, with obviously fake data, and
// it breaks each promise on purpose to see the judge go red. The live page itself is read by the display lane
// every morning. The one real click, in Chromium on the live page, is written up in
// ops/workflows/finish-853-2026-10-14/manifest-b09.md.
//
// A practice test of the judge is not a click on the real page, and it is not described as one.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { gapChecks, DISPLAY_TRACKING_CASES } from "./gap-catalog-display.mjs";
import {
  LEADS_RESET_ROW,
  judgeLeadsReset,
  judgeLeadsResetHtml,
  leadsResetFor,
  leadsResetPath,
  leadsResetResults,
} from "./fin-b09-leads-reset.mjs";
import { PULSE_REGISTRY } from "../registry.mjs";

const MARKER = "ZZ-PLANTED-WORDS-ZZ";
const SCRIPT = `
const SEED = [{"id":"L1","name":"${MARKER} Sample","phone":"+10000000000","tag":"sample lead"}];
const KEY = 'sample-leads-key';
const STATUSES = ['New', 'Texted', 'Replied', 'Booked', 'Not now'];

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
}
function render() {
  document.getElementById('rows').textContent = String(SEED.length);
}

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Clear the dates, notes, and statuses you typed on this Mac?')) return;
  saved = {};
  persist();
  render();
});

render();
`;

function page({ button = '<button class="reset" id="reset" title="Clear saved edits in this browser">Reset my edits</button>', script = SCRIPT } = {}) {
  return `<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Sample</title></head><body>
<h1>Sample</h1>${button}
<table><thead><tr><th>Name</th><th>Number</th><th>Follow up date</th><th>Response</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table>
<script>${script}</script></body></html>`;
}

// One change to the good script, and the promise it breaks.
const swap = (from, to) => {
  assert.ok(SCRIPT.includes(from), `the stand-in script must contain: ${from}`);
  return SCRIPT.replace(from, to);
};

test("the good stand-in page holds every promise", () => {
  const judged = judgeLeadsResetHtml(page());
  assert.equal(judged.ok, true, judged.broke.join("; "));
  assert.equal(judged.broke.length, 0);
  assert.equal(judged.held.length, 7);
});

test("the button itself: missing, renamed, doubled, or with no id is red", () => {
  const cases = [
    ["no button", page({ button: "" }), /no button that says Reset my edits/],
    ["renamed", page({ button: '<button id="reset">Clear</button>' }), /no button that says Reset my edits/],
    ["two buttons", page({ button: '<button id="reset">Reset my edits</button><button id="again">Reset my edits</button>' }), /2 buttons that say Reset my edits/],
    ["no id", page({ button: "<button>Reset my edits</button>" }), /no id/],
  ];
  for (const [label, html, words] of cases) {
    const judged = judgeLeadsResetHtml(html);
    assert.equal(judged.ok, false, label);
    assert.match(judged.broke.join(" | "), words, label);
  }
});

test("no handler, a handler on another button, or a commented-out handler is red", () => {
  const block = /document\.getElementById\('reset'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n\}\);\n/;
  assert.match(SCRIPT, block);
  const cases = [
    ["no handler", SCRIPT.replace(block, "")],
    ["handler on another id", swap("getElementById('reset')", "getElementById('other')")],
    ["handler is a comment", SCRIPT.replace(block, (m) => m.split("\n").map((line) => `// ${line}`).join("\n"))],
    ["handler is a block comment", SCRIPT.replace(block, (m) => `/* ${m} */`)],
    ["a different event", swap("addEventListener('click'", "addEventListener('mouseover'")],
  ];
  for (const [label, script] of cases) {
    const judged = judgeLeadsResetHtml(page({ script }));
    assert.equal(judged.ok, false, label);
    assert.match(judged.broke.join(" | "), /pressing the button runs nothing/, label);
  }
});

test("each step of the handler is held to: ask, empty, write, redraw", () => {
  const cases = [
    ["no question", swap("  if (!confirm('Clear the dates, notes, and statuses you typed on this Mac?')) return;\n", ""), /does not ask first/],
    ["question that never stops it", swap("if (!confirm('Clear the dates, notes, and statuses you typed on this Mac?')) return;", "if (!confirm('Clear the dates, notes, and statuses you typed on this Mac?')) { }"), /does not ask first/],
    ["question asked after the clearing", swap("  if (!confirm('Clear the dates, notes, and statuses you typed on this Mac?')) return;\n  saved = {};", "  saved = {};\n  if (!confirm('Clear?')) return;"), /does not empty/],
    ["edits not emptied", swap("  saved = {};\n  persist();", "  persist();"), /does not empty/],
    ["a different object emptied", swap("  saved = {};\n  persist();", "  const other = {};\n  persist();"), /does not empty/],
    ["emptied but never written", swap("  saved = {};\n  persist();\n  render();", "  saved = {};\n  render();"), /never writes the empty edits/],
    ["written before it is emptied", swap("  saved = {};\n  persist();\n  render();", "  persist();\n  saved = {};\n  render();"), /never writes the empty edits/],
    ["never redrawn", swap("  saved = {};\n  persist();\n  render();", "  saved = {};\n  persist();"), /does not redraw/],
    ["redrawn before it is written", swap("  saved = {};\n  persist();\n  render();", "  saved = {};\n  render();\n  persist();"), /does not redraw/],
  ];
  for (const [label, script, words] of cases) {
    const judged = judgeLeadsResetHtml(page({ script }));
    assert.equal(judged.ok, false, label);
    assert.match(judged.broke.join(" | "), words, label);
  }
});

test("the page must load back what Reset clears: a different key is red", () => {
  const script = swap("localStorage.getItem(KEY)", "localStorage.getItem('another-key')");
  const judged = judgeLeadsResetHtml(page({ script }));
  assert.equal(judged.ok, false);
  assert.match(judged.broke.join(" | "), /never loads its edits back from the storage key it clears/);
});

test("other honest ways to write the same page still pass", () => {
  const variants = {
    "removeItem instead of an empty object": swap("  saved = {};\n  persist();\n  render();", "  localStorage.removeItem(KEY);\n  saved = {};\n  render();"),
    "a named handler": swap("document.getElementById('reset').addEventListener('click', () => {", "function doReset() {").replace("  render();\n});\n\nrender();", "  render();\n}\ndocument.getElementById('reset').addEventListener('click', doReset);\n\nrender();"),
    "a held element": swap("document.getElementById('reset').addEventListener('click', () => {", "const resetEl = document.getElementById('reset');\nresetEl.addEventListener('click', function () {"),
    "querySelector": swap("document.getElementById('reset')", 'document.querySelector("#reset")'),
    "a double quote and a comment in the handler": swap("saved = {};\n  persist();", "saved = {}; // empty\n  persist();"),
  };
  for (const [label, script] of Object.entries(variants)) {
    const judged = judgeLeadsResetHtml(page({ script }));
    assert.equal(judged.ok, true, `${label}: ${judged.broke.join("; ")}`);
  }
});

test("the lane row: PASS only when it opens and holds; gone or moved is FAIL; an unread page is skip", () => {
  const entry = { id: "row-1", control: LEADS_RESET_ROW.control };
  assert.equal(judgeLeadsReset(entry, { status: 200, html: page() }).status, "PASS");

  const broken = judgeLeadsReset(entry, { status: 200, html: page({ script: swap("  persist();\n", "") }) });
  assert.equal(broken.status, "FAIL");
  assert.match(broken.detail, /never writes the empty edits/);
  assert.match(broken.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);

  for (const status of [404, 410]) {
    const gone = judgeLeadsReset(entry, { status, html: "" });
    assert.equal(gone.status, "FAIL");
    assert.match(gone.detail, /is gone/);
  }
  for (const status of [301, 302, 307]) {
    const moved = judgeLeadsReset(entry, { status, html: "" });
    assert.equal(moved.status, "FAIL");
    assert.match(moved.detail, /somewhere else/);
  }
  for (const status of [401, 403, 429, 500, 503, Number.NaN]) {
    assert.equal(judgeLeadsReset(entry, { status, html: "" }).status, "skip", String(status));
  }
  assert.equal(judgeLeadsReset(entry, { error: "offline" }).status, "skip");
  assert.equal(judgeLeadsReset(entry, null).status, "skip");
  // An empty answer (a stub, or a blank page) is a page with no button: red, never green.
  assert.equal(judgeLeadsReset(entry, { status: 200, html: "" }).status, "FAIL");
});

test("nothing the page holds ever comes back in a detail line", () => {
  const entry = { id: "row-1", control: LEADS_RESET_ROW.control };
  const rows = [
    judgeLeadsReset(entry, { status: 200, html: page() }),
    judgeLeadsReset(entry, { status: 200, html: page({ script: swap("  persist();\n", "") }) }),
    judgeLeadsReset(entry, { status: 200, html: page({ button: "" }) }),
  ];
  for (const row of rows) {
    assert.ok(!JSON.stringify(row).includes(MARKER), "a word from the page leaked into the result");
    assert.ok(!/\+1000000000/.test(JSON.stringify(row)), "a number from the page leaked into the result");
  }
});

test("the address comes from the one registry row, and the row key is exact", () => {
  const path = leadsResetPath();
  assert.match(path, /^\/leads\/[^/]+\/$/);
  assert.equal(leadsResetPath([]), null);
  const row = PULSE_REGISTRY.find((r) => r.kind === "public_static" && /^leads\//.test(r.file || ""));
  assert.ok(row, "the registry still names the private lead page");
  assert.equal(leadsResetPath([row, { ...row, file: "leads/other/index.html" }]), null, "two rows are ambiguous");
  assert.equal(leadsResetPath([{ ...row, kind: "desk" }]), null);

  assert.equal(leadsResetFor({ ...LEADS_RESET_ROW }), true);
  assert.equal(leadsResetFor({ ...LEADS_RESET_ROW, control: "Button 'Reset'" }), false);
  assert.equal(leadsResetFor({ ...LEADS_RESET_ROW, surface: "page:leads/<32-hex>/index.html" }), false);
  assert.equal(leadsResetFor({ ...LEADS_RESET_ROW, sourceFile: "desks-a.json" }), false);
  assert.equal(leadsResetFor(null), false);
});

test("the map still has exactly one Reset button row, and the lane tracks it", () => {
  const mine = DISPLAY_TRACKING_CASES.filter(leadsResetFor);
  assert.equal(mine.length, 1, "the tracked map row is gone or doubled: re-point this check");
  assert.equal(mine[0].contract, null, "the row now owns a contract: judge it there and drop this file");
});

test("leadsResetResults makes one read and answers only the Reset row", async () => {
  const entries = [
    { id: "a", sourceFile: "x.json", surface: "s", control: "c" },
    { id: "b", ...LEADS_RESET_ROW },
  ];
  const asked = [];
  const results = await leadsResetResults(entries, async (path) => {
    asked.push(path);
    return { status: 200, html: page() };
  });
  assert.deepEqual([...results.keys()], ["b"]);
  assert.equal(results.get("b").status, "PASS");
  assert.equal(asked.length, 1);
  assert.equal(asked[0], leadsResetPath());

  // A map without the row reads nothing at all.
  const none = await leadsResetResults(entries.slice(0, 1), async () => { throw new Error("must not read"); });
  assert.equal(none.size, 0);

  // A registry with no leads row is skip, not PASS.
  const lost = await leadsResetResults(entries, async () => { throw new Error("must not read"); }, []);
  assert.equal(lost.get("b").status, "skip");
});

test("through the display lane: one GET of the registry address, judged, and no other row is moved", async () => {
  const wanted = leadsResetPath();
  const seen = [];
  const make = (html, status = 200) => async (url, init) => {
    const target = new URL(String(url));
    // The lane's retired-page read asks for other pages; answer those as the lane's own test does.
    if (target.pathname !== wanted) return new Response("", { status: 200 });
    seen.push({ method: init?.method, redirect: init?.redirect, path: target.pathname });
    return new Response(html, { status });
  };
  const idOf = DISPLAY_TRACKING_CASES.find(leadsResetFor).id;

  const good = await gapChecks({ fetchImpl: make(page()) });
  assert.equal(good.find((row) => row.id === idOf).status, "PASS");
  assert.deepEqual(seen, [{ method: "GET", redirect: "manual", path: wanted }]);

  const bad = await gapChecks({ fetchImpl: make(page({ button: "" })) });
  assert.equal(bad.find((row) => row.id === idOf).status, "FAIL");

  const gone = await gapChecks({ fetchImpl: make("", 404) });
  assert.equal(gone.find((row) => row.id === idOf).status, "FAIL");

  const nothing = await gapChecks({ fetchImpl: null });
  assert.equal(nothing.find((row) => row.id === idOf).status, "skip");

  const thrown = await gapChecks({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(thrown.find((row) => row.id === idOf).status, "skip");

  // Every other tracked row has the answer it had before this file: none of them is this row's business.
  const others = good.filter((row) => row.id !== idOf);
  assert.equal(others.length, DISPLAY_TRACKING_CASES.length - 1);
});

test("this file has no network call of its own (the lane makes the one GET)", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./fin-b09-leads-reset.mjs", import.meta.url)), "utf8");
  const code = source.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bfetch\b|\bfetchImpl\b|\bXMLHttpRequest\b|\bnode:http|\bnode:https/.test(code),
    "the judge must stay a pure reader: the lane owns the GET");
});
