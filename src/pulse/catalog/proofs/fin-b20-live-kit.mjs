// Shared helpers for the batch 20 live-check tests: stand-in rows with the real column names, and the
// "switch one clause off and see the wrong row read clean" step.

import assert from "node:assert/strict";
import { makeStandIn } from "./fin-b20-sql-kit.mjs";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const S2 = "aaaaaaaa-0000-4000-8000-000000000002";
export const S3 = "aaaaaaaa-0000-4000-8000-000000000003";
export const C1 = "cccccccc-0000-4000-8000-000000000001";
export const C2 = "cccccccc-0000-4000-8000-000000000002";

let seq = 0;
export const id = (p = "r") => `${p}-${String(++seq).padStart(4, "0")}`;

/** Run `sql` over a stand-in built by seed(). Returns { sample_count, bad_count }. */
export function run(sql, tables, seed, org = ORG) {
  const s = makeStandIn(tables);
  try { seed(s); return s.run(sql, org); } finally { s.close(); }
}

/** Switch an OR-arm of the wrong-result test off, and fail loudly when the text is not in the SQL. */
export function without(sql, text) {
  assert.ok(sql.includes(text), `the SQL no longer contains the clause under test: ${text}`);
  return sql.replace(text, "1 = 0");
}

/** Make a join or filter condition always true, and fail loudly when the text is not in the SQL. */
export function loosen(sql, text) {
  assert.ok(sql.includes(text), `the SQL no longer contains the clause under test: ${text}`);
  return sql.replace(text, "1 = 1");
}

/** Replace everything from `from` up to and including `to` (both must be in the SQL). */
export function cut(sql, from, to, replacement = "1 = 0") {
  const a = sql.indexOf(from);
  assert.ok(a >= 0, `the SQL no longer contains: ${from}`);
  const b = sql.indexOf(to, a);
  assert.ok(b >= 0, `the SQL no longer contains: ${to}`);
  return sql.slice(0, a) + replacement + sql.slice(b + to.length);
}
