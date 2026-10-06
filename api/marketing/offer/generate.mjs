// /api/marketing/offer/generate — the dashboard's "Write offer" button.
//
// Route key: "marketing/offer/generate" (netlify/functions/api.mjs ROUTES). The key IS
// this file's path under api/ — src/http/routes.test.mjs holds that rule.
// Contract: docs/specs/marketing-offer-contract.md. Flow: docs/journeys/marketing-offer-flow.md.
//
//   POST  start a run. Saves a queued job, wakes the background writer, answers
//         202 with the job. The writing (six offers, four judges, one winner —
//         the flywheel stage 3 rubric, src/marketing/offer-generator.mjs) takes a
//         few minutes, far past this function's 26-second limit, so it happens in
//         netlify/functions/marketing-offer-background.mjs.
//   GET   read back. ?id=<job id> → that run. No id → the newest run and the
//         newest finished offer, which is what the dashboard's Offer card shows.
//
// Owner and admin only. requireAuth answers "signed-in employee" and nothing
// else (CLAUDE.md §12), so the role gate is the separate requireRole call.
//
// BEFORE THE MIGRATION SHIPS there is no marketing_jobs table. GET then answers
// 200 with ready:false and POST answers 503 not_ready, both in plain words —
// never a 500.

import { db } from "../../../src/db.mjs";
import { requireAuth, bearerToken } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../../src/http/read-api.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { safeError } from "../../../src/http/health.mjs";
import { resolveOfferInputs, isCampaign, DEFAULT_CAMPAIGN } from "../../../src/marketing/offer-inputs.mjs";
import { repoFlywheelDefaults } from "../../../src/marketing/research/repo-read.mjs";
import { anthropicKeyOf, wakeOfferWorker } from "../../../src/marketing/offer-transport.mjs";
import {
  createOfferJob, failOfferJob, getOfferJob, latestOfferJobs,
  isNotReady, jobView, offerView
} from "../../../src/marketing/offer-store.mjs";

const NOT_READY_MESSAGE =
  "The offer writer is built, but its database table is not live yet. It turns on with the next ship.";

/** Today's date where Chris is (Arizona, no daylight saving). */
function todayInArizona(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const wake = deps.wake ?? wakeOfferWorker;
  const readInputs = deps.resolveInputs ?? resolveOfferInputs;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  // Owner and admin — the same set as OFFER_ROLES in src/marketing/offer-run.mjs,
  // which the background writer checks.
  if (!requireRole(res, staff, ROLE_SETS.OPS)) return;
  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  if (req.method === "GET") return read(req, res, { database, orgId });

  // ── POST: start a run ─────────────────────────────────────────────────────
  if (!anthropicKeyOf(env)) {
    return res.status(503).json({ ok: false, error: "no_model",
      message: "The writing robot is not set on this site (no Anthropic key), so nothing was started." });
  }

  // The default inputs come through the repo reader (GitHub at one commit, saves waiting
  // in the outbox on top, the bundled copy when GitHub cannot be read), so a board that
  // "Research the market" just saved reaches this run without a ship (design §6 slice 10,
  // unit X2). Any trouble reading falls back to the bundled files exactly as before.
  let readOpts;
  if (!deps.resolveInputs) {
    const body = req.body || {};
    const wanted = typeof body.campaign === "string" ? body.campaign.trim().toLowerCase() : "";
    const campaign = wanted && isCampaign(wanted) ? wanted : DEFAULT_CAMPAIGN;
    const d = await (deps.repoDefaults ?? repoFlywheelDefaults)(database, campaign, { env }).catch(() => null);
    if (d) readOpts = { readDefaults: () => d };
  }
  const resolved = readInputs(req.body || {}, readOpts);
  if (!resolved.ok) {
    return res.status(400).json({ ok: false, error: resolved.error, message: resolved.message });
  }
  const payload = { ...resolved.inputs, today: todayInArizona() };

  try {
    const { job, created } = await createOfferJob(database, { orgId, staffId: staff.id, payload });
    if (!job) {
      return res.status(500).json({ ok: false, error: "not_saved", message: "The run could not be saved. Nothing was started." });
    }
    if (!created) {
      return res.status(202).json({
        ok: true, started: false, already_running: true, job: jobView(job),
        poll: `/api/marketing/offer/generate?id=${job.id}`,
        message: "An offer is already being written. This is that run."
      });
    }

    const woke = await wake({ jobId: job.id, token: bearerToken(req), env });
    if (!woke.ok) {
      const reason = `The writer could not be started: ${woke.reason}. Nothing was written.`;
      await failOfferJob(database, { jobId: job.id, orgId, error: reason });
      return res.status(502).json({ ok: false, error: "worker_unreachable", message: reason,
        job: { ...jobView(job), status: "failed", error: reason } });
    }

    return res.status(202).json({
      ok: true, started: true, already_running: false, job: jobView(job),
      poll: `/api/marketing/offer/generate?id=${job.id}`,
      message: "Writing the offer. Six offers, four judges, one winner — this takes a few minutes."
    });
  } catch (err) {
    if (isNotReady(err)) return res.status(503).json({ ok: false, error: "not_ready", message: NOT_READY_MESSAGE });
    if (dbDown(res, err)) return;
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

async function read(req, res, { database, orgId }) {
  const id = (req.query || {}).id;
  try {
    if (id != null && id !== "") {
      if (!isUuid(String(id))) {
        return res.status(400).json({ ok: false, error: "bad_id", message: "id must be the run's id." });
      }
      const row = await getOfferJob(database, { orgId, jobId: String(id).trim() });
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, ready: true, job: jobView(row), offer: offerView(row) });
    }
    const { latestJob, latestDone } = await latestOfferJobs(database, { orgId });
    return res.status(200).json({ ok: true, ready: true, job: jobView(latestJob), offer: offerView(latestDone) });
  } catch (err) {
    if (isNotReady(err)) {
      return res.status(200).json({ ok: true, ready: false, job: null, offer: null, message: NOT_READY_MESSAGE });
    }
    if (dbDown(res, err)) return;
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
