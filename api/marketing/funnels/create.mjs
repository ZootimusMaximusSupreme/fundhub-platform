// POST /api/marketing/funnels/create — make a book-a-call funnel with its own
// address and tag, and start writing its pages (build unit X4; owner order
// 2026-10-05). Contract: docs/specs/marketing-machine-api.md.
//
//   {request_id, offer_key, lane?, name?, campaign?, path?, build?}
//   → 200 {funnel, job, worker:{started, reason}}
//
// The address is picked for Chris (the offer's word: /blueprint, then
// /blueprint-2 if that is taken) unless he typed one. Either way it is checked
// against the live ClickFunnels pages (a read; nothing there is changed), our
// own funnels and the reserved words. The tag (fnl-blueprint) is set once and
// never changes. The funnel is a draft: nothing is on ClickFunnels until Push
// live. build (default true) queues the page writer (job kind 'funnel').
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING).

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth, bearerToken } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { funnelView } from "../../../src/marketing/settings-store.mjs";
import { createBuiltFunnel, enqueueFunnelJob, jobView, BUILD_KIND } from "../../../src/marketing/funnel-store.mjs";
import {
  validateCreate, liveTakenPaths, sendLiveUnreadable, knownConflict, wakeOrFail
} from "../../../src/marketing/funnel-routes.mjs";

export const ROUTE = "marketing/funnels/create";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to make a funnel." });
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
    const input = validateCreate(body);

    const live = await (deps.liveTaken ?? liveTakenPaths)({ env });
    if (!live.ok) return sendLiveUnreadable(res, live.error, "Nothing was made.");

    let answer;
    try {
      answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
        const made = await createBuiltFunnel(tx, {
          orgId, staffId: staff.id ?? null, offerKey: input.offerKey, lane: input.lane, name: input.name,
          campaign: input.campaign, base: input.base, liveTaken: live.taken
        });
        const job = input.build
          ? await enqueueFunnelJob(tx, { orgId, funnelId: made.funnel.id, kind: BUILD_KIND, staffId: staff.id ?? null })
          : null;
        return { funnel: funnelView({ ...made.funnel, pages: made.pages }), job: jobView(job) };
      });
    } catch (err) {
      const known = knownConflict(err);
      if (known) throw known;
      throw err;
    }

    const worker = await wakeOrFail(database, { job: answer.job, token: bearerToken(req), env, wake: deps.wake });
    const job = answer.job && worker.reason ? { ...answer.job, status: "failed", error: worker.reason } : answer.job;
    return res.status(200).json({ ...answer, job, worker });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The funnel builder")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
