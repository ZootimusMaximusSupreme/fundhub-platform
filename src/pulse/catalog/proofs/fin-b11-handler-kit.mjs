// Batch 11, repair cycle 2: run the REAL api/ handlers over stand-in rows.
//
// The page tests use a fake server, so they cannot see what an endpoint really writes. The
// handler harness (src/testing/handler-harness.mjs) already runs a real handler with a scripted
// database, but a scripted database answers by pattern and holds no rows, so "the handler touched
// every creative of the partner" or "the handler saved the wrong kind" cannot show up in it. This kit
// gives the same harness a database that HOLDS rows: the real column names from db/schema and
// db/migrations (fin-b11-sql-kit.mjs) in an in-memory SQLite, with the handler's own SQL text run
// against them. A test then writes through the real handler and reads what was saved back, with the
// live check's own SQL if it wants.
//
// What this is not: Postgres. There is none on this Mac. portableSql() turns the few Postgres
// spellings the handlers use into the same statement for SQLite, and a statement it cannot run
// throws, so a handler that began using a spelling the kit cannot turn is a red test, never a
// silent pass.
//
// Tests only. Nothing here is imported by the live bundle.

import { portableSql, makeStandIn, NOW } from "./fin-b11-sql-kit.mjs";
import { runWithSharedDb } from "../../../testing/handler-harness.mjs";

export { NOW };

// pg hands jsonb back parsed and booleans as true / false. SQLite hands back text and 0 / 1.
const JSON_COLUMNS = new Set(["blocked_reasons", "spec", "sources", "config", "reasons", "palette", "fonts", "voice_profile", "products"]);
const BOOL_COLUMNS = new Set(["marketing_suite_enabled", "thin", "ai_generated", "synthetic_performer", "active"]);

function fixRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof value === "string") {
      try { out[key] = JSON.parse(value); } catch { out[key] = value; }
    } else if (BOOL_COLUMNS.has(key) && (value === 0 || value === 1)) {
      out[key] = value === 1;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toSqlValue(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * A database the shared harness can point the handlers at.
 *   tables   the real tables to create (their columns come from db/schema and db/migrations)
 *   rules    [[RegExp | fn, answer]] tried first: the sign-in checks are answered here, as the harness does
 *   unique   extra unique indexes the real tables have, as { table: ["col", "col"] } (ON CONFLICT needs them)
 *
 * It keeps every statement the handler ran in calls, and its clock moves forward one millisecond per
 * statement, so "now()" in one statement is later than "now()" in the one before it, as in Postgres.
 */
export function standInDatabase(tables, { rules = [], unique = {} } = {}) {
  let tick = 0;
  const clock = () => new Date(NOW.getTime() + (tick += 1));
  const si = makeStandIn(tables, { defaults: true, clock });
  for (const [table, cols] of Object.entries(unique)) {
    si.db.exec(`CREATE UNIQUE INDEX ux_${table}_${cols.join("_")} ON ${table} (${cols.map((c) => `"${c}"`).join(", ")})`);
  }
  const calls = [];

  async function query(sql, params = []) {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params || [];
    calls.push({ sql: text, params: args });
    for (const [match, answer] of rules) {
      const hit = typeof match === "function" ? match(text, args) : match.test(text);
      if (!hit) continue;
      const out = typeof answer === "function" ? await answer(text, args, calls) : answer;
      if (out instanceof Error) throw out;
      if (Array.isArray(out)) return { rows: out, rowCount: out.length };
      if (out && Array.isArray(out.rows)) return { rowCount: out.rows.length, ...out };
      return { rows: [], rowCount: 0 };
    }
    // The transaction brackets and the partner-scope settings are the pool's business, not rows.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(text) || /\bset_config\s*\(/i.test(text)) return { rows: [], rowCount: 0 };
    const stmt = si.db.prepare(portableSql(text, { now: clock() }));
    const bound = args.map(toSqlValue);
    if (/^\s*(select|with)\b/i.test(text) || /\breturning\b/i.test(text)) {
      const rows = stmt.all(...bound).map(fixRow);
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...bound);
    return { rows: [], rowCount: Number(info.changes) };
  }

  return {
    si,
    calls,
    query,
    connected: 0,
    released: 0,
    async connect() {
      this.connected += 1;
      return { query, release: () => { this.released += 1; } };
    },
    /** Every table's rows, for a test that wants to see what was saved. */
    rows(table, where = "") {
      return si.db.prepare(`SELECT * FROM ${table} ${where}`).all().map(fixRow);
    },
    /** The writes the handler made to its own tables: INSERT, UPDATE and DELETE statements, in order. A
     *  sign-in check's session touch (account_sessions) is the gate's own bookkeeping, not the handler's. */
    writes() {
      return calls.filter((c) => /^\s*(insert|update|delete)\b/i.test(c.sql) && !/\baccount_sessions\b|\bsessions\b/i.test(c.sql));
    },
    /** Run a live check's exact SQL as of a later moment (the check ignores very new rows). */
    runCheck(sql, orgId, { after = 3 * 60 * 60_000 } = {}) {
      const row = si.db.prepare(portableSql(sql, { now: new Date(NOW.getTime() + after) })).get(orgId);
      return { sample_count: Number(row.sample_count), bad_count: Number(row.bad_count) };
    },
    close() { si.close(); }
  };
}

/** A response object and request the way the Netlify adapter shapes them. */
export function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/**
 * Run a handler that reads the shared database (api/creative/*, api/brand/review.mjs) over a
 * stand-in database. Returns { status, body }.
 */
export async function runShared(handler, database, { method = "POST", body = {}, query = {} } = {}) {
  const res = mockRes();
  const req = { method, body, query, headers: { authorization: "Bearer test-token-not-real" } };
  await runWithSharedDb(database, () => handler(req, res));
  return { status: res.statusCode, body: res.body };
}
