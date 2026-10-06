// The offer writer. Netlify runs a function whose name ends in -background for
// up to 15 minutes and answers the caller 202 straight away — the only kind of
// function here with time for six offers, four judges and a write-up (see the
// timing table in netlify/functions/ad-video-worker-background.mjs: /api is
// killed at 26 s, a scheduled function at 30 s).
//
// Started by POST /api/marketing/offer/generate (api/marketing/offer/generate.mjs),
// which saves a queued job first and then calls this URL with the owner's own
// session token and { job_id }.
//
// THIS IS AN OPEN URL, so it checks the caller exactly the way /api does: a live
// staff session, then the owner/admin role, then the job must belong to that
// person's company and still be queued. A stranger gets a plain 404 and nothing
// runs. There is no shared secret to leak or to forget to set.
//
// The real work is src/marketing/offer-run.mjs. This file is a thin shell.

import { db } from "../../src/db.mjs";
import { authenticate, AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { allowsRole, isUuid } from "../../src/http/read-api.mjs";
import { runOfferJob, OFFER_ROLES } from "../../src/marketing/offer-run.mjs";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

export function makeHandler({ database = db, run = runOfferJob, auth = authenticate } = {}) {
  return async function handler(req) {
    const authorization = req?.headers?.get ? req.headers.get("authorization") : null;
    const who = await auth({ headers: { authorization } }, { db: database });
    if (!who || who === AUTH_UNAVAILABLE || !allowsRole(OFFER_ROLES, who.staff && who.staff.role)) {
      console.error("[marketing-offer] refused: no owner/admin session on the request");
      return json(404, { ok: false, error: "not_found" });
    }

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const jobId = body && typeof body.job_id === "string" ? body.job_id.trim() : "";
    if (!isUuid(jobId)) return json(400, { ok: false, error: "bad_job_id" });

    console.log(`[marketing-offer] build ${String(process.env.COMMIT_REF || "unknown").slice(0, 8)} writing job ${jobId}`);
    const out = await run(database, { jobId, orgId: who.staff.org_id });
    console.log(`[marketing-offer] job ${jobId}: ${out.status || out.error}`);
    return json(200, out);
  };
}

export const handler = makeHandler();
export default handler;
