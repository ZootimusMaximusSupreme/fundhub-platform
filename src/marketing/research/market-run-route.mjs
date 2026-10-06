// Step 2 of /api/marketing/flywheel/run — run one flywheel step on the server. This file starts
// step 2 (wave 2b merge glue: api/marketing/flywheel/run.mjs checks the gate and hands stage 2 here;
// X2 built this as the whole route). It starts
// step 2, "What the market sells" (Research the market, J2), and its Resume.
//
// Route key "marketing/flywheel/run". Design docs/specs/command-center-design-2026-10-05.md
// §2 row J2, §3.2 item 6 row 2 and "Endpoints" (`POST marketing/flywheel/run {campaign,
// stage, request_id, market?, competitors?, retry_job_id?}` → `202 {ok, started,
// already_running, job, poll}`; `400` bad campaign; `503 no_model | not_ready`; `409 cap_hit`,
// answered here as 400 cap_reached because the contract keeps 409 for 'stale' — a gap in its §8);
// contract docs/specs/marketing-machine-api.md §6.11. Unit X2. Step 1 (the avatar) and steps
// 4 and 5 add their own `stage` branch here when they land; until then those numbers answer
// 400 with the reason, never start something else.
//
// The run itself is a marketing_jobs row of kind 'flywheel_stage' run in 5 saved steps on the
// marketing worker (src/marketing/flywheel/ad-research.mjs). One run per company, campaign
// and stage in flight (migration 429): a second tap gets that run back. retry_job_id resumes a
// stopped run from its saved steps (the same as POST marketing/jobs/retry).
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING).

import fs from "node:fs";
import { db } from "../../db.mjs";
import { dbDown } from "../../http/db-down.mjs";
import { requireAuth } from "../../http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../http/read-api.mjs";
import { withRequest, readBody, checkRequestId, sendKnownError, hasCompany, InvalidError } from "../http.mjs";
import { getOrCreateSettings } from "../settings-store.mjs";
import { monthUsedUsd } from "./usage.mjs";
import { retryJob } from "../jobs.mjs";
import { flywheelDir } from "../offer-inputs.mjs";
import {
  checkMarketStart, startMarketResearch, marketRunView, researchNotReady, hasModelKey,
  monthState, monthCapSentence, NO_MODEL_SENTENCE, STAGE_KIND, Refusal
} from "./store.mjs";
import { wakeWorker } from "../wake.mjs";

export const ROUTE = "marketing/flywheel/run";

/** Steps this route starts today. */
export const STAGES_HERE = Object.freeze([2]);

/** Is there a flywheel folder for this campaign: bundled with the site, or waiting in the outbox? */
async function campaignExists(tx, orgId, campaign, { dirOf = flywheelDir } = {}) {
  const dir = dirOf(campaign);
  if (dir && fs.existsSync(dir)) return true;
  const r = await tx.query(
    `SELECT 1 FROM repo_outbox WHERE org_id = $1 AND path LIKE $2 LIMIT 1`,
    [orgId, `marketing/flywheel/${campaign}/%`]
  );
  return r.rows.length > 0;
}

export async function runMarketStage(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to run a flywheel step." });
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
    const stage = body.stage;
    if (!Number.isInteger(stage) || stage < 1 || stage > 6) throw new InvalidError("stage", "stage must be the step number, 1 to 6.");
    if (!STAGES_HERE.includes(stage)) {
      throw new InvalidError("stage", `Step ${stage} does not run from this button yet. Step 2 (What the market sells) does.`);
    }
    const input = checkMarketStart(body);
    if (!hasModelKey(env)) return res.status(503).json({ error: "no_model", message: NO_MODEL_SENTENCE });

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      if (input.retry_job_id) {
        const row = await retryJob(tx, { orgId, id: input.retry_job_id, kinds: [STAGE_KIND] });
        if (!row) throw new Refusal(400, { error: "invalid", field: "retry_job_id", message: "That run cannot be resumed: it is not stopped, or it is not this company's." });
        return { status: 202, body: { ok: true, queued: true, started: true, already_running: false, resumed: true, job: marketRunView(row), poll: `marketing/flywheel/job?id=${row.id}` } };
      }
      if (!(await campaignExists(tx, orgId, input.campaign, { dirOf: deps.flywheelDir }))) {
        throw new Refusal(400, { error: "bad_campaign", field: "campaign", message: `There is no flywheel named "${input.campaign}". Start a flywheel for it first.` });
      }
      const settings = await getOrCreateSettings(tx, orgId);
      const m = monthState(settings, await monthUsedUsd(tx, orgId));
      if (m.capped) throw new Refusal(400, { error: "cap_reached", message: monthCapSentence(m.month_cap_usd) });
      const { job, already_running } = await startMarketResearch(tx, {
        orgId, staffId: staff.id ?? null, campaign: input.campaign, market: input.market, competitors: input.competitors
      });
      return { status: 202, body: { ok: true, queued: true, started: !already_running, already_running, job: marketRunView(job), poll: `marketing/flywheel/job?id=${job.id}` } };
    });
    if (answer.status === 202 && answer.body.started) await (deps.wake ?? wakeWorker)(env).catch(() => null);
    return res.status(answer.status).json(answer.body);
  } catch (err) {
    if (err instanceof Refusal) return res.status(err.status).json(err.body);
    if (sendKnownError(res, err)) return;
    if (researchNotReady(err)) {
      return res.status(503).json({ error: "not_ready", message: "This button is built, but its database change is not live yet. It turns on with the next ship." });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
