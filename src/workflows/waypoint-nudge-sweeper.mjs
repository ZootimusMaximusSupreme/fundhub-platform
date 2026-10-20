// The waypoint nudge sweeper — the clock behind the chase ladder.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging cadence on
// a consumer-finance file.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A CLOCK AND NOT AN EVENT
//
// "This waypoint went overdue" is not an event. Nobody does anything, a date
// passes, and the row quietly sits there. Absence never fires — the same
// argument message-dispatch-sweeper.mjs makes for a text deferred overnight and
// hiring-bench-sweeper.mjs makes for a bench that has gone thin. Something has
// to come back and look.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT ONE PASS CAN AND CANNOT DO
//
// It can write at most one queued `messages` row per client per calendar day in
// that client's own timezone. The existing four-rung ladder remains finite;
// migration489 adds one Blueprint-only voice receipt after two unanswered
// sent texts, sharing the daily/destination caps. These are database constraints,
// not decisions this file makes, so
// running this function twice at once, replaying it, or firing it from sixteen
// duplicate triggers produces the same result as running it once.
//
// Text reminders queue; src/messaging/dispatch.mjs sends,
// on its own five-minute clock, behind the per-company outbound switch
// (messaging_settings.outbound_enabled, migration 126) and the compliance gate.
// Blueprint calls use the separately reviewed live voice agent and gated Bland
// provider. Registering this function does not activate agents or settings.
//
// HOURLY, NOT EVERY FIVE MINUTES. The ladder's own resolution is days, and the
// only thing a faster clock would buy is a nudge landing at 08:05 local instead
// of 08:59. Against that: every pass reads every overdue client-owned waypoint
// in the org. Twelve passes an hour of that work to move a text by fifty
// minutes is not a trade worth making. The one thing the cadence must be finer
// than is the quiet-hours window it has to fit inside, and an hour clears a
// twelve-hour window comfortably.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { runNudges } from "../nudge/run.mjs";

/** Top of every hour. See the header for why not faster. */
export const SWEEP_CRON = "0 * * * *";

export const SOURCE_WORKFLOW = "waypoint-nudge-sweeper";

/** sweep — one pass. `db` and the clock are arguments so the tests drive it
    without Inngest and without a scheduler.

    Never throws: runNudges() catches per candidate and returns a tally. A pass
    that fails must not take the scheduled function down with it, because the
    next pass is the recovery — a waypoint that was not chased is still
    overdue. */
export async function sweep(conn = db, { orgId = null, now = new Date(), step = null, deliveryNow = null } = {}) {
  return runNudges(conn, { orgId, now, step, deliveryNow });
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow, so "every registered workflow is callable" stays true
   rather than this one becoming the exception that softens the rule.

   It has no event trigger (it is a cron), so no journey reaches it and it will
   always appear in the runner's neverFired list. That is the correct outcome
   for a scheduled job, not a coverage hole. */
export async function handle({ db: handleDb, step, now } = {}) {
  // Freeze this run's evaluation time across durable step replays. Each model
  // turn and each dial then has its own host request and saved receipt.
  const clock = () => (now == null ? new Date() : new Date(now)).toISOString();
  const at = typeof step?.run === "function" ? await step.run("nudge-clock", clock) : clock();
  // Planning is replay-stable; send-time consent, quiet hours and day caps
  // use the actual execution time. Explicit local test clocks stay fixed.
  const deliveryNow = typeof step?.run === "function" && now == null ? () => new Date() : null;
  return sweep(handleDb || db, { now: new Date(at), step, deliveryNow });
}

export const waypointNudgeSweeper = inngest.createFunction(
  { id: "waypoint-nudge-sweeper", name: "Waypoint nudge sweeper" },
  { cron: SWEEP_CRON },
  ({ step }) => handle({ db, step })
);

export default sweep;
