import test from "node:test";
import assert from "node:assert/strict";

import {
  DAY_MS, SIM_RECEIPT_PREFIX, TEST_CLIENT_EMAIL_RE, addDaysIso, ageOf, clip, count, dollars, etDay, intOf, looksMasked,
  naRow, nowOf, plural, readRow, readRows, request, row, runnerOf, skipWhy, testClientSql, toDate
} from "./money-reads.mjs";
import { SIM_RECEIPT_PREFIX as GP_PREFIX, TEST_CLIENT_EMAIL_RE as GP_RE } from "./gap-payments.mjs";
import { etToday } from "../../finance/money-transfers.mjs";

test("money-reads: a test client is the same person here as in gap-payments", () => {
  assert.equal(TEST_CLIENT_EMAIL_RE, GP_RE);
  assert.equal(SIM_RECEIPT_PREFIX, GP_PREFIX);
  const sql = testClientSql("c.email", "$7");
  assert.match(sql, /COALESCE\(c\.is_demo, false\)/);
  assert.match(sql, /custom_fields ->> 'synthetic'/);
  assert.match(sql, /c\.email, ''\) ~\* \$7::text/);
});

test("money-reads: the test pattern catches test addresses and leaves real ones", () => {
  const re = new RegExp(TEST_CLIENT_EMAIL_RE, "i");
  for (const e of ["a+walk-12@x.com", "b@example.com", "c@host.test", "e2e+run1@fundhub.ai", "demo+x@fundhub.ai"]) assert.ok(re.test(e), e);
  for (const e of ["buyer@gmail.com", "owner@fundhub.ai", "demoman@gmail.com"]) assert.ok(!re.test(e), e);
});

test("money-reads: row and naRow are the shapes the pulse reads", () => {
  assert.deepEqual(row("a", "PASS", "ok"), { id: "a", status: "PASS", detail: "ok", suggestedFix: null });
  assert.deepEqual(naRow("a", "low-traffic", { x: 1 }, "none"), { id: "a", status: "na", detail: "none", suggestedFix: null, na: { code: "low-traffic", args: { x: 1 } } });
});

test("money-reads: counts keep unknown as unknown", () => {
  assert.equal(count(null), null);
  assert.equal(count(""), null);
  assert.equal(count("0"), 0);
  assert.equal(count("x"), null);
  assert.equal(intOf(null), 0);
  assert.equal(intOf("7"), 7);
  assert.equal(plural(1, "move"), "1 move");
  assert.equal(plural(2, "move"), "2 moves");
  assert.equal(plural(2, "press", "presses"), "2 presses");
});

test("money-reads: the New York day and day arithmetic", () => {
  const d = new Date("2026-10-10T03:30:00Z");
  assert.equal(etDay(d), "2026-10-09");
  assert.equal(etDay(d), etToday(d));
  assert.equal(addDaysIso("2026-10-10", -8), "2026-10-02");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(DAY_MS, 86400000);
});

test("money-reads: age words, money words, masks, dates", () => {
  const now = new Date("2026-10-10T18:00:00Z");
  assert.equal(ageOf("2026-10-10T17:30:00Z", now), "30 minutes");
  assert.equal(ageOf("2026-10-10T15:00:00Z", now), "3 hours");
  assert.equal(ageOf("2026-10-07T18:00:00Z", now), "3 days");
  assert.equal(ageOf("2026-10-11T18:00:00Z", now), "a short time");
  assert.equal(dollars(49700), "$497");
  assert.equal(dollars("1234567"), "$12,345.67");
  assert.equal(dollars(null), "an unknown amount");
  assert.equal(dollars(0), "$0");
  assert.equal(dollars("abc"), "an unknown amount");
  assert.equal(looksMasked("****************f3"), true);
  assert.equal(looksMasked("   "), true);
  assert.equal(looksMasked("49700"), false);
  assert.equal(toDate("nope"), null);
  assert.equal(toDate(null), null);
  assert.equal(clip(new Error("a   b\n c"), 4), "a b");
  assert.equal(nowOf({ now: "garbage" }) instanceof Date, true);
});

test("money-reads: the runner is the staff scope first, then the pool, else none", async () => {
  const seen = [];
  const scope = async (fn) => { seen.push("scope"); return fn({ query: async () => ({ rows: [{ n: 1 }] }) }); };
  const db = { query: async () => { seen.push("db"); return { rows: [{ n: 2 }] }; } };
  assert.equal(await runnerOf({ scope, db })((tx) => tx.query("select 1")).then((r) => r.rows[0].n), 1);
  assert.equal(await runnerOf({ db })((tx) => tx.query("select 1")).then((r) => r.rows[0].n), 2);
  assert.equal(runnerOf({}), null);
  assert.deepEqual(seen, ["scope", "db"]);
  assert.match(skipWhy({ run: null, orgId: "o" }, "x"), /no database/);
  assert.match(skipWhy({ run: () => {}, orgId: null }, "x"), /no org id/);
  assert.equal(skipWhy({ run: () => {}, orgId: "o" }, "x"), null);
});

test("money-reads: a read that fails or comes back empty is a skip, never a pass", async () => {
  const good = async (fn) => fn({ query: async () => ({ rows: [{ n: 3 }] }) });
  const empty = async (fn) => fn({ query: async () => ({ rows: [] }) });
  const bad = async () => { throw new Error("statement timeout"); };
  assert.deepEqual((await readRow(good, "id", "things", "select 1")).r, { n: 3 });
  assert.equal((await readRow(empty, "id", "things", "select 1")).skip.status, "skip");
  const b = await readRow(bad, "id", "things", "select 1");
  assert.equal(b.skip.status, "skip");
  assert.match(b.skip.detail, /could not read things: statement timeout/);
  assert.equal((await readRows(good, "id", "things", "select 1")).rows.length, 1);
  assert.equal((await readRows(bad, "id", "things", "select 1")).skip.status, "skip");
});

test("money-reads: request sends GET and HEAD only, with a timeout, and refuses anything else", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, signal: init.signal instanceof AbortSignal, redirect: init.redirect });
    return { status: 200, text: async () => "body" };
  };
  assert.deepEqual(await request(fetchImpl, "GET", "https://x.example.test/a"), { status: 200, text: "body" });
  assert.deepEqual(await request(fetchImpl, "head", "https://x.example.test/b"), { status: 200, text: "" });
  assert.deepEqual(calls.map((c) => [c.method, c.signal, c.redirect]), [["GET", true, "follow"], ["HEAD", true, "follow"]]);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(request(fetchImpl, m, "https://x.example.test"), /only GET or HEAD/);
  }
  assert.equal(calls.length, 2);
});
