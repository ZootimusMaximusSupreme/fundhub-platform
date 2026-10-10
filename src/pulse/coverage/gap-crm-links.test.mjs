import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PULSE_REGISTRY } from "../registry.mjs";
import { unpricedApprovalConditions } from "../../funding/success-fee.mjs";
import {
  BOARD_CARDS_SQL,
  BOARD_KEY,
  BOARD_LIMIT,
  BOARD_STAGES_SQL,
  CHECK_IDS,
  CLIENTS_LIST_LIMIT,
  CLIENTS_LIST_SQL,
  COUNTS_SQL,
  CLIENT_MSG_SQL,
  CLIENT_PICK_SQL,
  CLIENT_TX_SQL,
  LENDER_COUNT_SQL,
  LOGO_NEWEST,
  LOGO_PLACEHOLDER,
  LOGO_ROTATION,
  LOGO_SQL,
  PIPELINE_CARDS_SQL,
  SCREEN_FILES,
  appPageFile,
  extractAppLinks,
  gapChecks,
  isBadLogoPath,
  isOwnLogoPath,
  judgeBoard,
  judgeClientsList,
  judgePipelineCards,
  judgeRailCounts,
  pickLogos,
  scriptFiles,
  stripComments,
  stripHtmlComments,
  stripJsComments
} from "./gap-crm-links.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Code only. The header comments name the things this file refuses to do.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-crm-links.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-08T15:00:00.000Z");
const BASE = "https://fundhub.ai";

function shape(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0);
  for (const r of rows) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.id.length > 0);
    assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    assert.ok("suggestedFix" in r);
    if (r.status === "FAIL") {
      assert.equal(typeof r.suggestedFix, "string");
      assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    } else {
      assert.equal(r.suggestedFix, null);
    }
  }
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "row ids are unique");
}

const byId = (rows, id) => rows.find((r) => r.id === id);

/** A fetch that answers by exact URL and records every call. An unknown URL answers 404. */
function site(map, calls = []) {
  return async (url, init = {}) => {
    const method = String((init && init.method) || "GET").toUpperCase();
    calls.push({ url: String(url), method });
    const hit = Object.prototype.hasOwnProperty.call(map, url) ? map[url] : 404;
    if (hit instanceof Error) throw hit;
    const status = typeof hit === "number" ? hit : 200;
    const body = typeof hit === "string" ? hit : "";
    return { status, text: async () => body };
  };
}

const SCREEN_HTML = (extra = "") =>
  `<html><script defer src="shell.js"></script><script src="/app/data.js?v=2"></script><a href="lenders.html">Banks</a>${extra}</html>`;

function screens(over = {}) {
  const map = {};
  for (const f of SCREEN_FILES) map[`${BASE}/app/${f}`] = SCREEN_HTML();
  map[`${BASE}/app/shell.js`] = 'var nav = ["pipeline.html", "documents.html"]; // "removed-screen.html?x=..." is gone';
  map[`${BASE}/app/data.js`] = 'window.open("client-control-panel.html?id=" + id);';
  return { ...map, ...over };
}

/** A db that answers only the exact SQL it is given. Anything else throws. */
function fakeDb(map, seen = []) {
  return {
    async query(sql, params) {
      const key = String(sql);
      seen.push({ sql: key, params });
      assert.doesNotMatch(key, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|BEGIN|COMMIT|ROLLBACK)\b/i);
      if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error(`unexpected sql: ${key.slice(0, 70)}`);
      const answer = map[key];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(params) : answer;
    }
  };
}

const goodCards = [
  { key: "sales", stages: 6, cards: 10, no_stage: 0, no_owner: 0 },
  { key: "optimization", stages: 4, cards: 1, no_stage: 0, no_owner: 0 }
];

function dbMap(over = {}) {
  return {
    [PIPELINE_CARDS_SQL]: { rows: goodCards },
    [CLIENT_PICK_SQL]: { rows: [{ id: CLIENT }] },
    [LENDER_COUNT_SQL]: { rows: [{ n: 12 }] },
    [LOGO_SQL]: { rows: [] },
    [CLIENT_TX_SQL]: { rows: [] },
    [CLIENT_MSG_SQL]: { rows: [] },
    [BOARD_STAGES_SQL]: { rows: [{ id: "s1", key: "new", name: "New", sort_order: 1 }, { id: "s2", key: "won", name: "Won", sort_order: 2 }] },
    [BOARD_CARDS_SQL]: { rows: [{ id: "c1", stage_id: "s1" }] },
    [COUNTS_SQL]: { rows: [{ pipeline_key: "sales", count: 7 }, { pipeline_key: "optimization", count: 1 }] },
    [CLIENTS_LIST_SQL]: { rows: [{ id: CLIENT }] },
    ...over
  };
}

function readers(over = {}) {
  return {
    listLenders: async () => [{ name: "Bank" }],
    matchForClient: async () => ({ summary: { lender_count: 12, match_count: 3 }, matches: [{}, {}, {}] }),
    listTradelines: async () => [{ id: "t1" }],
    readClientStepRows: async () => ({ client: { id: CLIENT }, crsResults: [], tasks: [], fundingRounds: [], invoices: [], businesses: [] }),
    orgDemoModeEnabled: async () => false,
    ...over
  };
}

/* ─────────────── links: extraction ─────────────── */

test("app page links stay inside /app", () => {
  assert.equal(appPageFile("pipeline.html"), "pipeline.html");
  assert.equal(appPageFile("client-control-panel.html?id=abc"), "client-control-panel.html");
  assert.equal(appPageFile("/app/lenders.html"), "lenders.html");
  assert.equal(appPageFile("https://fundhub.ai/app/documents.html"), "documents.html");
  assert.equal(appPageFile("#"), null);
  assert.equal(appPageFile("https://example.com/apply"), null);
  assert.equal(appPageFile("/login.html"), null);
  assert.equal(appPageFile("../secret.html"), null);
  // Another site's /app page is not ours, even with the same path.
  assert.equal(appPageFile("https://example.com/app/documents.html"), null);
  assert.equal(appPageFile("https://evil.example/app/pipeline.html"), null);

  const found = extractAppLinks(
    '<a href="lenders.html">Banks</a><a href="#">stay</a><a href="messaging.html?client_id=1">note</a>',
    "client-control-panel.html"
  );
  assert.deepEqual([...found.keys()].sort(), ["lenders.html", "messaging.html"]);
});

test("a screen named only inside a comment is not a link", () => {
  const js = [
    '/* old screens: "card-stack.html?client_id=..." and "bank-accounts.html" */',
    '// "money-map.html" was removed',
    'var live = ["pipeline.html"]; // "gone-too.html"',
    'var url = "https://fundhub.ai/app/lenders.html"; // trailing "nope.html"'
  ].join("\n");
  const found = extractAppLinks(js, "shell.js");
  assert.deepEqual([...found.keys()].sort(), ["lenders.html", "pipeline.html"]);

  const html = '<!-- <a href="old.html">x</a> --><a href="documents.html">d</a>';
  assert.deepEqual([...extractAppLinks(html, "pipeline.html").keys()], ["documents.html"]);

  const inline = '<script>/* "inside.html" */ var a = "messaging.html";</script>';
  assert.deepEqual([...extractAppLinks(inline, "pipeline.html").keys()], ["messaging.html"]);
});

test("comment stripping keeps code: a // inside a string, an apostrophe inside a comment", () => {
  assert.equal(stripJsComments('var u = "https://x.test/a"; // gone').includes("https://x.test/a"), true);
  assert.equal(stripJsComments('var u = "https://x.test/a"; // gone').includes("gone"), false);
  const out = stripJsComments("// don't stop\nvar keep = 'documents.html';");
  assert.match(out, /documents\.html/);
  assert.doesNotMatch(out, /don't/);
  assert.doesNotMatch(stripJsComments("a /* x */ b"), /x/);
  assert.match(stripJsComments('var s = "a \\" // not a comment";'), /not a comment/);
  // A quote inside a regex literal must not swallow the comments on the lines after it.
  const found = extractAppLinks("var re = /'/;\n// \"gone.html\"\nvar x = \"documents.html\";", "shell.js");
  assert.deepEqual([...found.keys()], ["documents.html"]);
  assert.equal(stripComments("shell.js", "// x\nvar a=1;").includes("x"), false);
  assert.equal(stripHtmlComments("<p>hi</p><!-- cut -->").includes("cut"), false);
  assert.equal(stripHtmlComments("<style>/* paint */ a{}</style>").includes("paint"), false);
});

test("script files are read from defer and plain tags, same folder only", () => {
  const html = [
    '<script defer src="shell.js"></script>',
    '<script src="/app/data.js?v=3"></script>',
    '<script src="https://cdn.example/x.js"></script>',
    '<script src="//cdn.example/y.js"></script>',
    '<script src="../vendor/z.js"></script>',
    '<script src="shell.js"></script>',
    '<script>inline()</script>'
  ].join("");
  assert.deepEqual(scriptFiles(html), ["shell.js", "data.js"]);
});

/* ─────────────── links: pages ─────────────── */

test("pages: links come from the live screens and scripts over HTTP; desk pages are not fetched again", async () => {
  const calls = [];
  const rows = await gapChecks({ fetchImpl: site(screens(), calls), baseUrl: BASE });
  shape(rows);
  const pages = byId(rows, "crm-links:pages");
  assert.equal(pages.status, "PASS");
  assert.match(pages.detail, /^4 internal \/app links read from the CRM screens over HTTP\. 4 are on the morning desk list/);
  assert.doesNotMatch(pages.detail, /were not on it/);
  assert.ok(calls.every((c) => c.method === "GET" || c.method === "HEAD"));
  const urls = calls.map((c) => c.url);
  for (const f of SCREEN_FILES) assert.ok(urls.includes(`${BASE}/app/${f}`));
  assert.ok(urls.includes(`${BASE}/app/shell.js`));
  assert.ok(urls.includes(`${BASE}/app/data.js`));
  // lenders.html, documents.html and pipeline.html are on the desk list, so no second GET for them.
  assert.equal(urls.includes(`${BASE}/app/documents.html`), false);
  assert.equal(urls.includes(`${BASE}/app/lenders.html`), false);
  // The comment that names a removed screen was not followed.
  assert.equal(urls.includes(`${BASE}/app/removed-screen.html`), false);
});

test("pages: a link to a page that is not on the desk list is fetched, and 404 or 500 fails it", async () => {
  for (const status of [404, 500, 503]) {
    const map = screens({ [`${BASE}/app/data.js`]: 'window.open("typo-screen.html");', [`${BASE}/app/typo-screen.html`]: status });
    const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
    shape(rows);
    const dead = byId(rows, "crm-link:typo-screen.html");
    assert.equal(dead.status, "FAIL");
    assert.match(dead.detail, new RegExp(`answered ${status}`));
    assert.match(dead.detail, /data\.js/);
    assert.match(dead.detail, /not on the morning desk list/);
    assert.equal(byId(rows, "crm-links:pages"), undefined);
  }
});

test("pages: a link off the desk list that answers 200 passes and is counted", async () => {
  const map = screens({ [`${BASE}/app/data.js`]: 'window.open("brand-new-screen.html");', [`${BASE}/app/brand-new-screen.html`]: "<html></html>" });
  const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
  const pages = byId(rows, "crm-links:pages");
  assert.equal(pages.status, "PASS");
  assert.match(pages.detail, /^4 internal \/app links read from the CRM screens over HTTP\. 3 are on the morning desk list, which pings them\. 1 were not on it, were fetched, and all answered/);
});

test("pages: a link whose GET throws fails, it does not pass and does not crash", async () => {
  const map = screens({ [`${BASE}/app/data.js`]: 'window.open("typo-screen.html");', [`${BASE}/app/typo-screen.html`]: new Error("socket hang up") });
  const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
  const dead = byId(rows, "crm-link:typo-screen.html");
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /did not answer: socket hang up/);
});

test("a dropped connection is tried once more; a status code is not", async () => {
  let n = 0;
  const flaky = async (url, init) => {
    if (String(url).endsWith("/app/typo-screen.html")) {
      n += 1;
      if (n === 1) throw new Error("socket hang up");
      return { status: 200, text: async () => "<html></html>" };
    }
    return site(screens({ [`${BASE}/app/data.js`]: 'window.open("typo-screen.html");' }))(url, init);
  };
  const rows = await gapChecks({ fetchImpl: flaky, baseUrl: BASE });
  assert.equal(byId(rows, "crm-links:pages").status, "PASS");
  assert.equal(n, 2);

  const calls = [];
  const dead = await gapChecks({
    fetchImpl: site(screens({ [`${BASE}/app/data.js`]: 'window.open("typo-screen.html");', [`${BASE}/app/typo-screen.html`]: 404 }), calls),
    baseUrl: BASE
  });
  assert.equal(byId(dead, "crm-link:typo-screen.html").status, "FAIL");
  assert.equal(calls.filter((c) => c.url.endsWith("/app/typo-screen.html")).length, 1);
});

test("pages: a script the screen loads that is gone fails", async () => {
  const map = screens({ [`${BASE}/app/shell.js`]: 404 });
  const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
  shape(rows);
  const gone = byId(rows, "crm-script:shell.js");
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /closer-dashboard\.html, pipeline\.html/);
  assert.match(gone.detail, /answered 404/);
  assert.match(gone.suggestedFix, /Restore \/app\/shell\.js/);
});

test("pages: a screen that will not load is a skip with the reason, never a PASS", async () => {
  const map = screens({ [`${BASE}/app/sales-floor.html`]: 503, [`${BASE}/app/pipeline.html`]: new Error("timeout") });
  const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
  shape(rows);
  const pages = byId(rows, "crm-links:pages");
  assert.equal(pages.status, "skip");
  assert.match(pages.detail, /sales-floor\.html answered 503/);
  assert.match(pages.detail, /pipeline\.html did not answer \(timeout\)/);
});

test("pages: screens that were read and hold no page links are a skip, not a PASS", async () => {
  const map = {};
  for (const f of SCREEN_FILES) map[`${BASE}/app/${f}`] = "<html>no links here</html>";
  const rows = await gapChecks({ fetchImpl: site(map), baseUrl: BASE });
  const pages = byId(rows, "crm-links:pages");
  assert.equal(pages.status, "skip");
  assert.match(pages.detail, /no internal \/app page links were found/);
});

test("pages: no fetch is a skip; injected sources replace the screens", async () => {
  const none = await gapChecks({});
  assert.equal(byId(none, "crm-links:pages").status, "skip");
  assert.match(byId(none, "crm-links:pages").detail, /no fetch/);

  const calls = [];
  const rows = await gapChecks({
    sources: [{ name: "pipeline.html", text: '<a href="documents.html">d</a><a href="gone-xyz.html">x</a>' }],
    fetchImpl: site({}, calls),
    baseUrl: BASE
  });
  assert.equal(byId(rows, "crm-link:gone-xyz.html").status, "FAIL");
  assert.deepEqual(calls.map((c) => c.url), [`${BASE}/app/gone-xyz.html`]);
});

test("pages: when both fetchImpl and fetch are passed, fetchImpl is the one used", async () => {
  const viaImpl = [];
  const viaFetch = [];
  await gapChecks({ fetchImpl: site(screens(), viaImpl), fetch: site(screens(), viaFetch), baseUrl: BASE });
  assert.ok(viaImpl.length > 0);
  assert.equal(viaFetch.length, 0);
});

test("pages: the fetch the pulse names fetchImpl is used, and ctx.fetch still works", async () => {
  const viaFetch = await gapChecks({ fetch: site(screens()), baseUrl: BASE });
  assert.equal(byId(viaFetch, "crm-links:pages").status, "PASS");
  const viaImpl = await gapChecks({ fetchImpl: site(screens()), baseUrl: `${BASE}/` });
  assert.equal(byId(viaImpl, "crm-links:pages").status, "PASS");
});

/* ─────────────── bank logos ─────────────── */

test("pickLogos: the newest few, a rotating slice, and the placeholder; every logo comes round", () => {
  const rows = [];
  for (let i = 0; i < 100; i += 1) {
    rows.push({ logo_path: `/assets/lenders/b${String(i).padStart(3, "0")}.png`, updated_at: new Date(2026, 0, 1 + i).toISOString() });
  }
  const today = pickLogos(rows, NOW);
  assert.equal(today.total, 100);
  assert.ok(today.picked.includes(LOGO_PLACEHOLDER));
  // On a day when the rotation starts at the top (b000 to b039), only the "newest" rule can bring in b090 to b099.
  const day = Math.ceil(NOW.getTime() / 86400000 / 5) * 5;
  const topDay = pickLogos(rows, new Date(day * 86400000));
  assert.equal(topDay.picked.includes("/assets/lenders/b000.png"), true);
  assert.equal(topDay.picked.includes("/assets/lenders/b045.png"), false);
  for (let i = 90; i < 100; i += 1) assert.ok(topDay.picked.includes(`/assets/lenders/b${String(i).padStart(3, "0")}.png`));
  assert.equal(topDay.picked.includes("/assets/lenders/b089.png"), false);
  assert.ok(today.picked.length <= LOGO_NEWEST + LOGO_ROTATION + 1);
  assert.notDeepEqual(pickLogos(rows, new Date(NOW.getTime() + 86400000)).picked, today.picked);
  const seen = new Set();
  for (let d = 0; d < Math.ceil(100 / LOGO_ROTATION); d += 1) {
    for (const p of pickLogos(rows, new Date(NOW.getTime() + d * 86400000)).picked) seen.add(p);
  }
  for (const r of rows) assert.ok(seen.has(r.logo_path), `${r.logo_path} is never checked`);
  assert.deepEqual(pickLogos([], NOW).picked, [LOGO_PLACEHOLDER]);
  assert.equal(pickLogos([{ logo_path: "" }, null], NOW).total, 0);
});

test("logos: PASS when every file loads, HEAD only; FAIL naming a missing file; FAIL when a HEAD gets no answer", async () => {
  const rows = [
    { logo_path: "/assets/lenders/a.png", updated_at: "2026-09-01T00:00:00Z" },
    { logo_path: "/assets/lenders/b.png", updated_at: "2026-09-02T00:00:00Z" }
  ];
  const db = fakeDb(dbMap({ [LOGO_SQL]: { rows } }));
  const calls = [];
  const ok = await gapChecks({
    db, orgId: ORG, now: NOW, sources: [], crmReaders: readers(),
    fetchImpl: site({
      [`${BASE}/assets/lenders/a.png`]: 200,
      [`${BASE}/assets/lenders/b.png`]: 200,
      [`${BASE}${LOGO_PLACEHOLDER}`]: 200
    }, calls),
    baseUrl: BASE
  });
  shape(ok);
  const good = byId(ok, "crm-links:bank-logos");
  assert.equal(good.status, "PASS");
  assert.match(good.detail, /3 of 2 bank logos|2 of 2|of 2 bank logos/);
  assert.ok(calls.filter((c) => c.url.includes("/assets/lenders/")).every((c) => c.method === "HEAD"));

  const missing = await gapChecks({
    db: fakeDb(dbMap({ [LOGO_SQL]: { rows } })), orgId: ORG, now: NOW, sources: [], crmReaders: readers(),
    fetchImpl: site({
      [`${BASE}/assets/lenders/a.png`]: 200,
      [`${BASE}/assets/lenders/b.png`]: 404,
      [`${BASE}${LOGO_PLACEHOLDER}`]: 200
    }),
    baseUrl: BASE
  });
  const bad = byId(missing, "crm-links:bank-logos");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /\/assets\/lenders\/b\.png \(404\)/);
  assert.match(bad.suggestedFix, /placeholder\.svg/);

  const silent = await gapChecks({
    db: fakeDb(dbMap({ [LOGO_SQL]: { rows } })), orgId: ORG, now: NOW, sources: [], crmReaders: readers(),
    fetchImpl: site({
      [`${BASE}/assets/lenders/a.png`]: new Error("reset"),
      [`${BASE}/assets/lenders/b.png`]: 200,
      [`${BASE}${LOGO_PLACEHOLDER}`]: 200
    }),
    baseUrl: BASE
  });
  assert.equal(byId(silent, "crm-links:bank-logos").status, "FAIL");
  assert.match(byId(silent, "crm-links:bank-logos").detail, /no answer/);
});

test("logos: a path the page cannot load fails (relative, or with ..), another site's picture is left alone", async () => {
  assert.equal(isBadLogoPath("assets/lenders/x.png"), true);
  assert.equal(isBadLogoPath("/assets/lenders/../secret.png"), true);
  assert.equal(isBadLogoPath("assets/lenders/x.png?v=2"), true);
  assert.equal(isBadLogoPath("/assets/lenders/x.png"), false);
  assert.equal(isBadLogoPath("https://cdn.example/bank..v2.svg"), false);
  assert.equal(isBadLogoPath("//cdn.example/a..b.svg"), false);
  assert.equal(isBadLogoPath(""), false);
  assert.equal(isBadLogoPath(null), false);
  assert.equal(isOwnLogoPath("/assets/lenders/x.png"), true);
  assert.equal(isOwnLogoPath("/assets/lenders/../x.png"), false);
  assert.equal(isOwnLogoPath("assets/lenders/x.png"), false);
  assert.equal(isOwnLogoPath(undefined), false);
  assert.match(LOGO_SQL, /logo_path LIKE 'assets\/lenders\/%'/);
  assert.match(LOGO_SQL, /logo_path LIKE '%\.\.%'/);

  const rows = [
    { logo_path: "/assets/lenders/ok.png", updated_at: "2026-09-01T00:00:00Z" },
    { logo_path: "assets/lenders/also-missing.png", updated_at: "2026-09-02T00:00:00Z" },
    { logo_path: "/assets/lenders/../etc.png", updated_at: "2026-09-03T00:00:00Z" }
  ];
  const calls = [];
  const out = await gapChecks({
    db: fakeDb(dbMap({ [LOGO_SQL]: { rows } })), orgId: ORG, now: NOW, sources: [], crmReaders: readers(),
    fetchImpl: site({ [`${BASE}/assets/lenders/ok.png`]: 200, [`${BASE}${LOGO_PLACEHOLDER}`]: 200 }, calls),
    baseUrl: BASE
  });
  const logo = byId(out, "crm-links:bank-logos");
  assert.equal(logo.status, "FAIL");
  assert.match(logo.detail, /^2 of 4 bank logos checked today do not load/);
  assert.match(logo.detail, /assets\/lenders\/also-missing\.png \(a path the page cannot load\)/);
  assert.match(logo.detail, /\/assets\/lenders\/\.\.\/etc\.png \(a path the page cannot load\)/);
  // The bad paths are named and never fetched.
  assert.ok(calls.every((c) => !c.url.includes("also-missing") && !c.url.includes("etc.png")));

  // Bad paths alone, with nothing under /assets/lenders to fetch, still fail.
  const only = await gapChecks({
    db: fakeDb(dbMap({ [LOGO_SQL]: { rows: [{ logo_path: "assets/lenders/x.png", updated_at: null }] } })),
    orgId: ORG, now: NOW, sources: [], crmReaders: readers(),
    fetchImpl: site({ [`${BASE}${LOGO_PLACEHOLDER}`]: 200 }), baseUrl: BASE
  });
  assert.equal(byId(only, "crm-links:bank-logos").status, "FAIL");
});

test("logos: skip with no database, no fetch, or no logo rows; FAIL when the read throws", async () => {
  const noDb = await gapChecks({ fetchImpl: site({}), sources: [], baseUrl: BASE });
  assert.equal(byId(noDb, "crm-links:bank-logos").status, "skip");
  const noFetch = await gapChecks({ db: fakeDb(dbMap()), orgId: ORG, sources: [] });
  assert.equal(byId(noFetch, "crm-links:bank-logos").status, "skip");
  const empty = await gapChecks({ db: fakeDb(dbMap()), orgId: ORG, sources: [], fetchImpl: site({}), baseUrl: BASE });
  assert.equal(byId(empty, "crm-links:bank-logos").status, "skip");
  const broken = await gapChecks({
    db: fakeDb(dbMap({ [LOGO_SQL]: new Error('relation "lenders" does not exist') })),
    orgId: ORG, sources: [], fetchImpl: site({}), baseUrl: BASE
  });
  assert.equal(byId(broken, "crm-links:bank-logos").status, "FAIL");
  assert.match(byId(broken, "crm-links:bank-logos").detail, /could not read bank logo paths/);
});

/* ─────────────── records the screens draw ─────────────── */

test("pipeline cards: PASS when every card has a column and a person", () => {
  const r = judgePipelineCards(goodCards);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /11 cards on 2 rails/);
});

test("pipeline cards: FAIL for a missing sales rail, an empty sales rail, and cards that cannot show", () => {
  assert.equal(judgePipelineCards([]).status, "FAIL");
  assert.match(judgePipelineCards([]).detail, /no sales pipeline/);
  assert.equal(judgePipelineCards([{ key: "sales", stages: 0, cards: 0, no_stage: 0, no_owner: 0 }]).status, "FAIL");
  const lost = judgePipelineCards([
    { key: "sales", stages: 6, cards: 10, no_stage: 2, no_owner: 0 },
    { key: "optimization", stages: 4, cards: 1, no_stage: 0, no_owner: 1 }
  ]);
  assert.equal(lost.status, "FAIL");
  assert.match(lost.detail, /3 pipeline cards exist but cannot show/);
  assert.match(lost.detail, /sales: 2 in no column/);
  assert.match(lost.detail, /optimization: 1 with no client or partner/);
  assert.match(lost.suggestedFix, /Recon \(AG-07\)/);
  assert.match(PIPELINE_CARDS_SQL, /LEFT JOIN pipeline_stages s ON s\.id = cd\.stage_id AND s\.pipeline_id = p\.id/);
  assert.match(PIPELINE_CARDS_SQL, /c\.id IS NULL AND pr\.id IS NULL/);
});

test("pipeline cards: read through the database, a read error is FAIL, no database is a skip", async () => {
  const seen = [];
  const ok = await gapChecks({ db: fakeDb(dbMap(), seen), orgId: ORG, sources: [], crmReaders: readers(), now: NOW });
  assert.equal(byId(ok, "crm-data:pipeline-cards").status, "PASS");
  assert.equal(seen.find((c) => c.sql === PIPELINE_CARDS_SQL).params[0], ORG);

  const broken = await gapChecks({
    db: fakeDb(dbMap({ [PIPELINE_CARDS_SQL]: new Error('relation "cards" does not exist') })),
    orgId: ORG, sources: [], crmReaders: readers(), now: NOW
  });
  assert.equal(byId(broken, "crm-data:pipeline-cards").status, "FAIL");

  const none = await gapChecks({ sources: [] });
  assert.equal(byId(none, "crm-data:pipeline-cards").status, "skip");

  // With no org id the SQL takes a null and reads every company; it still runs.
  const seenNull = [];
  await gapChecks({ db: fakeDb(dbMap(), seenNull), sources: [], now: NOW });
  assert.equal(seenNull.find((c) => c.sql === PIPELINE_CARDS_SQL).params[0], null);
});

test("records: three reads PASS for a client on file, using the same library functions the routes call", async () => {
  const calls = [];
  const rows = await gapChecks({
    db: fakeDb(dbMap()), orgId: ORG, now: NOW, sources: [],
    crmReaders: readers({
      listLenders: async (_db, args) => { calls.push(["listLenders", args]); return [{ name: "Bank" }]; },
      matchForClient: async (_db, args) => { calls.push(["matchForClient", args]); return { summary: { lender_count: 12, match_count: 3 }, matches: [{}, {}, {}] }; },
      listTradelines: async (_db, args) => { calls.push(["listTradelines", args]); return []; },
      readClientStepRows: async (_db, args) => { calls.push(["readClientStepRows", args]); return { client: { id: CLIENT } }; }
    })
  });
  shape(rows);
  assert.equal(byId(rows, "crm-data:lenders").status, "PASS");
  assert.equal(byId(rows, "crm-data:client").status, "PASS");
  assert.deepEqual(calls.find((c) => c[0] === "readClientStepRows")[1], { orgId: ORG, clientId: CLIENT });
  assert.equal(byId(rows, "crm-data:lender-matches").status, "PASS");
  assert.match(byId(rows, "crm-data:lender-matches").detail, /3 matches/);
  assert.equal(byId(rows, "crm-data:tradelines").status, "PASS");
  assert.match(byId(rows, "crm-data:tradelines").detail, /0 cards/);
  assert.deepEqual(calls.find((c) => c[0] === "listLenders")[1], { orgId: ORG, limit: 5 });
  assert.deepEqual(calls.find((c) => c[0] === "matchForClient")[1], { orgId: ORG, clientId: CLIENT });
  assert.deepEqual(calls.find((c) => c[0] === "listTradelines")[1], { orgId: ORG, clientId: CLIENT });
});

test("records: lenders FAIL for an empty book, an empty list with banks on file, a bad return and a throw", async () => {
  const run = (db, rd) => gapChecks({ db: fakeDb(db), orgId: ORG, now: NOW, sources: [], crmReaders: readers(rd) });
  const empty = await run(dbMap({ [LENDER_COUNT_SQL]: { rows: [{ n: 0 }] } }), {});
  assert.equal(byId(empty, "crm-data:lenders").status, "FAIL");
  assert.match(byId(empty, "crm-data:lenders").detail, /bank book is empty/);

  const hidden = await run(dbMap(), { listLenders: async () => [] });
  assert.equal(byId(hidden, "crm-data:lenders").status, "FAIL");
  assert.match(byId(hidden, "crm-data:lenders").detail, /12 banks are on file and the bank list read came back empty/);

  const bad = await run(dbMap(), { listLenders: async () => null });
  assert.equal(byId(bad, "crm-data:lenders").status, "FAIL");
  assert.match(byId(bad, "crm-data:lenders").detail, /did not return a list/);

  const threw = await run(dbMap(), { listLenders: async () => { throw new Error('column "active" does not exist'); } });
  assert.equal(byId(threw, "crm-data:lenders").status, "FAIL");
  assert.match(byId(threw, "crm-data:lenders").detail, /column "active" does not exist/);
});

test("records: bank matches FAIL for no client, no list, an empty book with banks on file, and a throw", async () => {
  const run = (rd) => gapChecks({ db: fakeDb(dbMap()), orgId: ORG, now: NOW, sources: [], crmReaders: readers(rd) });
  const noClient = await run({ matchForClient: async () => null });
  assert.equal(byId(noClient, "crm-data:lender-matches").status, "FAIL");
  assert.match(byId(noClient, "crm-data:lender-matches").detail, /no such client/);

  const noList = await run({ matchForClient: async () => ({ summary: { lender_count: 12 } }) });
  assert.equal(byId(noList, "crm-data:lender-matches").status, "FAIL");

  const noSummary = await run({ matchForClient: async () => ({ matches: [] }) });
  assert.equal(byId(noSummary, "crm-data:lender-matches").status, "FAIL");

  const bookEmpty = await run({ matchForClient: async () => ({ summary: { lender_count: 0, match_count: 0 }, matches: [] }) });
  assert.equal(byId(bookEmpty, "crm-data:lender-matches").status, "FAIL");
  assert.match(byId(bookEmpty, "crm-data:lender-matches").detail, /bank book is empty/);

  const zeroMatches = await run({ matchForClient: async () => ({ summary: { lender_count: 12, match_count: 0 }, matches: [] }) });
  assert.equal(byId(zeroMatches, "crm-data:lender-matches").status, "PASS");

  const threw = await run({ matchForClient: async () => { throw new Error("pii_identity unreadable"); } });
  assert.equal(byId(threw, "crm-data:lender-matches").status, "FAIL");
});

test("records: the client file read FAILs for no person, a throw, and either extra read throwing", async () => {
  const run = (rd, db = dbMap()) => gapChecks({ db: fakeDb(db), orgId: ORG, now: NOW, sources: [], crmReaders: readers(rd) });
  const none = byId(await run({ readClientStepRows: async () => ({ client: null }) }), "crm-data:client");
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /did not return that person/);
  assert.equal(byId(await run({ readClientStepRows: async () => null }), "crm-data:client").status, "FAIL");

  const threw = byId(await run({ readClientStepRows: async () => { throw new Error('column "outcome_tier" does not exist'); } }), "crm-data:client");
  assert.equal(threw.status, "FAIL");
  assert.match(threw.detail, /outcome_tier/);

  const tx = byId(await run({}, dbMap({ [CLIENT_TX_SQL]: new Error('column "amount_paid" does not exist') })), "crm-data:client");
  assert.equal(tx.status, "FAIL");
  assert.match(tx.detail, /amount_paid/);
  const msg = byId(await run({}, dbMap({ [CLIENT_MSG_SQL]: new Error('column "rendered_body" does not exist') })), "crm-data:client");
  assert.equal(msg.status, "FAIL");
  assert.match(msg.detail, /rendered_body/);

  const ok = byId(await run({}), "crm-data:client");
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /returned a client on file/);
});

test("records: tradelines FAIL for a bad return and a throw, and an empty card list is a PASS", async () => {
  const run = (rd) => gapChecks({ db: fakeDb(dbMap()), orgId: ORG, now: NOW, sources: [], crmReaders: readers(rd) });
  assert.equal(byId(await run({ listTradelines: async () => [] }), "crm-data:tradelines").status, "PASS");
  const bad = byId(await run({ listTradelines: async () => undefined }), "crm-data:tradelines");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /did not return a list/);
  const threw = await run({ listTradelines: async () => { throw new Error('relation "tradelines" does not exist'); } });
  assert.equal(byId(threw, "crm-data:tradelines").status, "FAIL");
  assert.match(byId(threw, "crm-data:tradelines").detail, /tradelines/);
});

test("records: skip with no database or no org id, skip with no client on file, FAIL when picking a client throws", async () => {
  const recordIds = ["crm-data:pipeline", "crm-data:pipeline-counts", "crm-data:clients", "crm-data:lenders", "crm-data:client", "crm-data:lender-matches", "crm-data:tradelines"];
  const noDb = await gapChecks({ sources: [] });
  for (const id of recordIds) {
    assert.equal(byId(noDb, id).status, "skip");
    assert.match(byId(noDb, id).detail, /no database/);
  }
  const noOrg = await gapChecks({ db: fakeDb(dbMap()), sources: [], crmReaders: readers() });
  for (const id of recordIds) {
    assert.equal(byId(noOrg, id).status, "skip");
    assert.match(byId(noOrg, id).detail, /no org id/);
  }
  const noClient = await gapChecks({ db: fakeDb(dbMap({ [CLIENT_PICK_SQL]: { rows: [] } })), orgId: ORG, sources: [], crmReaders: readers() });
  assert.equal(byId(noClient, "crm-data:lenders").status, "PASS");
  assert.equal(byId(noClient, "crm-data:client").status, "skip");
  assert.equal(byId(noClient, "crm-data:lender-matches").status, "skip");
  assert.equal(byId(noClient, "crm-data:tradelines").status, "skip");

  const pickBroke = await gapChecks({
    db: fakeDb(dbMap({ [CLIENT_PICK_SQL]: new Error("clients unreadable") })),
    orgId: ORG, sources: [], crmReaders: readers()
  });
  assert.equal(byId(pickBroke, "crm-data:client").status, "FAIL");
  assert.equal(byId(pickBroke, "crm-data:lender-matches").status, "FAIL");
  assert.equal(byId(pickBroke, "crm-data:tradelines").status, "FAIL");
  assert.match(byId(pickBroke, "crm-data:tradelines").detail, /clients unreadable/);
});

test("database handle: the plain handle wins over the staff scope, and the scope is the fallback", async () => {
  const plain = [];
  const staff = [];
  await gapChecks({
    db: fakeDb(dbMap(), plain), scope: (fn) => fn(fakeDb(dbMap(), staff)),
    orgId: ORG, now: NOW, sources: [], crmReaders: readers()
  });
  assert.ok(plain.length > 0);
  assert.equal(staff.length, 0);
  // With no plain handle, the logo and pipeline-card reads go through the scope.
  const viaScope = [];
  const rows = await gapChecks({ scope: (fn) => fn(fakeDb(dbMap(), viaScope)), sources: [], now: NOW });
  assert.equal(byId(rows, "crm-data:pipeline-cards").status, "PASS");
  assert.ok(viaScope.some((c) => c.sql === PIPELINE_CARDS_SQL));
  // The record reads need the plain handle: they skip without one.
  assert.equal(byId(rows, "crm-data:pipeline").status, "skip");
});

test("records: the org passed in is a uuid; a junk org id reads as no org", async () => {
  const junk = await gapChecks({ db: fakeDb(dbMap()), orgId: "not-a-uuid", sources: [], crmReaders: readers() });
  assert.equal(byId(junk, "crm-data:lenders").status, "skip");
});

test("records: the real library functions are still exported", async () => {
  const lenders = await import("../../lenders/store.mjs");
  const tradelines = await import("../../tradelines/store.mjs");
  assert.equal(typeof lenders.listLenders, "function");
  assert.equal(typeof lenders.matchForClient, "function");
  assert.equal(typeof tradelines.listTradelines, "function");
  const step = await import("../../fulfillment/client-step.mjs");
  assert.equal(typeof step.readClientStepRows, "function");
});

test("records: the real libraries load when none are passed", async () => {
  // A db that answers empty for any SELECT. listLenders and the picks must run without a throw about missing code.
  const db = {
    async query(sql) {
      const key = String(sql);
      if (key === CLIENT_PICK_SQL) return { rows: [{ id: CLIENT }] };
      if (key === LENDER_COUNT_SQL) return { rows: [{ n: 1 }] };
      if (key === PIPELINE_CARDS_SQL) return { rows: goodCards };
      if (key === LOGO_SQL) return { rows: [] };
      return { rows: [] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: [] });
  shape(rows);
  // Everything came back empty, so lenders FAIL honestly (1 bank on file, an empty list read).
  assert.equal(byId(rows, "crm-data:lenders").status, "FAIL");
  assert.doesNotMatch(byId(rows, "crm-data:lenders").detail, /would not load/);
});

/* ─────────────── the routes behind the Pipeline screen ─────────────── */

const ROOT = path.resolve(HERE, "../../..");

/** The template literal named `name` in a dashboard route file, with its one helper call filled in. */
function routeSql(file, name) {
  const src = fs.readFileSync(path.join(ROOT, "api/dashboard", file), "utf8");
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(src);
  assert.ok(m, `${name} was not found in api/dashboard/${file}`);
  return m[1].replace('${unpricedApprovalConditions("a")}', unpricedApprovalConditions("a"));
}

/** SQL with its comments and spacing gone, so only the words are compared. */
const squash = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();

test("route copies: each SQL here is word for word the SQL inside its route file", () => {
  assert.equal(squash(BOARD_STAGES_SQL), squash(routeSql("pipeline.mjs", "STAGES_SQL")));
  assert.equal(squash(BOARD_CARDS_SQL), squash(routeSql("pipeline.mjs", "CARDS_SQL")));
  assert.equal(squash(COUNTS_SQL), squash(routeSql("pipeline-counts.mjs", "COUNTS_SQL")));
  assert.equal(squash(CLIENTS_LIST_SQL), squash(routeSql("clients.mjs", "SQL")));
});

test("route copies: the guard notices a changed word, a dropped filter, and a renamed column", () => {
  assert.notEqual(squash(CLIENTS_LIST_SQL), squash(routeSql("clients.mjs", "SQL").replace("c.org_id = $1", "c.org_id = $9")));
  assert.notEqual(squash(COUNTS_SQL), squash(routeSql("pipeline-counts.mjs", "COUNTS_SQL").replace("(c.custom_fields->>'crm_archived_at') IS NULL", "true")));
  assert.notEqual(squash(BOARD_CARDS_SQL), squash(routeSql("pipeline.mjs", "CARDS_SQL").replace("cd.entered_at", "cd.entered_on")));
  assert.notEqual(squash(BOARD_STAGES_SQL), squash(routeSql("pipeline.mjs", "STAGES_SQL").replace("s.sort_order ASC", "s.sort_order DESC")));
  // Comments and spacing are not words.
  assert.equal(squash("SELECT 1 /* x */ -- y\n  FROM t"), "SELECT 1 FROM t");
});

test("route copies: the routes still pass their values in the order this file does", () => {
  const read = (file) => fs.readFileSync(path.join(ROOT, "api/dashboard", file), "utf8");
  assert.match(read("pipeline.mjs"), /db\.query\(STAGES_SQL, \[key, orgId\]\)/);
  assert.match(read("pipeline.mjs"), /db\.query\(CARDS_SQL, \[key, orgId, limit, demoOn\]\)/);
  assert.match(read("pipeline.mjs"), /fallback: 500/);
  assert.match(read("pipeline-counts.mjs"), /db\.query\(COUNTS_SQL, \[orgId, demoOn\]\)/);
  assert.match(read("clients.mjs"), /db\.query\(SQL, \[orgId, limit, demoOn\]\)/);
  assert.equal(BOARD_KEY, "sales");
  assert.equal(BOARD_LIMIT, 500);
});

test("route reads: board, rail counts and client list all PASS, and pass the route's own values", async () => {
  const seen = [];
  const rows = await gapChecks({ db: fakeDb(dbMap(), seen), orgId: ORG, now: NOW, sources: [], crmReaders: readers() });
  shape(rows);
  const board = byId(rows, "crm-data:pipeline");
  assert.equal(board.status, "PASS");
  assert.match(board.detail, /2 columns and 1 cards/);
  const counts = byId(rows, "crm-data:pipeline-counts");
  assert.equal(counts.status, "PASS");
  assert.match(counts.detail, /2 rails holding 8 cards/);
  const list = byId(rows, "crm-data:clients");
  assert.equal(list.status, "PASS");
  assert.match(list.detail, /1 clients/);
  const param = (sql) => seen.find((c) => c.sql === sql).params;
  assert.deepEqual(param(BOARD_STAGES_SQL), [BOARD_KEY, ORG]);
  assert.deepEqual(param(BOARD_CARDS_SQL), [BOARD_KEY, ORG, BOARD_LIMIT, false]);
  assert.deepEqual(param(COUNTS_SQL), [ORG, false]);
  assert.deepEqual(param(CLIENTS_LIST_SQL), [ORG, CLIENTS_LIST_LIMIT, false]);
});

test("route reads: the company's demo mode setting is read first and handed to every route", async () => {
  const seen = [];
  const rows = await gapChecks({
    db: fakeDb(dbMap(), seen), orgId: ORG, now: NOW, sources: [],
    crmReaders: readers({ orgDemoModeEnabled: async (_db, org) => org === ORG })
  });
  assert.equal(byId(rows, "crm-data:pipeline").status, "PASS");
  const param = (sql) => seen.find((c) => c.sql === sql).params;
  assert.equal(param(BOARD_CARDS_SQL)[3], true);
  assert.equal(param(COUNTS_SQL)[1], true);
  assert.equal(param(CLIENTS_LIST_SQL)[2], true);
});

test("route reads: the demo setting failing to read fails all three, never a PASS", async () => {
  const rows = await gapChecks({
    db: fakeDb(dbMap()), orgId: ORG, now: NOW, sources: [],
    crmReaders: readers({ orgDemoModeEnabled: async () => { throw new Error('column "demo_mode_enabled" does not exist'); } })
  });
  shape(rows);
  for (const id of ["crm-data:pipeline", "crm-data:pipeline-counts", "crm-data:clients"]) {
    assert.equal(byId(rows, id).status, "FAIL");
    assert.match(byId(rows, id).detail, /demo_mode_enabled/);
  }
  // The library reads are not touched by it.
  assert.equal(byId(rows, "crm-data:lenders").status, "PASS");
});

test("route reads: the board FAILs for a rail with no columns (the route answers 404), and never reads the cards", async () => {
  const seen = [];
  const rows = await gapChecks({
    db: fakeDb(dbMap({ [BOARD_STAGES_SQL]: { rows: [] } }), seen), orgId: ORG, now: NOW, sources: [], crmReaders: readers()
  });
  const board = byId(rows, "crm-data:pipeline");
  assert.equal(board.status, "FAIL");
  assert.match(board.detail, /no columns/);
  assert.match(board.detail, /unknown_pipeline/);
  assert.equal(seen.some((c) => c.sql === BOARD_CARDS_SQL), false);
  assert.equal(judgeBoard([], []).status, "FAIL");
  assert.equal(judgeBoard(null, null).status, "FAIL");
  assert.equal(judgeBoard([{ id: "s" }], []).status, "PASS");
});

test("route reads: a column or table gone from the board, the counts or the client list FAILs only that row", async () => {
  const run = (over) => gapChecks({ db: fakeDb(dbMap(over)), orgId: ORG, now: NOW, sources: [], crmReaders: readers() });
  const cards = await run({ [BOARD_CARDS_SQL]: new Error('column "approval_excluded_at" does not exist') });
  assert.equal(byId(cards, "crm-data:pipeline").status, "FAIL");
  assert.match(byId(cards, "crm-data:pipeline").detail, /approval_excluded_at/);
  assert.match(byId(cards, "crm-data:pipeline").suggestedFix, /api\/dashboard\/pipeline/);
  assert.equal(byId(cards, "crm-data:pipeline-counts").status, "PASS");
  assert.equal(byId(cards, "crm-data:clients").status, "PASS");

  const stages = await run({ [BOARD_STAGES_SQL]: new Error('relation "pipeline_stages" does not exist') });
  assert.equal(byId(stages, "crm-data:pipeline").status, "FAIL");

  const counts = await run({ [COUNTS_SQL]: new Error('column "crm_archived_at" does not exist') });
  assert.equal(byId(counts, "crm-data:pipeline-counts").status, "FAIL");
  assert.match(byId(counts, "crm-data:pipeline-counts").detail, /crm_archived_at/);
  assert.equal(byId(counts, "crm-data:pipeline").status, "PASS");
  assert.equal(byId(counts, "crm-data:clients").status, "PASS");

  const clients = await run({ [CLIENTS_LIST_SQL]: new Error('column "tags" does not exist') });
  assert.equal(byId(clients, "crm-data:clients").status, "FAIL");
  assert.match(byId(clients, "crm-data:clients").detail, /"tags"/);
  assert.match(byId(clients, "crm-data:clients").suggestedFix, /api\/dashboard\/clients/);
  assert.equal(byId(clients, "crm-data:pipeline").status, "PASS");
  assert.equal(byId(clients, "crm-data:pipeline-counts").status, "PASS");
});

test("route reads: rail counts FAIL when the company has no pipelines; the client list FAILs only with a client on file", async () => {
  const none = judgeRailCounts([]);
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /shows a dash/);
  assert.equal(judgeRailCounts(null).status, "FAIL");
  assert.equal(judgeRailCounts([{ pipeline_key: "sales", count: 0 }]).status, "PASS");

  const empty = judgeClientsList([], true);
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /client is on file and the Pipeline client list read came back empty/);
  assert.equal(judgeClientsList([], false).status, "PASS");
  assert.equal(judgeClientsList(null, true).status, "FAIL");
  assert.equal(judgeClientsList([{ id: "x" }], true).status, "PASS");

  const rows = await gapChecks({
    db: fakeDb(dbMap({ [CLIENTS_LIST_SQL]: { rows: [] } })), orgId: ORG, now: NOW, sources: [], crmReaders: readers()
  });
  assert.equal(byId(rows, "crm-data:clients").status, "FAIL");
  const noClient = await gapChecks({
    db: fakeDb(dbMap({ [CLIENTS_LIST_SQL]: { rows: [] }, [CLIENT_PICK_SQL]: { rows: [] } })), orgId: ORG, now: NOW, sources: [], crmReaders: readers()
  });
  assert.equal(byId(noClient, "crm-data:clients").status, "PASS");
  assert.equal(byId(noClient, "crm-data:pipeline").status, "PASS");
});

test("route reads: the three run even when the library code will not load or no client can be picked", async () => {
  const noLibrary = await gapChecks({
    db: fakeDb(dbMap()), orgId: ORG, now: NOW, sources: [],
    get crmReaders() { throw new Error("cannot find module lenders/store.mjs"); }
  });
  shape(noLibrary);
  for (const id of ["crm-data:lenders", "crm-data:client", "crm-data:lender-matches", "crm-data:tradelines"]) {
    assert.equal(byId(noLibrary, id).status, "FAIL");
    assert.match(byId(noLibrary, id).detail, /would not load: cannot find module/);
  }
  // The demo setting falls back to the library copy, which sends its own SELECT; a db that answers it keeps the routes alive.
  const answer = fakeDb({ ...dbMap(), "SELECT demo_mode_enabled FROM orgs WHERE id = $1": { rows: [{ demo_mode_enabled: false }] } });
  const live = await gapChecks({
    db: answer, orgId: ORG, now: NOW, sources: [],
    get crmReaders() { throw new Error("cannot find module"); }
  });
  for (const id of ["crm-data:pipeline", "crm-data:pipeline-counts", "crm-data:clients"]) assert.equal(byId(live, id).status, "PASS");

  const pickBroke = await gapChecks({
    db: fakeDb(dbMap({ [CLIENT_PICK_SQL]: new Error("clients unreadable") })), orgId: ORG, now: NOW, sources: [], crmReaders: readers()
  });
  assert.equal(byId(pickBroke, "crm-data:pipeline").status, "PASS");
  assert.equal(byId(pickBroke, "crm-data:clients").status, "PASS");
});

/* ─────────────── the desk list ─────────────── */

test("pages: a link to a public page or an API name is not on the desk list, so it is fetched", async () => {
  // careers.html is a public page (public_static) and has no desk row. /app/careers.html would 404.
  assert.ok(PULSE_REGISTRY.some((r) => r.kind === "public_static" && r.file === "careers.html"));
  assert.ok(!PULSE_REGISTRY.some((r) => r.kind === "desk" && r.path === "/app/careers.html"));
  assert.ok(PULSE_REGISTRY.some((r) => r.kind === "desk" && r.path === "/app/lenders.html"));
  const calls = [];
  const rows = await gapChecks({
    sources: [{ name: "pipeline.html", text: '<a href="lenders.html">d</a><a href="careers.html">c</a>' }],
    fetchImpl: site({ [`${BASE}/app/careers.html`]: 404 }, calls),
    baseUrl: BASE
  });
  const dead = byId(rows, "crm-link:careers.html");
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /answered 404/);
  assert.deepEqual(calls.map((c) => c.url), [`${BASE}/app/careers.html`]);
  // A real desk page is still not fetched again.
  assert.equal(calls.some((c) => c.url.endsWith("/app/lenders.html")), false);
});

/* ─────────────── shape and safety ─────────────── */

test("row ids: the lane's ids are the ones the board names", async () => {
  assert.deepEqual([...CHECK_IDS], [
    "crm-links:pages",
    "crm-links:bank-logos",
    "crm-data:pipeline-cards",
    "crm-data:pipeline",
    "crm-data:pipeline-counts",
    "crm-data:clients",
    "crm-data:lenders",
    "crm-data:client",
    "crm-data:lender-matches",
    "crm-data:tradelines"
  ]);
  const rows = await gapChecks({
    db: fakeDb(dbMap()), orgId: ORG, now: NOW, crmReaders: readers(),
    fetchImpl: site(screens()), baseUrl: BASE
  });
  shape(rows);
  for (const id of CHECK_IDS) assert.ok(byId(rows, id), `${id} is missing`);
  // The rows come out in the order the board names them.
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
});

test("this file reads no repo files, writes nothing, sends nothing, and opens no database of its own", () => {
  assert.doesNotMatch(SRC, /node:fs|readFileSync|existsSync|readdirSync/);
  assert.doesNotMatch(SRC, /import\.meta\.url|fileURLToPath|path\.(join|resolve)|process\.cwd/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/);
  assert.doesNotMatch(SRC, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  assert.doesNotMatch(SRC, /textChris|ticketDarwin|DATABASE_URL|notify\.mjs|placeCall|chargeCard/);
  assert.doesNotMatch(SRC, /x-dashboard-key|DASHBOARD_SECRET|Authorization/i);
  assert.match(SRC, /Recon/);
});
