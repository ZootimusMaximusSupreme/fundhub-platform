// /api/marketing/jobs/retry — Chris's Retry button on a stuck machine step.
//
// Route key "marketing/jobs/retry" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §8.3 (Today lists each machine stage with Retry; the owner goal is to run
// marketing from the dashboard, never from Claude Code). Shape:
// docs/specs/marketing-machine-api.md §6.3 (plan unit U26). GET marketing/today's
// stuck_jobs carry the ids this route takes.
//
//   POST {request_id, job_id} → 200 {ok:true, job:{id, kind, status:'queued'}}
//        The failed job goes back in the queue clean (attempts 0, no error, due
//        now) through retryJob (src/marketing/jobs.mjs), in one staff
//        transaction; then the worker is woken.
//        404 {error:'not_found'}         no such job, another company's job, a
//                                        kind the worker does not know (not in
//                                        JOB_KINDS), or an 'offer' job (the
//                                        Write offer button has its own path)
//        400 {error:'invalid', field:'job_id'}  the job is not failed
//        A repeated request_id answers the first 200 again and changes nothing.
//
// Free: a retry spends no model money by itself; the job's own handler checks
// the caps when it runs.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany,
  InvalidError, NotFoundError
} from "../../../src/marketing/http.mjs";
import { retryJob, OFFER_KIND } from "../../../src/marketing/jobs.mjs";
import { JOB_KINDS } from "../../../src/marketing/job-kinds.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/jobs/retry";

const NOT_FOUND = "That step was not found, or it is not one the machine can retry.";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const kinds = deps.jobKinds ?? JOB_KINDS;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to retry a stuck step." });
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
    if (!isUuid(body.job_id)) throw new InvalidError("job_id", "Which step? Send the job_id from the stuck row.");
    const jobId = body.job_id.trim();
    const known = Object.keys(kinds).filter((k) => k !== OFFER_KIND);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const found = (await tx.query(
        `SELECT id, kind, status FROM marketing_jobs WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [jobId, orgId]
      )).rows[0];
      if (!found || found.kind === OFFER_KIND || !known.includes(found.kind)) throw new NotFoundError(NOT_FOUND);
      if (found.status !== "failed") {
        throw new InvalidError("job_id", found.status === "done"
          ? "That step already finished. There is nothing to retry."
          : "That step has not failed. It is waiting or running now.");
      }
      const row = await retryJob(tx, { orgId, id: jobId, kinds: known });
      if (!row) throw new InvalidError("job_id", "That step changed while you were looking. Reload and try again.");
      return { ok: true, job: { id: row.id, kind: row.kind, status: row.status } };
    });

    // After COMMIT: wake the worker so the job runs now. Never throws.
    await (deps.wake ?? wakeWorker)(env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Retry")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
