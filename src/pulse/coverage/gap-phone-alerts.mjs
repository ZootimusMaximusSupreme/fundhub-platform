// Phone alerts — did the push a client was promised actually go out? Read only. Report only.
//
// Unit D of the Finance OS CFO build (ops/workflows/finance-os-cfo-build-2026-11-06.txt, spec item 1,
// owner-set 2026-11-06: "MOST IMPORTANT"). One id, one yes-or-no: alerts:phone-alerts-went-out.
//   1. OWED: every card due in 0 to 3 days and every bill marked Important charging in 0 to 3 days, for
//      a Finance OS or Capital Blueprint client with a phone set up, alerts on and no STOP, has a queued
//      phone alert row from the daily pass.
//   2. WENT OUT: every finance phone alert row from the last few days was sent, is waiting for its hour,
//      or was stopped by the client — not failed, stuck or left with an unknown outcome.
//
// The SQL and the verdict live in src/pulse/beats/lib/phone-alerts-truth.mjs, so this morning lane and
// the hourly beat money-alerts judge with the same code. This file hands the lane its database (the
// morning pulse's pool) and re-exports the truth.
//
// RULES (heartbeat law): SELECT only. No push, no text, no web call. A failed read is a skip with the reason.

import { runPhoneAlertChecks } from "../beats/lib/phone-alerts-truth.mjs";

export * from "../beats/lib/phone-alerts-truth.mjs";

/**
 * gapChecks — one read-only row, alerts:phone-alerts-went-out.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  return runPhoneAlertChecks({ db: ctx.db, orgId: ctx.orgId, now: ctx.now });
}
