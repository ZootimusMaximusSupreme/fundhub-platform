// Practice test (fake answers, the real shipped files) for the four controls the map lists that the
// product no longer has: the e-book price box, Send e-book email, Pay for Audit, and the climate gate.
// Each is "nothing to judge" only while the live files hold none of it, and goes red the day it is back.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RETIRED_CONTROLS, retiredControlFor, retiredControlState } from "./fin-b01-retired-controls.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, naVerify } from "./gap-catalog-display.mjs";
import { verifyNa } from "../na-conditions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

// Where each live address is a file in this checkout.
function fileFor(url) {
  const p = new URL(url).pathname;
  if (p === "/optimize") return path.join(ROOT, "public/optimize.html");
  if (p === "/climate/") return path.join(ROOT, "public/climate/index.html");
  return path.join(ROOT, "public", p);
}

/* A live site made of the shipped files. `edit(pathname, text)` may change what one address says. */
function shippedSite({ edit = (p, text) => text, status = {}, boom = {}, calls = [] } = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET", "retired-control reads are GET only");
    const p = new URL(url).pathname;
    calls.push(p);
    if (boom[p]) throw new Error(boom[p]);
    if (status[p]) return new Response("", { status: status[p] });
    const file = fileFor(url);
    if (!fs.existsSync(file)) return new Response("", { status: 404 });
    return new Response(edit(p, fs.readFileSync(file, "utf8")), { status: 200 });
  };
}

const EBOOK = RETIRED_CONTROLS[0];
const SEND_EBOOK = RETIRED_CONTROLS[1];
const AUDIT = RETIRED_CONTROLS[2];
const GATE = RETIRED_CONTROLS[3];

// The page script the climate page names (its hash changes with every build).
const climatePageChunk = () => {
  const html = fs.readFileSync(path.join(ROOT, "public/climate/index.html"), "utf8");
  return /src="(\/climate\/_next\/static\/chunks\/app\/page-[^"]+)"/.exec(html)[1];
};

test("each retired control is one exact money row of the map and one exact lane row", () => {
  assert.equal(RETIRED_CONTROLS.length, 4);
  const maps = new Map();
  for (const rc of RETIRED_CONTROLS) {
    if (!maps.has(rc.sourceFile)) maps.set(rc.sourceFile, JSON.parse(fs.readFileSync(path.join(MAP_DIR, rc.sourceFile), "utf8")));
    const rows = maps.get(rc.sourceFile).filter((r) => r.surface === rc.surface && r.control === rc.control);
    assert.equal(rows.length, 1, rc.control);
    assert.equal(rows[0].impact, "money", rc.control);
    const entries = DISPLAY_TRACKING_CASES.filter((e) => e.sourceFile === rc.sourceFile && e.surface === rc.surface && e.control === rc.control);
    assert.equal(entries.length, 1, `${rc.control} is not one row of the display lane`);
    assert.equal(retiredControlFor(entries[0]), rc);
  }
  assert.equal(retiredControlFor({ sourceFile: "desks-f.json", surface: "x", control: "y" }), null);
  assert.equal(retiredControlFor(null), null);
});

test("with the shipped files, every retired control is nothing to judge", async () => {
  const calls = [];
  const ctx = { fetchImpl: shippedSite({ calls }) };
  for (const rc of RETIRED_CONTROLS) {
    const state = await retiredControlState(rc, ctx);
    assert.equal(state.status, "na", `${rc.control}: ${state.detail}`);
  }
  // The climate gate is judged in the page's own script too.
  assert.ok(calls.includes(new URL(climatePageChunk(), "https://fundhub.ai").pathname));
});

test("the e-book controls come back: a price box, a send button or the send_ebook action turns both rows red", async () => {
  const cases = [
    ["/app/present.js", "\n$('#ebook-price').hide(); // Send e-book email\n"],
    ["/app/present.js", "\nvar body = { action: 'send_ebook' };\n"],
    ["/app/present.html", '\n<input id="fh-ebook" placeholder="$ amount">\n'],
    ["/app/contract-send.js", "\nfunction ebookDollars() {}\n"],
  ];
  for (const [pathname, extra] of cases) {
    const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === pathname ? text + extra : text) }) };
    for (const rc of [EBOOK, SEND_EBOOK]) {
      const state = await retiredControlState(rc, ctx);
      assert.equal(state.status, "FAIL", `${pathname} ${extra.trim()}`);
      assert.match(state.detail, new RegExp(pathname.replace(/\./g, "\\.")));
      assert.match(state.detail, /e-book control/);
    }
  }
  // The word Facebook is not an e-book control.
  const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === "/app/present.js" ? `${text}\n/* Facebook ad id */\n` : text) }) };
  assert.equal((await retiredControlState(EBOOK, ctx)).status, "na");
});

test("Pay for Audit comes back: the words, the checkout title or a POST on /optimize turn the row red", async () => {
  for (const extra of [
    '<button id="pay">Pay for Audit</button>',
    "<!-- Consulting Services Assessment -->",
    "<script>fetch('/api/public/optimize', { method: \"POST\", body: '{}' });</script>",
  ]) {
    const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === "/optimize" ? text + extra : text) }) };
    const state = await retiredControlState(AUDIT, ctx);
    assert.equal(state.status, "FAIL", extra);
    assert.match(state.detail, /\/optimize holds/);
  }
});

test("the climate gate comes back: in the page or in its own script, the row goes red", async () => {
  const chunk = new URL(climatePageChunk(), "https://fundhub.ai").pathname;
  for (const [pathname, extra] of [
    [chunk, '\nfetch("/api/public/optimize",{method:"POST"});'],
    [chunk, '\nchildren:"Unlock the full list with the $32 assessment"'],
    ["/climate/", '<button>Unlock the full list</button>'],
  ]) {
    const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === pathname ? text + extra : text) }) };
    const state = await retiredControlState(GATE, ctx);
    assert.equal(state.status, "FAIL", `${pathname} ${extra}`);
    assert.match(state.detail, /again\. The control is back/);
  }
});

test("a page that cannot be read is skipped, never nothing-to-judge", async () => {
  for (const ctx of [
    { fetchImpl: shippedSite({ boom: { "/app/present.js": "offline" } }) },
    { fetchImpl: shippedSite({ status: { "/app/present.html": 503 } }) },
    { fetchImpl: shippedSite({ status: { "/app/contract-send.js": 404 } }) },
    { fetchImpl: null },
    { fetchImpl: shippedSite(), baseUrl: "not a URL" },
  ]) {
    assert.equal((await retiredControlState(EBOOK, ctx)).status, "skip");
  }
  const noChunk = { fetchImpl: shippedSite({ status: { [new URL(climatePageChunk(), "https://fundhub.ai").pathname]: 500 } }) };
  assert.equal((await retiredControlState(GATE, noChunk)).status, "skip");
});

test("a page that reads fine but no longer looks like the page is red, not nothing-to-judge", async () => {
  for (const rc of RETIRED_CONTROLS) {
    const empty = { fetchImpl: async () => new Response("", { status: 200 }) };
    assert.equal((await retiredControlState(rc, empty)).status, "FAIL", rc.control);
    const login = { fetchImpl: async () => new Response("<h1>Sign in</h1>", { status: 200 }) };
    assert.equal((await retiredControlState(rc, login)).status, "FAIL", rc.control);
  }
});

test("the lane: the four rows are na with the retired-control code on the shipped files, and each page is read once", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: shippedSite({ calls }) });
  for (const rc of RETIRED_CONTROLS) {
    const id = `catalog-display:${rc.sourceFile}:${rc.surface}:${rc.control}`;
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "na", `${rc.control}: ${row.detail}`);
    assert.equal(row.na.code, "catalog-display-retired-control");
    assert.deepEqual(row.na.args, { sourceFile: rc.sourceFile, surface: rc.surface, control: rc.control });
    assert.equal(await naVerify["catalog-display-retired-control"](row.na.args, { fetchImpl: shippedSite() }), true);
    assert.equal((await verifyNa(row, {
      laneNaVerify: (slice, code, args) => (slice === "catalog-display" ? naVerify[code](args, { fetchImpl: shippedSite() }) : undefined),
    })).ok, true);
  }
  // Both e-book rows share three files: each is fetched once, not twice.
  assert.equal(calls.filter((p) => p === "/app/present.js").length, 1);
  assert.equal(calls.filter((p) => p === "/app/present.html").length, 1);
});

test("the lane: the day a control is back its row is red and the claim no longer verifies", async () => {
  const site = () => shippedSite({ edit: (p, text) => (p === "/app/present.js" ? `${text}\nvar x = "Send e-book email";` : text) });
  const rows = await gapChecks({ fetchImpl: site() });
  for (const rc of [EBOOK, SEND_EBOOK]) {
    const row = rows.find((r) => r.id === `catalog-display:${rc.sourceFile}:${rc.surface}:${rc.control}`);
    assert.equal(row.status, "FAIL");
    assert.match(row.suggestedFix, /attach a real check/);
    assert.equal(await naVerify["catalog-display-retired-control"]({ sourceFile: rc.sourceFile, surface: rc.surface, control: rc.control }, { fetchImpl: site() }), false);
  }
  // The other two rows are untouched.
  assert.equal(rows.find((r) => r.id.includes("Audit intake")).status, "na");
  // A claim about a control that is not on the list never verifies.
  assert.equal(await naVerify["catalog-display-retired-control"]({ sourceFile: "desks-f.json", surface: "present.html (+ present.js, contract-send.js)", control: "invented" }, { fetchImpl: shippedSite() }), false);
  assert.equal(await naVerify["catalog-display-retired-control"](undefined, { fetchImpl: shippedSite() }), false);
});

test("a run with no GET client skips the four rows and invents no pass", async () => {
  const rows = await gapChecks({ fetchImpl: null });
  for (const rc of RETIRED_CONTROLS) {
    const row = rows.find((r) => r.id === `catalog-display:${rc.sourceFile}:${rc.surface}:${rc.control}`);
    assert.equal(row.status, "skip");
    assert.equal(row.na, undefined);
  }
});
