// /api/marketing/flywheel/run — the Run (and Redo) button on a flywheel row.
//
// Route key "marketing/flywheel/run". Design docs/specs/command-center-design-
// 2026-10-05.md §3.2 rows 3 to 6 and "POST marketing/flywheel/run {campaign,
// stage, request_id, ...} -> 202 {ok, started, already_running, job, poll};
// 400 bad campaign; 503 no_model | not_ready; 409 cap_hit". Unit X3.
//
//   POST {request_id, campaign, stage, note?}
//   stage 4 (the copy) and 5 (the ad strategy):
//     → 202 {ok, stage, started, already_running, job, poll}
//       a marketing_jobs row kind 'flywheel_stage' {campaign, stage}; the worker
//       is woken after the commit and runs it in saved steps (one in flight per
//       campaign and step: a second tap answers that run).
//     409 {error:'blocked', message}   step 4 needs step 3 approved; step 5 needs
//                                      3 and 4 approved (the row says so first)
//     409 {error:'cap_hit', message}   the month's model spend is at its cap
//     503 {error:'no_model'}           no Anthropic key on the site
//   stage 3 (the offer): handed to the existing Write offer path
//     (POST marketing/offer/generate) with this campaign's files as the page sees
//     them; answers what that route answers (202 with its job).
//   stage 6 (the spend read): runs now, free, no model; 200 with the read
//     (same answer as POST marketing/flywheel/spend-read).
//   stage 1 and 2: see WAVE 2B MERGE GLUE below. (X3 alone answered 409
//     {error:'not_built'} for them until units X1 and X2 landed.)
//   400 invalid field campaign | stage · 404 no such campaign · 503 not_ready
//
// Owner and admin only. Nothing here spends ad money or touches Meta.
//
// WAVE 2B MERGE GLUE. Units X1 (step 1, Build the avatar) and X2 (step 2, Research
// the market) each built this route for their own step. After the gate, a stage of
// 1 or 2 is handed to that unit's route body, which answers exactly what that unit's
// route answered:
//   stage 1 → src/marketing/avatar/run-route.mjs          runAvatarStage (unit X1)
//   stage 2 → src/marketing/research/market-run-route.mjs runMarketStage (unit X2)
// Stages 3 to 6 run the code below (unit X3). Unit GL: STAGE_RUNNERS in
// src/marketing/flywheel/stages.mjs is the one list of who runs each step; rows 1
// and 2 name 'avatar' and 'market', and this route hands those to the two bodies
// above (STAGE_HANDLERS, keyed by that word), so the Ideas rows show their buttons.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, NotFoundError
} from "../../../src/marketing/http.mjs";
import {
  parseCampaign, parseStage, readCampaign, jobView, spendReadInTx, startOffer, blockedReason,
  STAGE_RUNNERS, NOT_BUILT
} from "../../../src/marketing/flywheel/http.mjs";
import { startStageJob, capsFor } from "../../../src/marketing/flywheel/store.mjs";
import { todayArizona } from "../../../src/marketing/flywheel/save.mjs";
import { costStatus } from "../../../src/marketing/model-usage.mjs";
import { anthropicKeyOf } from "../../../src/marketing/offer-transport.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";
import offerGenerate from "../offer/generate.mjs";
import { runAvatarStage } from "../../../src/marketing/avatar/run-route.mjs";
import { runMarketStage } from "../../../src/marketing/research/market-run-route.mjs";

export const ROUTE = "marketing/flywheel/run";

/** The route bodies of the steps another unit runs, by STAGE_RUNNERS[n].via (unit GL). */
export const STAGE_HANDLERS = Object.freeze({ avatar: runAvatarStage, market: runMarketStage });

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to run a step." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    const via = /** @type {any} */ (STAGE_RUNNERS)[Number(body.stage)]?.via;
    const handOff = via ? /** @type {any} */ (STAGE_HANDLERS)[via] : null;
    if (handOff) return await handOff(req, res, { ...deps, db: database, requireAuth: async () => staff });
    const requestId = checkRequestId(body.request_id);
    const campaign = parseCampaign(body.campaign);
    const stage = parseStage(body.stage);
    const runner = /** @type {any} */ (STAGE_RUNNERS)[stage];
    if (!runner) {
      return res.status(409).json({ error: "not_built", stage, message: /** @type {any} */ (NOT_BUILT)[stage] || "This step cannot run from the page yet." });
    }

    // Outside any transaction: may read GitHub.
    const view = await readCampaign({ db: database, orgId, campaign, env, deps });
    if (!view.read.campaigns.includes(campaign)) throw new NotFoundError(`There is no flywheel called ${campaign}. Start one first.`);

    if (runner.via === "offer") {
      const out = await startOffer(req, { campaign, files: view.files, offerHandler: deps.offerHandler ?? offerGenerate, deps: deps.offerDeps ?? {} });
      return res.status(out.status).json({ ...(out.body || {}), stage: 3 });
    }

    if (runner.via === "spend-read") {
      const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) =>
        spendReadInTx(tx, { orgId, campaign, files: view.files, opId: `flywheel-spend:${requestId}` }));
      await (deps.wake ?? wakeWorker)(env);
      return res.status(200).json({ ...answer, stage: 6 });
    }

    // Stages that run as a flywheel_stage job.
    const blocked = blockedReason(view.stages, stage);
    const row = view.stages.find((s) => s.n === stage);
    const alreadyRunning = row && row.run && (row.run.status === "queued" || row.run.status === "running");
    if (blocked && !alreadyRunning) return res.status(409).json({ error: "blocked", stage, message: blocked });
    if (!alreadyRunning) {
      if (!anthropicKeyOf(env)) {
        return res.status(503).json({ error: "no_model", message: "No Anthropic key is set on the site. An agent must set it." });
      }
      const caps = await capsFor(database, orgId);
      const cost = await costStatus(database, { orgId, maxMonthUsd: caps.monthCapUsd });
      if (cost.month_capped) {
        return res.status(409).json({ error: "cap_hit", message: `Stopped at the $${caps.monthCapUsd} month cap. Raise it in Settings or wait for next month.` });
      }
    }

    let ran = false;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.replace(/\s+/g, " ").trim().slice(0, 500) : null;
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      ran = true;
      const { job, created } = await startStageJob(tx, {
        orgId, campaign, stage, staffId: staff.id,
        payload: { today: todayArizona(), ...(note ? { note } : {}) }
      });
      return {
        ok: true, stage, started: created, already_running: !created, job: jobView(job),
        poll: `/api/marketing/flywheel?campaign=${campaign}`,
        message: created ? "Started. The row shows each step as it runs." : "That step is already being made. This is that run."
      };
    });
    if (ran && answer.started) await (deps.wake ?? wakeWorker)(env);
    return res.status(202).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "This step")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
