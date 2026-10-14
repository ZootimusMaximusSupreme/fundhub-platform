// Daily adapter for the shared read-only subscription truth.
import { runnerOf } from "./money-reads.mjs";
import { readSubscriptionsTruth } from "../beats/lib/money-subscriptions-truth.mjs";

export * from "../beats/lib/money-subscriptions-truth.mjs";

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  return readSubscriptionsTruth({
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null,
    now: ctx.now
  });
}
