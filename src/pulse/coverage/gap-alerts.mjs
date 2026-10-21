// Account alerts — did the text the client was promised actually go out? Read only. Report only.
//
// W4 of the 2026-10-10 coverage batch (ops/workflows/coverage-every-surface-2026-10-10.md, item 8).
// One id, one yes-or-no: alerts:texts-went-out. It asks two questions:
//   1. A file-protection alert (src/workflows/blueprint-finance-os-alerts.mjs) said it queued a text:
//      did that text leave and arrive, or is it stuck, failed or held?
//   2. A card or loan payment due in 0 to 3 days (src/workflows/finance-os-card-due-reminders.mjs):
//      for every reminder the job owed at its last pass, is there a text?
//
// The SQL and the verdict live in src/pulse/beats/lib/alerts-truth.mjs, so this morning lane and the hourly
// beat money-alerts judge with the same code. The card-due planners live in src/pulse/beats/lib/card-due-plan.mjs
// (src/banking/card-due-reminders.mjs re-exports them), so the job, the lane and the beat run one planner.
// This file hands the lane its database (the morning pulse's pool) and re-exports the truth, so every existing
// import from here keeps working.
//
// RULES (heartbeat law): SELECT only. No text, no email, no web call. A failed read is a skip with the reason.

import { runAlertChecks } from "../beats/lib/alerts-truth.mjs";

export * from "../beats/lib/alerts-truth.mjs";

/**
 * gapChecks — one read-only row, alerts:texts-went-out.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  return runAlertChecks({ db: ctx.db, orgId: ctx.orgId, now: ctx.now });
}
