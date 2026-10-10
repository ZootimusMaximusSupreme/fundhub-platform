// Run receipts on a REAL Postgres: migration 478, the two write statements, the grants, the switch-off,
// and the runs read (RUNS_SQL) that the morning wf: rows depend on.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL. A SKIPPED PG TEST IS NOT GREEN. ***
// It runs in CI (.github/workflows/tests.yml builds a throwaway Postgres on 127.0.0.1 from db/migrations
// with db/migrate.mjs and sets DATABASE_URL).
//
// WHY IT EXISTS. run-evidence.test.mjs and workflow-runs.test.mjs hand the code a FAKE database that matches on
// SQL text. That proves the wording and the control flow. It cannot show that the migration applies, that the
// app role may write and may not delete, that a REVOKE makes a write fail with 42501, that the upsert leaves one
// row, or that the runs read picks the right run / miss / meta rows. This file shows each of those.
//
// TWO PARTS, AND HOW EACH STAYS HARMLESS
//   Part 1  RUNS_SQL with made-up rows. READ ONLY by construction: every scenario is BEGIN READ ONLY ... ROLLBACK,
//           and `events` and `workflow_runs` are shadowed by CTEs that hold ONLY the made-up rows, so no real row is
//           read or written. Safe on any database, the same on an empty scratch database as on production.
//           Before migration 478 is applied (production, until the ship) the one privilege probe in the SQL
//           (has_table_privilege on workflow_runs) is pointed at job_heartbeats so the rest can still run.
//   Part 2  migration 478 and the writes. Needs the real tables, so it writes, and therefore it REFUSES any host that
//           is not loopback (127.0.0.1, localhost, ::1). Every test runs inside one transaction that is always
//           rolled back (a REVOKE is rolled back too), so nothing is left behind. Writes are made as fundhub_app
//           (SET LOCAL ROLE), the unprivileged role production uses, so the grants and row security really apply.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, close } from "../db.mjs";
import { RUNS_SQL, RECORDER_FUNCTION_ID } from "./workflow-runs.mjs";
import { FINISH_SQL, START_SQL, createRunEvidence } from "./run-evidence.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const HOST = (() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })();
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(HOST);
const SKIP_READ = HAS_DB ? false : "no DATABASE_URL (this runs in CI; a skipped pg test is not green)";
const SKIP_WRITE = !HAS_DB
  ? "no DATABASE_URL (this runs in CI; a skipped pg test is not green)"
  : !LOOPBACK
    ? `DATABASE_URL host "${HOST}" is not loopback. Part 2 writes rows (rolled back); it will not run against a shared database.`
    : false;

const TAG = crypto.randomBytes(3).toString("hex");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const uuid = () => crypto.randomUUID();

/* ═════ shared helpers ═════ */

const EVENTS_SHADOW = "events AS (SELECT * FROM jsonb_to_recordset($9::jsonb) AS x(id uuid, org_id uuid, name text, payload jsonb, created_at timestamptz))";
const RUNS_SHADOW = "workflow_runs AS (SELECT * FROM jsonb_to_recordset($10::jsonb) AS x(run_id text, attempt int, function_id text, event_name text, bus_event_id text, max_attempts int, started_at timestamptz, finished_at timestamptz, outcome text, \"final\" boolean, skipped boolean, note text, error text))";

/** RUNS_SQL with `events` (and, for Part 1, `workflow_runs`) put in front as CTEs that hold only the made-up rows. */
function shadowed({ runs, probeTable }) {
  assert.match(RUNS_SQL, /^\s*WITH\s+began AS/, "RUNS_SQL still starts with the began CTE");
  const rest = RUNS_SQL.replace(/^\s*WITH\s+/, "");
  let text = `WITH ${[EVENTS_SHADOW, runs ? RUNS_SHADOW : null].filter(Boolean).join(",\n")},\n${rest}`;
  if (probeTable) text = text.replace(/'public\.workflow_runs'/g, `'public.${probeTable}'`);
  return text;
}

/** The eight read parameters for the made-up window: the NOW of this file. */
function readParams(fnIds, names) {
  return [fnIds, names, at(3 * DAY), at(15 * MIN), at(30 * DAY), at(30 * DAY), 60, 25];
}

/* ═════ Part 1: the runs read, with made-up rows (read only) ═════ */

describe("RUNS_SQL on a real Postgres, with made-up rows (read only)", { skip: SKIP_READ }, () => {
  const ORG = uuid();
  const OTHER_ORG = uuid();
  let probeTable = null;

  before(async () => {
    const t = (await pool().query("SELECT to_regclass('public.workflow_runs') AS t")).rows[0].t;
    probeTable = t ? null : "job_heartbeats";
  });
  after(async () => { await close(); });

  /** Run RUNS_SQL inside BEGIN READ ONLY ... ROLLBACK. Returns the rows by kind. */
  async function read({ fnIds = ["f-cap"], names = ["entry.captured"], events = [], runs = [], marker = true }) {
    const c = await pool().connect();
    try {
      await c.query("BEGIN READ ONLY");
      await c.query("SET LOCAL statement_timeout = '20s'");
      const all = marker
        ? [{ run_id: "receipts-began", attempt: 0, function_id: RECORDER_FUNCTION_ID, started_at: at(3 * DAY), finished_at: at(3 * DAY), outcome: "ok", final: true, skipped: false }, ...runs]
        : runs;
      const res = await c.query(shadowed({ runs: true, probeTable }), [...readParams(fnIds, names), JSON.stringify(events), JSON.stringify(all)]);
      return {
        run: res.rows.filter((r) => r.kind === "run"),
        miss: res.rows.filter((r) => r.kind === "miss"),
        meta: res.rows.filter((r) => r.kind === "meta")
      };
    } finally {
      try { await c.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
      c.release();
    }
  }

  const post = (name, msAgo, over = {}) => ({
    id: uuid(),
    org_id: over.org || ORG,
    name,
    payload: "payload" in over ? over.payload : { email: over.email ?? "maria@example.com", funnel: over.funnel ?? "apply" },
    created_at: at(msAgo)
  });
  const runFor = (e, fn = "f-cap", over = {}) => ({
    run_id: `run-${e.id.slice(0, 8)}`, attempt: 0, function_id: fn, event_name: e.name, bus_event_id: e.id,
    max_attempts: 4, started_at: e.created_at, finished_at: e.created_at, outcome: "ok", final: true, skipped: false, ...over
  });
  const missN = (r) => r.miss.reduce((sum, m) => sum + Number(m.n), 0);

  test("the harness is read only: a write is refused by the database", async () => {
    const c = await pool().connect();
    try {
      await c.query("BEGIN READ ONLY");
      await assert.rejects(c.query("CREATE TEMP TABLE run_evidence_pg_probe (x int)"), /read-only transaction/);
    } finally {
      try { await c.query("ROLLBACK"); } catch { /* nothing to undo */ }
      c.release();
    }
  });

  /* ── the miss rows: an event that no run of the workflow carries ── */

  test("miss RED: a first funnel post with no run behind it is counted, with its time", async () => {
    const e = post("entry.captured", 2 * HOUR);
    const r = await read({ events: [e] });
    assert.equal(r.miss.length, 1);
    assert.equal(r.miss[0].function_id, "f-cap");
    assert.equal(r.miss[0].event_name, "entry.captured");
    assert.equal(Number(r.miss[0].n), 1);
    assert.equal(r.miss[0].at.toISOString(), e.created_at);
  });

  test("miss GREEN: the same post with a run that carries its id is not counted", async () => {
    const e = post("entry.captured", 2 * HOUR);
    assert.equal(missN(await read({ events: [e], runs: [runFor(e)] })), 0);
  });

  test("miss GREEN: a repeat post (same org, name, address and funnel, earlier, inside six hours) is not counted", async () => {
    const first = post("entry.captured", 3 * HOUR);
    const repeat = post("entry.captured", 2 * HOUR);
    const r = await read({ events: [first, repeat], runs: [runFor(first)] });
    assert.equal(missN(r), 0, "the app stored the repeat and started no run on purpose");
    // survey.submitted is the other name the adapter suppresses
    const s1 = post("survey.submitted", 3 * HOUR);
    const s2 = post("survey.submitted", 2 * HOUR);
    assert.equal(missN(await read({ fnIds: ["f-svy"], names: ["survey.submitted"], events: [s1, s2], runs: [runFor(s1, "f-svy")] })), 0);
  });

  test("miss RED: the first post still counts when the repeat is not counted (one miss, and it is the first)", async () => {
    const first = post("entry.captured", 3 * HOUR);
    const repeat = post("entry.captured", 2 * HOUR);
    const r = await read({ events: [first, repeat] });
    assert.equal(missN(r), 1);
    assert.equal(r.miss[0].at.toISOString(), first.created_at);
    assert.equal(r.miss[0].finished_at.toISOString(), first.created_at, "the last counted miss is the first post too");
  });

  test("miss RED: an earlier post OUTSIDE six hours does not make the next one a repeat", async () => {
    const old = post("entry.captured", 8 * HOUR);
    const next = post("entry.captured", 1 * HOUR);
    const r = await read({ events: [old, next], runs: [runFor(old)] });
    assert.equal(missN(r), 1);
    assert.equal(r.miss[0].at.toISOString(), next.created_at);
  });

  test("miss RED: a different address, a different funnel and a different company are each their own first post", async () => {
    const base = post("entry.captured", 3 * HOUR);
    for (const other of [
      post("entry.captured", 2 * HOUR, { email: "someone.else@example.com" }),
      post("entry.captured", 2 * HOUR, { funnel: "booking" }),
      post("entry.captured", 2 * HOUR, { org: OTHER_ORG })
    ]) {
      const r = await read({ events: [base, other], runs: [runFor(base)] });
      assert.equal(missN(r), 1, JSON.stringify(other.payload));
    }
  });

  test("miss GREEN: the address is matched without regard to case; RED: a post with no address is never a repeat", async () => {
    const first = post("entry.captured", 3 * HOUR, { email: "Maria@Example.com" });
    const repeat = post("entry.captured", 2 * HOUR, { email: "maria@example.COM" });
    assert.equal(missN(await read({ events: [first, repeat], runs: [runFor(first)] })), 0);
    const a = post("entry.captured", 3 * HOUR, { payload: { funnel: "apply" } });
    const b = post("entry.captured", 2 * HOUR, { payload: { funnel: "apply" } });
    assert.equal(missN(await read({ events: [a, b] })), 2, "no address: both count");
  });

  test("miss RED: a name the adapter does not suppress is never a repeat (payment.received twice, no runs)", async () => {
    const a = post("payment.received", 3 * HOUR);
    const b = post("payment.received", 2 * HOUR);
    const r = await read({ fnIds: ["f-pay"], names: ["payment.received"], events: [a, b] });
    assert.equal(missN(r), 2);
  });

  test("miss GREEN: a chain of repeats inside six hours of each other is one first post and its repeats", async () => {
    const a = post("entry.captured", 14 * HOUR);
    const b = post("entry.captured", 9 * HOUR);
    const c = post("entry.captured", 4 * HOUR);
    // b is 5 hours after a (a repeat); c is 5 hours after b (a repeat of b). Only a started a run.
    const r = await read({ events: [a, b, c], runs: [runFor(a)] });
    assert.equal(missN(r), 0);
  });

  test("miss GREEN: an event under 15 minutes old, and one from before receipts began plus an hour, are not judged yet", async () => {
    const young = post("entry.captured", 5 * MIN);
    const early = post("entry.captured", 3 * DAY - 30 * MIN);
    assert.equal(missN(await read({ events: [young, early] })), 0);
  });

  test("miss: a run of ANOTHER workflow does not cover the event; nothing is read when receipts have no marker", async () => {
    const e = post("entry.captured", 2 * HOUR);
    const other = runFor(e, "f-other");
    assert.equal(missN(await read({ events: [e], runs: [other] })), 1);
    assert.equal(missN(await read({ events: [e], marker: false })), 0);
    const noMarker = await read({ events: [e], marker: false });
    assert.equal(noMarker.meta[0].at, null, "no marker: the meta row says receipts have not begun");
  });

  /* ── the run rows ── */

  test("run: a start-only sleeper comes back open, with its start time", async () => {
    const r = await read({ runs: [{ run_id: "sleeper", attempt: 0, function_id: "f-cap", event_name: "entry.captured", started_at: at(2 * HOUR), final: false, skipped: false }] });
    assert.equal(r.run.length, 1);
    assert.equal(r.run[0].run_id, "sleeper");
    assert.equal(r.run[0].finished_at, null);
    assert.equal(r.run[0].outcome, null);
    assert.equal(r.run[0].at.toISOString(), at(2 * HOUR));
  });

  test("run: a non-final error followed by an ok attempt comes back as the ok attempt; the first start time is kept", async () => {
    const r = await read({ runs: [
      { run_id: "retried", attempt: 0, function_id: "f-cap", started_at: at(3 * HOUR), finished_at: at(3 * HOUR - 5000), outcome: "error", final: false, skipped: false, error: "timeout" },
      { run_id: "retried", attempt: 1, function_id: "f-cap", started_at: at(2 * HOUR), finished_at: at(2 * HOUR - 5000), outcome: "ok", final: true, skipped: false }
    ] });
    assert.equal(r.run.length, 1);
    assert.equal(r.run[0].attempt, 1);
    assert.equal(r.run[0].outcome, "ok");
    assert.equal(r.run[0].at.toISOString(), at(3 * HOUR), "the run began with its first attempt");
  });

  test("run: a failed attempt followed by a retry that is still open comes back as the failed attempt (a retry is coming)", async () => {
    const r = await read({ runs: [
      { run_id: "retrying", attempt: 0, function_id: "f-cap", started_at: at(3 * HOUR), finished_at: at(3 * HOUR - 5000), outcome: "error", final: false, skipped: false, error: "timeout" },
      { run_id: "retrying", attempt: 1, function_id: "f-cap", started_at: at(2 * HOUR), skipped: false, final: false }
    ] });
    assert.equal(r.run.length, 1);
    assert.equal(r.run[0].outcome, "error");
    assert.equal(r.run[0].final, false);
  });

  test("run: the marker row is never a workflow; other workflows and old runs are left out; at most 25 per workflow, newest first", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      run_id: `many-${i}`, attempt: 0, function_id: "f-cap", started_at: at((i + 1) * HOUR), finished_at: at((i + 1) * HOUR - 1000), outcome: "ok", final: true, skipped: false
    }));
    const noise = [
      { run_id: "elsewhere", attempt: 0, function_id: "f-not-asked", started_at: at(HOUR), finished_at: at(HOUR - 1000), outcome: "ok", final: true, skipped: false },
      { run_id: "ancient", attempt: 0, function_id: "f-cap", started_at: at(40 * DAY), finished_at: at(40 * DAY - 1000), outcome: "ok", final: true, skipped: false }
    ];
    const r = await read({ runs: [...many, ...noise] });
    assert.equal(r.run.length, 25);
    assert.ok(!r.run.some((x) => x.function_id === RECORDER_FUNCTION_ID || x.function_id === "f-not-asked" || x.run_id === "ancient"));
    // The newest 25 (many-0 is the newest). The rows come back in no promised order, so compare as a set.
    assert.deepEqual(r.run.map((x) => x.run_id).sort(), Array.from({ length: 25 }, (_, i) => `many-${i}`).sort());
  });

  test("run: an unfinished run older than the runs window but newer than the open window is still shown", async () => {
    const c = await pool().connect();
    try {
      await c.query("BEGIN READ ONLY");
      const params = readParams(["f-cap"], ["entry.captured"]);
      params[4] = at(30 * DAY);
      params[5] = at(200 * DAY);
      const sleeper = { run_id: "long-sleeper", attempt: 0, function_id: "f-cap", started_at: at(100 * DAY), final: false, skipped: false };
      const done = { run_id: "long-done", attempt: 0, function_id: "f-cap", started_at: at(100 * DAY), finished_at: at(100 * DAY - 1000), outcome: "ok", final: true, skipped: false };
      const res = await c.query(shadowed({ runs: true, probeTable }), [...params, "[]", JSON.stringify([sleeper, done])]);
      assert.deepEqual(res.rows.filter((r) => r.kind === "run").map((r) => r.run_id), ["long-sleeper"]);
    } finally {
      try { await c.query("ROLLBACK"); } catch { /* nothing to undo */ }
      c.release();
    }
  });

  /* ── the meta row ── */

  test("meta: when receipts began, the newest receipt time of any workflow, and one row only", async () => {
    const open = { run_id: "m-open", attempt: 0, function_id: "f-cap", started_at: at(2 * HOUR), final: false, skipped: false };
    const done = { run_id: "m-done", attempt: 0, function_id: "f-cap", started_at: at(5 * HOUR), finished_at: at(5 * HOUR - 1000), outcome: "ok", final: true, skipped: false };
    const r = await read({ runs: [open, done] });
    assert.equal(r.meta.length, 1);
    assert.equal(r.meta[0].at.toISOString(), at(3 * DAY), "the marker's start time");
    assert.equal(r.meta[0].finished_at.toISOString(), at(2 * HOUR), "the open run's start is the newest receipt");
    assert.ok([0, 1].includes(Number(r.meta[0].n)), "n is the privilege flag");
    // Nothing but the marker: no receipt of any workflow yet.
    const empty = await read({});
    assert.equal(empty.meta[0].finished_at, null);
  });
});

/* ═════ Part 2: migration 478 and the writes (loopback only, always rolled back) ═════ */

describe("migration 478 and the receipt writes on a real Postgres (rolled back)", { skip: SKIP_WRITE }, () => {
  let appRoleExists = false;
  before(async () => {
    appRoleExists = (await pool().query("SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'")).rowCount > 0;
  });
  after(async () => { await close(); });

  /** One transaction, always rolled back. `asApp` switches to the unprivileged role AFTER any owner-only setup. */
  async function inTxn(fn) {
    const c = await pool().connect();
    try {
      await c.query("BEGIN");
      return await fn(c);
    } finally {
      try { await c.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
      c.release();
    }
  }
  const asApp = (c) => c.query("SET LOCAL ROLE fundhub_app");
  /** The shape run-evidence.mjs wants, over one client, with a savepoint around each call so a refused write
      does not poison the transaction. */
  const dbOver = (c) => ({
    async query(cfg) {
      await c.query("SAVEPOINT rw");
      try {
        const res = await c.query(cfg);
        await c.query("RELEASE SAVEPOINT rw");
        return res;
      } catch (err) {
        await c.query("ROLLBACK TO SAVEPOINT rw");
        throw err;
      }
    }
  });
  const rowsOf = async (c, runId) => (await c.query("SELECT * FROM workflow_runs WHERE run_id = $1 ORDER BY attempt", [runId])).rows;
  const fnId = `zz-pg-probe-${TAG}`;
  const fakeFn = () => ({ opts: { id: fnId, triggers: [{ event: "round.started" }] } });
  const ctxFor = (runId, over = {}) => ({ event: { name: "round.started", data: { id: uuid() } }, runId, attempt: 0, maxAttempts: 4, ...over });

  test("478 is applied: the table, the marker row, both indexes, row security (on and forced) and the policy", async () => {
    const r = await pool().query(`
      SELECT c.relrowsecurity AS on_, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'workflow_runs' AND p.policyname = 'workflow_runs_app_all') AS policies,
             (SELECT count(*)::int FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = 'workflow_runs'
                 AND i.indexname IN ('workflow_runs_function_started_idx', 'workflow_runs_bus_event_idx', 'workflow_runs_pk')) AS indexes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'workflow_runs'`);
    assert.equal(r.rows.length, 1, "the table workflow_runs exists");
    assert.deepEqual(r.rows[0], { on_: true, forced: true, policies: 1, indexes: 3 });
    const marker = await pool().query("SELECT run_id, outcome, \"final\" FROM workflow_runs WHERE function_id = $1", [RECORDER_FUNCTION_ID]);
    assert.deepEqual(marker.rows, [{ run_id: "receipts-began", outcome: "ok", final: true }], "exactly one marker row");
  });

  test("grants: the app may SELECT, INSERT and UPDATE; it may not DELETE or TRUNCATE; the public web keys can do nothing", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    const can = async (role, priv) => (await pool().query("SELECT has_table_privilege($1, 'public.workflow_runs', $2) AS v", [role, priv])).rows[0].v;
    for (const [priv, want] of Object.entries({ SELECT: true, INSERT: true, UPDATE: true, DELETE: false, TRUNCATE: false })) {
      assert.equal(await can("fundhub_app", priv), want, `fundhub_app ${priv}`);
    }
    for (const role of ["anon", "authenticated"]) {
      if ((await pool().query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount === 0) continue;
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) assert.equal(await can(role, priv), false, `${role} ${priv}`);
    }
  });

  test("as the app role: START then FINISH leave one row with the right fields, and FINISH twice still leaves one row", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    await inTxn(async (c) => {
      await asApp(c);
      const lines = [];
      const { hooks } = createRunEvidence({ getDb: () => dbOver(c), log: (l) => lines.push(l) });
      const runId = `run-${TAG}-1`;
      const bus = uuid();
      const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: ctxFor(runId, { event: { name: "round.started", data: { id: bus } } }), steps: [] });
      let rows = await rowsOf(c, runId);
      assert.equal(rows.length, 1, "the start mark");
      assert.equal(rows[0].finished_at, null);
      assert.equal(rows[0].outcome, null);
      assert.deepEqual([rows[0].function_id, rows[0].event_name, rows[0].bus_event_id, rows[0].max_attempts, rows[0].attempt], [fnId, "round.started", bus, 4, 0]);
      await hook.finished({ result: { data: { skipped: true, reason: "switched_off" } } });
      rows = await rowsOf(c, runId);
      assert.equal(rows.length, 1, "the finish mark fills in the same row");
      assert.deepEqual([rows[0].outcome, rows[0].final, rows[0].skipped, rows[0].note, rows[0].error], ["ok", true, true, "switched_off", null]);
      assert.ok(rows[0].finished_at);
      // FINISH again with another answer: still one row, now the second answer.
      await hook.finished({ result: { error: new Error("boom") } });
      rows = await rowsOf(c, runId);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].outcome, rows[0].final, rows[0].skipped, rows[0].note, rows[0].error], ["error", false, false, null, "boom"]);
      // START again, later: ON CONFLICT DO NOTHING changes nothing.
      const earlier = rows[0];
      await dbOver(c).query({ text: START_SQL, values: [runId, 0, fnId, "round.started", bus, 4, new Date(Date.now() + HOUR)] });
      const later = (await rowsOf(c, runId))[0];
      assert.equal(later.started_at.getTime(), earlier.started_at.getTime());
      assert.equal(later.outcome, "error");
      assert.deepEqual(lines, [], "nothing went wrong, so nothing was logged");
    });
  });

  test("as the app role: a second attempt is its own row, and the same attempt is never two", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    await inTxn(async (c) => {
      await asApp(c);
      const { hooks } = createRunEvidence({ getDb: () => dbOver(c), log: () => {} });
      const runId = `run-${TAG}-2`;
      const a0 = await hooks.onFunctionRun({ fn: fakeFn(), ctx: ctxFor(runId, { attempt: 0 }), steps: [] });
      await a0.finished({ result: { error: new Error("first try") } });
      const { hooks: other } = createRunEvidence({ getDb: () => dbOver(c), log: () => {} }); // a second container
      const a1 = await other.onFunctionRun({ fn: fakeFn(), ctx: ctxFor(runId, { attempt: 1 }), steps: [{ id: "a" }] });
      await a1.finished({ result: { data: { done: true } } });
      const rows = await rowsOf(c, runId);
      assert.deepEqual(rows.map((r) => [r.attempt, r.outcome, r.final]), [[0, "error", false], [1, "ok", true]]);
    });
  });

  test("as the app role: DELETE and TRUNCATE are refused (42501), and a bad row is refused by its CHECK", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    await inTxn(async (c) => {
      const runId = `run-${TAG}-3`;
      await c.query("INSERT INTO workflow_runs (run_id, attempt, function_id) VALUES ($1, 0, $2)", [runId, fnId]);
      await asApp(c);
      for (const sql of ["DELETE FROM workflow_runs WHERE run_id = $1", "TRUNCATE workflow_runs"]) {
        await c.query("SAVEPOINT d");
        await assert.rejects(c.query(sql, sql.startsWith("DELETE") ? [runId] : []), (e) => e.code === "42501");
        await c.query("ROLLBACK TO SAVEPOINT d");
      }
      assert.equal((await rowsOf(c, runId)).length, 1, "the row is still there");
      const refused = async (values, constraint) => {
        await c.query("SAVEPOINT k");
        await assert.rejects(
          c.query("INSERT INTO workflow_runs (run_id, attempt, function_id, finished_at, outcome, note) VALUES ($1, 0, $2, $3, $4, $5)", values),
          (e) => e.constraint === constraint
        );
        await c.query("ROLLBACK TO SAVEPOINT k");
      };
      await refused([`bad-${TAG}-1`, fnId, new Date(), null, null], "workflow_runs_finish_ck"); // finished with no outcome
      await refused([`bad-${TAG}-2`, fnId, new Date(), "maybe", null], "workflow_runs_outcome_ck");
      await refused([`bad-${TAG}-3`, fnId, null, null, "n".repeat(121)], "workflow_runs_note_ck");
    });
  });

  test("the switch-off: after REVOKE INSERT, UPDATE a write fails with 42501, the hooks stay quiet, the breaker opens, and the read still works", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    await inTxn(async (c) => {
      await c.query("REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app");
      await asApp(c);
      // The raw statements are refused with a permission error.
      await c.query("SAVEPOINT s1");
      await assert.rejects(c.query(START_SQL, ["r", 0, fnId, "round.started", null, 4, new Date()]), (e) => e.code === "42501");
      await c.query("ROLLBACK TO SAVEPOINT s1");
      await c.query("SAVEPOINT s2");
      await assert.rejects(
        c.query(FINISH_SQL, ["r", 0, fnId, "round.started", null, 4, new Date(), new Date(), "ok", true, false, null, null]),
        (e) => e.code === "42501"
      );
      await c.query("ROLLBACK TO SAVEPOINT s2");
      // The hooks swallow it: nothing is thrown into the workflow, the breaker opens after three, one line is logged.
      const lines = [];
      const { hooks, breaker } = createRunEvidence({ getDb: () => dbOver(c), log: (l) => lines.push(l) });
      for (let i = 0; i < 3; i += 1) {
        const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: ctxFor(`off-${TAG}-${i}`), steps: [] });
        assert.equal(await hook.finished({ result: { data: 1 } }), undefined);
      }
      assert.equal(breaker.state().open, true);
      assert.ok(lines.some((l) => /^\[run-evidence\] paused/.test(l)), lines.join("\n"));
      assert.ok(lines.every((l) => l.startsWith("[run-evidence]")));
      assert.equal((await rowsOf(c, `off-${TAG}-0`)).length, 0, "nothing was written");
      // The runs read still works as the app, and now says the app cannot write receipts.
      const res = await c.query(shadowed({ runs: false }), [...readParams(["f-cap"], ["entry.captured"]), "[]"]);
      const meta = res.rows.find((r) => r.kind === "meta");
      assert.equal(Number(meta.n), 0, "the meta row says the app can no longer write receipts");
    });
  });

  test("the meta row says the app CAN write receipts while the grant is in place", async (t) => {
    if (!appRoleExists) return t.skip("no fundhub_app role in this database");
    await inTxn(async (c) => {
      await asApp(c);
      const res = await c.query(shadowed({ runs: false }), [...readParams(["f-cap"], ["entry.captured"]), "[]"]);
      assert.equal(Number(res.rows.find((r) => r.kind === "meta").n), 1);
      assert.ok(res.rows.find((r) => r.kind === "meta").at, "the marker row is there");
    });
  });
});
