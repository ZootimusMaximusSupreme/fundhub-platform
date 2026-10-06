// /api/marketing/settings — the marketing machine's settings, one row per company.
//
// Route key "marketing/settings" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §6 Step 3; defaults §17. Table: db/migrations/410_marketing_settings_funnels.sql.
//
//   GET   → 200 {settings:{org_id, enabled, batch_weekday, batch_time, timezone,
//           scripts_per_day, days_per_batch, size_rule, format_style,
//           draft_expiry_days, winner_rule, ad_number_floor, next_overrides,
//           max_batch_cost_usd, max_month_cost_usd, submagic_template,
//           caption_position_y, magic_zooms, clean_audio, caption_dictionary,
//           animation_mode, flip_horizontal, settle_minutes, quiet_start,
//           quiet_end, updated_at, updated_by}}
//         The first read makes the row with the defaults (enabled false).
//   POST  {request_id, updated_at, patch:{...}} → 200 {settings}
//         400 {error:'invalid', field, message}  a bad value or unknown key
//         409 {error:'stale', message, current}   updated_at is not the saved one
//         A repeated request_id answers the first save again and writes nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The
// company is the session's, never one from the body. Turning the machine on is
// `patch:{enabled:true}` — Chris's tap in Settings; nothing else sets it.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId,
  sendKnownError, sendNotReady, hasCompany
} from "../../src/marketing/http.mjs";
import {
  getOrCreateSettings, saveSettings, settingsView,
  validateSettingsPatch, parseUpdatedAt
} from "../../src/marketing/settings-store.mjs";

export const ROUTE = "marketing/settings";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read settings or POST to save them." });
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
      const row = await staffRead(database, (tx) => getOrCreateSettings(tx, orgId));
      return res.status(200).json({ settings: settingsView(row) });
    }

    // POST — check everything that needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    parseUpdatedAt(body.updated_at);
    validateSettingsPatch(body.patch);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const row = await saveSettings(tx, orgId, {
        patch: body.patch,
        updatedAt: body.updated_at,
        staffId: staff.id ?? null
      });
      return { settings: settingsView(row) };
    });
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Marketing settings")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
