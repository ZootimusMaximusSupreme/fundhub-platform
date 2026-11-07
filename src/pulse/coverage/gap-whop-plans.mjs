// Whop plans — is every Whop plan a client sees on Payments still true? Read only. Report only.
//
// Finance OS unit W. One id, one yes-or-no: payments:whop-plans-current. FAIL when an open
// Whop plan of a real client was not read from Whop in 36 hours, or still shows a charge day
// that has passed.
//
// The SQL and the verdict live in src/pulse/beats/lib/whop-plans-truth.mjs, so this morning
// lane and the hourly beat judge with the same code. This file hands the lane its database
// (the morning pulse's pool) and re-exports the truth.
//
// RULES (heartbeat law): SELECT only. No Whop call, no send. A failed read is a FAIL with the
// reason, never a PASS. No database: skip.

import { runWhopPlanChecks } from "../beats/lib/whop-plans-truth.mjs";

export * from "../beats/lib/whop-plans-truth.mjs";

/**
 * gapChecks — one read-only row, payments:whop-plans-current.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  return runWhopPlanChecks({ db: ctx.db, orgId: ctx.orgId, now: ctx.now });
}

export default gapChecks;
