// Daily read over the same saved-property judge used by the hourly soft-pull beat.
import { runnerOf } from "./money-reads.mjs";
import { readPropertyReportTruth } from "../beats/lib/crs-property-truth.mjs";
export * from "../beats/lib/crs-property-truth.mjs";

export async function gapChecks(ctx = {}) {
  return readPropertyReportTruth({ run: runnerOf(ctx), orgId: ctx.orgId });
}
