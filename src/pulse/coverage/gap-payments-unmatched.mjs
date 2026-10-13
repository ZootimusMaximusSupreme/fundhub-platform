// Daily adapter for the shared read-only unmatched-payment truth.
import { runnerOf } from "./money-reads.mjs";
import { readUnmatchedTruth } from "../beats/lib/money-unmatched-truth.mjs";

export * from "../beats/lib/money-unmatched-truth.mjs";

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  return readUnmatchedTruth({
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null,
    now: ctx.now
  });
}
