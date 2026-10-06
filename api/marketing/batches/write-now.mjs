// /api/marketing/batches/write-now — Chris's Write now button: a batch of
// scripts written now, on top of the weekly drop.
//
// Route key "marketing/batches/write-now" (netlify/functions/api.mjs ROUTES; the
// key is this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8, §2 item 1, §7.7. Shape: docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
//   POST {request_id, count?, funnel_key?, idea_ids?}
//        → 202 {queued:true, batch_id, job_id}
//        In ONE staff transaction: a marketing_batches row (kind on_command,
//        status planned, release_at now) and one 'start_batch' job
//        {batch_id, count, funnel_key, idea_ids}; then the worker is woken.
//        count left out = settings.scripts_per_day. The batch releases as soon
//        as it is done (§7.7; plan unit U35 runs start_batch).
//        400 {error:'invalid', field}  count, funnel_key or idea_ids
//        400 {error:'cap_reached', message}  a model-bill cap is reached
//                                            (costStatus); nothing is queued
//        A repeated request_id answers the first 202 again and queues nothing.
//
// Write now spends model money, so it only ever runs from Chris's tap. It does
// not read `enabled`: it works while the weekly schedule is off.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { validateWriteNowInput, startWriteNow, CapReachedError } from "../../../src/marketing/ideas-store.mjs";
import { getOrCreateSettings } from "../../../src/marketing/settings-store.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/batches/write-now";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to start Write now." });
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
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const input = validateWriteNowInput(body);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      const { batch, job } = await startWriteNow(tx, orgId, { settings, ...input, deps: deps.writeNow });
      return { queued: true, batch_id: batch.id, job_id: job.id };
    });

    // After COMMIT: wake the worker so start_batch runs now. Never throws.
    await (deps.wake ?? wakeWorker)(env);
    return res.status(202).json(answer);
  } catch (err) {
    if (err instanceof CapReachedError) {
      return res.status(400).json({ error: "cap_reached", message: err.message });
    }
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Write now")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
