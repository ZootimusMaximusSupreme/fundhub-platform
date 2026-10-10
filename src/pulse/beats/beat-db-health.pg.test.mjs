// db-health against the REAL Postgres, READ ONLY.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL. A SKIPPED PG TEST IS NOT GREEN. ***
// It proves the beat's SQL on live data. A fake database that answers any SQL with canned rows proves
// nothing about the SQL (beat-db-health.test.mjs says so too). Everything here goes through the pulse read
// box (BEGIN READ ONLY, one statement at a time, ROLLBACK at the end, never COMMIT). The one plain query is
// the fixed settings query from readbox.mjs, on its own connection, which only reads three settings.
// The web call (the health door) is faked: this file never touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as beat from "./beat-db-health.mjs";
import { runBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { openReadBox, readDbSettings } from "./readbox.mjs";

const SKIP = process.env.DATABASE_URL ? false : "no DATABASE_URL (a skipped pg test is not green)";
const require = createRequire(import.meta.url);

function newClient() {
  const pg = require("pg");
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(url);
  const c = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  c.on("error", () => {});
  return c;
}
const connect = async () => { const c = newClient(); await c.connect(); return c; };
const plainSettings = async () => readDbSettings(async (sql) => {
  const c = await connect();
  try { return await c.query(sql); } finally { await c.end().catch(() => {}); }
});

/** Run the real beat on the real read box; the web is faked. `rewrite` may change a read's params. */
async function runLive({ rewrite, swapSql, http } = {}) {
  const box = await openReadBox({ connect });
  try {
    const read = (sql, params) => box.read(swapSql ? swapSql(sql) : sql, rewrite ? rewrite(sql, params) : params);
    const ctx = makeFakeCtx(beat, { read, http: http ?? beat.goodHealth(), dbSettings: plainSettings });
    const result = await runBeat(beat, ctx);
    return { result, log: ctxLog(ctx), report: await box.close() };
  } catch (err) {
    await box.close().catch(() => {});
    throw err;
  }
}

/** A table in public that the app role cannot INSERT into (measured 2026-10-09: waypoint_definitions). null if none. */
async function tableWithoutInsert() {
  const box = await openReadBox({ connect });
  try {
    const r = await box.read(
      "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT has_table_privilege($1::name, c.oid, 'INSERT') ORDER BY 1 LIMIT 1",
      [beat.APP_ROLE]
    );
    return r.rows[0]?.name ?? null;
  } finally { await box.close(); }
}

test("LIVE: the real beat is green on the real database, reads only, nothing committed", { skip: SKIP }, async () => {
  const { result, log, report } = await runLive();
  assert.equal(result.ok, true, `${result.step}: ${result.detail}`);
  assert.deepEqual(result.notRun, []);
  assert.equal(log.reads.length, 4);
  assert.deepEqual(log.refused, []);
  assert.equal(report.commitsSent, 0);
  assert.equal(report.rolledBack, true);
  assert.equal(report.readOnlyAtClose, true);
  assert.equal(report.errors, 0);
  assert.ok(result.evidence.queryMs < beat.SLOW_QUERY_MS, `the trivial query took ${result.evidence.queryMs} ms`);
});

test("LIVE: the grants SQL says INSERT is true for the nine launch tables and absent-or-true for pulse_beats", { skip: SKIP }, async () => {
  const box = await openReadBox({ connect });
  try {
    const rows = (await box.read(beat.SQL_GRANTS, [beat.APP_ROLE, [...beat.GRANT_TABLES]])).rows;
    assert.equal(rows.length, beat.GRANT_TABLES.length);
    for (const r of rows) {
      if (beat.MAY_BE_ABSENT.includes(r.name) && r.present === false) {
        assert.equal(r.can_insert, null, `${r.name}: absent should read null, not false`);
      } else {
        assert.equal(r.present, true, `${r.name} should exist`);
        assert.equal(r.can_insert, true, `${r.name}: ${beat.APP_ROLE} should be able to INSERT`);
      }
    }
  } finally { await box.close(); }
});

test("LIVE: the grants SQL says FALSE for a table the app role truly cannot INSERT into, and null for a table that is not there", { skip: SKIP }, async (t) => {
  const lacking = await tableWithoutInsert();
  if (!lacking) return t.skip("every public table lets the app role INSERT right now, so there is no real negative to read");
  const box = await openReadBox({ connect });
  try {
    const rows = (await box.read(beat.SQL_GRANTS, [beat.APP_ROLE, [lacking, "clients", "no_such_table_zz"]])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.deepEqual([by[lacking].present, by[lacking].can_insert], [true, false]);
    assert.deepEqual([by.clients.present, by.clients.can_insert], [true, true]);
    assert.deepEqual([by.no_such_table_zz.present, by.no_such_table_zz.can_insert], [false, null]);
  } finally { await box.close(); }
});

test("LIVE: the beat goes red at grants on real data when a table lacks INSERT (the SQL looks up a real table without it under the name messages)", { skip: SKIP }, async (t) => {
  const lacking = await tableWithoutInsert();
  if (!lacking) return t.skip("no real table without INSERT to swap in");
  const { result } = await runLive({
    rewrite: (sql, params) => params,
    swapSql: (sql) => sql.split("to_regclass('public.' || t.name)").join(`to_regclass('public.' || CASE t.name WHEN 'messages' THEN '${lacking}' ELSE t.name END)`)
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "grants");
  assert.equal(result.detail, `${beat.APP_ROLE} cannot INSERT into: messages`);
});

test("LIVE: the role check says false for a role that is not there, and the beat goes red at grants", { skip: SKIP }, async () => {
  const { result, log } = await runLive({ rewrite: (sql, params) => (/FROM pg_roles/.test(sql) ? ["no_such_role_zz"] : params) });
  assert.equal(result.step, "grants");
  assert.match(result.detail, /app role fundhub_app is not in the database/);
  assert.equal(log.reads.some((r) => /has_table_privilege/.test(r.sql)), false);
});

test("LIVE: the pressure SQL returns a count and the real max_connections", { skip: SKIP }, async () => {
  const box = await openReadBox({ connect });
  try {
    const row = (await box.read(beat.SQL_PRESSURE)).rows[0];
    const used = Number(row.used_conn);
    const limit = Number(row.limit_conn);
    const show = (await box.read("SHOW max_connections")).rows[0].max_connections;
    assert.ok(Number.isInteger(used) && used >= 1, `used_conn ${row.used_conn}`);
    assert.equal(limit, Number(show));
    assert.ok(used / limit <= beat.PRESSURE_RED, `${used} of ${limit} connections: the live database is over ${beat.PRESSURE_RED * 100} percent right now`);
  } finally { await box.close(); }
});

test("LIVE: the pressure count includes other roles' sessions, not only the app role's own", { skip: SKIP }, async () => {
  // One statement, one snapshot: the beat's count, the same count by the broken backend_type filter, and
  // the app role's own sessions. As the app role (no pg_read_all_stats) backend_type is NULL for every
  // other role, so the old filter could only ever see the app's own sessions.
  const box = await openReadBox({ connect });
  try {
    const row = (await box.read(
      "SELECT (SELECT used_conn FROM (" + beat.SQL_PRESSURE + ") q) AS beat_used, " +
      "count(*) FILTER (WHERE datid IS NOT NULL) AS by_datid, " +
      "count(*) FILTER (WHERE backend_type = 'client backend') AS by_backend_type, " +
      "count(*) FILTER (WHERE datid IS NOT NULL AND usename = current_user) AS app_only " +
      "FROM pg_stat_activity"
    )).rows[0];
    const [beatUsed, byDatid, byBackend, appOnly] = [row.beat_used, row.by_datid, row.by_backend_type, row.app_only].map(Number);
    // Sessions come and go between the two counts inside one statement, so allow a few of slack.
    assert.ok(Math.abs(beatUsed - byDatid) <= 3, `beat count ${beatUsed} vs datid count ${byDatid}`);
    assert.ok(beatUsed >= appOnly, `beat count ${beatUsed} must be at least the app role's own ${appOnly}`);
    assert.ok(byDatid >= byBackend, "counting by datid never shows fewer than counting by backend_type");
  } finally { await box.close(); }
});

test("LIVE: a plain pooled connection is writable (the same question pool-writable asks)", { skip: SKIP }, async () => {
  const s = await plainSettings();
  assert.equal(s.ok, true, s.error);
  assert.deepEqual([s.transaction_read_only, s.default_transaction_read_only, s.in_recovery], [false, false, false]);
});
