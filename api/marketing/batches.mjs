// /api/marketing/batches — batch history: every weekly drop and every Write now,
// newest first, with how many scripts each one planned, wrote and flagged.
//
// Route key "marketing/batches" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §7.8,
// §7.4. Table marketing_batches (migration 414). Shape:
// docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
//   GET → 200 {batches:[{id, kind, week_key, status, release_at, released_at,
//              counts:{total, ready, flagged, failed}, error}], write_now_ready}
//
// write_now_ready is true only once the job kind 'start_batch' is registered in
// src/marketing/job-kinds.mjs (plan unit U35). Until then a Write now would sit
// in the queue and make no drafts, so the screens hide the button (UI-STANDARDS
// §5: no dead button).
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, hasCompany, sendNotReady } from "../../src/marketing/http.mjs";
import { listBatches, batchView, START_BATCH_KIND } from "../../src/marketing/ideas-store.mjs";
import { JOB_KINDS } from "../../src/marketing/job-kinds.mjs";

export const ROUTE = "marketing/batches";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const kinds = deps.jobKinds ?? JOB_KINDS;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the batch history." });
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
    const rows = await staffRead(database, (tx) => listBatches(tx, orgId));
    return res.status(200).json({
      batches: rows.map(batchView),
      write_now_ready: Boolean(Object.prototype.hasOwnProperty.call(kinds, START_BATCH_KIND) && kinds[START_BATCH_KIND])
    });
  } catch (err) {
    if (sendNotReady(res, err, "Batch history")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
