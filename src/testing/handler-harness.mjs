// A small kit for handler tests that run the REAL api/ handler with no Postgres.
//
// WHY THIS EXISTS
//
// Many handlers take their database through `deps.db` and are easy to test. A
// good number do not: they import the shared `db` from src/db.mjs (and
// src/partners/rls.mjs opens a transaction straight off its pool). Those doors
// had no test at all, because the only way to run them was a real database.
//
// This kit answers both kinds:
//   - fakeDb(rules)       a { query, connect } stand-in that answers SQL by
//                         pattern and records every call, in order.
//   - useSharedDb(fake)   points the shared src/db.mjs `db` AND every pg.Pool
//                         this process opens at the stand-in, then puts both
//                         back. Nothing reaches a real database while it is on,
//                         even when DATABASE_URL is set.
//   - staffSession(staff) a rule that answers the session check, so the real
//                         requireAuth / requirePrincipal gates run unchanged.
//
// What it proves and what it does not: the handler's own code runs for real
// (method gate, sign-in gate, role gate, input checks, which store call it
// makes and with what). The SQL text itself is not run by Postgres here; the
// *.pg.test.mjs files do that on a scratch database.

import pg from "pg";
import { db as sharedDb } from "../db.mjs";

/** A response object shaped like the Netlify adapter's. */
export function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    ended: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(o) { this.body = o; this.ended = true; return this; },
    end(o) { if (o !== undefined) this.body = o; this.ended = true; return this; }
  };
}

/**
 * fakeDb(rules) — rules is a list of [match, answer].
 *   match:  a RegExp tested against the SQL, or (sql, params) => boolean
 *   answer: rows array, a { rows } object, an Error to throw, or
 *           (sql, params, calls) => any of those (may be async)
 * The first matching rule wins. No match answers { rows: [] }.
 * Every call is kept on fake.calls as { sql, params }.
 * connectError: connect() throws it (a pool that cannot hand out a client).
 */
export function fakeDb(rules = [], { connectError = null } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params;
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
    return { rows: [], rowCount: 0 };
  }
  const fake = {
    calls,
    query,
    connected: 0,
    released: 0,
    async connect() {
      if (connectError) throw connectError;
      fake.connected += 1;
      return { query, release() { fake.released += 1; } };
    },
    /** Every recorded SQL that matches the pattern. */
    find(re) { return calls.filter((c) => re.test(c.sql)); },
    /** How many times this exact statement ran (BEGIN, COMMIT, ROLLBACK). */
    count(text) { return calls.filter((c) => c.sql.trim() === text).length; }
  };
  return fake;
}

/** Staff the session check returns. Defaults to an owner in org-1. */
export const ORG_ID = "0a000000-0000-4000-8000-000000000001";
export const OTHER_ORG_ID = "0b000000-0000-4000-8000-000000000002";
export const STAFF_ID = "5a000000-0000-4000-8000-000000000001";

export function staffRow(over = {}) {
  return {
    session_id: "5e000000-0000-4000-8000-000000000001",
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
    staff_id: STAFF_ID,
    org_id: ORG_ID,
    role: "owner",
    email: "owner@example.test",
    name: "Olive Owner",
    status: "active",
    avatar_key: null,
    active_flag: null,
    ...over
  };
}

/** The rule that answers verifySession (src/auth/session.mjs). */
export function staffSession(over = {}) {
  return [/FROM live JOIN staff/, () => [staffRow(over)]];
}

/** The two rules that answer verifyAccountSession for a partner (or other) account. */
export function accountSession({ kind = "partner", partnerId = null, clientId = null, orgId = ORG_ID } = {}) {
  const accountId = "ac000000-0000-4000-8000-000000000001";
  return [
    [/UPDATE account_sessions s/, () => [{
      id: "5e000000-0000-4000-8000-000000000002", account_id: accountId, org_id: orgId,
      expires_at: new Date(Date.now() + 3600e3).toISOString(), active_client_id: null
    }]],
    [/FROM accounts WHERE id = \$1/, () => [{
      id: accountId, org_id: orgId, kind, email: "acct@example.test", name: "Acct Holder",
      status: "active", client_id: clientId, affiliate_id: null, partner_id: partnerId
    }]]
  ];
}

/** A request with a bearer token, so the real sign-in gate runs. */
export function req(method, { body, query, headers } = {}) {
  return {
    method,
    body: body === undefined ? {} : body,
    query: query || {},
    headers: { authorization: "Bearer test-token-not-real", ...(headers || {}) }
  };
}

/**
 * useSharedDb(fake) — route the shared src/db.mjs `db` and every pg.Pool in
 * this process to the fake. Returns restore(). Call restore in a finally.
 */
export function useSharedDb(fake) {
  const realQuery = sharedDb.query;
  const proto = pg.Pool.prototype;
  const realConnect = proto.connect;
  const realPoolQuery = proto.query;
  const hadUrl = Object.prototype.hasOwnProperty.call(process.env, "DATABASE_URL");
  const realUrl = process.env.DATABASE_URL;

  sharedDb.query = (sql, params) => fake.query(sql, params);
  proto.connect = async function connect() { return fake.connect(); };
  proto.query = function query(sql, params) { return fake.query(sql, params); };
  // pool() refuses to build a Pool with no address. The address is never
  // dialled: connect and query above never reach the real driver.
  if (!realUrl) process.env.DATABASE_URL = "postgres://handler-harness@127.0.0.1:9/never";

  return function restore() {
    sharedDb.query = realQuery;
    proto.connect = realConnect;
    proto.query = realPoolQuery;
    if (hadUrl) process.env.DATABASE_URL = realUrl;
    else delete process.env.DATABASE_URL;
  };
}

/** Run one handler call against a fake shared db, always restoring. */
export async function runWithSharedDb(fake, fn) {
  const restore = useSharedDb(fake);
  try {
    return await fn();
  } finally {
    restore();
  }
}
