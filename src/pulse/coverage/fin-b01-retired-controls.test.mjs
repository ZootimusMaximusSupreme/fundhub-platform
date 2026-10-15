// Practice test (fake answers, the real shipped files) for the four controls the map lists that the
// product no longer has: the e-book price box, Send e-book email, Pay for Audit, and the climate gate.
// Each is "nothing to judge" only while the live files hold none of it, and goes red the day it is back.
//
// The Pay for Audit row is only half retired: the intake boxes and the SMS consent box are still on the
// page. That row is judged PASS (never "nothing to judge") and goes red when either half breaks.
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
function shippedSite({ edit = (p, text) => text, status = {}, boom = {}, calls = [], extra = {} } = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET", "retired-control reads are GET only");
    const p = new URL(url).pathname;
    calls.push(p);
    if (boom[p]) throw new Error(boom[p]);
    if (status[p]) return new Response("", { status: status[p] });
    if (extra[p] !== undefined) return new Response(extra[p], { status: 200 });
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

test("with the shipped files, the e-book rows and the climate gate are nothing to judge, and the optimize row passes", async () => {
  const calls = [];
  const ctx = { fetchImpl: shippedSite({ calls }) };
  for (const rc of [EBOOK, SEND_EBOOK, GATE]) {
    const state = await retiredControlState(rc, ctx);
    assert.equal(state.status, "na", `${rc.control}: ${state.detail}`);
  }
  // Pay for Audit is gone but the intake and its SMS consent are live: a pass, never "nothing to judge".
  const audit = await retiredControlState(AUDIT, ctx);
  assert.equal(audit.status, "pass", audit.detail);
  assert.match(audit.detail, /SMS consent/);
  // The climate gate is judged in EVERY script the page names, not only the app chunk.
  for (const pathname of climateScripts()) assert.ok(calls.includes(pathname), `${pathname} was not read`);
  assert.ok(climateScripts().length >= 7, "the climate page names its scripts");
});

// Every script the shipped climate page names (src attribute, any folder).
const climateScripts = () => {
  const html = fs.readFileSync(path.join(ROOT, "public/climate/index.html"), "utf8");
  return [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).filter((p) => p.startsWith("/"));
};

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
    // None of the old words: a different label and a transport that is not fetch.
    "<button id=\"p\">Pay now</button><script>var x=new XMLHttpRequest();x.open('POST','/api/public/optimize');</script>",
    "<script>fetch('/api/public/optimize', { method: 'post' });</script>",
    "<script>navigator.sendBeacon('/api/public/optimize', '{}');</script>",
    "<script>$.post('/api/public/optimize', {});</script>",
    "<form method=\"post\" action=\"/api/public/optimize\"><button>Go</button></form>",
    "<a href=\"/go\">Start checkout</a>",
  ]) {
    const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === "/optimize" ? text + extra : text) }) };
    const state = await retiredControlState(AUDIT, ctx);
    assert.equal(state.status, "FAIL", extra);
    assert.match(state.detail, /\/optimize holds/);
  }
});

test("the optimize intake half: each piece of the live intake and its consent code is required, by name", async () => {
  const breaks = [
    ["first name box gone", (t) => t.replace('id="first"', 'id="gone1"'), /first name box/],
    ["last name box gone", (t) => t.replace('id="last"', 'id="gone2"'), /last name box/],
    ["email box gone", (t) => t.replace('id="email"', 'id="gone3"'), /email box/],
    ["mobile box gone", (t) => t.replace('id="phone"', 'id="gone4"'), /mobile box/],
    ["SMS box gone", (t) => t.replace('name="sms_consent"', 'name="other"'), /SMS consent box/],
    ["opt-out wording gone", (t) => t.replaceAll("Reply STOP to opt out", "Reply to opt out"), /opt-out wording/],
    ["the saving line gone", (t) => t.replace('sessionStorage.setItem("fh_opt"', 'sessionStorage.setItem("other"'), /saves the typed values/],
    ["consent written as true whatever was ticked", (t) => t.replace("sms_consent: sms.checked === true", "sms_consent: true"), /sms\.checked === true/],
    ["consent written as the typed text", (t) => t.replace("sms_consent: sms.checked === true", "sms_consent: sms.checked"), /sms\.checked === true/],
  ];
  for (const [label, edit, said] of breaks) {
    const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === "/optimize" ? edit(text) : text) }) };
    const state = await retiredControlState(AUDIT, ctx);
    assert.equal(state.status, "FAIL", label);
    assert.match(state.detail, said, label);
    assert.match(state.detail, /still live/, label);
  }
});

test("the optimize row: a page that still has the intake but no longer looks like the page is red, not a pass", async () => {
  const ctx = { fetchImpl: async () => new Response("<h1>Sign in</h1>", { status: 200 }) };
  assert.equal((await retiredControlState(AUDIT, ctx)).status, "FAIL");
});

test("the climate gate comes back: in the page, or in ANY script the page names, the row goes red", async () => {
  const gate = [
    '\nfetch("/api/public/optimize",{method:"POST"});',
    '\nchildren:"Unlock the full list with the $32 assessment"',
  ];
  // Every script the shipped page names: the app chunk, the shared chunks, the framework runtime, a tracker.
  const scripts = climateScripts();
  assert.ok(scripts.length >= 7);
  for (const pathname of scripts) {
    for (const extra of gate) {
      const ctx = { fetchImpl: shippedSite({ edit: (p, text) => (p === pathname ? text + extra : text) }) };
      const state = await retiredControlState(GATE, ctx);
      assert.equal(state.status, "FAIL", `${pathname} ${extra.trim()}`);
      assert.match(state.detail, /again\. The control is back/);
      assert.ok(state.detail.includes(pathname), `${pathname} was not named: ${state.detail}`);
    }
  }
  const inPage = { fetchImpl: shippedSite({ edit: (p, text) => (p === "/climate/" ? `${text}<button>Unlock the full list</button>` : text) }) };
  assert.equal((await retiredControlState(GATE, inPage)).status, "FAIL");
});

test("the climate gate comes back in a chunk that only the page's own data names, or in a second app chunk", async () => {
  const extra = "/climate/_next/static/chunks/app/extra-0123abcd.js";
  const ctx = {
    fetchImpl: shippedSite({
      // The page now lists one more chunk in its page data (no src attribute), and that chunk holds the gate.
      edit: (p, text) => (p === "/climate/" ? text.replace("</body>", `<script>self.__next_f.push([1,"static/chunks/app/extra-0123abcd.js"])</script></body>`) : text),
      extra: { [extra]: 'document.title="Unlock the full list";' },
    }),
  };
  const state = await retiredControlState(GATE, ctx);
  assert.equal(state.status, "FAIL");
  assert.ok(state.detail.includes("extra-0123abcd.js"), state.detail);
});

test("a script from another site is not read, and a page that names too many scripts is red, not partly read", async () => {
  const calls = [];
  const ctx = {
    fetchImpl: shippedSite({
      calls,
      edit: (p, text) => (p === "/climate/" ? text.replace("</body>", '<script src="https://cdn.example.test/lib.js"></script></body>') : text),
    }),
  };
  assert.equal((await retiredControlState(GATE, ctx)).status, "na");
  assert.ok(!calls.includes("/lib.js"), "a script from another site must not be fetched");

  const many = Array.from({ length: 45 }, (_, i) => `<script src="/climate/_next/static/chunks/many-${i}.js"></script>`).join("");
  const big = {
    fetchImpl: shippedSite({
      edit: (p, text) => (p === "/climate/" ? text.replace("</body>", `${many}</body>`) : text),
      extra: Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`/climate/_next/static/chunks/many-${i}.js`, "var a=1;"])),
    }),
  };
  const state = await retiredControlState(GATE, big);
  assert.equal(state.status, "FAIL");
  assert.match(state.detail, /more than the 40/);
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
  // A gate in one script is red even when another script of the page could not be read.
  const both = { fetchImpl: shippedSite({
    status: { "/climate/_next/static/chunks/375-9c2ed26a6c945538.js": 500 },
    edit: (p, text) => (p.endsWith("/page-b71b32356ee1b98a.js") ? `${text}\nvar t="Unlock the full list";` : text),
  }) };
  assert.equal((await retiredControlState(GATE, both)).status, "FAIL");
  // A shared chunk the page names that cannot be read is also a skip, never nothing-to-judge.
  const noShared = { fetchImpl: shippedSite({ status: { "/climate/_next/static/chunks/375-9c2ed26a6c945538.js": 404 } }) };
  assert.equal((await retiredControlState(GATE, noShared)).status, "skip");
});

test("a page that reads fine but no longer looks like the page is red, not nothing-to-judge", async () => {
  for (const rc of RETIRED_CONTROLS) {
    const empty = { fetchImpl: async () => new Response("", { status: 200 }) };
    assert.equal((await retiredControlState(rc, empty)).status, "FAIL", rc.control);
    const login = { fetchImpl: async () => new Response("<h1>Sign in</h1>", { status: 200 }) };
    assert.equal((await retiredControlState(rc, login)).status, "FAIL", rc.control);
  }
});

test("the lane: the e-book rows and the gate are na with the retired-control code, the optimize row is a PASS, and each page is read once", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: shippedSite({ calls }) });
  for (const rc of [EBOOK, SEND_EBOOK, GATE]) {
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
  const audit = rows.find((r) => r.id === `catalog-display:${AUDIT.sourceFile}:${AUDIT.surface}:${AUDIT.control}`);
  assert.equal(audit.status, "PASS", audit.detail);
  assert.equal(audit.na, undefined);
  // A "nothing to judge" claim on the optimize row is never verified: the intake half is live.
  assert.equal(await naVerify["catalog-display-retired-control"]({ sourceFile: AUDIT.sourceFile, surface: AUDIT.surface, control: AUDIT.control }, { fetchImpl: shippedSite() }), false);
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
  // The other rows are untouched.
  assert.equal(rows.find((r) => r.id.includes("Audit intake")).status, "PASS");
  // A claim about a control that is not on the list never verifies.
  assert.equal(await naVerify["catalog-display-retired-control"]({ sourceFile: "desks-f.json", surface: "present.html (+ present.js, contract-send.js)", control: "invented" }, { fetchImpl: shippedSite() }), false);
  assert.equal(await naVerify["catalog-display-retired-control"](undefined, { fetchImpl: shippedSite() }), false);
});

test("the lane: the optimize row goes red when the consent line breaks, or when Pay for Audit is back", async () => {
  const broken = shippedSite({ edit: (p, t) => (p === "/optimize" ? t.replace("sms_consent: sms.checked === true", "sms_consent: true") : t) });
  const back = shippedSite({ edit: (p, t) => (p === "/optimize" ? `${t}<button>Pay for Audit</button>` : t) });
  for (const site of [broken, back]) {
    const rows = await gapChecks({ fetchImpl: site });
    const row = rows.find((r) => r.id.includes("Audit intake"));
    assert.equal(row.status, "FAIL");
  }
});

test("the optimize row names its browser practice test, and every title in it exists", () => {
  assert.equal(AUDIT.practice.spec, "e2e/fin-b01-optimize-intake.spec.mjs");
  const spec = fs.readFileSync(path.join(ROOT, AUDIT.practice.spec), "utf8");
  for (const title of [
    "Get My Credit Report writes what was typed and sms_consent true when the SMS box was ticked",
    "sms_consent is false when the SMS box was left empty, and the report link still works",
    "unticking the SMS box again writes false, not the earlier true",
    "See my roadmap carries the same typed values and the same consent to the next page",
  ]) assert.ok(spec.includes(`test("${title}"`), title);
});

test("a run with no GET client skips the four rows and invents no pass", async () => {
  const rows = await gapChecks({ fetchImpl: null });
  for (const rc of RETIRED_CONTROLS) {
    const row = rows.find((r) => r.id === `catalog-display:${rc.sourceFile}:${rc.surface}:${rc.control}`);
    assert.equal(row.status, "skip");
    assert.equal(row.na, undefined);
  }
});
