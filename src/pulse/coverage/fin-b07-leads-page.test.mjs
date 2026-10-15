// Practice tests for the live read of the private leads list page (finish-853 batch 07).
// The page is git-excluded and holds real names and numbers, so these tests use a stand-in page built
// here from plain words. The judge is the real one; the stand-in is the product being judged. Each
// test breaks one promise of the row in the stand-in and expects red.

import assert from "node:assert/strict";
import test from "node:test";

import { DISPLAY_RESULT_CASES, DISPLAY_TRACKING_CASES, LIVE_PAGE_CONTRACT_COUNT, gapChecks } from "./gap-catalog-display.mjs";
import {
  LEADS_COLUMNS,
  LIVE_PAGE_JUDGES,
  SEND_PATTERNS,
  judgeLeadsHtml,
  judgeLeadsPage,
  leadsPagePath,
} from "./fin-b07-leads-page.mjs";
import { PULSE_REGISTRY } from "../registry.mjs";

const CONTROL = "Private leads list page (noindex, secret folder name): a local table with Name, Number, Follow up date, Response, Status. Edits save in the browser only; nothing is sent from the page.";
const MARKER = "ZZ-MARKER-NAME-DO-NOT-REPEAT";

/* A stand-in for the page, built from plain words. One call returns a page that keeps every promise;
   each option breaks exactly one. */
function page({
  robots = '<meta name="robots" content="noindex,nofollow,noarchive">',
  headings = LEADS_COLUMNS,
  script = 'var KEY = "leads-v1"; var rows = [{"n":"' + MARKER + '","p":"not a real number"}]; function save(){ localStorage.setItem(KEY, JSON.stringify(rows)); } function load(){ return JSON.parse(localStorage.getItem(KEY) || "[]"); }',
  extraHead = "",
  extraBody = "",
} = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Leads</title>${robots}
<meta name="viewport" content="width=device-width, initial-scale=1">${extraHead}</head><body>
<table><thead><tr>${headings.map((h) => `<th style="width:20%">${h}</th>`).join("")}</tr></thead><tbody></tbody></table>
${extraBody}<script>${script}</script></body></html>`;
}

function entryFor() {
  return DISPLAY_TRACKING_CASES.find((e) => e.control === CONTROL);
}

/* A GET client that answers the leads address with `html` and everything else with an empty 200. */
function client({ html = page(), status = 200, headers = {}, error = null, seen = [] } = {}) {
  return async (url, init) => {
    seen.push({ url: String(url), init });
    if (error) throw new Error(error);
    if (String(url).includes("/leads/")) return new Response(status === 200 ? html : null, { status, headers });
    return new Response("", { status: 200 });
  };
}

async function leadsRow(options = {}, ctx = {}) {
  const rows = await gapChecks({ fetchImpl: client(options), ...ctx });
  return rows.find((row) => row.id === entryFor().id);
}

test("the row is a live-page contract in the compiled catalog, with no SQL, and it is not NOT_PROVED", async () => {
  const entry = entryFor();
  assert.ok(entry, "the leads row must be a tracked display row");
  assert.equal(entry.contract.mode, "live-page");
  assert.equal(entry.contract.page, "leads-list");
  assert.equal(entry.contract.sql, null);
  assert.equal(typeof LIVE_PAGE_JUDGES[entry.contract.page].judge, "function");
  assert.equal(typeof LIVE_PAGE_JUDGES[entry.contract.page].path, "function");
  assert.ok(DISPLAY_RESULT_CASES.some((c) => c.id === entry.id));
  assert.equal(LIVE_PAGE_CONTRACT_COUNT, 1);
  const row = await leadsRow();
  assert.notEqual(row.status, "NOT_PROVED");
});

test("the address comes from the registry row that pings the page, and the read is one plain GET", async () => {
  const path = leadsPagePath();
  assert.match(path, /^\/leads\/[0-9a-f]{32}\/$/);
  assert.ok(PULSE_REGISTRY.some((r) => r.path === path && r.kind === "public_static"));
  const seen = [];
  const row = await leadsRow({ seen });
  const leads = seen.filter((s) => s.url.includes("/leads/"));
  assert.equal(leads.length, 1, "one read, no retry");
  assert.equal(leads[0].url, `https://fundhub.ai${path}`);
  assert.equal(leads[0].init.method, "GET");
  assert.equal(leads[0].init.redirect, "manual");
  assert.ok(leads[0].init.signal, "a time limit");
  assert.equal(leads[0].init.body, undefined);
  assert.equal(row.status, "PASS");
});

test("a page that keeps every promise is green, and nothing the page holds comes back", async () => {
  const row = await leadsRow();
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /every promise held/);
  assert.ok(!row.detail.includes(MARKER));
  assert.equal(row.suggestedFix, null);
  for (const words of ["noindex", "Name, Number, Follow up date, Response, Status", "nothing in it can send data out", "localStorage"]) {
    assert.ok(row.detail.includes(words), words);
  }
});

test("a different base address is used for the read, and a bad one is not read", async () => {
  const seen = [];
  const ok = await leadsRow({ seen }, { baseUrl: "https://example.test/ignored/path" });
  assert.equal(ok.status, "PASS");
  assert.ok(seen.some((s) => s.url === `https://example.test${leadsPagePath()}`));
  const bad = await leadsRow({}, { baseUrl: "not a web address" });
  assert.equal(bad.status, "skip");
  assert.match(bad.detail, /base address/);
});

test("noindex gone: red. noindex in the header instead of the page: still green", async () => {
  const gone = await leadsRow({ html: page({ robots: "" }) });
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /no noindex/);
  const wrongTag = await leadsRow({ html: page({ robots: '<meta name="robots" content="index,follow">' }) });
  assert.equal(wrongTag.status, "FAIL");
  const header = await leadsRow({ html: page({ robots: "" }), headers: { "x-robots-tag": "noindex, nofollow" } });
  assert.equal(header.status, "PASS");
  const wordElsewhere = await leadsRow({ html: page({ robots: '<meta name="description" content="noindex">' }) });
  assert.equal(wordElsewhere.status, "FAIL", "the word in another tag is not the robots tag");
  const commented = await leadsRow({ html: page({ robots: '<!-- <meta name="robots" content="noindex"> -->' }) });
  assert.equal(commented.status, "FAIL", "a commented-out tag does nothing");
});

test("a changed, missing, extra or reordered column is red", async () => {
  const variants = [
    LEADS_COLUMNS.map((c) => (c === "Number" ? "Phone" : c)),
    LEADS_COLUMNS.filter((c) => c !== "Response"),
    [...LEADS_COLUMNS, "Notes"],
    [...LEADS_COLUMNS].reverse(),
  ];
  for (const headings of variants) {
    const row = await leadsRow({ html: page({ headings }) });
    assert.equal(row.status, "FAIL", headings.join(","));
    assert.match(row.detail, /column headings/);
  }
  const caseOnly = await leadsRow({ html: page({ headings: LEADS_COLUMNS.map((c) => c.toUpperCase()) }) });
  assert.equal(caseOnly.status, "PASS", "capital letters alone do not change the promise");
});

/* One snippet per send pattern. The table must cover every pattern the judge holds. */
const SENDERS = {
  "calls fetch": { script: 'fetch("/api/x", {method: "POST", body: JSON.stringify(rows)}); localStorage.setItem("a","b");' },
  "uses XMLHttpRequest": { script: 'var x = new XMLHttpRequest(); localStorage.getItem("a");' },
  "uses sendBeacon": { script: 'navigator.sendBeacon("/x", "y"); localStorage.getItem("a");' },
  "opens a WebSocket": { script: 'var w = new WebSocket("wss://x.test"); localStorage.getItem("a");' },
  "opens an EventSource": { script: 'var w = new EventSource("/x"); localStorage.getItem("a");' },
  "loads code while it runs": { script: 'import("/x.js"); localStorage.getItem("a");' },
  "builds an Image to ping a server": { script: 'new Image(); localStorage.getItem("a");' },
  "sets a src from script": { script: 'var p = {}; p.src = "/x?d=1"; localStorage.getItem("a");' },
  "creates a script, image, frame, form or link tag from script": { script: 'document.createElement("img"); localStorage.getItem("a");' },
  "has a form": { extraBody: '<form action="/x" method="post"></form>' },
  "has a frame, embed or object": { extraBody: '<iframe src="/x"></iframe>' },
  "loads a script file": { extraBody: '<script src="/x.js"></script>' },
  "loads a file from another address": { extraHead: '<link rel="stylesheet" href="https://cdn.example.test/x.css">' },
  "sends the visitor on by itself (meta refresh)": { extraHead: '<meta http-equiv="refresh" content="0;url=/x">' },
};

test("every way a page can send data out is held by a pattern, and each one turns the row red", async () => {
  assert.deepEqual(Object.keys(SENDERS).sort(), SEND_PATTERNS.map(([words]) => words).sort(),
    "a pattern was added or removed without its break test");
  for (const [words, options] of Object.entries(SENDERS)) {
    const row = await leadsRow({ html: page(options) });
    assert.equal(row.status, "FAIL", words);
    assert.match(row.detail, /can send data out/, words);
    assert.ok(row.detail.includes(words), `${words}: ${row.detail}`);
  }
});

test("things that are not a send stay green: same-address files, data images, plain links, tel links", async () => {
  const html = page({
    extraHead: '<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="local.css">',
    extraBody: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><img src="/logo.png" alt=""><a href="https://example.test/x">a link</a><a href="tel:0000000000">call</a><!-- fetch("/x") in a comment -->',
  });
  const row = await leadsRow({ html });
  assert.equal(row.status, "PASS", row.detail);
});

test("edits no longer kept in the browser: red", async () => {
  const row = await leadsRow({ html: page({ script: "var rows = [];" }) });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no localStorage/);
});

test("several broken promises are all named in one red row, and none of the page's words are repeated", async () => {
  const html = page({ robots: "", headings: ["Name"], script: `var rows = ["${MARKER}"]; fetch("/x");` });
  const row = await leadsRow({ html });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /broke 4 promises/);
  assert.ok(!row.detail.includes(MARKER));
  assert.ok(!(row.suggestedFix || "").includes(MARKER));
  assert.match(row.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
});

test("a page that is gone or moved is red", async () => {
  for (const status of [404, 410]) {
    const row = await leadsRow({ status });
    assert.equal(row.status, "FAIL", String(status));
    assert.match(row.detail, /the live page is gone/);
  }
  for (const status of [301, 302, 307, 308]) {
    const row = await leadsRow({ status, headers: { location: "/login.html" } });
    assert.equal(row.status, "FAIL", String(status));
    assert.match(row.detail, /somewhere else/);
  }
});

test("a read that could not be made is skip with the reason, never green", async () => {
  for (const status of [401, 403, 429, 500, 502, 503]) {
    const row = await leadsRow({ status });
    assert.equal(row.status, "skip", String(status));
    assert.match(row.detail, /was not read/);
  }
  const offline = await leadsRow({ error: "network down" });
  assert.equal(offline.status, "skip");
  assert.match(offline.detail, /network down/);
  const noClient = await leadsRow({}, { fetchImpl: null });
  assert.equal(noClient.status, "skip");
  assert.match(noClient.detail, /no GET client/);
});

test("the empty answer a count script gets is red, not green and not NOT_PROVED", async () => {
  const row = await leadsRow({ html: "" });
  assert.equal(row.status, "FAIL");
});

test("without a registry row for the page there is nothing to read, and it says so", async () => {
  assert.equal(leadsPagePath([]), null);
  assert.equal(leadsPagePath([{ kind: "public_static", file: "leads/a/index.html", path: "/leads/a/" }, { kind: "public_static", file: "leads/b/index.html", path: "/leads/b/" }]), null, "two rows is not one page");
  const seen = [];
  const row = await leadsRow({ seen }, { registry: [] });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /registry/);
  assert.equal(seen.filter((s) => s.url.includes("/leads/")).length, 0, "nothing is read when there is no address");
});

test("the row judge, given a read directly, answers by status and never repeats the page", () => {
  const entry = entryFor();
  const good = judgeLeadsPage(entry, { status: 200, html: page(), robotsHeader: "" });
  assert.equal(good.status, "PASS");
  assert.equal(good.id, entry.id);
  assert.equal(judgeLeadsPage(entry, { status: 200, html: page({ robots: "" }), robotsHeader: "" }).status, "FAIL");
  assert.equal(judgeLeadsPage(entry, { status: 404, html: "" }).status, "FAIL");
  assert.equal(judgeLeadsPage(entry, { status: 302, html: "" }).status, "FAIL");
  assert.equal(judgeLeadsPage(entry, { status: 500, html: "" }).status, "skip");
  assert.equal(judgeLeadsPage(entry, { status: Number.NaN, html: "" }).status, "skip");
  assert.equal(judgeLeadsPage(entry, undefined).status, "skip");
});

test("the pure judge answers held and broke in plain words, and ignores the order of attributes", () => {
  const ok = judgeLeadsHtml(page({ robots: '<meta content="noindex" name="robots">' }));
  assert.equal(ok.ok, true);
  assert.equal(ok.held.length, 4);
  assert.deepEqual(ok.broke, []);
  const bad = judgeLeadsHtml("");
  assert.equal(bad.ok, false);
  assert.equal(bad.broke.length, 3, "no noindex, no columns, no localStorage; nothing sends");
});
