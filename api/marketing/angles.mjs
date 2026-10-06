// GET /api/marketing/angles — the marketing numbers by ANGLE, last 30 Arizona days.
//
// Route key "marketing/angles" (netlify/functions/api.mjs ROUTES). Spec
// docs/specs/marketing-machine-2026-10-04.md §11.2 and §11.3 (the Angles view;
// "Make more of this" is POST marketing/ideas with the angle_key). Shape:
// docs/specs/marketing-machine-api.md §6.6 (fixed shape 9):
//
//   200 {rows:[{angle_key, name, spend_cents, ads, leads, booked, sales,
//               cash_cents, roas}], as_of}
//
//   one row per angle that had spend or leads in the window, biggest spend
//   first. Which angle an ad is: its number's live script's angle_key, else the
//   label its creative's script carries (v_ad_label_spine). name comes from
//   marketing/ads/angles.json; a key not in that file shows the key.
//   The counting rules are U20's (src/marketing/metrics.mjs). null = unknown,
//   never 0. Money is integer cents. as_of = the last Meta sync (null if never).
//
// READ ONLY. Nothing here writes a row, calls Meta or calls a model.
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12), then a company on the session.
// ads, campaigns, ad_scripts and ad_metrics_daily force partner row security,
// so every read runs inside one asStaff() transaction (staffRead).

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany } from "../../src/marketing/http.mjs";
import { byAngle, lastDays, loadAngleNames, ROLLUP_DAYS } from "../../src/marketing/metrics-rollups.mjs";
import { readLastSync } from "./today.mjs";

export const ROUTE = "marketing/angles";

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the angles." });
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
    const angleNames = deps.angleNames ?? loadAngleNames();
    const out = await staffRead(database, async (tx) => ({
      rows: await byAngle(tx, { orgId, from, to, now, angleNames }),
      sync: await readLastSync(tx, { orgId })
    }), deps.asStaff ? { asStaff: deps.asStaff } : undefined);
    return res.status(200).json({
      rows: out.rows,
      as_of: iso(out.sync.meta_synced_at ?? out.sync.metrics_synced_at ?? null)
    });
  } catch (err) {
    if (sendNotReady(res, err, "The angle numbers")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
