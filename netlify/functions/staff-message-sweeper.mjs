// The thing that actually sends a held staff reply once the window opens.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE HOLE THIS CLOSES.
//
// A text written at 11pm is correctly held until 11am — the gate marks quiet
// hours retryable, the dispatcher pushes `scheduled_at` to the next 11:00
// Arizona and puts the row back on the queue. Then nothing happens, forever,
// because NOTHING IN THIS REPOSITORY HAS EVER CALLED THE DISPATCHER ON A
// SCHEDULE. The message sits queued and due and nobody sends it.
//
// The staff member was told "held until 11am — it will go out on its own". That
// sentence was not true. This function is what makes it true.
//
//
// WHY THIS IS A NETLIFY SCHEDULED FUNCTION AND NOT THE INNGEST SWEEPER.
//
// src/workflows/message-dispatch-sweeper.mjs already exists and does this job.
// It is not used here, and the reason is a blast radius, not a preference:
//
//   * It is an Inngest function, and Inngest fires nothing until
//     INNGEST_EVENT_KEY is set. CLAUDE.md §11 names setting that key as one of
//     three things to ask the owner about first, because it makes 47 workflow
//     functions go live at once. Releasing held text messages must not require
//     switching on the entire workflow engine.
//   * Registering it would also mean it drains EVERYTHING queued. See the note
//     on senderStaffOnly below.
//
// This function does one job, on its own clock, with no key to set. The Inngest
// sweeper stays defined and unregistered exactly as it was.
//
//
// *** WHAT IT WILL AND WILL NOT SEND. READ THIS BEFORE WIDENING IT. ***
//
// `senderStaffOnly: true`. It releases ONLY messages with a sender_staff_id —
// rows written by src/messaging/compose.mjs, which means a named employee typed
// them and pressed Send. Those are the messages the hold was applied to and the
// ones somebody is waiting on.
//
// It deliberately does NOT drain the several thousand rows queued by workflows
// over the past months (110_messages_outbound.sql documents them). Those have
// never been dispatched because nothing has ever dispatched anything; sweeping
// them would put months of stale automated messages in front of real people in
// one afternoon. Draining that backlog is a decision for the owner, not a side
// effect of fixing overnight texts. If you widen this filter, that is what you
// are choosing to do.
//
//
// EVERY RULE STILL APPLIES ON THE WAY OUT. This calls dispatchDue, which calls
// dispatchOne, which gates every single message afresh at the moment of
// sending. A client who opted out at 2am does not get the 11am text. That is
// the whole reason the gate reads opt-out state at send time rather than at
// queue time — and it is why a held message is re-gated rather than trusted.

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { dispatchDue, DEFAULT_BATCH } from "../../src/messaging/dispatch.mjs";

/* Every five minutes. The quiet-hours window opens on the hour, and a text held
   overnight should go out within a few minutes of 11:00 rather than up to an
   hour after it. Matches SWEEP_CRON in the Inngest sweeper on purpose.

   THE SCHEDULE IS DECLARED IN netlify.toml, NOT HERE. Netlify reads it from
   either a `[functions."<name>"] schedule = ...` block or the `schedule()`
   wrapper in the @netlify/functions package. The config form is used because
   the wrapper form is a new npm dependency, and CLAUDE.md §8 does not allow one
   for something a two-line config block already does. This constant is the
   documented value and what the test asserts netlify.toml agrees with — a
   schedule that lives in one file and is asserted from another is how the two
   stay in step. */
export const SWEEP_CRON = "*/5 * * * *";

/* How many batches one pass will work through before stopping.

   ONE BATCH IS NOT ENOUGH AT 11AM. dispatchDue claims DEFAULT_BATCH (50) and
   sends them one at a time. At 11:00 the whole night's held messages come due
   together; if a pass only ever did 50 and passes are five minutes apart, a
   backlog of 600 would take an hour to clear and the last person would get a
   reply to their 11pm text at noon.

   BUT IT IS STILL BOUNDED. An unbounded drain holds the function open for as
   long as the backlog is long, and a serverless function has a wall-clock limit
   it will be killed at — mid-send, with rows left in 'sending'. Ten batches is
   500 messages, which clears any realistic night of staff replies in one pass,
   and anything larger is worked through by the next pass five minutes later.
   Nothing is lost by stopping: an unclaimed message is still queued and due. */
export const MAX_BATCHES_PER_PASS = 10;

/* sweepStaffMessages — one pass. Exported and taking `db` so the tests drive it
   directly, without Netlify and without a scheduler.

   NEVER THROWS. A pass that fails must not take the schedule down, because the
   next pass is the recovery: every message it did not finish is still queued
   and still due. The error is returned so the caller can log it. */
export async function sweepStaffMessages(db, options = {}) {
  const { limit = DEFAULT_BATCH, maxBatches = MAX_BATCHES_PER_PASS, ...rest } = options;
  const counts = {};
  let claimed = 0;
  let batches = 0;

  try {
    while (batches < maxBatches) {
      const pass = await dispatchDue(db, { ...rest, limit, senderStaffOnly: true });
      batches += 1;
      claimed += pass.claimed;
      for (const [k, v] of Object.entries(pass.counts || {})) counts[k] = (counts[k] || 0) + v;
      // Nothing left to claim. Stopping here is what makes the common case —
      // an empty queue, which is most of the 288 passes in a day — a single
      // query rather than ten. `batches` counts passes actually run, so this
      // case reports 1 and not 0.
      if (pass.claimed === 0) break;
    }
    return { ok: true, claimed, batches, counts };
  } catch (err) {
    return {
      ok: false, claimed, batches, counts,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* The scheduled handler. Netlify invokes it on SWEEP_CRON; there is no HTTP
   route to it and no way to trigger it from outside.

   It answers 200 even on a failed pass, deliberately: a non-2xx from a
   scheduled function is a deploy-level alarm, and a single failed sweep is not
   one — the next pass five minutes later is the retry. The outcome is in the
   body and in the log line.

   A web Response, not { statusCode, body }: the default export makes this
   Netlify's newer function style, which rejects the old object and re-runs
   the pass. See commas-inbox-sweeper.mjs and
   src/http/scheduled-functions-return.test.mjs. */
export async function handler() {
  const result = await sweepStaffMessages(db);
  if (!result.ok) {
    console.error(`[staff-message-sweeper] pass failed: ${result.error}`);
  } else if (result.claimed > 0) {
    console.log(`[staff-message-sweeper] released ${result.claimed} held message(s): ` +
      JSON.stringify(result.counts));
  }
  await noteScheduledRun(db, "staff-message-sweeper", result);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default handler;
