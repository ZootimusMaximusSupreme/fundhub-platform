// GET /api/marketing/funnels/stats — the marketing numbers by FUNNEL, last 30
// Arizona days: ad -> page -> lead -> call -> sale, with the two step rates.
//
// Route key "marketing/funnels/stats" (netlify/functions/api.mjs ROUTES). Spec
// docs/specs/marketing-machine-2026-10-04.md §11.2 and §11.1. Shape:
// docs/specs/marketing-machine-api.md §6.6 (fixed shape 9):
//
//   200 {rows:[{funnel_key, name, spend_cents, page_views, click_to_page,
//               page_to_lead, leads, booked, showed, sales, cash_cents, roas}],
//        unmapped_spend_cents, as_of}
//
//   rows: every active funnel, plus any funnel that spend or leads were placed
//   on. Which funnel: the ad number's live script's funnel_key, else the funnel
//   whose meta_campaign_ids holds the ad's campaign (Chris maps these in
//   Settings), else unmapped. Both funnels start with no campaigns mapped, so
//   until Chris maps them most spend is unmapped — said honestly, not guessed.
//   page_views = people who opened the funnel's landing page (funnel.page, actor
//   person). click_to_page = page views ÷ the funnel's link clicks; page_to_lead
//   = leads ÷ page views; both 0..1, null when the bottom is 0 or unknown.
//   unmapped_spend_cents: spend no funnel claims (null when no ad-day is saved).
//   Counting rules: U20 (src/marketing/metrics.mjs). as_of = the last Meta sync.
//
// READ ONLY. Owner and admin only: requireAuth, then
// requireRole(ROLE_SETS.MARKETING), then a company on the session. Every read
// runs inside one asStaff() transaction (staffRead).

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany } from "../../../src/marketing/http.mjs";
import { funnelStats, lastDays, ROLLUP_DAYS } from "../../../src/marketing/metrics-rollups.mjs";
import { readLastSync } from "../today.mjs";

export const ROUTE = "marketing/funnels/stats";

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the funnel numbers." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source.
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const { from, to } = lastDays(ROLLUP_DAYS, now);
    const out = await staffRead(database, async (tx) => ({
      stats: await funnelStats(tx, { orgId, from, to, now }),
      sync: await readLastSync(tx, { orgId })
    }), deps.asStaff ? { asStaff: deps.asStaff } : undefined);
    return res.status(200).json({
      rows: out.stats.rows,
      unmapped_spend_cents: out.stats.unmapped_spend_cents,
      as_of: iso(out.sync.meta_synced_at ?? out.sync.metrics_synced_at ?? null)
    });
  } catch (err) {
    if (sendNotReady(res, err, "The funnel numbers")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
