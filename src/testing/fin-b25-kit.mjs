// Small kit for the finish-the-853 batch 25 practice tests (marketing, ops, partner and read doors).
//
// Every practice test in src/http/fin-b25-*.test.mjs runs the REAL api/ handler, with its real sign-in
// and role gate and the real library under it, over a stand-in database that answers by the SQL text the
// code really sends. Nothing here reaches Postgres, a vendor or a network. A stand-in cannot prove the
// SQL is valid Postgres (the *.pg.test.mjs files do that on a scratch database); it proves which
// statements the code sends, with which bound values, and what it does with the answer.
import assert from "node:assert/strict";

import {
  ORG_ID,
  OTHER_ORG_ID,
  STAFF_ID,
  accountSession,
  makeRes,
  req as authedRequest,
  runWithSharedDb,
  staffSession,
} from "./handler-harness.mjs";
import { strictFakeDb } from "./s3-handler-call.mjs";
import { assertSqlHas, plainSql } from "./s3-scoped-rows.mjs";

export { ORG_ID, OTHER_ORG_ID, STAFF_ID, assertSqlHas, plainSql };

/** Every kind of sign-in a staff door has to tell apart. "partner" and "client" are refused by staff doors. */
export const ALL_ROLES = [
  "owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter", "partner", "client",
];

/**
 * call(handler, options) runs the real handler once.
 *   role / staff   who is signed in (the session rule answers the real sign-in check)
 *   account        sign in as a partner or client account instead: { kind, partnerId, clientId }
 *   anonymous      send no authorization header at all
 *   rules          stand-in database answers: [[RegExp | fn, rows | fn]] (first match wins)
 *   deps           third handler argument (fixed clock, env, wake, injected readers)
 * Returns what the caller would see, plus the stand-in db so a test can read every statement.
 */
export async function call(handler, {
  method = "GET", query, body, headers, role = "owner", staff = {}, rules = [], deps, anonymous = false, account = null,
  withSession = true, rawBody,
} = {}) {
  const session = !withSession ? [] : account ? accountSession(account) : [staffSession({ role, ...staff })];
  const fake = strictFakeDb([...session, ...rules]);
  let request;
  if (anonymous) request = { method, body: rawBody !== undefined ? rawBody : (body ?? {}), query: query || {}, headers: headers || {} };
  else request = authedRequest(method, { body: rawBody !== undefined ? rawBody : body, query, headers });
  const res = makeRes();
  await runWithSharedDb(fake, () => (deps === undefined ? handler(request, res) : handler(request, res, deps)));
  return { status: res.statusCode, body: res.body, headers: res.headers, db: fake, ended: res.ended };
}

/** Every statement that matched `pattern`, with its bound values. The session lookup is never counted. */
export function sqlCalls(result, pattern) {
  return result.db.calls.filter((entry) => pattern.test(entry.sql));
}

/** The statements a call ran, minus the sign-in lookup and the transaction frame. */
export function dataCalls(result) {
  return result.db.calls.filter((entry) =>
    !/FROM live JOIN staff/.test(entry.sql)
    && !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(entry.sql)
    && !/set_config\(/.test(entry.sql));
}

/**
 * Tries every role. Each role in `allowed` gets past the gate; every other role is refused with 403
 * before any statement other than the sign-in lookup. A gate tried only with the roles it lets in
 * proves nothing, and a role added to the gate by mistake turns this red.
 */
export async function assertRoleGate(handler, allowed, request = {}) {
  assert.ok(allowed.every((role) => ALL_ROLES.includes(role)), "allowed roles must be known roles");
  for (const role of ALL_ROLES) {
    let result;
    try {
      result = await call(handler, { ...request, role });
    } catch (error) {
      // A handler that got past the gate and then tripped on an empty stand-in database was let in.
      assert.ok(allowed.includes(role), `${role} was not refused: ${error.message}`);
      continue;
    }
    if (allowed.includes(role)) {
      assert.ok(![401, 403].includes(result.status), `${role} must be let in, got ${result.status}`);
      continue;
    }
    assert.equal(result.status, 403, `${role} must be refused`);
    assert.deepEqual(dataCalls(result).map((entry) => entry.sql), [], `${role} is refused before any data is read or written`);
  }
}

/** The request_id table the marketing writes share (withRequest in src/marketing/http.mjs). */
export function requestLog() {
  const saved = new Map();
  return {
    saved,
    rules: [
      [/FROM marketing_requests WHERE request_id = \$1/, (_sql, params) =>
        (saved.has(params[0]) ? [saved.get(params[0])] : [])],
      [/INSERT INTO marketing_requests/, (_sql, params) => {
        saved.set(params[0], { org_id: params[1], route: params[2], response: JSON.parse(params[3]) });
        return [];
      }],
    ],
  };
}

/* ── tiny SQL readers, so a stand-in can answer an INSERT or UPDATE by what the statement says ────── */

function splitTop(text) {
  const out = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (const char of text) {
    if (char === "'") quote = !quote;
    if (!quote) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        out.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function valueOf(token, params, now) {
  const bound = /^\$(\d+)(?:::[\w\[\]]+)?$/.exec(token);
  if (bound) return params[Number(bound[1]) - 1];
  const literal = /^'((?:[^']|'')*)'(?:::\w+)?$/.exec(token);
  if (literal) return literal[1].replace(/''/g, "'");
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;
  if (/^null$/i.test(token)) return null;
  if (/^now\(\)$/i.test(token)) return now;
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
  return undefined;
}

/**
 * The row an `INSERT INTO t (a, b) VALUES ($1, 'x')` statement writes: { a: params[0], b: "x" }.
 * A token it cannot read (a function call) is left out.
 */
export function insertedRow(sql, params, now = new Date("2026-10-14T18:00:00.000Z")) {
  const text = plainSql(sql);
  const match = /INSERT INTO\s+\w+\s*\(([^)]*)\)\s*VALUES\s*\((.*?)\)\s*(?:ON CONFLICT|RETURNING|$)/i.exec(text);
  assert.ok(match, `not an INSERT this kit can read: ${text.slice(0, 80)}`);
  const columns = match[1].split(",").map((name) => name.trim());
  const tokens = splitTop(match[2]);
  const row = {};
  columns.forEach((column, index) => {
    const value = valueOf(tokens[index] ?? "", params, now);
    if (value !== undefined) row[column] = value;
  });
  return row;
}

/** The columns an `UPDATE t SET a = $2, b = 'x' WHERE ...` statement sets: { a: params[1], b: "x" }. */
export function updatedFields(sql, params, now = new Date("2026-10-14T18:00:00.000Z")) {
  const text = plainSql(sql);
  const match = /\bSET\b(.*?)\bWHERE\b/i.exec(text);
  assert.ok(match, `not an UPDATE this kit can read: ${text.slice(0, 80)}`);
  const out = {};
  for (const assignment of splitTop(match[1])) {
    const pair = /^(\w+)\s*=\s*(.+)$/.exec(assignment);
    if (!pair) continue;
    const value = valueOf(pair[2].trim(), params, now);
    if (value !== undefined) out[pair[1]] = value;
  }
  return out;
}

/** A pg-shaped timestamp row value: handlers see a Date, answers carry its ISO text. */
export const at = (iso) => new Date(iso);
