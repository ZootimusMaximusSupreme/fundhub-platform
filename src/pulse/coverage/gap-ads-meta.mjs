// Daily adapter for the shared read-only Meta money truth.
import { request, runnerOf } from "./money-reads.mjs";
import {
  naVerify as safeNaVerify,
  readAdsMetaTruth,
  readMetaCampaigns as readSafeMetaCampaigns
} from "../beats/lib/money-ads-meta-truth.mjs";

export * from "../beats/lib/money-ads-meta-truth.mjs";

export function readMetaCampaigns({ fetchImpl, token, accountId, version }) {
  return readSafeMetaCampaigns({
    readWeb: (method, url, init) => request(fetchImpl, method, url, init),
    token,
    accountId,
    version
  });
}

function safeContext(ctx = {}) {
  const run = runnerOf(ctx);
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
  return {
    read: run ? (sql, params) => run((tx) => tx.query(sql, params)) : null,
    readWeb: fetchImpl ? (method, url, init) => request(fetchImpl, method, url, init) : null,
    hasScope: typeof ctx.scope === "function",
    orgId: ctx.orgId || null,
    now: ctx.now,
    env: ctx.env
  };
}

export const naVerify = Object.freeze({
  "not-connected": (args, ctx = {}) => safeNaVerify["not-connected"](args, safeContext(ctx))
});

export async function gapChecks(ctx = {}) {
  return readAdsMetaTruth(safeContext(ctx));
}
