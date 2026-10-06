// POST /api/marketing/funnels/build — write (or write again) a draft funnel's
// three pages (build unit X4). Contract: docs/specs/marketing-machine-api.md.
//
//   {request_id, id} → 202 {queued:true, job, worker:{started, reason}}
//
// Queues one job of kind 'funnel' (src/marketing/funnel-build.mjs): one model
// call, the copy check, the three pages drawn with the funnel tag and the
// tracking. Refused when the funnel is live or any page is already on
// ClickFunnels (a live page is never rewritten), and while a build or push of
// this funnel is still running.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING).

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth, bearerToken } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany,
  InvalidError, NotFoundError
} from "../../../src/marketing/http.mjs";
import { loadFunnel, inFlightJob, enqueueFunnelJob, jobView, BUILD_KIND } from "../../../src/marketing/funnel-store.mjs";
import { onlyKeys, funnelId, knownConflict, wakeOrFail } from "../../../src/marketing/funnel-routes.mjs";

export const ROUTE = "marketing/funnels/build";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to write a funnel's pages." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    onlyKeys(body, ["request_id", "id"]);
    const id = funnelId(body.id);

    let answer;
    try {
      answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
        const found = await loadFunnel(tx, orgId, id, { lock: true });
        if (!found || !found.funnel.kind) throw new NotFoundError("That funnel was not found, or it was not built here.");
        const { funnel, pages } = found;
        if (funnel.status === "live" || pages.some((p) => p.cf_page_id)) {
          throw new InvalidError("id", `${funnel.path} is on ClickFunnels. A live page is never rewritten. Build a new funnel instead.`);
        }
        if (await inFlightJob(tx, funnel.id)) {
          throw new InvalidError("id", "The pages are already being written or pushed. Wait for that to finish.");
        }
        const job = await enqueueFunnelJob(tx, { orgId, funnelId: funnel.id, kind: BUILD_KIND, staffId: staff.id ?? null });
        return { queued: true, job: jobView(job) };
      });
    } catch (err) {
      const known = knownConflict(err);
      if (known) throw known;
      throw err;
    }

    const worker = await wakeOrFail(database, { job: answer.job, token: bearerToken(req), env, wake: deps.wake });
    const job = worker.reason ? { ...answer.job, status: "failed", error: worker.reason } : answer.job;
    return res.status(202).json({ ...answer, job, worker });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The funnel builder")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
