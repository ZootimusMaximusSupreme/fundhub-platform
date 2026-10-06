// /api/marketing/meta/load — put approved ad videos into Meta, PAUSED.
//
// Route key "marketing/meta/load" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §10.5 ("Load to Meta", "Load all approved", the endpoints) and §2 items 6 and
// 11. Contract: docs/specs/marketing-machine-api.md §6.8 (U01). Build plan U28.
//
//   POST {request_id, ad_video_id}   one video
//   POST {request_id, all: true}     every approved video not loaded yet
//     → 202 {queued: true, jobs: [{ad_number, ad_video_id, job_id}]}
//     400 {error:'invalid', field:'ad_video_id'}  neither sent, both sent, or not a uuid
//     404 {error:'not_found'}                     no ad video with that id in this company
//   A repeated request_id answers the first answer again and queues nothing.
//
// THIS ROUTE NEVER CALLS META. It only writes marketing_jobs rows (kind
// meta_load) inside withRequest's one staff transaction, then — after that
// transaction commits — wakes the marketing worker, which runs the loader
// (src/marketing/meta-load.mjs). Refusals (no approval, no Meta copy, no
// default ad set, the guard, the screen, an enhancement on, the final video
// not in storage yet) show in GET marketing/meta/load-status, never here.
//
// NOTHING HERE TURNS AN AD ON. Every ad the loader makes is PAUSED. Only
// Chris turns an ad on, one at a time (campaigns/write resume_ad).
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12), then a company on the session.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, InvalidError, NotFoundError,
  sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { queueLoads } from "../../../src/marketing/meta-load.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/meta/load";

const PICK_ONE = "Send ad_video_id (one video) or all: true (every approved video), not both.";

/** The body's choice → { adVideoId, all }. Throws InvalidError in plain words. */
export function readChoice(body) {
  const all = body.all === true;
  const hasId = body.ad_video_id !== undefined && body.ad_video_id !== null && body.ad_video_id !== "";
  if (all && hasId) throw new InvalidError("ad_video_id", PICK_ONE);
  if (!all && !hasId) throw new InvalidError("ad_video_id", PICK_ONE);
  if (body.all !== undefined && body.all !== true && body.all !== false) {
    throw new InvalidError("all", "all must be true or false.");
  }
  if (hasId && !isUuid(String(body.ad_video_id))) {
    throw new InvalidError("ad_video_id", "ad_video_id must be the video's id (a uuid).");
  }
  return { adVideoId: hasId ? String(body.ad_video_id).trim().toLowerCase() : null, all };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "method_not_allowed",
      message: "Use POST to load ads. GET marketing/meta/load-status shows how they are doing."
    });
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
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const { adVideoId, all } = readChoice(body);
    const staffId = isUuid(String(staff.id || staff.staff_id || "")) ? String(staff.id || staff.staff_id) : null;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const jobs = await queueLoads(tx, { orgId, adVideoId, all, requestedBy: staffId });
      if (jobs === null) throw new NotFoundError("No ad video with that id.");
      return { queued: true, jobs };
    });

    // After the commit, never inside it: a wake is a network call (spec §4
    // trap 3). It never throws; without it the clock picks the jobs up.
    if (answer.jobs.length) {
      const wake = deps.wake ?? wakeWorker;
      await wake(deps.env ?? process.env);
    }
    return res.status(202).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Loading ads into Meta")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
