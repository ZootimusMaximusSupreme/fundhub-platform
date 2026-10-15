// Finish-853 batch 26: the small kit the batch 26 route practice tests share.
// Tests only; nothing here is product code. Practice tests with fake data, a stand-in database,
// no network. They are not live checks.
//
// What it gives a test:
//   run(handler, request, rules, deps)  one real handler call over a stand-in database that refuses
//                                       what Postgres refuses (a value the statement never uses).
//   inSql(rows, sql, params)            the rows a statement's WHERE keeps, by the conditions the SQL
//                                       text itself names (equality, optional filter, `= ANY($n)`).
//   asRole(role, over) / asPartner / asClient   the session rules the real sign-in gates read.
//   Snapshot-able tables for transaction tests (BEGIN / ROLLBACK).
import assert from "node:assert/strict";

import { makeRes, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "./handler-harness.mjs";
import { strictFakeDb } from "./s3-handler-call.mjs";
import { rowsWhere, plainSql } from "./s3-scoped-rows.mjs";

export { ORG_ID, OTHER_ORG_ID };
export { req, staffSession, accountSession, STAFF_ID } from "./handler-harness.mjs";
export { assertSqlHas, plainSql } from "./s3-scoped-rows.mjs";

export const PARTNER = "a1000000-0000-4000-8000-000000000001";
export const OTHER_PARTNER = "a2000000-0000-4000-8000-000000000002";
export const FOREIGN_PARTNER = "a9000000-0000-4000-8000-000000000009";
export const CLIENT = "c1000000-0000-4000-8000-000000000001";
export const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
export const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";

/** Every staff role the app knows, read from the app's own list. */
export const ALL_STAFF_ROLES = Object.freeze([
  "owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter",
]);

/**
 * One call of a real handler over a stand-in database. `deps` (optional) is merged over { db: fake }.
 * Returns { res, fake } where fake.calls holds every statement in order.
 */
export async function run(handler, request, rules = [], deps = null) {
  const fake = strictFakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => (deps ? handler(request, res, { db: fake, ...deps }) : handler(request, res)));
  return { res, fake };
}

/** The statements of a call that match a pattern. */
export const sqlOf = (fake, re) => fake.calls.filter((call) => re.test(call.sql));

/** True when the call wrote anything (INSERT, UPDATE, DELETE). set_config and BEGIN are not writes. */
export const writes = (fake) => fake.calls.filter((call) =>
  /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.sql)
  // A login touches its own session row. That is the sign-in gate, not the door under test.
  && !/^\s*UPDATE\s+(?:account_)?sessions\b/i.test(call.sql)
  && !/^\s*UPDATE\s+account_sessions\b/i.test(call.sql));

export const wrote = (fake) => writes(fake).length > 0;

const ANY_OF = /\b(?:[a-z]\w*\.)?([a-z_]\w*)(?:::\w+)?\s*=\s*ANY\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/gi;

/**
 * The rows a statement's WHERE keeps, judged from the statement's own text: `col = $n`, `col = 'x'`,
 * the optional `($n IS NULL OR col = $n)` filter and `col = ANY($n)`. A condition the product drops
 * from its SQL stops filtering here, so another company's row comes back and the test goes red.
 */
export function inSql(rows, sql, params = []) {
  const where = /\bWHERE\b([\s\S]*)$/i.exec(sql);
  let kept = rowsWhere(rows, sql, params);
  if (!where) return kept;
  for (const m of where[1].matchAll(ANY_OF)) {
    const list = params[Number(m[2]) - 1];
    const values = (Array.isArray(list) ? list : [list]).map(String);
    kept = kept.filter((row) => values.includes(String(row[m[1]])));
  }
  return kept;
}

/** A table the test can snapshot at BEGIN and restore at ROLLBACK, so a transaction test is honest. */
export function txTables(tables) {
  let saved = null;
  const copy = () => Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((row) => ({ ...row }))]));
  return {
    rules: [
      [/^\s*BEGIN\b/i, () => { saved = copy(); return []; }],
      [/^\s*COMMIT\b/i, () => { saved = null; return []; }],
      [/^\s*ROLLBACK\b/i, () => {
        if (saved) for (const [k, v] of Object.entries(saved)) { tables[k].length = 0; tables[k].push(...v); }
        saved = null;
        return [];
      }],
      [/set_config\(/i, []],
    ],
  };
}

/** A staff login, as a list of rules to spread into a call. role and company are what a gate reads. */
export const asRole = (role, over = {}) => [staffSession({ role, ...over })];

/** A partner login: partnerId is what a partner-scoped read is pinned to. */
export const asPartner = (partnerId = PARTNER, orgId = ORG_ID) => accountSession({ kind: "partner", partnerId, orgId });

/** A client login attached to one client file. */
export const asClient = (clientId = CLIENT, orgId = ORG_ID) => accountSession({ kind: "client", clientId, orgId });

/** An affiliate login (a kind most partner and staff doors name and refuse). */
export const asAffiliate = (orgId = ORG_ID) => accountSession({ kind: "affiliate", orgId });

/** Fails when the statement text no longer carries a clause, with the clause named. */
export function pinned(sql, name, clause) {
  assert.ok(plainSql(sql).includes(plainSql(clause)), `${name}: the statement no longer says: ${clause}`);
}

/** The set of ways a session can be refused or unknown, for a door that names only some kinds. */
export function refusedKinds() {
  return [
    ["no session at all", []],
  ];
}

/** Collapse a statement to one line. Handy in failure messages. */
export const oneLine = (sql) => plainSql(sql);
