// Daily adapter over the same saved-receipt judge used hourly. Read only.
import { checkOffersIqLeadSort, verifyOffersIqSortNothingToJudge, NOTHING_TO_JUDGE } from "../beats/lib/offersiq-lead-sort-truth.mjs";
export * from "../beats/lib/offersiq-lead-sort-truth.mjs";

function reader(ctx) {
  if (typeof ctx.scope === "function") return (sql, params) => ctx.scope(db => db.query(sql, params));
  if (ctx.db && typeof ctx.db.query === "function") return (sql, params) => ctx.db.query(sql, params);
  return null;
}

export async function gapChecks(ctx = {}) {
  return [await checkOffersIqLeadSort({ read: reader(ctx), orgId: ctx.orgId })];
}

export const naVerify = Object.freeze({
  [NOTHING_TO_JUDGE]: (args, ctx = {}) => verifyOffersIqSortNothingToJudge(args, { read: reader(ctx) })
});
