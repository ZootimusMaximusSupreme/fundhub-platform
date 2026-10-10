// Published partner pages. Fake database and fake web client only. GET only. Nothing is published or changed.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  DEFAULT_BASE_URL,
  NOT_LIVE_MARK,
  PAGE_CAP,
  PAGE_TIMEOUT_MS,
  PUBLISHED_SQL,
  gapChecks,
  pickPages,
  readPage
} from "./gap-partner-pages.mjs";
import { NOT_LIVE_HTML, parsePath } from "../../../netlify/functions/partner-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-partner-pages.mjs"), "utf8");
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";

const pid = (n) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-dddddddddddd`;
const rowsOf = (n, slug = "apply") => Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, partner_id: pid(i + 1), slug }));

function dbWith(rows, seen = []) {
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (rows instanceof Error) throw rows;
      return { rows };
    }
  };
}

/** A fake web client. answers: url -> { status, body } | Error. Records every call. */
function web(answers = {}, fallback = { status: 200, body: "<html><title>Apply</title></html>" }) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: String(init.method || "GET").toUpperCase(), hasSignal: !!init.signal });
    const hit = Object.prototype.hasOwnProperty.call(answers, url) ? answers[url] : fallback;
    if (hit instanceof Error) throw hit;
    return { status: hit.status, text: async () => hit.body ?? "" };
  };
  impl.calls = calls;
  return impl;
}

test("the SQL lists published rows only, reads, and writes nothing", () => {
  assert.match(PUBLISHED_SQL, /pp\.status = 'published'/);
  assert.doesNotMatch(PUBLISHED_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|method:\s*["']POST|method:\s*["']PUT/);
  assert.deepEqual([...CHECK_IDS], ["partner-pages:live"]);
  assert.equal(DEFAULT_BASE_URL, "https://fundhub.ai");
});

test("the miss marker and the address shape are the ones the partner-site function uses", () => {
  assert.ok(NOT_LIVE_HTML.includes(NOT_LIVE_MARK), "the miss page still says the marked words");
  const url = `/sites/${pid(1)}/apply`;
  assert.deepEqual(parsePath(url), { mode: "sites", partnerId: pid(1), slug: "apply" });
});

test("no database, or no web client, is a skip that says why", async () => {
  const noDb = await gapChecks({ fetchImpl: web() });
  assert.equal(noDb[0].status, "skip");
  assert.match(noDb[0].detail, /No database/);
  const noWeb = await gapChecks({ db: dbWith(rowsOf(2)) });
  assert.equal(noWeb[0].status, "skip");
  assert.match(noWeb[0].detail, /No web client/);
});

test("PASS: every published page answers 200, one GET each, to the live address, with a timeout", async () => {
  const fetchImpl = web();
  const seen = [];
  const rows = await gapChecks({ db: dbWith(rowsOf(3), seen), fetchImpl, now: NOW, orgId: ORG });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "partner-pages:live");
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /All 3 published partner pages answer 200/);
  assert.equal(rows[0].suggestedFix, null);
  assert.equal(seen[0].params[0], ORG);
  assert.equal(fetchImpl.calls.length, 3);
  for (const [i, c] of fetchImpl.calls.entries()) {
    assert.equal(c.method, "GET");
    assert.equal(c.url, `https://fundhub.ai/sites/${pid(i + 1)}/apply`);
    assert.equal(c.hasSignal, true, "each read carries a timeout");
  }
  assert.ok(PAGE_TIMEOUT_MS <= 10000);
});

test("FAIL: a published page that answers 404 is red and is named by a short id and its slug", async () => {
  const dead = `https://fundhub.ai/sites/${pid(2)}/apply`;
  const fetchImpl = web({ [dead]: { status: 404, body: NOT_LIVE_HTML } });
  const rows = await gapChecks({ db: dbWith(rowsOf(3)), fetchImpl, now: NOW, orgId: ORG });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /^1 published partner page is not live \(of 3 published\): 00000002…\/apply answered 404/);
  assert.match(rows[0].suggestedFix, /Do not auto-fix/);
  // The full partner id is not in the morning text.
  assert.doesNotMatch(rows[0].detail, new RegExp(pid(2)));
});

test("FAIL: a 200 that is really the not-live page is red too", async () => {
  const url = `https://fundhub.ai/sites/${pid(1)}/apply`;
  const rows = await gapChecks({
    db: dbWith(rowsOf(1)),
    fetchImpl: web({ [url]: { status: 200, body: NOT_LIVE_HTML } }),
    now: NOW
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /answered 200 with the not-live page/);
});

test("FAIL: a 500 and a page that never answers are red, and name which", async () => {
  const a = `https://fundhub.ai/sites/${pid(1)}/apply`;
  const b = `https://fundhub.ai/sites/${pid(2)}/apply`;
  const rows = await gapChecks({
    db: dbWith(rowsOf(2)),
    fetchImpl: web({ [a]: { status: 500, body: "page unavailable" }, [b]: new Error("The operation was aborted due to timeout") }),
    now: NOW
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /^2 published partner pages are not live \(of 2 published\)/);
  assert.match(rows[0].detail, /answered 500/);
  assert.match(rows[0].detail, /did not answer \(The operation was aborted due to timeout\)/);
});

test("FAIL: a row that cannot make a real address is its own failure and no request is made for it", async () => {
  const bad = [{ id: "x", partner_id: "not-a-uuid", slug: "Bad Slug" }, ...rowsOf(1)];
  const fetchImpl = web();
  const rows = await gapChecks({ db: dbWith(bad), fetchImpl, now: NOW });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /cannot be a web address/);
  assert.equal(fetchImpl.calls.length, 1);
});

test("no published page is a PASS that says so (nothing can be dead)", async () => {
  const fetchImpl = web();
  const rows = await gapChecks({ db: dbWith([]), fetchImpl, now: NOW });
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /No partner page is published/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a list that cannot be read is a skip, never a PASS", async () => {
  const rows = await gapChecks({ db: dbWith(new Error("connection terminated")), fetchImpl: web(), now: NOW });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /connection terminated/);
});

test("many pages: at most PAGE_CAP are read in a morning, a different slice each day, and the detail says so", async () => {
  const many = rowsOf(PAGE_CAP + 15);
  const day1 = web();
  const r1 = await gapChecks({ db: dbWith(many), fetchImpl: day1, now: new Date("2026-10-10T13:00:00Z") });
  assert.equal(day1.calls.length, PAGE_CAP);
  assert.equal(r1[0].status, "PASS");
  assert.match(r1[0].detail, new RegExp(`a rotating ${PAGE_CAP} of ${many.length} today`));
  const day2 = web();
  await gapChecks({ db: dbWith(many), fetchImpl: day2, now: new Date("2026-10-11T13:00:00Z") });
  assert.notDeepEqual(day1.calls.map((c) => c.url), day2.calls.map((c) => c.url), "the next day reads a different slice");
  // Across enough days every page is read at least once.
  const seen = new Set();
  for (let d = 0; d < 8; d += 1) {
    for (const row of pickPages(many, new Date(Date.UTC(2026, 9, 10 + d, 13)))) seen.add(row.partner_id);
  }
  assert.equal(seen.size, many.length);
});

test("pickPages returns everything when there are not more than the cap", () => {
  assert.equal(pickPages(rowsOf(5), NOW).length, 5);
  assert.equal(pickPages(rowsOf(PAGE_CAP), NOW).length, PAGE_CAP);
});

test("readPage: ok only for a real 200", async () => {
  const row = { partner_id: pid(1), slug: "apply" };
  assert.deepEqual(await readPage(web(), "https://fundhub.ai", row), { ok: true, why: "" });
  assert.equal((await readPage(web({}, { status: 404, body: "" }), "https://fundhub.ai", row)).ok, false);
  assert.equal((await readPage(web({}, { status: 301, body: "" }), "https://fundhub.ai", row)).ok, false);
});

test("a base url with a trailing slash does not double it, and the reads go through the staff scope", async () => {
  const fetchImpl = web();
  const viaScope = [];
  const viaDb = [];
  await gapChecks({
    db: dbWith(rowsOf(1), viaDb),
    scope: (fn) => fn(dbWith(rowsOf(1), viaScope)),
    fetchImpl,
    baseUrl: "https://fundhub.ai/",
    now: NOW
  });
  assert.equal(fetchImpl.calls[0].url, `https://fundhub.ai/sites/${pid(1)}/apply`);
  assert.equal(viaScope.length, 1);
  assert.equal(viaDb.length, 0);
});
