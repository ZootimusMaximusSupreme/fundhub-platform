// Tests for the db-health beat. No network, no database: the fake ctx answers only what it is told
// and refuses a query nobody gave an answer to. The SQL itself is proved against the REAL database,
// read only, in beat-db-health.pg.test.mjs (it skips without DATABASE_URL: a skipped pg test is not green)
// and by `node scripts/pulse/run-beat.mjs db-health`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-db-health.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SETTINGS_OK = { ok: true, ms: 40, transaction_read_only: false, default_transaction_read_only: false, in_recovery: false };

/** Run the beat with the good world, changed where the test says. */
async function go({ reads, http, dbSettings, siteUrl } = {}) {
  const ctx = makeFakeCtx(beat, {
    read: reads ?? beat.goodReads(),
    http: http ?? beat.goodHealth(),
    ...(dbSettings !== undefined ? { dbSettings } : {}),
    ...(siteUrl ? { siteUrl } : {})
  });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
}

/** The good reads with one rule swapped (the first rule that matches wins, so the swap goes in front). */
const readsWith = (rule) => [rule, ...beat.goodReads()];
const grantRows = (changes = {}) => beat.GRANT_TABLES.map((name) => {
  const absent = beat.MAY_BE_ABSENT.includes(name);
  return { name, present: !absent, can_insert: absent ? null : true, ...(changes[name] || {}) };
});

test("db-health is a valid beat, passes the static pin and its own self test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-db-health.mjs" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-db-health.mjs"), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal(beat.kind, "infra");
  assert.equal(beat.damp, 1);
  assert.equal(beat.box, false);
  assert.deepEqual(beat.covers, []);
  assert.deepEqual(beat.steps, ["query-ok", "pool-writable", "grants", "health-endpoint", "pool-pressure"]);
});

test("every SQL string the beat sends is a single read the real allow-list accepts", () => {
  for (const sql of [beat.SQL_QUERY_OK, beat.SQL_ROLE, beat.SQL_GRANTS, beat.SQL_PRESSURE]) {
    assert.doesNotThrow(() => assertReadOnlySql(sql), sql);
  }
});

test("the grants list is the ten tables the launch path writes, and only pulse_beats may be absent", () => {
  assert.deepEqual([...beat.GRANT_TABLES], [
    "clients", "events", "messages", "commas_inbox", "webhook_captures",
    "account_magic_links", "payment_links", "transactions", "job_heartbeats", "pulse_beats"
  ]);
  assert.deepEqual([...beat.MAY_BE_ABSENT], ["pulse_beats"]);
});

/* ---------------- PASS ---------------- */

test("PASS: a healthy database -> green, every step ran, the counts are in the words", async () => {
  const { result, log } = await go();
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.deepEqual(result.skipped, []);
  assert.match(result.detail, /pulse_beats not made yet \(skipped\)/);
  assert.match(result.detail, /connections 6 of 60/);
  assert.equal(result.evidence.connections, 6);
  assert.equal(log.reads.length, 4, "SELECT 1, the role, the grants, the connections");
  assert.deepEqual(log.refused, []);
  assert.equal(log.http.length, 1);
  assert.deepEqual([log.http[0].method, log.http[0].host], ["GET", "fundhub.ai"]);
});

test("PASS: the grants read is asked about the app role and the ten tables", async () => {
  const { log } = await go();
  const grants = log.reads.find((r) => /has_table_privilege/.test(r.sql));
  assert.deepEqual(grants.params[0], "fundhub_app");
  assert.deepEqual(grants.params[1], [...beat.GRANT_TABLES]);
  assert.match(grants.sql, /'INSERT'/);
});

test("PASS: pulse_beats made and writable is fine too (after migration 475 ships)", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ pulse_beats: { present: true, can_insert: true } }) }) });
  assert.equal(result.ok, true, result.detail);
  assert.doesNotMatch(result.detail, /not made yet/);
});

test("PASS: it takes three plain pooled samples, not one", async () => {
  let calls = 0;
  const { result } = await go({ dbSettings: async () => { calls++; return SETTINGS_OK; } });
  assert.equal(result.ok, true);
  assert.equal(calls, beat.SAMPLES);
  assert.equal(beat.SAMPLES, 3);
});

/* ---------------- FAIL: query-ok ---------------- */

test("FAIL: the trivial query errors -> red at query-ok, with the code and never the message", async () => {
  const boom = Object.assign(new Error("canceling statement due to statement timeout, host 10.1.2.3 password=hunter2"), { code: "57014" });
  const { result } = await go({ reads: readsWith({ match: /SELECT 1 AS ok/, error: boom }) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "query-ok");
  assert.match(result.detail, /did not answer a trivial query: timed out \(57014\)/);
  assert.doesNotMatch(result.detail, /hunter2|10\.1\.2\.3|canceling/);
});

test("FAIL: the trivial query returns the wrong thing or nothing -> red at query-ok", async () => {
  for (const rows of [[], [{ ok: 2 }], [{ ok: null }]]) {
    const { result } = await go({ reads: readsWith({ match: /SELECT 1 AS ok/, rows }) });
    assert.equal(result.step, "query-ok", JSON.stringify(rows));
    assert.match(result.detail, /wrong answer/);
  }
});

test("FAIL: a slow query is red only when the plain pooled queries were slow or silent too (reads queue behind other beats)", async () => {
  const slow = (extra) => go({
    reads: readsWith({ match: /SELECT 1 AS ok/, fn: async () => { await wait(beat.SLOW_QUERY_MS + 100); return { rows: [{ ok: 1 }] }; } }),
    ...extra
  });
  const [bothSlow, silent, queueOnly] = await Promise.all([
    slow({ dbSettings: { ...SETTINGS_OK, ms: 2500 } }),
    slow({ dbSettings: { ok: false, error: "timed out" } }),
    slow({ dbSettings: { ...SETTINGS_OK, ms: 60 } })
  ]);
  assert.equal(bothSlow.result.ok, false);
  assert.equal(bothSlow.result.step, "query-ok");
  assert.match(bothSlow.result.detail, /took 1[67]\d\d ms \(limit 1500\), and a plain pooled query took 2500 ms/);

  assert.equal(silent.result.step, "query-ok");
  assert.match(silent.result.detail, /plain pooled query did not answer/);

  assert.equal(queueOnly.result.ok, true, "a slow read with fast plain queries is the read queue, not the database");
  assert.match(queueOnly.result.detail, /read took \d+ ms behind other beats' reads; plain query took 60 ms/);
});

test("PASS: a query just under the limit is green and asks for no cross-check", async () => {
  let calls = 0;
  const { result } = await go({
    reads: readsWith({ match: /SELECT 1 AS ok/, fn: async () => { await wait(50); return { rows: [{ ok: 1 }] }; } }),
    dbSettings: async () => { calls++; return SETTINGS_OK; }
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 3, "the samples run anyway for pool-writable, but they do not decide query-ok");
});

/* ---------------- FAIL: pool-writable ---------------- */

test("FAIL: a pooled connection that is read-only -> red at pool-writable, for each way it can show", async () => {
  const cases = [
    [{ transaction_read_only: true }, /transaction_read_only is on/],
    [{ default_transaction_read_only: true }, /default_transaction_read_only is on/],
    [{ in_recovery: true }, /in recovery \(a replica\)/],
    [{ transaction_read_only: null }, /could not be read/]
  ];
  for (const [over, re] of cases) {
    const { result } = await go({ dbSettings: { ...over } });
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(result.step, "pool-writable", JSON.stringify(over));
    assert.match(result.detail, re);
    assert.match(result.detail, /3 of 3 samples/);
    assert.match(result.detail, /Saves will fail/);
  }
});

test("FAIL: ONE stuck sample out of three is enough (the pooler hands out different connections)", async () => {
  let n = 0;
  const { result } = await go({ dbSettings: async () => (++n === 2 ? { ...SETTINGS_OK, transaction_read_only: true } : SETTINGS_OK) });
  assert.equal(result.step, "pool-writable");
  assert.match(result.detail, /1 of 3 samples/);
});

test("FAIL: no plain pooled query answers at all -> red at pool-writable (it could not be checked)", async () => {
  const { result } = await go({ dbSettings: { ok: false, error: "no pool" } });
  assert.equal(result.step, "pool-writable");
  assert.match(result.detail, /no plain pooled query answered/);
  const thrown = await go({ dbSettings: async () => { throw new Error("pool exploded"); } });
  assert.equal(thrown.result.step, "pool-writable");
});

test("PASS: one sample that fails to answer, with the rest writable, stays green", async () => {
  let n = 0;
  const { result } = await go({ dbSettings: async () => (++n === 1 ? { ok: false } : SETTINGS_OK) });
  assert.equal(result.ok, true, result.detail);
});

/* ---------------- FAIL: grants ---------------- */

test("FAIL: the app role cannot INSERT into a table -> red at grants, naming only table names", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ messages: { can_insert: false }, transactions: { can_insert: false } }) }) });
  assert.equal(result.ok, false);
  assert.equal(result.step, "grants");
  assert.equal(result.detail, "fundhub_app cannot INSERT into: messages, transactions");
});

test("FAIL: a required table is gone -> red at grants", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ commas_inbox: { present: false, can_insert: null } }) }) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /table missing: commas_inbox/);
});

test("FAIL: the query returned fewer rows than tables asked about -> the missing ones count as gone", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows().filter((r) => r.name !== "events") }) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /table missing: events/);
});

test("FAIL: pulse_beats exists but the app cannot INSERT into it -> red (only ABSENT is forgiven)", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ pulse_beats: { present: true, can_insert: false } }) }) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /cannot INSERT into: pulse_beats/);
});

test("FAIL: both a lost right and a gone table are in one detail", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ clients: { can_insert: false }, events: { present: false, can_insert: null } }) }) });
  assert.equal(result.detail, "fundhub_app cannot INSERT into: clients. table missing: events");
});

test("FAIL: the app role itself is not in the database -> red at grants, and the grants query is not run", async () => {
  const { result, log } = await go({ reads: readsWith({ match: /FROM pg_roles/, rows: [{ present: false }] }) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /app role fundhub_app is not in the database/);
  assert.equal(log.reads.some((r) => /has_table_privilege/.test(r.sql)), false);
});

test("FAIL: the grants read errors -> red at grants with the code", async () => {
  const { result } = await go({ reads: readsWith({ match: /has_table_privilege/, error: Object.assign(new Error("relation secret_internal_name"), { code: "42P01" }) }) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /could not be read: error 42P01/);
  assert.doesNotMatch(result.detail, /secret_internal_name/);
});

/* ---------------- FAIL: health-endpoint ---------------- */

test("FAIL: the health door -> red at health-endpoint (503, not ok, pending, no answer, not JSON)", async () => {
  const url = "GET https://fundhub.ai/api/health?strict=1";
  const cases = [
    [{ status: 503, body: "{}" }, /answered 503, wanted 200/],
    [{ status: 404, body: "" }, /answered 404, wanted 200/],
    [{ status: 200, body: JSON.stringify({ ok: false, state: "down", pending: 0 }) }, /ok false, state down, pending 0/],
    [{ status: 200, body: JSON.stringify({ ok: true, state: "up", pending: 3 }) }, /ok true, state up, pending 3/],
    [{ status: 200, body: "<html>maintenance SECRET-BODY</html>" }, /not the health answer/],
    [{ status: 0, ok: false, class: "timeout", error: "x" }, /got no answer \(timeout\)/]
  ];
  for (const [answer, re] of cases) {
    const { result } = await go({ http: { [url]: answer } });
    assert.equal(result.ok, false);
    assert.equal(result.step, "health-endpoint");
    assert.match(result.detail, re);
    assert.doesNotMatch(result.detail, /SECRET-BODY/);
  }
});

test("FAIL: no https site address -> red at health-endpoint and nothing is called", async () => {
  const { result, log } = await go({ siteUrl: "http://fundhub.ai" });
  assert.equal(result.step, "health-endpoint");
  assert.equal(log.http.length, 0);
});

/* ---------------- pool-pressure ---------------- */

const pressure = (used, limit) => readsWith({ match: /FROM pg_stat_activity/, rows: [{ used_conn: used, limit_conn: limit }] });

test("pool-pressure: red only ABOVE 90 percent of max_connections", async () => {
  const at90 = await go({ reads: pressure("54", 60) });
  assert.equal(at90.result.ok, true, "exactly 90 percent is not above 90");
  const over = await go({ reads: pressure("55", 60) });
  assert.equal(over.result.ok, false);
  assert.equal(over.result.step, "pool-pressure");
  assert.match(over.result.detail, /55 of 60 database connections are in use \(92 percent, limit 90\)/);
  const full = await go({ reads: pressure(60, 60) });
  assert.equal(full.result.step, "pool-pressure");
  const quiet = await go({ reads: pressure("0", 60) });
  assert.equal(quiet.result.ok, true);
});

test("pool-pressure: a role that may not look -> the step is SKIPPED, never red", async () => {
  const denied = await go({ reads: readsWith({ match: /FROM pg_stat_activity/, error: Object.assign(new Error("permission denied for view pg_stat_activity"), { code: "42501" }) }) });
  assert.equal(denied.result.ok, true, denied.result.detail);
  assert.deepEqual(denied.result.skipped, ["pool-pressure"]);
  assert.match(denied.result.detail, /pool-pressure skipped/);
  const other = await go({ reads: readsWith({ match: /FROM pg_stat_activity/, error: Object.assign(new Error("x"), { code: "XX000" }) }) });
  assert.deepEqual(other.result.skipped, ["pool-pressure"]);
  const empty = await go({ reads: readsWith({ match: /FROM pg_stat_activity/, rows: [{}] }) });
  assert.deepEqual(empty.result.skipped, ["pool-pressure"]);
  const zeroLimit = await go({ reads: pressure("5", 0) });
  assert.deepEqual(zeroLimit.result.skipped, ["pool-pressure"]);
});

/* ---------------- the harness is not blind ---------------- */

test("MUTATION: each step goes red on its own break, at its own name", async () => {
  const breaks = {
    "query-ok": { reads: readsWith({ match: /SELECT 1 AS ok/, error: new Error("down") }) },
    "pool-writable": { dbSettings: { transaction_read_only: true } },
    grants: { reads: readsWith({ match: /has_table_privilege/, rows: grantRows({ events: { can_insert: false } }) }) },
    "health-endpoint": { http: { "GET https://fundhub.ai/api/health?strict=1": { status: 500, body: "" } } },
    "pool-pressure": { reads: pressure(59, 60) }
  };
  assert.deepEqual(Object.keys(breaks), beat.steps);
  for (const [step, world] of Object.entries(breaks)) {
    const { result } = await go(world);
    assert.equal(result.ok, false, `${step} stayed green`);
    assert.equal(result.step, step);
  }
});

test("a query nobody gave an answer to fails loudly, it is never answered with a guess", async () => {
  const { result } = await go({ reads: [{ match: /SELECT 1 AS ok/, rows: [{ ok: 1 }] }] });
  assert.equal(result.ok, false);
  assert.equal(result.step, "grants");
});

test("it reads, it does not write: no read the beat sends is anything but a SELECT", async () => {
  const { log } = await go();
  for (const r of log.reads) assert.match(r.sql, /^SELECT /);
});

test("the self test: pass is green at every declared step, fail is red at a declared step", async () => {
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(pass.ok, true, pass.detail);
  assert.deepEqual(pass.notRun, []);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "pool-writable");
  assert.ok(beat.steps.includes(fail.step));
});

test("pool-pressure counts sessions by datid, never by backend_type (the app role cannot see other roles' backend_type)", () => {
  assert.match(beat.SQL_PRESSURE, /FILTER \(WHERE datid IS NOT NULL\) AS used_conn/);
  assert.doesNotMatch(beat.SQL_PRESSURE, /backend_type\s*=/);
});
