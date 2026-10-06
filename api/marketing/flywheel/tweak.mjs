// /api/marketing/flywheel/tweak — Tweak on a flywheel row: one line of what to
// change, saved to the owner notes, then that step runs again with it.
//
// Route key "marketing/flywheel/tweak". Design docs/specs/command-center-
// design-2026-10-05.md §3.2 row 6: "Tweak (one-line box ...) -> POST
// marketing/flywheel/tweak {campaign, stage, note, request_id}; the note is
// appended as one dated line under ## Notes in 00-OWNER-NOTES.md (append only,
// never a rewrite) and also rides in the new run's payload, so the run does not
// wait for the commit" and "-> 202 {ok, job, outbox_id} (outbox edit op
// append_line_under_heading)". Unit X3.
//
//   POST {request_id, campaign, stage, note}
//     → 202 {ok, campaign, stage, line, outbox_id, job, rerun{started, reason}}
//       Always: the line "YYYY-MM-DD | stage N | <note>" is queued for the
//       owner notes (and the worker woken to carry it to git).
//       Then the step runs again where it can:
//         4, 5  a new flywheel_stage job with the note in its payload (or the
//               running one, or blocked with the reason: approve 3 / 3 and 4)
//         6     the spend read runs now in the same transaction (free)
//         3     handed to the Write offer path with the new line in its notes
//         1, 2  not yet (units X1, X2): rerun.reason says so
//     400 invalid: campaign, stage, note; "no owner notes" (field campaign)
//     404 no such campaign · 503 not_ready
//
// The note itself is free. The re-run costs what that step costs (the row's
// cost line says so before the tap). Owner and admin only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, InvalidError, NotFoundError
} from "../../../src/marketing/http.mjs";
import {
  parseCampaign, parseStage, parseNote, readCampaign, jobView, spendReadInTx, startOffer, blockedReason,
  fileText, noteLine, STAGE_RUNNERS, NOT_BUILT
} from "../../../src/marketing/flywheel/http.mjs";
import { NOTES_FILE, NOTES_HEADING } from "../../../src/marketing/flywheel/campaigns.mjs";
import { startStageJob } from "../../../src/marketing/flywheel/store.mjs";
import { todayArizona } from "../../../src/marketing/flywheel/save.mjs";
import { anthropicKeyOf } from "../../../src/marketing/offer-transport.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";
import offerGenerate from "../offer/generate.mjs";

export const ROUTE = "marketing/flywheel/tweak";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to tweak a step." });
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
    const note = parseNote(body.note);
    const today = todayArizona();
    const line = noteLine({ today, stage, note });

    // Outside any transaction: may read GitHub.
    const view = await readCampaign({ db: database, orgId, campaign, env, deps });
    if (!view.read.campaigns.includes(campaign)) throw new NotFoundError(`There is no flywheel called ${campaign}. Start one first.`);
    if (fileText(view.files, NOTES_FILE) == null) {
      throw new InvalidError("campaign", "This flywheel has no owner notes file yet. Start it from the page first.");
    }

    const runner = /** @type {any} */ (STAGE_RUNNERS)[stage];
    const row = view.stages.find((s) => s.n === stage);
    const running = row && row.run && (row.run.status === "queued" || row.run.status === "running");
    const blocked = runner && runner.via === "job" ? blockedReason(view.stages, stage) : null;
    let ran = false;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      ran = true;
      const saved = await enqueueRepoWrite(tx, {
        orgId,
        opId: `flywheel-tweak:${requestId}`,
        path: `marketing/flywheel/${campaign}/${NOTES_FILE}`,
        mode: "edit",
        edit: { op: "append_line_under_heading", heading: NOTES_HEADING, line }
      });
      const base = { ok: true, campaign, stage, line, outbox_id: saved.id, job: null };

      if (!runner) {
        return { ...base, rerun: { started: false, reason: /** @type {any} */ (NOT_BUILT)[stage] || "This step cannot re-run from the page yet." } };
      }
      if (runner.via === "spend-read") {
        const spend = await spendReadInTx(tx, { orgId, campaign, files: view.files, opId: `flywheel-spend:${requestId}` });
        return { ...base, rerun: { started: true, reason: null }, spend };
      }
      if (runner.via === "offer") {
        // Started after the commit (the offer path has its own transaction).
        return { ...base, rerun: { started: false, reason: "pending", via: "offer" } };
      }
      if (blocked && !running) return { ...base, rerun: { started: false, reason: blocked } };
      if (!running && !anthropicKeyOf(env)) {
        return { ...base, rerun: { started: false, reason: "No Anthropic key is set on the site. An agent must set it." } };
      }
      const { job, created } = await startStageJob(tx, {
        orgId, campaign, stage, staffId: staff.id, payload: { today, note }
      });
      return {
        ...base,
        job: jobView(job),
        rerun: {
          started: created,
          reason: created ? null : "That step was already running, so the note is saved and the next run reads it."
        }
      };
    });

    let out = answer;
    if (ran && answer.rerun && answer.rerun.via === "offer") {
      const offer = await startOffer(req, {
        campaign, files: view.files, extraNote: line,
        offerHandler: deps.offerHandler ?? offerGenerate, deps: deps.offerDeps ?? {}
      });
      const ok = offer.status >= 200 && offer.status < 300 && offer.body && offer.body.ok !== false;
      out = {
        ...answer,
        job: ok && offer.body.job ? offer.body.job : null,
        rerun: ok
          ? { started: Boolean(offer.body.started), reason: offer.body.already_running ? offer.body.message : null, via: "offer" }
          : { started: false, reason: (offer.body && offer.body.message) || "The offer writer did not start.", via: "offer" }
      };
    }
    if (ran) await (deps.wake ?? wakeWorker)(env);
    return res.status(202).json(out);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Tweak")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
