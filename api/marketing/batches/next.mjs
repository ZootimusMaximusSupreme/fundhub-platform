// /api/marketing/batches/next — the next batch's plan, live, and Chris's one-time
// changes to it.
//
// Route key "marketing/batches/next" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §7.5, §7.8.
// Shape: docs/specs/marketing-machine-api.md §6.4 (plan unit U23).
//
//   GET  → 200 {next:{release_at, week_key, enabled, total, size_rule,
//                     funnels:[{funnel_key, name, spend_7d_cents, share, slots}],
//                     slots:[{n, funnel_key, script_format, style, source, angle_key,
//                             idea_id, reason}],
//                     suggestions:[{angle_key, name, why, last_ran_on,
//                                   numbers:{spend_7d_cents, leads, cpl_cents}}],
//                     unmapped_spend_cents, overrides},
//               saved:{batch_id, status}|null, as_of}
//        `next` is a live preview: the planner (src/marketing/planner.mjs) runs on the
//        current numbers every time; nothing is written. `saved` is the next weekly
//        batch once its plan is saved (3 hours before release), else null. as_of is the
//        last Meta sync.
//   POST {request_id, updated_at, overrides} → 200, the same body with the overrides on
//        Saves one-time changes for the next weekly batch into
//        marketing_settings.next_overrides ({} clears them). updated_at is
//        marketing_settings.updated_at (the overrides live on that row).
//        400 {error:'invalid', field:'overrides' | 'overrides.<key>', message}
//        409 {error:'stale', message, current:{updated_at, overrides}}
//        A repeated request_id answers the first save again and writes nothing.
//
// The overrides Chris can send (U23 owns these keys):
//   total         1..100 scripts for the next weekly batch
//   funnel_slots  {funnel_key: 0..100} — exactly that many for that funnel (0 = leave it
//                 out this time); the rest is split by spend as usual
//   skip_angles   [angle_key] — the planner leaves these angles out this time
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING) (requireAuth
// ignores roles, CLAUDE.md §12). The company is the session's, never one from the body.
// ads, ad_scripts, campaigns and ad_metrics_daily force partner row security, so the GET
// reads inside one asStaff() transaction (staffRead) and the POST writes and re-reads
// inside withRequest's one transaction. No model, GitHub or Meta call happens here.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId,
  sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { parseUpdatedAt } from "../../../src/marketing/settings-store.mjs";
import { planBatch, nextReleaseAt, weekKey } from "../../../src/marketing/planner.mjs";
import {
  gatherPlanInputs, readSavedNext, saveOverrides, validateOverrides
} from "../../../src/marketing/planner-data.mjs";
import { readLastSync } from "../today.mjs";

export const ROUTE = "marketing/batches/next";

/** @param {unknown} v */
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/**
 * Reads everything for the answer inside one staff transaction and plans.
 * @param {any} tx @param {{ orgId: string, now: Date }} opts
 */
export async function readNext(tx, { orgId, now }) {
  const inputs = await gatherPlanInputs(tx, { orgId, now });
  const releaseAt = nextReleaseAt(inputs.settings, now);
  const week = weekKey(releaseAt, inputs.settings && inputs.settings.timezone);
  const saved = await readSavedNext(tx, { orgId, weekKey: week });
  const sync = await readLastSync(tx, { orgId });
  return nextAnswer({ inputs, releaseAt, week, saved, sync });
}

/**
 * The answer body, the same for GET and POST.
 * @param {{ inputs: any, releaseAt: Date, week: string, saved: any, sync: any }} parts
 */
export function nextAnswer({ inputs, releaseAt, week, saved, sync }) {
  const plan = planBatch(inputs);
  return {
    next: {
      release_at: releaseAt.toISOString(),
      week_key: week,
      enabled: !!(inputs.settings && inputs.settings.enabled),
      total: plan.total,
      size_rule: plan.size_rule,
      funnels: plan.funnels,
      slots: plan.slots,
      suggestions: plan.suggestions,
      unmapped_spend_cents: plan.unmapped_spend_cents,
      overrides: plan.overrides
    },
    saved: saved || null,
    as_of: iso((sync && (sync.meta_synced_at ?? sync.metrics_synced_at)) ?? null)
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "method_not_allowed",
      message: "Use GET to read the next batch's plan or POST to change it."
    });
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
  const now = deps.now ? new Date(deps.now) : new Date();

  try {
    if (req.method === "GET") {
      const answer = await staffRead(database, (tx) => readNext(tx, { orgId, now }));
      return res.status(200).json(answer);
    }

    // POST — check everything that needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    parseUpdatedAt(body.updated_at);
    validateOverrides(body.overrides);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      await saveOverrides(tx, orgId, {
        overrides: body.overrides,
        updatedAt: body.updated_at,
        staffId: staff.id ?? null
      });
      return readNext(tx, { orgId, now });
    });
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The next batch plan")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
