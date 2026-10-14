// Daily adapter for the shared read-only money-move truth.
import { runnerOf } from "./money-reads.mjs";
import {
  naVerify as safeNaVerify,
  readMoneyMovesTruth
} from "../beats/lib/money-moves-truth.mjs";

export * from "../beats/lib/money-moves-truth.mjs";

function safeContext(ctx = {}) {
  const run = runnerOf(ctx);
  return {
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    orgId: ctx.orgId || null,
    now: ctx.now
  };
}

export const naVerify = Object.freeze({
  "not-connected": (args, ctx = {}) => safeNaVerify["not-connected"](args, safeContext(ctx))
});

export async function gapChecks(ctx = {}) {
  return readMoneyMovesTruth(safeContext(ctx));
}
