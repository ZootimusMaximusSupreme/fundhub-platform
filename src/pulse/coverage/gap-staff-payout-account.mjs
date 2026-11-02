// Daily adapter over the same read-only staff bank truth used hourly.
import { runnerOf } from "./money-reads.mjs";
import { readStaffPayoutTruth } from "../beats/lib/money-staff-payout-truth.mjs";
export * from "../beats/lib/money-staff-payout-truth.mjs";
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  return readStaffPayoutTruth({
    read: run ? (sql, params) => run(tx => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null
  });
}
