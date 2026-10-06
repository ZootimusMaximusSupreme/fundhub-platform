// Run one queued offer job, start to finish. Called by the background worker
// (netlify/functions/marketing-offer-background.mjs) and by tests.
//
// The order is the rule from api/social/generate.mjs: no database connection
// is held while the model writes. Claim (short write) → write the offer (three
// model calls, nothing held) → save (short write).

import { ROLE_SETS } from "../http/read-api.mjs";
import { generateOffer, OfferError } from "./offer-generator.mjs";
import { askAnthropic, OFFER_MODEL } from "./offer-transport.mjs";
import { claimOfferJob, finishOfferJob, failOfferJob } from "./offer-store.mjs";

/* Owner and admin: ROLE_SETS.OPS. The dashboard plan calls this pair
   ROLE_SETS.MARKETING (docs/specs/marketing-dashboard-plan-2026-10-05.md §4 Step B);
   it is the same two roles. The endpoint names ROLE_SETS.OPS in its own text too,
   because scripts/journeys/generate.mjs reads the gate off the handler's source. */
export const OFFER_ROLES = ROLE_SETS.OPS;

/** The background function gets 15 minutes. Stop starting new calls well before. */
export const RUN_BUDGET_MS = 14 * 60 * 1000;

/**
 * runOfferJob(db, { jobId, orgId }) → { ok, status, error? }
 * Never throws: every way out leaves the row done or failed with a reason.
 */
export async function runOfferJob(db, {
  jobId, orgId, ask = askAnthropic, now = Date.now, budgetMs = RUN_BUDGET_MS
} = {}) {
  let job;
  try {
    job = await claimOfferJob(db, { jobId, orgId });
  } catch (err) {
    return { ok: false, status: null, error: `could not claim the job: ${String(err && err.message || err).slice(0, 200)}` };
  }
  if (!job) return { ok: false, status: null, error: "not_queued" };

  const started = now();
  const payload = job.payload || {};
  try {
    const result = await generateOffer({
      inputs: payload,
      ask,
      seed: job.id,
      today: payload.today || null,
      timeLeft: () => budgetMs - (now() - started)
    });
    result.model = OFFER_MODEL;
    await finishOfferJob(db, { jobId, orgId, result });
    return { ok: true, status: "done" };
  } catch (err) {
    const message = err instanceof OfferError
      ? err.message
      : `Something broke while writing the offer, and nothing was chosen: ${String(err && err.message || err).slice(0, 200)}`;
    const partial = err instanceof OfferError ? err.partial : null;
    try {
      await failOfferJob(db, { jobId, orgId, error: message, result: partial });
    } catch { /* the stale sweep closes it at 16 minutes; the reason is in the log */ }
    console.error(`[marketing-offer] job ${jobId} failed: ${message}`);
    return { ok: false, status: "failed", error: message };
  }
}
