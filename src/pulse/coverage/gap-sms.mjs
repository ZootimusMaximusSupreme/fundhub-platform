// Customer and staff SMS that never goes out, and the message queue. Read only. Report only.
//
// The SQL and the verdicts live in src/pulse/beats/lib/sms-truth.mjs, so this morning lane
// and the hourly beat message-health judge with the same code. This file only hands the lane
// to the morning pulse under its old name. It reads with ctx.db, as it always did, and it
// never sends BEGIN, COMMIT or SET on the shared pool.

import { runSmsLane } from "../beats/lib/sms-truth.mjs";

export * from "../beats/lib/sms-truth.mjs";

/**
 * gapChecks — the message queue. The three gap:sms-* rows first, then the five gap:msg-* rows.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 * Returns { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  return runSmsLane(ctx);
}
