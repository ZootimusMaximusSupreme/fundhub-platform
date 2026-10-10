// Tests for the apply-links beat (src/pulse/beats/beat-apply-links.mjs).
//
// Everything runs on the fake ctx: no network, no database. The SQL the beat sends is not run here; it was
// run against the live database read-only (see the board) and it is checked here against the real read-box
// allow-list, so a word the box refuses cannot slip in.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-apply-links.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { normalizeQuery } from "./readbox.mjs";
import { TRACKING_DOMAINS } from "./lib/bank-classify.mjs";
import { scrubDetail } from "../alerts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const hashOf = (url) => crypto.createHash("sha256").update(url).digest("hex");
const lenderId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const host = (url) => new URL(url).hostname;

/** A book of { n, url } -> the rows the SQL returns. */
const sqlRows = (urls) => urls.map((url, i) => ({ url_hash: hashOf(url), url, lender_ids: [lenderId(i + 1)] }));
const bank = (n, over = "") => `https://www.bank${n}.example.com/apply?ecid=SECRET-${n}${over}`;
const banks = (count, start = 1) => Array.from({ length: count }, (_, i) => bank(start + i));
const wasGood = (url, over = {}) => ({
  urlHash: hashOf(url), lenderId: null, lastCheckedAt: "2026-10-08T10:00:00.000Z", lastGoodAt: "2026-10-08T10:00:00.000Z",
  lastClass: "OK", lastStatus: 200, lastHost: host(url), ...over
});
const page = (title = "Apply now") => ({ status: 200, body: `<html><head><title>${title}</title></head><body>x</body></html>` });
const gone = () => new Error("fetch failed");
const notFound = () => ({ status: 404, body: "<title>Page Not Found</title>" });
const wall = () => ({ status: 403, body: "<title>Just a moment...</title>" });

/** Run the beat on a fake ctx. `http` is a function (method, url) => partial | Error. */
/* The saved list's own health reads (only asked when the saved list is empty): table there, no rows. */
const tableStubs = ({ there = true, n = 0 } = {}) => [
  { match: /to_regclass/, rows: [{ there }] },
  { match: /FROM pulse_bank_links/, rows: [{ n }] }
];
async function go({ urls = [], state = null, http = () => page(), read, env, table, stateExtra = {} } = {}) {
  const ctx = makeFakeCtx(beat, {
    read: [...(read ?? [{ match: /FROM lenders/, rows: sqlRows(urls) }]), ...tableStubs(table)],
    state: state === null ? null : { bankLinks: state, ...stateExtra },
    http,
    env
  });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx), rows: (result.evidence && result.evidence.bankLinks) || [] };
}
const rowFor = (rows, url) => rows.find((r) => r.urlHash === hashOf(url));
const callsTo = (log, url) => log.http.filter((c) => c.host === host(url)).length;

/* ---------------- the beat is a valid beat ---------------- */

test("apply-links: validates, is read-only, probe kind, damp 2, reads any host by GET only", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-apply-links.mjs" }), []);
  assert.equal(beat.box, false);
  assert.equal(beat.kind, "probe");
  assert.equal(beat.damp, 2);
  assert.equal(beat.deadlineMs, 12000);
  assert.deepEqual(beat.needs, ["bankLinks"]);
  assert.deepEqual(beat.reads, [{ host: "*", methods: ["GET"] }]);
  assert.deepEqual(beat.steps, ["url-shape", "pick", "fetch", "classify", "confirm", "verdict"]);
});

test("apply-links: covers are real surfaces (the route and both screens)", async () => {
  const { ROUTES } = await import("../../../netlify/functions/api.mjs");
  assert.ok(Object.keys(ROUTES).includes("lenders"), "route:lenders");
  assert.ok(fs.existsSync(path.join(ROOT, "public/app/lenders.html")), "desk:lenders.html");
  assert.ok(fs.existsSync(path.join(ROOT, "public/app/client-control-panel.html")), "desk:client-control-panel.html");
  assert.deepEqual(beat.covers, ["route:lenders", "desk:lenders.html", "desk:client-control-panel.html"]);
});

test("apply-links: the fix guide names real files and no secret", () => {
  const { paths, missing, anyExists } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(anyExists);
  assert.deepEqual(missing, [], `fix guide names files that are not on disk: ${missing.join(", ")} (of ${paths.join(", ")})`);
  assert.ok(beat.fixGuide.split("\n")[0].length <= 120);
});

test("apply-links: the beat file and its helper pass the static pin (no database, no fetch, no process, no SQL write)", () => {
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-apply-links.mjs"), "utf8"), { role: "beat" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib/bank-classify.mjs"), "utf8"), { role: "lib" }), []);
});

test("apply-links: the SQL is one read the real read-box allow-list accepts, keyed on the same sha-256", () => {
  const q = normalizeQuery(beat.SQL_APPLY_URLS, []);
  assert.equal(q.text, beat.SQL_APPLY_URLS);
  assert.match(beat.SQL_APPLY_URLS, /^SELECT /);
  assert.match(beat.SQL_APPLY_URLS, /sha256\(convert_to\(application_url, 'UTF8'\)\)/);
  assert.match(beat.SQL_APPLY_URLS, /WHERE active/);
  assert.match(beat.SQL_APPLY_URLS, /GROUP BY application_url/);
});

test("apply-links: selfTest.pass is green, selfTest.fail is red at a declared step", async () => {
  assert.deepEqual(await checkBeatSelfTest(beat), []);
});

/* ---------------- PASS ---------------- */

test("PASS: every address opens -> green, every step ran, rows are OK with a good time", async () => {
  const urls = banks(6);
  const { result, rows, log } = await go({ urls, state: urls.map((u) => wasGood(u)) });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.steps.map((s) => s.name), beat.steps);
  assert.deepEqual(result.notRun, []);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.lastClass === "OK" && r.lastGoodAt === "2026-10-09T19:07:00.000Z" && r.lastStatus === 200));
  assert.equal(log.http.length, 6, "one read each, no second reads");
  assert.ok(log.http.every((c) => c.method === "GET"));
  assert.deepEqual(log.refused, []);
  assert.match(result.detail, /read 6 of 6 Apply links; OK 6/);
});

test("PASS: nothing in the book -> green and says so", async () => {
  const { result, rows } = await go({ urls: [], state: [] });
  assert.equal(result.ok, true);
  assert.match(result.detail, /read 0 of 0/);
  assert.deepEqual(rows, []);
});

/* ---------------- FAIL: the red path ---------------- */

test("FAIL: a link that worked turns HARD on both reads -> red at confirm, names the lender id and the class", async () => {
  const urls = banks(4);
  const dead = urls[2];
  const { result, rows, log } = await go({
    urls,
    state: urls.map((u) => wasGood(u)),
    http: (m, url) => (url === dead ? gone() : page())
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "confirm");
  assert.match(result.detail, /^www\.bank3\.example\.com HARD no answer \(lender 00000000\) - 1 bank Apply link broke after it worked\.$/);
  assert.equal(callsTo(log, dead), 2, "read twice in the same run");
  assert.equal(callsTo(log, urls[0]), 1);
  const row = rowFor(rows, dead);
  assert.equal(row.lastClass, "HARD");
  assert.equal(row.lastGoodAt, "2026-10-08T10:00:00.000Z", "the old good time is kept, so it stays a suspect");
  assert.equal(rowFor(rows, urls[0]).lastClass, "OK", "the state of the other reads is carried in the red result too");
  assert.deepEqual(result.evidence.confirmed.map((c) => c.lenderId), [lenderId(3)]);
});

test("FAIL: a good link that now says 404 on both reads -> red, BAD_URL, host and lender named", async () => {
  const urls = banks(3);
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[1] ? notFound() : page()) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "confirm");
  assert.match(result.detail, /^www\.bank2\.example\.com BAD_URL 404 \(lender 00000000\)/);
  assert.equal(rowFor(rows, urls[1]).lastClass, "BAD_URL");
  assert.match(rowFor(rows, urls[1]).lastDetail, /^BAD_URL 404 page not found at www\.bank2\.example\.com "Page Not Found"$/);
});

test("FAIL: HARD on the first read, a different break (404) on the second, is still red", async () => {
  const urls = banks(1);
  let n = 0;
  const { result } = await go({ urls, state: [wasGood(urls[0])], http: () => (++n === 1 ? gone() : notFound()) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "confirm");
  assert.match(result.detail, /BAD_URL 404/, "the second read is the one on record");
});

test("FAIL: a 5xx with no wall word on both reads is HARD and red", async () => {
  const urls = banks(2);
  const { result } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[0] ? { status: 503, body: "<title>Service Unavailable</title>" } : page()) });
  assert.equal(result.ok, false);
  assert.match(result.detail, /^www\.bank1\.example\.com HARD 503/);
});

test("the second read: a blip that clears on the second read is green and the row is OK again", async () => {
  const urls = banks(3);
  let n = 0;
  const { result, rows, log } = await go({
    urls, state: urls.map((u) => wasGood(u, { lastCheckedAt: u === urls[1] ? "2026-10-01T00:00:00.000Z" : "2026-10-08T10:00:00.000Z" })),
    http: (m, url) => (url === urls[1] && ++n === 1 ? gone() : page())
  });
  assert.equal(result.ok, true, result.detail);
  assert.equal(callsTo(log, urls[1]), 2);
  assert.equal(rowFor(rows, urls[1]).lastClass, "OK");
  assert.equal(rowFor(rows, urls[1]).lastGoodAt, "2026-10-09T19:07:00.000Z");
});

test("the second read: a first-read break that turns into a bot wall is green (a wall is never red)", async () => {
  const urls = banks(1);
  let n = 0;
  const { result, rows } = await go({ urls, state: [wasGood(urls[0])], http: () => (++n === 1 ? gone() : wall()) });
  assert.equal(result.ok, true);
  assert.equal(rows[0].lastClass, "WALL");
});

test("the second read: a first-read break that turns into a timeout is green (unproven is never red)", async () => {
  const urls = banks(1);
  let n = 0;
  const { result, rows } = await go({ urls, state: [wasGood(urls[0])], http: () => (++n === 1 ? gone() : { class: "timeout", status: 0, error: "timed out after 8000ms" }) });
  assert.equal(result.ok, true);
  assert.equal(rows[0].lastClass, "SLOW");
});

/* ---------------- WALL, SLOW, first pass, never good: never red ---------------- */

test("WALL: 403 on a link that was good is never red, and is read once only", async () => {
  const urls = banks(3);
  const { result, rows, log } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[0] ? wall() : page()) });
  assert.equal(result.ok, true, result.detail);
  assert.equal(rowFor(rows, urls[0]).lastClass, "WALL");
  assert.equal(rowFor(rows, urls[0]).lastGoodAt, "2026-10-08T10:00:00.000Z", "a wall does not erase the good time");
  assert.equal(callsTo(log, urls[0]), 1, "no second read for a wall");
  assert.match(result.detail, /WALL 1/);
});

test("WALL: every kind of wall on a good link stays green (403, 429, 200 with a wall title, 503 challenge, cf-mitigated)", async () => {
  const answers = [
    { status: 403, body: "<title>403 Forbidden</title>" },
    { status: 429, body: "<title>Too Many Requests</title>" },
    { status: 200, body: "<title>Pardon Our Interruption</title>" },
    { status: 503, body: "<title>Just a moment...</title>" },
    { status: 403, body: "<title>x</title>", headers: { "cf-mitigated": "challenge" } }
  ];
  const urls = banks(answers.length);
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => answers[urls.indexOf(url)] });
  assert.equal(result.ok, true, result.detail);
  assert.ok(rows.every((r) => r.lastClass === "WALL"), JSON.stringify(rows.map((r) => r.lastClass)));
});

test("SLOW: a timeout on a good link is never red", async () => {
  const urls = banks(2);
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[0] ? { class: "timeout", status: 0, error: "timed out after 8000ms" } : page()) });
  assert.equal(result.ok, true);
  assert.equal(rowFor(rows, urls[0]).lastClass, "SLOW");
});

test("FIRST PASS: empty state, every link dead -> green, nothing raised, no second reads, state filled", async () => {
  const urls = banks(5);
  for (const state of [[], null]) {
    const { result, rows, log } = await go({ urls, state, http: () => notFound() });
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /first pass: filled the list, raised nothing/);
    assert.equal(log.http.length, 5, "no confirm reads on a first pass");
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.lastClass === "BAD_URL" && r.lastGoodAt === null));
    assert.match(result.detail, /5 never worked \(not an alarm\)/);
  }
});

test("FIRST PASS: junk in the saved state counts as empty", async () => {
  const urls = banks(2);
  const { result } = await go({ urls, state: [null, 7, "x", {}, { urlHash: 5 }], http: () => gone() });
  assert.equal(result.ok, true);
  assert.match(result.detail, /first pass/);
});

test("NEVER GOOD: a link with a saved row but no good time that is dead is link debt, not red, and gets no second read", async () => {
  const urls = banks(3);
  const state = urls.map((u, i) => wasGood(u, i === 0 ? { lastGoodAt: null, lastClass: "BAD_URL" } : {}));
  const { result, log } = await go({ urls, state, http: (m, url) => (url === urls[0] ? notFound() : page()) });
  assert.equal(result.ok, true, result.detail);
  assert.equal(callsTo(log, urls[0]), 1);
  assert.match(result.detail, /1 never worked/);
});

test("NEVER GOOD: a link not in the saved state at all is not red even when the rest of the state exists", async () => {
  const urls = banks(3);
  const { result } = await go({ urls, state: [wasGood(urls[1])], http: (m, url) => (url === urls[0] ? gone() : page()) });
  assert.equal(result.ok, true);
});

/* ---------------- the second-read limits ---------------- */

test("CONFIRM CAP: 7 good links go dead -> only 5 are read a second time; the red names 5; 2 are left for the next hour", async () => {
  const urls = banks(9);
  const dead = new Set(urls.slice(0, 7));
  const { result, log, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (dead.has(url) ? gone() : page()) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "confirm");
  assert.equal(log.http.length, 9 + 5, "9 first reads and 5 second reads");
  assert.equal(result.evidence.confirmed.length, 5);
  assert.equal(result.evidence.unconfirmed, 2);
  assert.match(result.detail, /- 5 bank Apply links broke after it worked\.$/);
  assert.equal(rows.filter((r) => r.lastClass === "HARD").length, 7, "all 7 are saved HARD, so all 7 stay suspects");
});

test("SUSPECTS: a link that was good and is dead is read first on every run, even if it was read a minute ago", async () => {
  const urls = banks(60);
  const state = urls.map((u, i) => wasGood(u, { lastCheckedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  state[59] = wasGood(urls[59], { lastClass: "HARD", lastStatus: 0, lastCheckedAt: "2026-10-09T18:07:00.000Z" });
  const { log, result } = await go({ urls, state, http: () => page() });
  assert.equal(callsTo(log, urls[59]), 1, "the newest-read link is still read");
  assert.equal(log.http.length, 40);
  assert.equal(result.ok, true);
});

test("DAMP: a broken link stays red on the next run (it is read again), and goes green when it opens again", async () => {
  const urls = banks(3);
  const dead = urls[0];
  const run1 = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === dead ? gone() : page()) });
  assert.equal(run1.result.ok, false);
  // The runner saves run1's rows and hands them back next hour.
  const run2 = await go({ urls, state: run1.rows, http: (m, url) => (url === dead ? gone() : page()) });
  assert.equal(run2.result.ok, false, "still red the next hour");
  assert.equal(run2.log.http.filter((c) => c.host === host(dead)).length, 2);
  const run3 = await go({ urls, state: run2.rows, http: () => page() });
  assert.equal(run3.result.ok, true, "fixed");
  assert.equal(rowFor(run3.rows, dead).lastClass, "OK");
});

/* ---------------- picking ---------------- */

test("PICK: 40 per run, oldest last_checked_at first, never-checked first", async () => {
  const urls = banks(70);
  const state = urls.slice(0, 50).map((u, i) => wasGood(u, { lastCheckedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const { log, result } = await go({ urls, state });
  assert.equal(result.ok, true, result.detail);
  const hit = new Set(log.http.map((c) => c.host));
  assert.equal(hit.size, 40);
  for (const u of urls.slice(50)) assert.ok(hit.has(host(u)), `never-checked ${host(u)} is read`);
  for (const u of urls.slice(0, 20)) assert.ok(hit.has(host(u)), `the 20 oldest are read: ${host(u)}`);
  for (const u of urls.slice(20, 50)) assert.ok(!hit.has(host(u)), `newer ones wait: ${host(u)}`);
});

test("PICK: at most 6 reads per tracking host and 2 per other host, in one run", async () => {
  const urls = [];
  for (const d of TRACKING_DOMAINS) for (let i = 0; i < 12; i++) urls.push(`https://www.${d}/card?ecid=SECRET-${i}`);
  for (let i = 0; i < 6; i++) urls.push(`https://www.bigbank.example.com/p${i}?ecid=SECRET-B${i}`);
  const { log } = await go({ urls, state: [] });
  const per = new Map();
  for (const c of log.http) per.set(c.host, (per.get(c.host) ?? 0) + 1);
  for (const d of TRACKING_DOMAINS) assert.equal(per.get(`www.${d}`), 6, d);
  assert.equal(per.get("www.bigbank.example.com"), 2);
  assert.equal(log.http.length, 4 * 6 + 2);
});

test("PICK: the first pass over a mixed book touches 40 different hosts, once each", async () => {
  const urls = [];
  for (const d of TRACKING_DOMAINS) for (let i = 0; i < 30; i++) urls.push(`https://www.${d}/card?ecid=SECRET-${i}`);
  for (let h = 0; h < 80; h++) for (let i = 0; i < 2; i++) urls.push(`https://www.other${h}.example.com/p${i}?ecid=SECRET`);
  const { log } = await go({ urls, state: [] });
  assert.equal(log.http.length, 40);
  assert.equal(new Set(log.http.map((c) => c.host)).size, 40);
});

test("PICK: two lenders on one address are read once and both ids are carried", async () => {
  const url = bank(1);
  const rows = [{ url_hash: hashOf(url), url, lender_ids: [lenderId(1), lenderId(2)] }];
  const { result, rows: saved, log } = await go({ read: [{ match: /FROM lenders/, rows }], state: [wasGood(url)], http: () => gone() });
  assert.equal(log.http.length, 2, "one read and one second read, not one per lender");
  assert.match(result.detail, /\(lender 00000000, 2 lender rows\)/);
  assert.deepEqual(saved[0].lenderIds, [lenderId(1), lenderId(2)]);
});

/* ---------------- url-shape ---------------- */

test("URL SHAPE: the real bad row (a space in the query) is BAD_URL, costs no read, and is saved once", async () => {
  const bad = "https://creditcardlearnmore.com/card?ecdma-lc= 27795&ecid=SECRET-SPACE";
  const plain = "http://www.plain-http.example.com/apply?id=SECRET-HTTP";
  const urls = [bank(1), bad, plain];
  const a = await go({ urls, state: [] });
  assert.equal(a.result.ok, true);
  assert.equal(a.log.http.length, 1, "only the good-looking address was read");
  const row = rowFor(a.rows, bad);
  assert.equal(row.lastClass, "BAD_URL");
  assert.match(row.lastDetail, /has a space or blank in it/);
  assert.equal(rowFor(a.rows, plain).lastClass, "BAD_URL");
  assert.match(a.result.detail, /2 stored addresses cannot be opened/);
  // Next hour: the state already has them as BAD_URL, so they are not written again.
  const b = await go({ urls, state: a.rows });
  assert.equal(b.rows.some((r) => r.urlHash === hashOf(bad)), false);
  assert.equal(b.result.ok, true);
});

test("URL SHAPE: a bad address is never red, even when the state says it was good", async () => {
  const bad = "https://www.bank1.example.com/a b";
  const { result } = await go({ urls: [bad], state: [wasGood(bad)] });
  assert.equal(result.ok, true);
});

test("URL SHAPE: the list of addresses vanishing is red at url-shape (a wipe)", async () => {
  const known = banks(80);
  const state = known.map((u) => wasGood(u));
  const wiped = await go({ urls: known.slice(0, 20), state });
  assert.equal(wiped.result.ok, false);
  assert.equal(wiped.result.step, "url-shape");
  assert.match(wiped.result.detail, /Apply links went missing: 20 addresses on the lenders now, 80 were checked before/);
  const fine = await go({ urls: known.slice(0, 50), state });
  assert.equal(fine.result.ok, true, "a drop under half is not a wipe");
  const none = await go({ urls: [], state });
  assert.equal(none.result.step, "url-shape", "the whole column empty is red");
});

test("URL SHAPE: a small saved list never trips the wipe check", async () => {
  const { result } = await go({ urls: banks(2), state: banks(40).map((u) => wasGood(u)) });
  assert.equal(result.ok, true);
});

test("URL SHAPE: a row without a fingerprint, or a failed read, is red at url-shape", async () => {
  const noHash = await go({ read: [{ match: /FROM lenders/, rows: [{ url: bank(1), lender_ids: [lenderId(1)] }] }] });
  assert.equal(noHash.result.ok, false);
  assert.equal(noHash.result.step, "url-shape");
  const throws = await go({ read: [{ match: /FROM lenders/, error: new Error("canceling statement due to statement timeout") }] });
  assert.equal(throws.result.ok, false);
  assert.equal(throws.result.step, "url-shape");
  assert.match(throws.result.detail, /statement timeout/);
});

/* ---------------- the two blind cases ---------------- */

test("BLIND: not one of 10 different banks answered -> red at fetch (the pulse lost its web link), nothing saved", async () => {
  const urls = banks(10);
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: () => gone() });
  assert.equal(result.ok, false);
  assert.equal(result.step, "fetch");
  assert.match(result.detail, /No bank page answered, not one of 10/);
  assert.deepEqual(rows, [], "our own outage must not be written down as 10 dead banks");
});

test("BLIND: 5 dead out of 5 is not the blind case (too few to tell); a single answer clears it", async () => {
  const urls = banks(10);
  const five = await go({ urls: banks(5), state: banks(5).map((u) => wasGood(u)), http: () => gone() });
  assert.equal(five.result.step, "confirm", "5 dead banks are reported as banks");
  const nine = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[0] ? page() : gone()) });
  assert.equal(nine.result.step, "confirm");
});

test("BLIND: web calls on hold (dry-run fence) -> red at fetch with the reason", async () => {
  const urls = banks(3);
  const { result } = await go({ urls, state: [], http: () => ({ class: "blocked", status: 0, error: "the dry-run fence is holding web calls (ADAPTERS_DRY_RUN)" }) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "fetch");
  assert.match(result.detail, /ADAPTERS_DRY_RUN/);
});

/* ---------------- the query string never leaves ---------------- */

test("PRIVACY: a bank's campaign code (the query string) is in no detail, no row, no evidence, not even when the probe error repeats the address", async () => {
  const urls = [bank(1, "&merchantId=SECRET-M"), bank(2), bank(3)];
  const echo = (url) => new Error(`request to ${url} failed, reason: connect ECONNREFUSED`);
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[0] ? echo(url) : page()) });
  assert.equal(result.ok, false);
  const everything = JSON.stringify({ result, rows });
  assert.ok(!/SECRET|ecid|merchantId|https?:\/\//i.test(everything), everything.slice(0, 600));
  const ok = await go({ urls, state: urls.map((u) => wasGood(u)), http: () => page() });
  assert.ok(!/SECRET|ecid|merchantId|https?:\/\//i.test(JSON.stringify(ok.result)));
});

test("PRIVACY: a page title is kept short and ASCII, and the stored row fits the table's limits", async () => {
  const urls = banks(2);
  const { rows } = await go({ urls, state: [], http: () => ({ status: 404, body: `<title>${"café not found ".repeat(60)}</title>` }) });
  for (const r of rows) {
    assert.ok(r.lastDetail.length <= 300);
    assert.match(r.lastDetail, /^[\x20-\x7e]*$/);
    assert.ok(r.lastStatus >= 0 && r.lastStatus <= 999);
    assert.match(r.urlHash, /^[0-9a-f]{64}$/);
    assert.ok(r.host.length >= 1 && r.host.length <= 255);
  }
});

/* ---------------- it cannot do more than read ---------------- */

test("READ ONLY: only GET goes out, the only SQL is the one SELECT, nothing is refused", async () => {
  const urls = banks(12);
  const { log, result } = await go({ urls, state: urls.map((u) => wasGood(u)), http: (m, url) => (url === urls[3] ? gone() : page()) });
  assert.ok(log.http.length > 0 && log.http.every((c) => c.method === "GET"));
  assert.equal(log.reads.length, 1);
  assert.equal(log.reads[0].sql, beat.SQL_APPLY_URLS);
  assert.deepEqual(log.refused, []);
  assert.equal(result.box, null);
});

test("READ ONLY: our own domain is never an Apply link to read (checked by shape, so no call leaves)", async () => {
  const own = "https://fundhub.ai/apply?x=1";
  const { result, rows, log } = await go({ urls: [own], state: [] });
  assert.equal(result.ok, true);
  assert.equal(rows[0].lastClass, "BAD_URL");
  assert.match(rows[0].lastDetail, /our own site/);
  assert.equal(log.http.length, 0, "no call left the ctx");
  assert.deepEqual(log.refused, []);
});

test("A hop the probe will not follow is SLOW, never a bad link, never red (live calibration: two real banks did this)", async () => {
  const urls = banks(2);
  const refuse = { class: "refused", status: 0, error: "refused: only https is allowed (got http)" };
  const { result, rows } = await go({ urls, state: urls.map((u) => wasGood(u)), http: () => refuse });
  assert.equal(result.ok, true, result.detail);
  assert.ok(rows.every((r) => r.lastClass === "SLOW" && /will not follow/.test(r.lastDetail)));
});

/* ---------------- time ---------------- */

test("TIME: no new read starts after 4 s, a read is given up on at 4.5 s, and the beat finishes well before 12 s", { timeout: 20000 }, async () => {
  const urls = banks(30);
  const hang = () => new Promise(() => {});
  const fake = (answers) => {
    let calls = 0;
    return makeFakeCtx(beat, {
      read: [{ match: /FROM lenders/, rows: sqlRows(urls) }, ...tableStubs()],
      state: { bankLinks: [] },
      http: async () => (++calls <= answers ? page() : hang())
    });
  };
  // Both runs go at once (real clocks): one where the first 3 reads answer and the rest hang, one where nothing answers.
  const some = fake(3);
  const none = fake(0);
  const t0 = Date.now();
  const [a, b] = await Promise.all([runBeat(beat, some), runBeat(beat, none)]);
  const took = Date.now() - t0;
  assert.ok(took >= 4400 && took < 8000, `took ${took} ms`);

  assert.equal(a.ok, true, a.detail);
  // 20 lanes start; the 3 that answer at once start 3 more, which hang; then nothing new starts.
  assert.equal(a.evidence.read, 23, "23 reads started, then no more");
  assert.match(a.detail, /7 not started \(time\)/);
  assert.equal(a.evidence.counts.OK, 3);
  assert.equal(a.evidence.counts.SLOW, 20, "the 20 that hung are SLOW, never red");
  assert.ok(a.evidence.bankLinks.filter((r) => r.lastClass === "SLOW").every((r) => /no answer in 4\.5 s/.test(r.lastDetail)));
  assert.equal(ctxLog(some).http.length, 3, "only the 3 that answered were logged");

  // Nothing answered at all, from 20 different banks: the pulse is blind, not 20 slow banks.
  assert.equal(b.ok, false);
  assert.equal(b.step, "fetch");
  assert.match(b.detail, /No bank page answered, not one of 20/);
});

test("TIME: no second read starts after 6 s, so a slow first phase never runs the beat into its 12 s deadline", { timeout: 20000 }, async () => {
  const urls = banks(21);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let calls = 0;
  // The first 20 reads (all 20 lanes) answer after 3.9 s, call 1 with HARD. A lane that frees at 3.9 s (before the 4 s
  // stop) starts read 21, which answers HARD after 4.4 s (under the 4.5 s limit). The first phase ends near 8.3 s.
  const http = async () => {
    const n = ++calls;
    if (n <= 20) { await sleep(3900); return n === 1 ? gone() : page(); }
    if (n === 21) { await sleep(4400); return gone(); }
    return gone(); // a second read, if one ever started, would come back dead at once
  };
  const t0 = Date.now();
  const { result, rows, log } = await go({ urls, state: urls.map((u) => wasGood(u)), http });
  const took = Date.now() - t0;
  assert.ok(took >= 8000 && took < 11000, `took ${took} ms (the first phase should end near 8.3 s)`);
  assert.equal(calls, 21, "21 first reads and NO second read after 6 s");
  assert.equal(log.http.length, 21);
  assert.equal(result.ok, true, `must not go red at confirm or deadline: ${result.step} ${result.detail}`);
  assert.match(result.detail, /2 broken not confirmed yet/);
  assert.equal(rows.length, 21, "every row learned is kept");
  assert.equal(rows.filter((r) => r.lastClass === "HARD").length, 2, "both dead links are saved HARD, so they stay suspects and are read first next hour");
  assert.equal(result.evidence.confirmed, undefined);
});

/* ---------------- the saved list is empty: first pass, or not loaded? ---------------- */

test("STATE: an empty saved list in an empty table is a true first pass (the table is asked, and answers there with 0 rows)", async () => {
  const urls = banks(3);
  const { result, log } = await go({ urls, state: [], table: { there: true, n: 0 } });
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /first pass/);
  assert.ok(log.reads.some((r) => /to_regclass/.test(r.sql)) && log.reads.some((r) => /FROM pulse_bank_links/.test(r.sql)));
});

test("STATE: the table is not there (migration 475 not applied) -> red at pick, no bank is read", async () => {
  const urls = banks(5);
  const { result, log } = await go({ urls, state: [], table: { there: false } });
  assert.equal(result.ok, false);
  assert.equal(result.step, "pick");
  assert.match(result.detail, /migration 475 is not applied/);
  assert.match(result.detail, /nothing can go red/);
  assert.equal(log.http.length, 0, "no bank page is read when nothing can be saved");
});

test("STATE: the table has rows but the runner handed in none (a failed or slow load) -> red at pick", async () => {
  const urls = banks(5);
  const { result, log } = await go({ urls, state: [], table: { there: true, n: 412 } });
  assert.equal(result.ok, false);
  assert.equal(result.step, "pick");
  assert.match(result.detail, /has 412 rows but the pulse could not load it/);
  assert.equal(log.http.length, 0);
});

test("STATE: the runner says the list did not load (bankLinksLoaded false) -> red at pick, even with some rows in hand", async () => {
  const urls = banks(3);
  const { result, log } = await go({ urls, state: [wasGood(urls[0])], stateExtra: { bankLinksLoaded: false } });
  assert.equal(result.ok, false);
  assert.equal(result.step, "pick");
  assert.match(result.detail, /could not be loaded this hour, so nothing can go red/);
  assert.equal(log.http.length, 0);
});

test("STATE: a loaded saved list never asks about the table (no extra reads on a normal hour)", async () => {
  const urls = banks(3);
  const { result, log } = await go({ urls, state: urls.map((u) => wasGood(u)), stateExtra: { bankLinksLoaded: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(log.reads.map((r) => /to_regclass|pulse_bank_links/.test(r.sql)), [false]);
});

test("STATE: the two table reads are single SELECTs the real read-box allow-list accepts", () => {
  for (const sql of [beat.SQL_STATE_TABLE, beat.SQL_STATE_COUNT]) {
    assert.equal(normalizeQuery(sql, []).text, sql);
    assert.match(sql, /^SELECT /);
  }
});

/* ---------------- what Chris reads on the phone ---------------- */

test("PHONE: after the alert layer cuts and scrubs the detail, the bank host and the class are still there for the first bank", async () => {
  const urls = banks(2);
  const { result } = await go({
    urls,
    state: urls.map((u) => wasGood(u)),
    http: (m, url) => (url === urls[0] ? notFound() : gone())
  });
  assert.equal(result.ok, false);
  const phone = scrubDetail(result.detail, 100);
  assert.match(phone, /^www\.bank[12]\.example\.com (?:BAD_URL 404|HARD no answer) \(lender 00000000\)/, phone);
  assert.ok(!/long value/.test(phone), phone);
  assert.match(beat.fixGuide.split("\n")[0], /Open the bank named in the alert/);
});

test("LIMIT: the fix guide says a green OK means the bank host answered, not that the link id is alive", () => {
  assert.match(beat.fixGuide, /answers 200 for ANY id/);
  assert.match(beat.fixGuide, /OK means the bank host answered with a page, not that the link id is alive/);
});

/* ---------------- the harness is not fooled ---------------- */

test("the rows the runner saves match what records.mjs accepts (camelCase v1 delta 13 shape)", async () => {
  const urls = banks(3);
  const { rows } = await go({ urls, state: [] });
  const keys = new Set(["urlHash", "host", "lenderId", "lenderIds", "lastCheckedAt", "lastGoodAt", "lastClass", "lastStatus", "lastDetail", "finalHost"]);
  for (const r of rows) {
    for (const k of Object.keys(r)) assert.ok(keys.has(k), `unexpected field ${k}`);
    assert.ok(["OK", "WALL", "HARD", "SLOW", "BAD_URL"].includes(r.lastClass));
  }
});
