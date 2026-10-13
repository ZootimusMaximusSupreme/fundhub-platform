// Daily adapter for the shared read-only checkout truth.
import { getOffer } from "../../config/offers.mjs";
import { request, runnerOf } from "./money-reads.mjs";
import {
  naVerify as safeNaVerify,
  readCheckoutTruth
} from "../beats/lib/money-checkout-truth.mjs";

export * from "../beats/lib/money-checkout-truth.mjs";

function safeContext(ctx = {}) {
  const run = runnerOf(ctx);
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
  return {
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    readWeb: fetchImpl ? (method, url, init) => request(fetchImpl, method, url, init) : null,
    offerLookup: getOffer,
    orgId: ctx.orgId || null,
    now: ctx.now,
    baseUrl: ctx.baseUrl || null
  };
}

export const naVerify = Object.freeze({
  "low-traffic": (args, ctx = {}) => safeNaVerify["low-traffic"](args, safeContext(ctx))
});

export async function gapChecks(ctx = {}) {
  return readCheckoutTruth(safeContext(ctx));
}
