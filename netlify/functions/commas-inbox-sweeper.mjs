/* The thing that turns a stored Commas webhook into money in the system.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS.
 *
 * The Commas webhook no longer does its work before answering. It verifies the
 * signature, writes the exact bytes to commas_inbox, and returns 200 — because
 * Commas delivers AT MOST ONCE and never retries, so any work done before the
 * response is work that can lose a real payment forever.
 *
 * That makes this function the other half of the payment path. Nothing in a
 * queued row reaches the events table, the money chain, or a client's record
 * until a pass runs. If this stops running, payments stop registering — they
 * are not lost (the bytes are durable and the next pass picks them up) but
 * they are late, and "late" on a deposit means a client who paid is still
 * being chased.
 *
 * WHY A NETLIFY SCHEDULED FUNCTION AND NOT INNGEST. Same reason as
 * staff-message-sweeper.mjs: Inngest fires nothing until INNGEST_EVENT_KEY is
 * set, and setting that key makes 47 workflow functions go live at once —
 * CLAUDE.md §11 names it as an owner decision. Draining the payment queue must
 * not require switching on the whole workflow engine.
 */

/* Keep fontkit in THIS function's zip — the same line api.mjs carries.
   register-all reaches vendor/underwriteiq-full/api/lite/letter-generator.js,
   which require()s @pdf-lib/fontkit when it loads. Nothing else in this
   function names the package, so the bundler left it out of the zip, and on
   live (2026-09-17 → 09-18) every pass died at load with
   "Cannot find module '@pdf-lib/fontkit'". Nothing drained the payment queue:
   a $3,000 deposit receipt sat pending, tried 0 times, and never reached the
   money chain. */
import "@pdf-lib/fontkit";
import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { drain } from "../../src/payments/commas-inbox.mjs";
import { processCommasInboxRow } from "../../src/adapters/commas.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";

/* Every minute.
 *
 * FASTER THAN THE OTHER SWEEPERS ON PURPOSE. This is the money path. The delay
 * between a client paying and the system knowing they paid is this number, and
 * that delay is visible to a human: it gates the onboarding email, the CRM
 * card moving, and whether the closer chasing them can see the deposit landed.
 * Five minutes of "did my payment go through?" is a support conversation.
 *
 * THE SCHEDULE IS DECLARED IN netlify.toml, NOT HERE. Netlify reads it from a
 * [functions."<name>"] block or the @netlify/functions schedule() wrapper; the
 * config form is used because the wrapper is a new npm dependency and
 * CLAUDE.md §8 does not allow one for something a two-line config block
 * already does. This constant is the documented value and what the test
 * asserts netlify.toml agrees with. */
export const SWEEP_CRON = "* * * * *";

/* Rows per claim, and claims per pass.
 *
 * BOUNDED, because a serverless function has a wall-clock limit it is killed
 * at, and a row killed mid-process is left in 'processing'. That case is
 * recovered (claim() reclaims stale rows after STALE_CLAIM_MINUTES) but it
 * costs a delay, so the pass is sized to finish comfortably. 25 × 4 = 100
 * payments a minute is far beyond any realistic volume here, and anything
 * above it is worked through by the next pass sixty seconds later. Nothing is
 * lost by stopping: an unclaimed row is still pending. */
export const BATCH = 25;
export const MAX_BATCHES_PER_PASS = 4;

/* sweepCommasInbox — one pass. Exported and taking `db` so tests drive it
   directly, without Netlify and without a scheduler.

   NEVER THROWS. A pass that fails must not take the schedule down, because the
   next pass is the recovery. The error is returned so the caller can log it. */
export async function sweepCommasInbox(db, options = {}) {
  const { limit = BATCH, maxBatches = MAX_BATCHES_PER_PASS, process: proc } = options;
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

/* The scheduled handler. Netlify invokes it on SWEEP_CRON; there is no HTTP
   route to it and no way to trigger it from outside.

   Answers 200 even on a failed pass, deliberately: a non-2xx from a scheduled
   function is a deploy-level alarm, and one failed sweep is not one — the next
   pass a minute later is the retry. The outcome is in the body and the log.

   A web Response, NOT { statusCode, body }. The default export below makes
   Netlify run this as its newer function style, which accepts only a Response
   or undefined. The old object made every pass end in "Function returned an
   unsupported value", and Netlify re-ran each pass twice (live, 2026-09-18:
   30 runs in 10 minutes instead of 10). src/http/scheduled-functions-return.test.mjs */
export async function handler() {
  const result = await sweepCommasInbox(db);
  if (!result.ok) {
    console.error(`[commas-inbox-sweeper] pass failed: ${result.error}`);
  } else if (result.claimed > 0) {
    console.log(
      `[commas-inbox-sweeper] processed ${result.claimed} payment event(s): ` +
      JSON.stringify(result.counts)
    );
  }
  await noteScheduledRun(db, "commas-inbox-sweeper", result);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default handler;
