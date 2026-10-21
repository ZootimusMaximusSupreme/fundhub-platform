// The candidate follow-up cadence, on a clock.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT DOES
//
// Every half hour it looks for job applications whose next follow-up is due,
// and queues that step's email (and text, if the applicant ticked the box).
// Four touches over ten days, then it stops. It also stops the moment the
// candidate replies, books, opts out, or a human moves the application — the
// exits live in src/hiring/outreach.mjs and are re-read on every single pass,
// because this thing sleeps for days at a time and all four can become true
// while it is asleep.
//
// IT SENDS NOTHING ITSELF. It writes `messages` rows with status='queued' and
// stops. src/messaging/dispatch.mjs gates, routes and sends them, and
// message-dispatch-sweeper.mjs is what calls the dispatcher. So every control
// on outbound mail still applies to a candidate exactly as it applies to a
// client: the per-company pause switch, the daily cap, quiet hours on texts,
// restricted wording, and the compliance gate with no override.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY A SWEEPER AND NOT AN EVENT WITH SLEEPS
//
// The obvious shape is one long-running function per applicant with
// step.sleep between touches. It is worse here for the same reason
// message-dispatch-sweeper.mjs gives:
//
//   * The exits have no events. Nobody emits "the candidate went quiet", and
//     three of the four stop conditions (a decision, a booking, an opt-out) are
//     rows changing rather than events firing. Something has to come back and
//     look.
//   * A cadence in flight would have to be cancelled when a human moves the
//     application, and a cancellation that misses leaves a workflow that texts
//     somebody after they were hired.
//   * Ten days is a long time to hold a function open for four small writes.
//
// A due-list drained on a clock handles all of it with one mechanism, and the
// state is a row anybody can read instead of a runtime somewhere.
//
// ═══════════════════════════════════════════════════════════════════════════
// EVERY PASS IS BOUNDED. SWEEP_CAP applications per pass, one step each. A
// backlog that does not fit in one pass is finished by the next one; an
// application that is still due is still due.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sweepCandidateOutreach, SWEEP_CAP } from "../hiring/outreach.mjs";

/** Every thirty minutes. The cadence's own gaps are measured in days, so the
    only thing this interval decides is how late a due step can be — half an
    hour, worst case, which is invisible against a two-day gap. A tighter clock
    would buy nothing and scan the same table more often. */
export const SWEEP_CRON = "45 * * * *";

export const SOURCE_WORKFLOW = "hiring-outreach-cadence";

/* sweep — one pass.

   Never throws. A scheduled job that falls over takes the schedule with it, and
   the next pass is the recovery: every application it did not work is still
   active and still due. The error is returned so a caller can log it. */
export async function sweep(handleDb, options = {}) {
  const { cap = SWEEP_CAP, ...rest } = options;
  try {
    return await sweepCandidateOutreach(handleDb || db, { ...rest, cap });
  } catch (err) {
    return {
      ok: false,
      scanned: 0,
      queued: 0,
      stopped: 0,
      results: [],
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

/* handle — the shape src/journeys/runner/registry.mjs expects of a registered
   workflow. It has no event trigger, so no journey will ever reach it and it
   will always show in the runner's neverFired list. That is correct for a cron
   job, not a coverage hole. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const hiringOutreachCadence = inngest.createFunction(
  { id: "hiring-outreach-cadence", name: "Hiring — candidate follow-up cadence" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
