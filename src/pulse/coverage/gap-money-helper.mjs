// FinanceOS money helper rows that are stuck. Report only. Read-only SQL.
//
// The SQL and the verdict live in src/pulse/beats/lib/money-helper-truth.mjs, so this morning lane and
// the hourly beat money-tasks judge with the same code. This file hands the lane its reader (the staff
// scope when the pulse has one, else the plain pool). What the check asks, the windows it uses and why
// test clients are left out are written at the top of that file.
//
//   helper:rows-stuck   a Do task row, a helper chat message or a ready-to-get-funded press is stuck
//
// Nothing is written. A read that fails is a skip.

import { runMoneyHelperChecks } from "../beats/lib/money-helper-truth.mjs";

export * from "../beats/lib/money-helper-truth.mjs";

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, optional { now, orgId, demoOn }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  return runMoneyHelperChecks({
    run: reader(ctx),
    now: ctx.now,
    orgId: ctx.orgId || null,
    demoOn: ctx.demoOn === true
  });
}
