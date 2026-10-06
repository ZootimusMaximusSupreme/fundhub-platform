// /api/marketing/funnels — where the ads send people, and which Meta campaigns
// belong to each funnel.
//
// Route key "marketing/funnels" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §6 Step 3. Table: db/migrations/410_marketing_settings_funnels.sql; the two
// starting funnels come from db/seed/297_marketing_funnels.sql.
//
//   GET   → 200 {funnels:[{id, key, name, landing_url, offer_key, lane, book_call,
//                          format_mix, cta_type, meta_campaign_ids,
//                          default_ad_set_external_id, weight, active,
//                          created_at, updated_at}],
//                campaigns:[{external_id, name, status, spend_7d_cents, funnel_key}],
//                ad_sets:[{external_id, name, status, campaign_external_id}],
//                as_of}
//         campaigns and ad_sets are the synced Meta ones, so Chris can map them.
//         spend_7d_cents is the last 7 Arizona days, today included; null when
//         no ad-day is saved for that campaign in the window (never 0).
//         as_of is the last Meta sync (null when it never synced).
//   POST  {request_id, funnel:{key, ...fields, updated_at?}} → 200 {funnel}
//         Upsert by key. A new key makes a funnel (name, landing_url and lane
//         needed). An existing key changes only with its current updated_at.
//         400 {error:'invalid', field, message}  bad value, unknown field, or a
//                                                 campaign already on another funnel
//         409 {error:'stale', message, current}  updated_at missing or old
//         A repeated request_id answers the first save again and writes nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). campaigns,
// ads, ad_sets and ad_metrics_daily force partner row security, so the GET
// reads inside one asStaff() transaction (staffRead).

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId,
  sendKnownError, sendNotReady, hasCompany
} from "../../src/marketing/http.mjs";
import {
  listFunnels, upsertFunnel, funnelView, validateFunnelInput,
  listCampaignsWithSpend, listAdSets
} from "../../src/marketing/settings-store.mjs";
import { readLastSync } from "./today.mjs";

export const ROUTE = "marketing/funnels";

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read funnels or POST to save one." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source (src/marketing/http.mjs
  // gateMarketing does the same three steps).
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    if (req.method === "GET") {
      const out = await staffRead(database, async (tx) => {
        const funnels = await listFunnels(tx, orgId);
        const campaigns = await listCampaignsWithSpend(tx, { orgId, now });
        const adSets = await listAdSets(tx, { orgId });
        const sync = await readLastSync(tx, { orgId });
        return { funnels, campaigns, adSets, sync };
      });
      return res.status(200).json({
        funnels: out.funnels.map(funnelView),
        campaigns: out.campaigns,
        ad_sets: out.adSets,
        as_of: iso(out.sync.meta_synced_at ?? out.sync.metrics_synced_at ?? null)
      });
    }

    // POST — check everything that needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    validateFunnelInput(body.funnel);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const row = await upsertFunnel(tx, orgId, { funnel: body.funnel });
      return { funnel: funnelView(row) };
    });
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Marketing funnels")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
