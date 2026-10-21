// Partner pages that are published and do not open. Report only.
//
// One question a partner's visitor would feel: "I clicked the partner's link
// and got a 'nothing is live' page."
//
//   partner-pages:live   every partner_pages row with status 'published' answers
//                        200 at /sites/<partnerId>/<slug>
//
// Brand Studio publishes a draft by setting status to 'published'
// (api/partner-pages.mjs). The page is then served by
// netlify/functions/partner-site.mjs, which answers a miss with a 404 "Nothing is
// live at this web address" page and a hit with a 200. Nothing read a published
// page after the publish click (measured 2026-10-10: gap-built-funnels.mjs reads
// built funnels, not partner pages), so a page that was published and then lost
// its brand row, its function route or its slug would be dead with no alarm.
//
// GET only, one request per page, all at once, each with its own timeout, so the
// whole lane stays far under 20 seconds. At most PAGE_CAP pages are read in one
// morning; with more than that the lane reads a different slice each day and the
// detail says how many it read. Nothing is written. No repo file is read.
//
// Custom domains are not read (a verified domain serves the same pages by host).
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL, the page read and the verdict live in
// src/pulse/beats/lib/partner-pages-truth.mjs, so this morning lane and the hourly beat
// partner-pages run the same code. This file picks the reader and the web client.

import { check, checkPublishedPages } from "../beats/lib/partner-pages-truth.mjs";

export {
  PAGE_CAP,
  PAGE_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  NOT_LIVE_MARK,
  CHECK_IDS,
  PUBLISHED_SQL,
  pickPages,
  readPage
} from "../beats/lib/partner-pages-truth.mjs";

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, { fetchImpl | fetch }, optional { now, orgId, baseUrl }.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) return [check("skip", "No database in this run, so the published partner pages were not listed.")];
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : (typeof ctx.fetch === "function" ? ctx.fetch : null);
  if (!fetchImpl) return [check("skip", "No web client came with this run, so no partner page was opened.")];
  return checkPublishedPages({ run, web: fetchImpl, now: ctx.now, orgId: ctx.orgId || null, baseUrl: ctx.baseUrl });
}
