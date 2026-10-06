// POST /api/marketing/funnels/push-live — put a built funnel live on
// ClickFunnels as NEW pages (build unit X4; owner order 2026-10-05: "we can
// push a funnel live, /blueprint or similar"). Contract:
// docs/specs/marketing-machine-api.md.
//
//   {request_id, id, confirm_url} → 202 {queued:true, job, url, worker:{started, reason}}
//
// THE TWO TAPS. The screen's second tap names the address ("This puts
// https://apply.fundhub.ai/blueprint live"). confirm_url is that address; it
// must equal the funnel's address or nothing happens, so a stale screen can
// never push a different page than the one Chris read (design §5 rules 5, 16).
// The screen sends it online only, never from its offline queue.
//
// The push itself is job kind 'funnel_push' (src/marketing/funnel-push.mjs): it
// checks all three addresses are still free, makes one NEW ClickFunnels funnel on
// the apply.fundhub.ai domain and three NEW custom HTML pages inside it (X4F),
// never changes a page it did not make, and proves each page live with a
// cache-busted read before the funnel says "live". Costs $0; no ad changes.
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
import { loadFunnel, inFlightJob, enqueueFunnelJob, jobView, PUSH_KIND } from "../../../src/marketing/funnel-store.mjs";
import { onlyKeys, funnelId, knownConflict, wakeOrFail } from "../../../src/marketing/funnel-routes.mjs";

export const ROUTE = "marketing/funnels/push-live";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to push a funnel live." });
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
    onlyKeys(body, ["request_id", "id", "confirm_url"]);
    const id = funnelId(body.id);
    if (typeof body.confirm_url !== "string" || !body.confirm_url.trim()) {
      throw new InvalidError("confirm_url", "Confirm the address first: the second tap names it.");
    }

    let answer;
    try {
      answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
        const found = await loadFunnel(tx, orgId, id, { lock: true });
        if (!found || !found.funnel.kind) throw new NotFoundError("That funnel was not found, or it was not built here.");
        const { funnel, pages } = found;
        if (funnel.status === "live") throw new InvalidError("id", `${funnel.landing_url} is already live.`);
        if (pages.length !== 3 || pages.some((p) => !p.html)) {
          throw new InvalidError("id", "Build the pages first. There is nothing to push yet.");
        }
        if (body.confirm_url.trim() !== funnel.landing_url) {
          throw new InvalidError("confirm_url",
            `You confirmed ${body.confirm_url.trim()}, but this funnel's address is ${funnel.landing_url}. Nothing was pushed.`);
        }
        if (await inFlightJob(tx, funnel.id)) {
          throw new InvalidError("id", "The pages are already being written or pushed. Wait for that to finish.");
        }
        const job = await enqueueFunnelJob(tx, {
          orgId, funnelId: funnel.id, kind: PUSH_KIND, staffId: staff.id ?? null,
          extra: { confirm_url: funnel.landing_url }
        });
        return { queued: true, job: jobView(job), url: funnel.landing_url };
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
