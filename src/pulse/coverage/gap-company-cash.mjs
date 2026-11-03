// Daily adapter over the same saved company-cash integrity used hourly.
import { runnerOf } from "./money-reads.mjs";
import { readCompanyCashTruth } from "../beats/lib/money-company-cash-truth.mjs";
export * from "../beats/lib/money-company-cash-truth.mjs";

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  return readCompanyCashTruth({
    read: run ? (sql, params) => run(tx => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null
  });
}
