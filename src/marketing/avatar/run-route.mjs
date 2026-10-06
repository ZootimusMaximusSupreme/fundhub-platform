// Step 1 of POST /api/marketing/flywheel/run — "Build the avatar" (flywheel step 1) on the server.
// The route file api/marketing/flywheel/run.mjs checks the gate and hands stage 1 here
// (wave 2b merge glue: X1 built this as the whole route; X2 and X3 run the other stages).
//
// Route key "marketing/flywheel/run" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 Endpoints and §6 slice 5a. Unit X1.
//
//   POST {campaign, stage:1, request_id, service_description?, tweak?, retry_job_id?}
//     → 202 {ok, started, already_running, job, poll}
//          started true: a new run is queued (kind 'avatar' on marketing_jobs) and the
//            worker is woken; it runs one saved step per claim
//          already_running true: a run for this campaign is in flight; `job` is that run
//          retry_job_id: a failed or cap-stopped run goes back in the queue with every
//            finished step kept (never paid for twice) and the run cap read again from
//            Settings
//     → 400 {error:'invalid', field, message}  bad campaign, a stage this route does
//            not run yet, no "What we sell", a missing request_id
//     → 404 not_found                          retry_job_id is not a failed avatar run here
//     → 409 {error:'cap_hit', message}         the month cap is already reached
//     → 503 {error:'no_model', message}        no usable ANTHROPIC_API_KEY on the site
//     → 503 {error:'not_ready', message}       the tables are not live yet
//   A repeated request_id answers the first answer again and starts nothing.
//
// STAGES. Only stage 1 runs here in this build. Stages 2, 4 and 5 are their own units
// (design slices 10 and 5); stage 3 is POST marketing/offer/generate. Asking for another
// stage is a 400 in plain words, never a silent no-op.
//
// The month cap is checked before the job is made; the run cap and the month cap are
// then checked again by the worker before every step (src/marketing/avatar/run.mjs).
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. The write is one staff transaction (withRequest); the worker
// is woken after it commits; no model call happens in this function.

import { db } from "../../db.mjs";
import { dbDown } from "../../http/db-down.mjs";
import { requireAuth } from "../../http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany,
  InvalidError, NotFoundError
} from "../http.mjs";
import { getOrCreateSettings } from "../settings-store.mjs";
import { costStatus } from "../model-usage.mjs";
import { wakeWorker } from "../wake.mjs";
import { isCampaign, defaultServiceDescription } from "./campaigns.mjs";
import { dollars } from "./plan.mjs";
import {
  createAvatarJob, retryAvatarJob, avatarRunCap, avatarJobView, inFlightAvatarJob
} from "./store.mjs";

export const ROUTE = "marketing/flywheel/run";

const MAX_SERVICE = 2000;
const MAX_TWEAK = 500;

/** A usable Anthropic key: set and not a masked copy. Never read into an answer. */
export function hasModelKey(env) {
  const k = env && env.ANTHROPIC_API_KEY;
  return typeof k === "string" && k.trim() !== "" && !k.includes("*");
}

class CapHitError extends Error {
  constructor(message) { super(message); this.name = "CapHitError"; }
}

function oneLine(v, field, max) {
  if (v == null || v === "") return "";
  if (typeof v !== "string") throw new InvalidError(field, `${field} must be text.`);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) throw new InvalidError(field, `${field} is longer than ${max} characters.`);
  return s;
}

export async function runAvatarStage(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const wake = deps.wake ?? wakeWorker;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to start a flywheel step." });
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
    const campaign = body.campaign;
    if (!isCampaign(campaign)) {
      throw new InvalidError("campaign", "Pick a campaign: a folder name of small letters, numbers and dashes, like partner.");
    }
    const stage = Number(body.stage);
    if (stage !== 1) {
      throw new InvalidError("stage", stage === 3
        ? "Step 3 (the offer) runs from Write the offer."
        : "Only step 1, Who we sell to, runs from this button in this build.");
    }
    const tweak = oneLine(body.tweak, "tweak", MAX_TWEAK);
    const retryId = body.retry_job_id == null || body.retry_job_id === "" ? null : String(body.retry_job_id);
    const typed = oneLine(body.service_description, "service_description", MAX_SERVICE);
    const service = typed || defaultServiceDescription(campaign) || "";
    if (!retryId && !service) {
      throw new InvalidError("service_description", "Type what we sell first. This campaign names no offer to fill it in from.");
    }
    if (!hasModelKey(env)) {
      return res.status(503).json({ error: "no_model", message: "No Anthropic key is set on the site. An agent must set it." });
    }

    let started = false;
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      const monthCap = Number(settings && settings.max_month_cost_usd);
      const month = await costStatus(tx, { orgId, maxMonthUsd: monthCap });
      if (month.month_capped) {
        throw new CapHitError(`Stopped at the ${dollars(monthCap)} month cap. Raise it in Settings or wait for next month.`);
      }
      const runCapUsd = avatarRunCap(settings);
      if (retryId) {
        let row;
        // A savepoint, so "another run of this campaign is in flight" (the unique
        // index) can be answered in words without aborting the whole transaction.
        await tx.query("SAVEPOINT avatar_retry");
        try {
          row = await retryAvatarJob(tx, { orgId, id: retryId, runCapUsd });
          await tx.query("RELEASE SAVEPOINT avatar_retry");
        } catch (err) {
          if (err && err.code === "23505") {
            await tx.query("ROLLBACK TO SAVEPOINT avatar_retry");
            const running = await inFlightAvatarJob(tx, { orgId, campaign });
            return { ok: true, started: false, already_running: true, message: "The avatar is already being built. This is that run.", job: avatarJobView(running), poll: pollOf(running) };
          }
          throw err;
        }
        if (!row) throw new NotFoundError("That run is not a stopped or failed avatar run for this company. Nothing was started.");
        started = true;
        return { ok: true, started: true, already_running: false, retried: true, job: avatarJobView(row), poll: pollOf(row) };
      }
      const { job, created } = await createAvatarJob(tx, {
        orgId, campaign, serviceDescription: service, tweak: tweak || null, runCapUsd, staffId: staff.id ?? null
      });
      started = created;
      return created
        ? { ok: true, started: true, already_running: false, job: avatarJobView(job), poll: pollOf(job) }
        : { ok: true, started: false, already_running: true, message: "The avatar is already being built. This is that run.", job: avatarJobView(job), poll: pollOf(job) };
    });

    // After the commit: wake the worker so the first step starts now, not at the next
    // clock tick. A failed wake is fine — the clock wakes it within 15 minutes.
    if (started) {
      try { await wake(env); } catch { /* the clock is the backstop */ }
    }
    return res.status(202).json(answer);
  } catch (err) {
    if (err instanceof CapHitError) return res.status(409).json({ error: "cap_hit", message: err.message });
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Build the avatar")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}

function pollOf(job) {
  return job ? `/api/marketing/flywheel/job?id=${job.id}` : null;
}
