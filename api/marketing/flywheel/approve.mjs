// /api/marketing/flywheel/approve — Approve on a flywheel row.
//
// Route key "marketing/flywheel/approve". Design docs/specs/command-center-
// design-2026-10-05.md §3.2 row 6: "Approve (free, one tap; flips the stamp's
// status to approved through one outbox edit that touches the front matter
// only, so the body hash and nothing downstream changes; the row flips at once
// from the pending save and stays when the commit lands) -> POST
// marketing/flywheel/approve {campaign, stage, request_id}" and "-> 200 {ok,
// stage, outbox_id} (outbox edit op set_front_matter_key)". Unit X3.
//
//   POST {request_id, campaign, stage}
//     → 200 {ok, campaign, stage, file, outbox_id, already_approved}
//     400 invalid: campaign, stage, or "step N has no file yet" (field stage)
//     404 no such campaign · 503 not_ready
//   Approving a file that does not clear its bar is allowed ("Approve anyway if
//   you like it"); the row still shows the bar it missed.
//
// STEP 3, THE OFFER (unit GL). The offer is written by the Write offer path, which
// keeps it in marketing_jobs.result. While the newest finished offer run waits (it is
// done and was never saved as step 3, src/marketing/flywheel/offer-stage.mjs
// offerWaiting), Approve writes the whole stamped 03-offer.md from that run in ONE
// outbox save (op id flywheel-offer:<run id>, status approved, one version above the
// file on hand) and keeps the stamp on the run (result.stage_file, with Chris's staff
// id), in the same transaction:
//     → 200 {ok, campaign, stage: 3, file, outbox_id, already_approved: false,
//            written_from_job, version}
// With no run waiting, step 3 is approved like every other step (the edit above).
//
// Free. One outbox save. Owner and admin only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, InvalidError, NotFoundError
} from "../../../src/marketing/http.mjs";
import { parseCampaign, parseStage, fileText, readCampaign } from "../../../src/marketing/flywheel/http.mjs";
import { STAGES, splitFrontMatter, parseFrontMatter } from "../../../scripts/flywheel/status.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { offerStageFile, offerOpId, markOfferApproved } from "../../../src/marketing/flywheel/offer-stage.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/flywheel/approve";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to approve a step." });
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
    const campaign = parseCampaign(body.campaign);
    const stage = parseStage(body.stage);
    const file = STAGES.find((s) => s.n === stage).file;
    const path = `marketing/flywheel/${campaign}/${file}`;

    // Outside any transaction: may read GitHub.
    const view = await readCampaign({ db: database, orgId, campaign, env, deps });
    if (!view.read.campaigns.includes(campaign)) throw new NotFoundError(`There is no flywheel called ${campaign}.`);
    let ran = false;

    // Step 3 with a finished offer run waiting: write the file from the run.
    const waiting = stage === 3 ? view.offer_waiting : null;
    if (waiting) {
      const job = view.jobs[3].job;
      const built = offerStageFile({ job, files: view.files, staffId: staff.id ?? null });
      const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
        ran = true;
        const row = await enqueueRepoWrite(tx, { orgId, opId: offerOpId(job.id), path, mode: "replace", content: built.text });
        await markOfferApproved(tx, { orgId, jobId: job.id, stageFile: { ...built.stageFile, outbox_id: row.id } });
        return {
          ok: true, campaign, stage, file, outbox_id: row.id, already_approved: false,
          written_from_job: String(job.id), version: built.stageFile.version
        };
      });
      if (ran) await (deps.wake ?? wakeWorker)(env);
      return res.status(200).json(answer);
    }

    const text = fileText(view.files, file);
    if (text == null) throw new InvalidError("stage", `Step ${stage} has no file yet, so there is nothing to approve. Run it first.`);
    if (!String(text).startsWith("---\n")) throw new InvalidError("stage", `Step ${stage}'s file has no stamp, so it cannot be marked approved. Redo the step.`);
    const already = parseFrontMatter(splitFrontMatter(text).frontMatter).status === "approved";

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      ran = true;
      const row = await enqueueRepoWrite(tx, {
        orgId,
        opId: `flywheel-approve:${requestId}`,
        path,
        mode: "edit",
        edit: { op: "set_front_matter_key", key: "status", value: "approved" }
      });
      return { ok: true, campaign, stage, file, outbox_id: row.id, already_approved: already };
    });

    if (ran) await (deps.wake ?? wakeWorker)(env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Approve")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
