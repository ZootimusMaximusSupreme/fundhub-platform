// Step 1 of POST /api/marketing/flywheel/tweak — Tweak "Who we sell to".
//
// WAVE 2B MERGE GLUE. Units X1 and X3 each built the tweak route. The route file
// (api/marketing/flywheel/tweak.mjs, X3's) checks the gate and hands stage 1 here:
// this is X1's route body, unchanged except the notes heading, which is now the
// whole line "## Notes" (the one form the merged append_line_under_heading takes).
// X1's own words follow.
//
// POST /api/marketing/flywheel/tweak — Tweak a flywheel step: one dated line in the
// owner notes, and (for step 1) a new run that carries the line.
//
// Route key "marketing/flywheel/tweak" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 Actions ("the note is appended as
// one dated line under ## Notes in 00-OWNER-NOTES.md (append only, never a rewrite) and
// also rides in the new run's payload, so the run does not wait for the commit"). Unit X1.
//
//   POST {campaign, stage, note, request_id} → 202 {ok, stage, outbox_id, job, started,
//                                                  already_running, poll, message}
//     stage 1: the line is queued AND a new avatar run starts with the line in its
//       payload (or the running one is handed back: one run per campaign at a time)
//     stages 2-6: the line is queued; job is null — those steps re-run from their own
//       buttons (their units), and the line feeds their next run
//     → 400 invalid  bad campaign, stage or an empty note · 409 cap_hit · 503 no_model
//
// The line is "YYYY-MM-DD | stage N | <note>" (Arizona date), the format the file
// documents. Edit op append_line_under_heading on marketing/flywheel/<c>/00-OWNER-NOTES.md
// (src/repo/edit-ops.mjs): applied to the newest copy, never a rewrite.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. One staff transaction (withRequest); the worker is woken after.

import { db } from "../../db.mjs";
import { dbDown } from "../../http/db-down.mjs";
import { requireAuth } from "../../http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, InvalidError
} from "../http.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { wakeWorker } from "../wake.mjs";
import { getOrCreateSettings } from "../settings-store.mjs";
import { costStatus } from "../model-usage.mjs";
import { isCampaign, defaultServiceDescription } from "./campaigns.mjs";
import { arizonaDate } from "./run.mjs";
import { dollars } from "./plan.mjs";
import { createAvatarJob, avatarRunCap, avatarJobView, latestAvatarJob } from "./store.mjs";
import { hasModelKey } from "./run-route.mjs";
import { NOTES_HEADING } from "../flywheel/campaigns.mjs";

const ROUTE = "marketing/flywheel/tweak";
const MAX_NOTE = 500;

export async function runAvatarTweak(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const wake = deps.wake ?? wakeWorker;

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
    const campaign = body.campaign;
    if (!isCampaign(campaign)) throw new InvalidError("campaign", "Pick a campaign: a folder name like partner.");
    const stage = Number(body.stage);
    if (!Number.isInteger(stage) || stage < 1 || stage > 6) throw new InvalidError("stage", "Say which step: 1 to 6.");
    // "|" splits the fields of a notes line, so one typed inside the note becomes "/".
    const note = typeof body.note === "string" ? body.note.replace(/\|/g, "/").replace(/\s+/g, " ").trim() : "";
    if (!note) throw new InvalidError("note", "Type the one line you want changed.");
    if (note.length > MAX_NOTE) throw new InvalidError("note", `Keep the tweak under ${MAX_NOTE} characters.`);
    if (stage === 1 && !hasModelKey(env)) {
      return res.status(503).json({ error: "no_model", message: "No Anthropic key is set on the site. An agent must set it." });
    }

    let started = false;
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const line = `${arizonaDate(deps.now ? deps.now() : new Date())} | stage ${stage} | ${note}`;
      const row = await enqueueRepoWrite(tx, {
        orgId, opId: `tweak:${requestId}`, path: `marketing/flywheel/${campaign}/00-OWNER-NOTES.md`, mode: "edit",
        edit: { op: "append_line_under_heading", heading: NOTES_HEADING, line }
      });
      if (stage !== 1) {
        return {
          ok: true, stage, outbox_id: row.id, job: null, started: false, already_running: false, poll: null,
          message: `Saved to your notes. Step ${stage} uses it the next time it runs from its own button.`
        };
      }
      const settings = await getOrCreateSettings(tx, orgId);
      const month = await costStatus(tx, { orgId, maxMonthUsd: Number(settings.max_month_cost_usd) });
      if (month.month_capped) {
        throw new InvalidError("stage", `Saved nothing: the ${dollars(Number(settings.max_month_cost_usd))} month cap is reached, so step 1 cannot re-run. Raise it in Settings or wait for next month.`);
      }
      const last = await latestAvatarJob(tx, { orgId, campaign });
      const service = (last && last.payload && last.payload.service_description) || defaultServiceDescription(campaign);
      if (!service) throw new InvalidError("note", "This campaign names no offer, so step 1 needs What we sell. Start it from Build the avatar.");
      const { job, created } = await createAvatarJob(tx, {
        orgId, campaign, serviceDescription: service, tweak: note, runCapUsd: avatarRunCap(settings), staffId: staff.id ?? null
      });
      started = created;
      return {
        ok: true, stage, outbox_id: row.id, job: avatarJobView(job), started: created, already_running: !created,
        poll: `/api/marketing/flywheel/job?id=${job.id}`,
        message: created
          ? "Saved to your notes. Step 1 is running again with it."
          : "Saved to your notes. The avatar is already being built; the next run uses it."
      };
    });
    if (started || answer.outbox_id) {
      try { await wake(env); } catch { /* the clock is the backstop */ }
    }
    return res.status(202).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && (err.name === "RepoPathError" || err.name === "EditOpError" || err.name === "OutboxError")) {
      return res.status(400).json({ error: "invalid", field: "note", message: `The repo refused the save: ${err.message}` });
    }
    if (sendNotReady(res, err, "Tweak")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
