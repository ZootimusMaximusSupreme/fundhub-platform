// Practice tests for the "control not on the live page" read (fin-b06-not-shipped.mjs).
// These use a stand-in site (fake GET), and also serve the REAL files in public/climate so the real shipped
// page is what gets judged. They are not a live read of fundhub.ai. The live read happens in the pulse.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { NA_CODES, NA_CONDITIONS, isNaCode, verifyNa } from "../na-conditions.mjs";
import { DISPLAY_TRACKING_CASES, gapChecks, naVerify } from "./gap-catalog-display.mjs";
import {
  NOT_SHIPPED_CODE, judgeNotShipped, readShipState, shipClaim, verifyNotShipped
} from "./fin-b06-not-shipped.mjs";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public");
const PHRASE = "See how many banks in our book fit your state";
const CLAIM = Object.freeze({ path: "/climate/", markers: Object.freeze([PHRASE, "climate-match"]) });

/** A stand-in site: { "/path": body | { status, body } }. Records every request and insists on GET + manual redirect. */
function site(files, { origin = "https://fundhub.ai" } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.method, "GET", `only GET is allowed: ${url}`);
    assert.equal(init.redirect, "manual", `redirects are never followed: ${url}`);
    assert.ok(init.signal, "every read has a timeout");
    const u = new URL(url);
    requests.push(u.href);
    assert.equal(u.origin, origin, `a read left the site: ${u.href}`);
    const hit = files[u.pathname];
    if (hit === undefined) return new Response("not found", { status: 404 });
    if (hit instanceof Error) throw hit;
    return typeof hit === "string" ? new Response(hit, { status: 200 }) : new Response(hit.body ?? "", { status: hit.status });
  };
  return { fetchImpl, requests };
}

const PAGE = (extra = "") => `<!DOCTYPE html><html lang="en"><head><title>Lending Climate</title>
<link rel="stylesheet" href="/climate/_next/static/css/a.css"/>
<link rel="preload" as="script" href="/climate/_next/static/chunks/webpack.js"/>
<script src="/climate/_next/static/chunks/main.js" async=""></script>
<script src="/climate/_next/static/chunks/app/page.js" async=""></script>
</head><body><main><div class="card">Loading lending climate…</div>${extra}</main></body></html>`;

const GOOD = {
  "/climate/": PAGE(),
  "/climate/_next/static/chunks/webpack.js": "var w=1;",
  "/climate/_next/static/chunks/main.js": "var m=2;",
  "/climate/_next/static/chunks/app/page.js": 'fetch("/api/climate");',
};

// ───────────────────────── the read ─────────────────────────

test("a page and its own scripts that carry neither the words nor the door read as absent", async () => {
  const { fetchImpl, requests } = site(GOOD);
  const out = await readShipState(CLAIM, { fetchImpl });
  assert.equal(out.state, "absent");
  assert.equal(out.scripts, 3);
  assert.deepEqual(out.found, []);
  assert.equal(requests.length, 4, "one page and three scripts, nothing else");
  assert.ok(!requests.some((href) => href.endsWith("a.css")), "a stylesheet is not read");
});

test("the words in the page itself make it present", async () => {
  const { fetchImpl } = site({ ...GOOD, "/climate/": PAGE(`<button>${PHRASE}</button>`) });
  const out = await readShipState(CLAIM, { fetchImpl });
  assert.equal(out.state, "present");
  assert.deepEqual(out.found, [PHRASE]);
});

test("the words in a bundled script make it present", async () => {
  const { fetchImpl } = site({ ...GOOD, "/climate/_next/static/chunks/app/page.js": `h("button",{children:"${PHRASE}"})` });
  assert.equal((await readShipState(CLAIM, { fetchImpl })).state, "present");
});

test("the lead door in a script makes it present even when the words changed", async () => {
  const { fetchImpl } = site({ ...GOOD, "/climate/_next/static/chunks/main.js": 'fetch("/api/public/climate-match",{method:"POST"})' });
  const out = await readShipState(CLAIM, { fetchImpl });
  assert.equal(out.state, "present");
  assert.deepEqual(out.found, ["climate-match"]);
});

test("capital letters and line breaks inside the words do not hide them", async () => {
  const { fetchImpl } = site({ ...GOOD, "/climate/": PAGE("<h2>SEE  HOW many\n  banks in our book fit your STATE</h2>") });
  assert.equal((await readShipState(CLAIM, { fetchImpl })).state, "present");
});

test("absence is never claimed from a read that did not finish", async () => {
  const cases = {
    "page is 404": { ...GOOD, "/climate/": { status: 404, body: "<html></html>" } },
    "page is 500": { ...GOOD, "/climate/": { status: 500, body: "<html></html>" } },
    "page moved (redirect not followed)": { ...GOOD, "/climate/": { status: 301, body: "" } },
    "page is not a web page": { ...GOOD, "/climate/": "" },
    "a script is 404": { ...GOOD, "/climate/_next/static/chunks/main.js": { status: 404, body: "" } },
    "a script is 503": { ...GOOD, "/climate/_next/static/chunks/app/page.js": { status: 503, body: "" } },
    "a script fails on the network": { ...GOOD, "/climate/_next/static/chunks/main.js": new Error("socket hang up") },
    "the page fails on the network": { ...GOOD, "/climate/": new Error("getaddrinfo ENOTFOUND") },
  };
  for (const [name, files] of Object.entries(cases)) {
    const out = await readShipState(CLAIM, { fetchImpl: site(files).fetchImpl });
    assert.equal(out.state, "unread", name);
    assert.ok(out.reason.length > 5, `${name}: says why`);
  }
});

test("a page with more scripts than the cap is not judged from a partial read", async () => {
  const many = Array.from({ length: 13 }, (_, i) => `<script src="/climate/_next/static/chunks/c${i}.js"></script>`).join("");
  const files = { "/climate/": `<html><body>${many}</body></html>` };
  for (let i = 0; i < 13; i += 1) files[`/climate/_next/static/chunks/c${i}.js`] = "x";
  const out = await readShipState(CLAIM, { fetchImpl: site(files).fetchImpl });
  assert.equal(out.state, "unread");
  assert.match(out.reason, /13 scripts/);
});

test("other sites' scripts are never fetched, and a repeated script is fetched once", async () => {
  const html = `<html><body>
    <script src="https://cdn.example.net/track.js"></script>
    <script src="//other.example.org/x.js"></script>
    <script src="/climate/_next/static/chunks/main.js"></script>
    <script src="/climate/_next/static/chunks/main.js#again"></script>
  </body></html>`;
  const { fetchImpl, requests } = site({ "/climate/": html, "/climate/_next/static/chunks/main.js": "ok" });
  const out = await readShipState(CLAIM, { fetchImpl });
  assert.equal(out.state, "absent");
  assert.deepEqual(requests, ["https://fundhub.ai/climate/", "https://fundhub.ai/climate/_next/static/chunks/main.js"]);
});

test("no GET client, a bad base address, and a bad claim are all unread, never absent", async () => {
  assert.equal((await readShipState(CLAIM, { fetchImpl: null })).state, "unread");
  assert.equal((await readShipState(CLAIM, { fetchImpl: site(GOOD).fetchImpl, baseUrl: "not a url" })).state, "unread");
});

test("a claim must name a path on the site and at least one word or door", () => {
  const entry = (notShipped) => ({ contract: { notShipped } });
  assert.deepEqual(shipClaim(entry({ path: "/climate/", markers: ["a"] })), { path: "/climate/", markers: ["a"] });
  for (const bad of [
    undefined, null, {}, { path: "climate/", markers: ["a"] }, { path: "//evil.example/", markers: ["a"] },
    { path: "/climate/", markers: [] }, { path: "/climate/", markers: [""] }, { path: "/climate/", markers: [7] },
    { path: "/climate/" }, { path: "", markers: ["a"] },
  ]) assert.equal(shipClaim(entry(bad)), null, JSON.stringify(bad));
  assert.equal(shipClaim(null), null);
  assert.equal(shipClaim({ contract: null }), null);
});

test("two controls on one page cost one page read", async () => {
  const { fetchImpl, requests } = site(GOOD);
  const claim = { path: "/climate/", markers: [PHRASE, "climate-match"] };
  const entries = ["one", "two"].map((n) => ({ id: `id-${n}`, sourceFile: "f.json", surface: "s", control: n, contract: { notShipped: claim } }));
  const rows = await judgeNotShipped(entries, { fetchImpl });
  assert.equal(rows.size, 2);
  assert.equal(requests.filter((href) => href.endsWith("/climate/")).length, 1);
});

// ───────────────────────── the real shipped page ─────────────────────────

/** Serves the REAL files under public/. `mutate` changes one served file in memory (never on disk). */
function repoSite(mutate = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    const u = new URL(url);
    requests.push(u.pathname);
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response("not found", { status: 404 });
    }
    let body = fs.readFileSync(file, "utf8");
    for (const [match, change] of Object.entries(mutate)) if (u.pathname === match || u.pathname.startsWith(match)) body = change(body);
    return new Response(body, { status: 200 });
  };
  return { fetchImpl, requests };
}

function climateEntry() {
  const entry = DISPLAY_TRACKING_CASES.find((item) => shipClaim(item));
  assert.ok(entry, "the climate button carries a not-shipped claim");
  return entry;
}

test("the real /climate/ page and every script it loads carry neither the button words nor the lead door", async () => {
  const { fetchImpl, requests } = repoSite();
  const out = await readShipState(shipClaim(climateEntry()), { fetchImpl });
  assert.equal(out.state, "absent",
    "The shipped /climate/ page now carries the lead-magnet button or its door. Take the not-shipped claim off " +
    "the button in fin-b06-display-contracts.mjs and attach a real check for the scroll and the form it saves.");
  assert.ok(out.scripts >= 5, `read the page's own scripts (${out.scripts})`);
  assert.ok(requests.some((p) => p.endsWith("/page-b71b32356ee1b98a.js")) || requests.some((p) => p.includes("/chunks/app/page-")));
});

test("the claim goes false when the real page gets the button", async () => {
  const withButton = repoSite({ "/climate/": (html) => html.replace("</body>", `<button>${PHRASE}</button></body>`) });
  const out = await readShipState(shipClaim(climateEntry()), { fetchImpl: withButton.fetchImpl });
  assert.equal(out.state, "present");
});

test("the claim goes false when the real page script starts calling the lead door", async () => {
  const wired = repoSite({ "/climate/_next/static/chunks/app/page-": (js) => `${js}\nfetch("/api/public/climate-match");` });
  const out = await readShipState(shipClaim(climateEntry()), { fetchImpl: wired.fetchImpl });
  assert.equal(out.state, "present");
  assert.deepEqual(out.found, ["climate-match"]);
});

// ───────────────────────── the lane and the morning audit ─────────────────────────

test("only the climate button carries a not-shipped claim, and it is still an unmeasured contract", () => {
  const claimed = DISPLAY_TRACKING_CASES.filter((item) => shipClaim(item));
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].contract.mode, "always-red");
  assert.ok(claimed[0].control.startsWith(PHRASE));
  assert.equal(claimed[0].sourceFile, "public-pages.json");
});

test("the lane says na for the real page, with a code the audit knows, and the audit lets it stand", async () => {
  const { fetchImpl } = repoSite();
  const rows = await gapChecks({ fetchImpl });
  const entry = climateEntry();
  const row = rows.find((item) => item.id === entry.id);
  assert.equal(row.status, "na", row.detail);
  assert.equal(row.na.code, NOT_SHIPPED_CODE);
  assert.equal(isNaCode(row.na.code), true);
  assert.deepEqual(row.na.args, { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control });
  assert.equal(NA_CONDITIONS[row.na.code].verify, "lane");
  assert.ok(NA_CODES.includes(NOT_SHIPPED_CODE));

  const laneNaVerify = async (_slice, code, args) => naVerify[code]?.(args, { fetchImpl });
  const audit = await verifyNa({ id: row.id, sliceId: "gap-catalog-display", na: row.na }, { laneNaVerify });
  assert.equal(audit.ok, true, audit.reason);
});

test("when the page gets the button the lane says not proved and the audit takes the na back", async () => {
  const { fetchImpl } = repoSite({ "/climate/": (html) => html.replace("</body>", `<button>${PHRASE}</button></body>`) });
  const rows = await gapChecks({ fetchImpl });
  const entry = climateEntry();
  const row = rows.find((item) => item.id === entry.id);
  assert.equal(row.status, "NOT_PROVED");
  assert.equal(row.na, undefined);
  assert.match(row.detail, /carries this control now/);
  assert.match(row.suggestedFix, /Chris fixes reds/);

  // Even if an old "na" row is replayed to the audit, the lane no longer agrees.
  const laneNaVerify = async (_slice, code, args) => naVerify[code]?.(args, { fetchImpl });
  const stale = { id: entry.id, sliceId: "gap-catalog-display", na: { code: NOT_SHIPPED_CODE, args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control } } };
  const audit = await verifyNa(stale, { laneNaVerify });
  assert.equal(audit.ok, false);
});

test("an unreadable live page makes the row skip, and the audit does not accept na", async () => {
  const down = site({ "/climate/": { status: 502, body: "bad gateway" } });
  const rows = await gapChecks({ fetchImpl: down.fetchImpl });
  const entry = climateEntry();
  const row = rows.find((item) => item.id === entry.id);
  assert.equal(row.status, "skip");
  assert.match(row.detail, /was not read: the live page answered 502/);
  const args = { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control };
  assert.equal(await naVerify[NOT_SHIPPED_CODE](args, { fetchImpl: down.fetchImpl }), false);
  assert.equal(await naVerify[NOT_SHIPPED_CODE](args, { fetchImpl: null }), false);
});

test("the audit's na proof cannot be copied onto a row that has no claim", async () => {
  const { fetchImpl } = repoSite();
  const entry = climateEntry();
  const args = { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control };
  assert.equal(await naVerify[NOT_SHIPPED_CODE](args, { fetchImpl }), true);
  assert.equal(await naVerify[NOT_SHIPPED_CODE]({ ...args, control: "invented" }, { fetchImpl }), false);
  assert.equal(await naVerify[NOT_SHIPPED_CODE]({ ...args, surface: "invented" }, { fetchImpl }), false);
  assert.equal(await naVerify[NOT_SHIPPED_CODE]({}, { fetchImpl }), false);
  const other = DISPLAY_TRACKING_CASES.find((item) => !shipClaim(item) && item.contract?.mode === "query");
  assert.ok(other);
  assert.equal(await naVerify[NOT_SHIPPED_CODE]({ sourceFile: other.sourceFile, surface: other.surface, control: other.control }, { fetchImpl }), false);
  assert.equal(await verifyNotShipped(DISPLAY_TRACKING_CASES, args, { fetchImpl }), true);
});

test("an incomplete proof is refused by the audit before the lane is asked", async () => {
  let asked = 0;
  const laneNaVerify = async () => { asked += 1; return true; };
  const out = await verifyNa({ id: "catalog-display:x", sliceId: "gap-catalog-display", na: { code: NOT_SHIPPED_CODE, args: { sourceFile: "public-pages.json" } } }, { laneNaVerify });
  assert.equal(out.ok, false);
  assert.match(out.reason, /not complete/);
  assert.equal(asked, 0);
});
