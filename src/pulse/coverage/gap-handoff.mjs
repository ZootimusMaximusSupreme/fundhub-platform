// Hand-offs that never happened. Read only. Report only.
//
// The SQL and the verdicts live in src/pulse/beats/lib/handoff-truth.mjs, so this morning lane
// and the hourly beat lead-handoff judge with the same code. This file only hands the lane its
// reader: the staff scope when the pulse has one (it reads every row), else the plain pool.
// It never sends BEGIN, COMMIT or SET on the shared pool.

import { runHandoffChecks } from "../beats/lib/handoff-truth.mjs";

export * from "../beats/lib/handoff-truth.mjs";

/**
 * Five read-only tripwires. ctx: { db, scope, orgId, now }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL or skip.
 * No database or no company: all five skip with the reason. A read that fails is a skip.
 */
export async function gapChecks(ctx = {}) {
  let read = null;
  if (typeof ctx.scope === "function") read = (sql, params) => ctx.scope((tx) => tx.query(sql, params));
  else if (ctx.db && typeof ctx.db.query === "function") read = (sql, params) => ctx.db.query(sql, params);
  return runHandoffChecks({ read, orgId: ctx.orgId, now: ctx.now, readTimeoutMs: ctx.readTimeoutMs });
}
