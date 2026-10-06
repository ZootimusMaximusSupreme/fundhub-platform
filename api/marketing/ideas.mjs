// /api/marketing/ideas — the ideas inbox. Chris drops an idea (typed or said
// into the keyboard mic), or accepts one of the planner's angle suggestions,
// and it goes into the next batch — or right now, with write_now.
//
// Route key "marketing/ideas" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §7.8,
// §7.5 step 7, §8.1 tab 4. Table ad_ideas (migration 414). Shapes:
// docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
//   GET   ?status=  → 200 {ideas:[{id, source, kind, raw_points, topic,
//                    script_format, funnel_key, angle_key, status, script_id,
//                    created_at}]}  newest first; status filters
//         400 {error:'invalid', field:'status'}  not new|writing|written|failed|dropped
//   POST  {request_id, raw_points, source?:'chris'|'suggestion', script_format?,
//          funnel_key?, angle_key?, write_now?}
//         → 200 {idea}                         the idea is saved
//         → 200 {idea, batch_id, job_id}       write_now: also an on-command
//                                              batch of 1 and its start_batch job
//         → 200 {idea, note}                   write_now, but a model-bill cap is
//                                              reached: the idea is saved, nothing
//                                              is queued, note says which cap
//         In ONE staff transaction: the ad_ideas row (status new) and one outbox
//         row writing marketing/ads/ideas/<YYYY-MM-DD>-<id8>.md; then the worker
//         is woken. 'machine' is refused: the planner writes its own ideas.
//         400 {error:'invalid', field}  raw_points, source, script_format,
//                                       funnel_key, angle_key or write_now
//         A repeated request_id answers the first save again and writes nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId,
  sendKnownError, sendNotReady, hasCompany
} from "../../src/marketing/http.mjs";
import {
  validateIdeaInput, validateIdeaStatus, ideaView, ideaFilePath, ideaFileContent,
  insertIdea, listIdeas, assertFunnel, startWriteNow, CapReachedError
} from "../../src/marketing/ideas-store.mjs";
import { getOrCreateSettings } from "../../src/marketing/settings-store.mjs";
import { enqueueRepoWrite } from "../../src/repo/outbox.mjs";
import { wakeWorker } from "../../src/marketing/wake.mjs";

export const ROUTE = "marketing/ideas";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read ideas or POST to save one." });
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
    if (req.method === "GET") {
      const status = validateIdeaStatus(req.query?.status);
      const rows = await staffRead(database, (tx) => listIdeas(tx, orgId, { status }));
      return res.status(200).json({ ideas: rows.map(ideaView) });
    }

    // POST — check everything that needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const input = validateIdeaInput(body);

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      await assertFunnel(tx, orgId, input.funnelKey);
      const row = await insertIdea(tx, orgId, { ...input, staffId: staff.id ?? null });
      await enqueueRepoWrite(tx, {
        orgId,
        opId: `idea-file:${row.id}`,
        path: ideaFilePath(row),
        mode: "replace",
        content: ideaFileContent(row)
      });
      const out = { idea: ideaView(row) };
      if (!input.writeNow) return out;

      // Write now from this idea: one script. A cap reached keeps the idea and
      // says why, instead of refusing the whole save.
      const settings = await getOrCreateSettings(tx, orgId);
      try {
        const started = await startWriteNow(tx, orgId, {
          settings, count: 1, funnelKey: input.funnelKey, ideaIds: [row.id], deps: deps.writeNow
        });
        return { ...out, batch_id: started.batch.id, job_id: started.job.id };
      } catch (err) {
        if (!(err instanceof CapReachedError)) throw err;
        return { ...out, note: `Your idea is saved. It was not written now: ${err.message}` };
      }
    });

    // After COMMIT: wake the worker (the idea's file, and the batch when one was
    // queued). Never throws.
    await (deps.wake ?? wakeWorker)(env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The ideas inbox")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
