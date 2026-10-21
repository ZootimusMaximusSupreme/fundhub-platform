// Built funnels that are live, for the morning pulse. Read only. Report only.
//
// A funnel the dashboard built (marketing_funnels.kind is set) goes live when
// the push-live job proves its three pages on apply.fundhub.ai (X4F, 2026-10-06).
// From that moment it is on every affiliate's link list (LIVE_OFFERS_SQL in
// src/affiliates/share-link.mjs) and it can take ad traffic. The push proves the
// pages ONCE, on the day it goes live. Nothing else looked at them again.
//
// This lane looks again, every morning. For each live built funnel it reads the
// funnel's pages from marketing_funnel_pages and does one cache-busted GET of each
// page's live_url. A funnel is wrong when:
//   * it has fewer than its three pages on file (landing, booking, thank_you), or
//   * a page has no live address, or
//   * a page answers anything but 200, or cannot be reached, or
//   * a page answers 200 without its funnel tag (the <meta name="fh-funnel-tag">
//     the database trigger in migration 425 makes every saved page carry). A 200
//     with no tag is a blank page, an error page, or another funnel's page.
//
// Why a new lane and not gap-funnels. gap-funnels.mjs and slice-05-funnels.mjs only
// read pages written into the code (GAP_DOORS). A funnel made in the dashboard is a
// row in the database, so no code names it. gap-marketing-queue only sees a job that
// failed. Neither can see a live page that has gone dead weeks later (ClickFunnels
// unlinks a step, someone archives the funnel).
//
// READ ONLY. Every read is a SELECT. Every web call is a GET. No text, no email, no
// AI call, no ClickFunnels API call (the pages are read the way a buyer reads them,
// on apply.fundhub.ai, with no key). The pulse only reports. It never fixes.
//
// NO REPO FILE IS READ AT RUN TIME. Everything comes from the database and the web.
//
// "NOTHING TO JUDGE" (owner law 2026-10-09: a live thing is never "not checked").
// With no live built funnel there is no page to judge. The lane then returns status
// "na" with na: { code: "low-traffic", args } (too few live built funnels to judge,
// judged the day one goes live). naVerify["low-traffic"] re-reads with the SAME SQL
// and the SAME minimum (MIN_LIVE_FUNNELS) on every audit, so the claim cannot rot.
// A zero from a table that reads as EMPTY is a blind read, not "none live", so it
// stays a skip (see SEEN_SQL).

// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL, the page read and the verdict live in
// src/pulse/beats/lib/built-funnels-truth.mjs, so this morning lane and the hourly beat
// built-funnels run the same code. This file picks the reader and the web client, and keeps the
// audit's naVerify.

import {
  CHECK_IDS, LIVE_SQL, MIN_LIVE_FUNNELS, SEEN_SQL, checkLiveFunnels, distinctFunnels, row, rowsOf
} from "../beats/lib/built-funnels-truth.mjs";

export {
  CHECK_IDS,
  MIN_LIVE_FUNNELS,
  TIMEOUT_MS,
  DEADLINE_MS,
  MAX_PAGES,
  CACHE_BUST_PARAM,
  LIVE_SQL,
  SEEN_SQL,
  bustedUrl
} from "../beats/lib/built-funnels-truth.mjs";

const ID = CHECK_IDS[0];

/** The staff scope when the pulse passes one, else the plain handle (tests, a laptop). */
function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the
 * same SQL (LIVE_SQL, SEEN_SQL) and the same minimum (MIN_LIVE_FUNNELS) the lane
 * used, and answers true only when the table reads as non-empty AND the live built
 * funnels are fewer than the minimum. No database, a count that is not a number, or
 * a row about another check is false. A read that throws is left to throw: the
 * audit counts a throw as false.
 * @param {{ check?: string, orgId?: string }} args
 * @param {{ db?: any, scope?: Function, orgId?: string }} ctx
 */
export const naVerify = Object.freeze({
  "low-traffic": async (args, ctx = {}) => {
    if (!args || args.check !== ID) return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    const seen = await rowsOf(run, SEEN_SQL, [orgId]);
    const n = Number(seen[0] && seen[0].n);
    if (!Number.isFinite(n) || n <= 0) return false;
    const live = await rowsOf(run, LIVE_SQL, [orgId]);
    return distinctFunnels(live).size < MIN_LIVE_FUNNELS;
  }
});

/**
 * One read-only check. ctx: { db, scope, orgId, now, fetchImpl | fetch, deadlineMs }.
 * The row is { id, status, detail, suggestedFix } with status PASS, FAIL, skip, or
 * na (nothing to judge: the row then also carries na: { code, args }).
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) return [row("skip", "no database in this run — live built funnels were not read")];
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") && ctx.fetchImpl !== undefined
    ? ctx.fetchImpl
    : (ctx.fetch ?? globalThis.fetch);
  return checkLiveFunnels({
    run,
    web: typeof fetchImpl === "function" ? fetchImpl : null,
    orgId: ctx.orgId || null,
    now: ctx.now instanceof Date ? ctx.now : new Date(),
    deadlineMs: ctx.deadlineMs
  });
}
