// Daily adapter for the shared read-only FinanceOS setup truth.
import { runnerOf } from "./money-reads.mjs";
import { readFinanceSetupTruth } from "../beats/lib/money-finance-setup-truth.mjs";

export * from "../beats/lib/money-finance-setup-truth.mjs";

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  return readFinanceSetupTruth({
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null,
    now: ctx.now,
    env: ctx.env
  });
}
