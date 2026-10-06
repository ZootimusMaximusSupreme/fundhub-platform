// The funnel worker (build unit X4). Netlify runs a function whose name ends in
// -background for up to 15 minutes and answers the caller 202 straight away:
// time for the page writer's model call, or for the ClickFunnels push and its
// proof.
//
// Started by POST /api/marketing/funnels/create, /build and /push-live, which
// save a queued job first and then call this URL with the owner's own session
// token and { job_id } (src/marketing/funnel-transport.mjs wakeFunnelWorker).
//
// THIS IS AN OPEN URL, so it checks the caller exactly the way /api does: a live
// staff session, then owner or admin (ROLE_SETS.MARKETING), then the job must
// belong to that person's company and still be queued (the claim in
// src/marketing/funnel-worker.mjs). A stranger gets a plain 404 and nothing
// runs. Same pattern as netlify/functions/marketing-offer-background.mjs.
//
// The real work is src/marketing/funnel-worker.mjs. This file is a thin shell.

import { db } from "../../src/db.mjs";
import { authenticate, AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { allowsRole, isUuid, ROLE_SETS } from "../../src/http/read-api.mjs";
import { runFunnelJob } from "../../src/marketing/funnel-worker.mjs";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

export function makeHandler({ database = db, run = runFunnelJob, auth = authenticate } = {}) {
  return async function handler(req) {
    const authorization = req?.headers?.get ? req.headers.get("authorization") : null;
    const who = await auth({ headers: { authorization } }, { db: database });
    if (!who || who === AUTH_UNAVAILABLE || !allowsRole(ROLE_SETS.MARKETING, who.staff && who.staff.role)) {
      console.error("[marketing-funnel] refused: no owner/admin session on the request");
      return json(404, { ok: false, error: "not_found" });
    }

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const jobId = body && typeof body.job_id === "string" ? body.job_id.trim() : "";
    if (!isUuid(jobId)) return json(400, { ok: false, error: "bad_job_id" });

    console.log(`[marketing-funnel] build ${String(process.env.COMMIT_REF || "unknown").slice(0, 8)} job ${jobId}`);
    const out = await run(database, { jobId, orgId: who.staff.org_id });
    console.log(`[marketing-funnel] job ${jobId}: ${out.status}${out.error ? ` (${String(out.error).slice(0, 200)})` : ""}`);
    return json(200, { ok: out.status === "done", status: out.status, job_id: out.job_id });
  };
}

// Default export only. A named `handler` export makes Netlify treat this as an old
// Lambda-style function, and those fail to deploy once the site's variables pass 4 KB.
const handler = makeHandler();
export default handler;
