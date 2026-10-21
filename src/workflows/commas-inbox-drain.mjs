/* The payment-queue drain, on the scheduler that is actually running.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — 2026-09-17.
 *
 * netlify/functions/commas-inbox-sweeper.mjs already does exactly this pass,
 * every minute, and its header explains why it was put on Netlify's cron
 * instead of Inngest. That reasoning is unchanged and that function stays
 * exactly as it is. The problem is not the code — it is the clock.
 *
 * MEASURED ON LIVE, 2026-09-17. Six commas_inbox rows sat status='pending'
 * with attempts=0, meaning nothing had even tried them. Two had been waiting
 * since 2026-09-15. The last time anything drained the queue was a single
 * 22-second burst at 17:46; nothing ran after it, across two deploys and four
 * hours. Meanwhile the Inngest clock was demonstrably alive in those same
 * hours, firing on a clean five-minute grid. So the Netlify cron is the dead
 * one, and the money path was hanging off it alone.
 *
 * netlify.toml:104-117 records this identical silent failure happening once
 * before, on 2026-09-06: a scheduled function that throws at load stops
 * running with no alarm, the queue rows just stay `pending`, and the deploy
 * that caused it is green. A single clock under the money path is the real
 * defect, and this is the second clock.
 *
 * RUNNING BOTH IS SAFE, which is why the Netlify one is left alone rather than
 * moved. claim() takes rows with FOR UPDATE SKIP LOCKED, so two passes that
 * overlap work different rows instead of the same ones or blocking; and the
 * inbox dedupes on the payment id before a row is ever written. A double pass
 * cannot count a payment twice.
 *
 * REGISTERING THIS SENDS NOTHING AND CHARGES NOTHING. It reads bytes Commas
 * already delivered and hands them to the same processor the Netlify function
 * hands them to. No money moves that has not already moved. */

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { drain } from "../payments/commas-inbox.mjs";
import { processCommasInboxRow } from "../adapters/commas.mjs";
import { ensureRegistered } from "../register-all.mjs";

/* Hourly, as the backup clock. The Netlify sweeper still drains every minute,
   so a payment lands within a minute while that clock is alive. This pass only
   bounds the delay (one hour) if the Netlify clock dies again.

   It ran every minute until 2026-10-20. That was 1,440 Inngest runs a day,
   about 43,000 a month, nearly all of the 50,000 the Inngest Free plan allows;
   the account ran out and every Inngest job stopped at 6:20 p.m. Arizona.
   Owner-set the same night: stay on the Free plan, cut runs. */
export const SWEEP_CRON = "10 * * * *";

export const SOURCE_WORKFLOW = "commas-inbox-drain";

/* Same bounds as the Netlify pass. Bounded because a pass that ran until the
   queue was empty would hold the function open for as long as the backlog is
   long; a row left unclaimed is still pending and is picked up next minute. */
export const BATCH = 25;
export const MAX_BATCHES_PER_PASS = 4;

/* sweep — one pass. `db` and the processor are arguments so the tests drive it
   directly, without Inngest and without a scheduler.

   NEVER THROWS. A failed pass must not take the schedule down with it, because
   the next pass a minute later is the recovery. The error is returned so the
   caller can log it. */
export async function sweep(db, options = {}) {
  const {
    limit = BATCH,
    maxBatches = MAX_BATCHES_PER_PASS,
    process: proc
  } = options;
  try {
    /* Handlers must be on the bus BEFORE anything is emitted. A cold start
       that skipped this would write the events and dispatch them to nobody —
       the payment would look processed and the money chain would never have
       run. */
    ensureRegistered();
    const result = await drain(db, {
      limit,
      maxBatches,
      process: proc || processCommasInboxRow
    });
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      claimed: 0,
      batches: 0,
      counts: {},
      error: String(err?.message || err).slice(0, 300)
    };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so "every registered workflow is callable" stays true
   rather than this one becoming the exception.

   It has no event trigger (it is a cron), so no journey will ever reach it and
   it will always appear in the runner's neverFired list. That is the correct
   outcome for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

/* scheduledPass — what the timer runs: one pass, then ONE log line, EVERY pass.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EVERY PASS SPEAKS — hole N6, measured on live 2026-09-18.
 *
 * This drain shipped at 23:14 UTC on 2026-09-17 and claimed nothing for the
 * next sixteen hours. Seven receipts sat pending, tried zero times, until the
 * Netlify sweeper was repaired at 15:13 UTC; all seven were claimed by that
 * one sweeper pass. The code here was not the fault. Inngest only runs the
 * functions it was told about the last time the app was synced with it
 * (PUT /api/inngest), and nothing synced after the deploy that added this
 * one. The api function's log shows it: overnight (03:00–03:10 UTC) the
 * five-minute jobs arrived on time, and whole minutes went by with no call
 * at all — a once-a-minute job Inngest knew about cannot leave that gap.
 * The re-sync at 18:47:52 UTC on 2026-09-18 registered it: from 19:49 to
 * 19:59 UTC the queue's claim ran 11 more times than the Netlify sweeper
 * accounts for — this drain, about once a minute. Any deploy that adds or
 * changes an Inngest function needs a sync after it, or Inngest never calls
 * the new one.
 *
 * It went unseen that long because a pass that found nothing said nothing, so
 * "running with an empty queue" and "never running" left the same empty log.
 * Now every pass leaves a line, and `netlify logs --function api` answers
 * "is the backup running?" on its own: a line a minute means yes, a gap means
 * Inngest is not calling it. `log` is an argument so the tests can read it. */
export async function scheduledPass(passDb = db, log = console) {
  const result = await sweep(passDb);
  if (!result.ok) {
    log.error(`[commas-inbox-drain] pass failed: ${result.error}`);
  } else if (result.claimed > 0) {
    log.log(
      `[commas-inbox-drain] processed ${result.claimed} payment event(s): ` +
      JSON.stringify(result.counts)
    );
  } else {
    log.log("[commas-inbox-drain] pass ok: nothing waiting");
  }
  return result;
}

/* The scheduled definition. Registered in src/workflows/index.mjs. */
export const commasInboxDrain = inngest.createFunction(
  { id: "commas-inbox-drain", name: "Commas payment inbox drain" },
  { cron: SWEEP_CRON },
  () => scheduledPass(db)
);

export default sweep;
