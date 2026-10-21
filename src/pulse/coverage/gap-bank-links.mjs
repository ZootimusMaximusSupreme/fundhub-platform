// Bank logins and merchant connections that stopped working. Report only. Read-only SQL.
//
// The SQL and the verdicts live in src/pulse/beats/lib/bank-links-truth.mjs, so this morning lane
// and the hourly beat bank-links judge with the same code. This file hands the lane its reader (the
// staff scope when the pulse has one, else the plain pool) and keeps naVerify, which the audit calls
// with the morning ctx. No Plaid call. Nothing is written.

import { MERCHANT_QUIET_MS, MERCHANT_SQL, num, one, runBankLinkChecks, toDate } from "../beats/lib/bank-links-truth.mjs";

export * from "../beats/lib/bank-links-truth.mjs";

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

/**
 * naVerify["not-connected"](args, ctx) → boolean. The claim "no live pull
 * connection" is read again, the same way, before the audit lets it stand.
 */
export const naVerify = Object.freeze({
  "not-connected": async (args, ctx = {}) => {
    if (!args || args.check !== "banks:merchant-sync") return false;
    const run = reader(ctx);
    if (!run) return false;
    try {
      const cut = new Date((toDate(ctx.now) || new Date()).getTime() - MERCHANT_QUIET_MS);
      const row = await one(run, MERCHANT_SQL, [ctx.orgId || null, cut.toISOString()]);
      return num(row.live) === 0;
    } catch {
      return false;
    }
  }
});

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * status is PASS, FAIL, skip or na (with a code the audit can re-check).
 * ctx: { db } or { scope }, optional { now, orgId }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  return runBankLinkChecks({ run: reader(ctx), now: ctx.now, orgId: ctx.orgId || null });
}
