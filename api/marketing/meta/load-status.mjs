// /api/marketing/meta/load-status — how each Meta load is doing.
//
// Route key "marketing/meta/load-status" (netlify/functions/api.mjs ROUTES).
// Spec docs/specs/marketing-machine-2026-10-04.md §10.5. Contract:
// docs/specs/marketing-machine-api.md §6.8 (U01). Build plan U28.
//
//   GET → 200 {loads: [{ad_number, ad_video_id,
//                       state: 'waiting'|'loading'|'loaded'|'refused'|'failed',
//                       reasons: [plain sentences],
//                       meta_video_id, meta_creative_id, meta_ad_external_id,
//                       ad_row_id, ad_status,
//                       ad_set: {external_id, status} | null,
//                       campaign: {external_id, status} | null,
//                       step, angle, funnel_key, loaded_at}],   ← extra keys for the Launch tab
//              as_of}
//
//   One row per ad video that was asked to load, or that already holds a Meta
//   id. The Meta ids fill in as Meta returns them. ad_status, ad_set.status and
//   campaign.status come from our rows (the last Meta pull), so the Launch tab
//   can say when an ad set or campaign is paused. ad_set and campaign are null
//   when the funnel has no default ad set. as_of is the last Meta pull (null if
//   Meta never synced).
//
// Read only. Never calls Meta. ads, ad_sets, campaigns, ad_scripts and
// ad_videos force row security, so it reads inside one staff transaction.
// Owner and admin only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany } from "../../../src/marketing/http.mjs";
import { readLoadStatus } from "../../../src/marketing/meta-load.mjs";
import { readLastSync } from "../today.mjs";

export const ROUTE = "marketing/meta/load-status";

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read how the Meta loads are doing." });
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
    const out = await staffRead(database, async (tx) => {
      const loads = await readLoadStatus(tx, { orgId });
      const sync = await readLastSync(tx, { orgId });
      return { loads, sync };
    });
    return res.status(200).json({
      loads: out.loads,
      as_of: iso(out.sync.meta_synced_at ?? out.sync.metrics_synced_at ?? null)
    });
  } catch (err) {
    if (sendNotReady(res, err, "Loading ads into Meta")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
