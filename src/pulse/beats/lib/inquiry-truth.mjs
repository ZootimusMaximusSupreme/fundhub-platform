// Inquiry cases that stopped moving: the SQL and the verdict. Read only. Report only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This code used to live in src/pulse/coverage/gap-inquiry.mjs.
// It moved here, unchanged except for the two heartbeats.mjs numbers copied below, so the morning
// lane (gap-inquiry.mjs imports it back) and the hourly beat (beat-inquiry-trip.mjs) run the same
// SQL and the same verdict. A beat may import only from src/pulse/beats/lib, so the truth lives here.
// The case constants the inquiry trip shares (lib/inquiry-trip-truth.mjs) live here too.
//
// Never POST. Never mail a bureau. Never auto-fix. One SELECT. The caller hands in the reader
// ({ query }): the morning lane its pool, the beat its read box.

/** No update for this long on a case a person should be moving. */
export const STUCK_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * The call sweeper runs every 15 minutes (see JOBS in heartbeats.mjs). A call that
 * came due and is still not fired after 3 runs of that sweeper is stuck.
 */
export const CALL_SWEEPER_CRON = "*/15 * * * *";
/** heartbeats.mjs STALE_MULTIPLE and cronIntervalMs(CALL_SWEEPER_CRON), copied: a lib file may import only lib
 *  files. beat-inquiry-trip.test.mjs fails the day either copy drifts from heartbeats.mjs. */
export const STALE_MULTIPLE = 3;
export const CALL_SWEEPER_INTERVAL_MS = 15 * 60 * 1000;
export const CALL_GRACE_MS = STALE_MULTIPLE * CALL_SWEEPER_INTERVAL_MS;

/** Same three the call sweeper is allowed to move. Escalated is not one of them. */
export const CALL_DUE_STATUSES = Object.freeze(["Queued", "Scheduled", "In Progress"]);

/** Gate writes a draft for any of these while the round still has open inquiries. */
export const LETTER_STATUSES = Object.freeze([
  "Queued",
  "Scheduled",
  "In Progress",
  "Escalated",
  "Blocked"
]);

/** Only the inquiry gate writes a draft letter. Cases from the IRA webhook never get one. */
export const GATE_SOURCE = "inquiry_gate";

/**
 * A case is stuck when no person or job is going to move it on its own:
 *   1. Escalated (needs a person) and untouched for 72 hours.
 *   2. Queued, Scheduled or In Progress, with no call scheduled and none fired
 *      (so nothing is waiting on a clock), untouched for 72 hours.
 *   3. A call came due, the sweeper had 3 runs to fire it, and it did not.
 * A case with a call still to come, or a call already fired, is waiting on the
 * bureau, not stuck. Blocked cases wait on client documents (documents lane).
 */
export const STUCK_SQL = `
SELECT count(*)::int AS n
  FROM inquiry_removal_cases irc
 WHERE irc.org_id = $1::uuid
   AND irc.is_demo IS NOT TRUE
   AND irc.closed_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM clients c
      WHERE c.id = irc.client_id
        AND (c.is_demo IS TRUE OR c.custom_fields->>'synthetic' = 'true')
   )
   AND (
     (
       irc.case_status::text = 'Escalated'
       AND irc.updated_at < $2::timestamptz
     )
     OR (
       irc.case_status::text = ANY($3::text[])
       AND irc.call_due_at IS NULL
       AND irc.call_fired_at IS NULL
       AND irc.updated_at < $2::timestamptz
     )
     OR (
       irc.case_status::text = ANY($3::text[])
       AND irc.call_due_at IS NOT NULL
       AND irc.call_due_at <= $4::timestamptz
       AND irc.call_fired_at IS NULL
     )
   )`;

const NO_MAIL = "Do not mail a bureau from this pulse.";
const NO_FIX = "Do not auto-fix from this pulse.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).slice(0, 160);
}

function countOf(rows) {
  const n = Number(rows && rows[0] ? rows[0].n : 0);
  return Number.isFinite(n) ? n : null;
}

/** The stuck-case check. ctx: { db: { query }, orgId, now }. Same rows the morning lane gave. */
export async function checkStuck({ db, orgId, now }) {
  if (!db || !orgId) {
    return check("inquiry:case-stuck", "skip", "no database — stuck inquiry cases not read");
  }
  const staleBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const callOverdueBefore = new Date(now.getTime() - CALL_GRACE_MS);
  try {
    const { rows } = await db.query(STUCK_SQL, [
      orgId,
      staleBefore.toISOString(),
      [...CALL_DUE_STATUSES],
      callOverdueBefore.toISOString()
    ]);
    const n = countOf(rows);
    if (n == null) {
      return check(
        "inquiry:case-stuck",
        "FAIL",
        "stuck inquiry case count was not a number",
        `Read inquiry_removal_cases. ${NO_MAIL} ${NO_FIX}`
      );
    }
    if (n === 0) {
      return check(
        "inquiry:case-stuck",
        "PASS",
        "no inquiry case is stale for 72 hours with nothing moving it, and no call is due and unfired"
      );
    }
    const noun = n === 1 ? "inquiry case is stuck" : "inquiry cases are stuck";
    return check(
      "inquiry:case-stuck",
      "FAIL",
      `${n} ${noun} (no update in 72 hours with nothing scheduled, or a call was due and never started)`,
      `Open the Specialist desk and move the stuck inquiry cases. ${NO_MAIL} ${NO_FIX}`
    );
  } catch (err) {
    return check(
      "inquiry:case-stuck",
      "FAIL",
      `could not read inquiry cases: ${clip(err)}`,
      `Read inquiry_removal_cases. ${NO_MAIL} ${NO_FIX}`
    );
  }
}
