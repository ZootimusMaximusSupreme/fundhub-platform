// Background jobs that can stall with nobody noticing.
//
// Read only. This does not start a clock, drain the dead-letter queue, or
// re-run a job. The morning pulse already owns job heartbeats
// (src/pulse/heartbeats.mjs). This file asks that same check, and it also
// reads failed_events — the place an event handler sits after it throws.
//
// A dead-letter row is stuck when it has given up (exhausted), or when it is
// still pending and already late. doc-check pending rows are not late until
// they are older than 3 times the document retry sweeper (every 20 minutes).
// That sweeper is the clock for those rows. Every other handler has no clock,
// so a pending row is stuck as soon as its next try time has passed.

import { checkJobHeartbeats, JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";

/** Same string as doc-check-retry-sweeper.mjs SWEEP_CRON. */
export const DOC_CHECK_RETRY_CRON = "*/20 * * * *";

/** Handler name on failed_events for the document reader. */
export const DOC_CHECK_HANDLER = "doc-check";

const STUCK_SQL = `
SELECT count(*)::int AS n,
       count(*) FILTER (WHERE status = 'exhausted')::int AS exhausted,
       count(*) FILTER (WHERE status = 'pending')::int AS pending,
       (array_agg(handler_name ORDER BY last_seen_at DESC))[1] AS latest_handler,
       (array_agg(left(error_message, 160) ORDER BY last_seen_at DESC))[1] AS latest_error
  FROM failed_events
 WHERE status = 'exhausted'
    OR (
         status = 'pending'
         AND handler_name <> $3
         AND (next_attempt_at IS NULL OR next_attempt_at <= $1::timestamptz)
       )
    OR (
         status = 'pending'
         AND handler_name = $3
         AND (next_attempt_at IS NULL OR next_attempt_at <= $2::timestamptz)
       )
`.trim();

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err || "unknown").replace(/\s+/g, " ").slice(0, 160);
}

/* doc-check pending rows count as stuck only after 3 times the retry sweeper. */
export function docCheckStuckBefore(now) {
  const interval = cronIntervalMs(DOC_CHECK_RETRY_CRON);
  const grace = interval == null ? 0 : STALE_MULTIPLE * interval;
  return new Date(now.getTime() - grace);
}

async function failedEventsCheck(db, now) {
  if (!db || typeof db.query !== "function") {
    return check("failed-events", "skip", "no database in this run — failed events not read");
  }
  try {
    const due = docCheckStuckBefore(now);
    const { rows } = await db.query(STUCK_SQL, [now, due, DOC_CHECK_HANDLER]);
    const row = rows && rows[0] ? rows[0] : {};
    const n = Number(row.n || 0);
    if (!Number.isFinite(n)) {
      return check("failed-events", "skip", "failed events count was not a number");
    }
    if (n === 0) {
      return check("failed-events", "PASS", "No stuck dead-letter rows.");
    }
    const exhausted = Number(row.exhausted || 0);
    const pending = Number(row.pending || 0);
    const handler = row.latest_handler ? String(row.latest_handler).slice(0, 80) : "unknown handler";
    const error = row.latest_error ? String(row.latest_error).replace(/\s+/g, " ").slice(0, 160) : "no error text";
    const noun = n === 1 ? "row" : "rows";
    return check(
      "failed-events",
      "FAIL",
      `${n} stuck dead-letter ${noun} (${exhausted} exhausted, ${pending} pending overdue). Latest: ${handler} — ${error}`,
      "Open the dead-letter list and read the handler and the error. Do not retry them from this pulse."
    );
  } catch (err) {
    return check("failed-events", "skip", `failed events not read: ${clip(err)}`);
  }
}

/**
 * Morning read for stalled background work.
 * @param {{ db?: { query: Function }, now?: Date | string | number, jobs?: typeof JOBS }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS" | "FAIL" | "skip", detail: string, suggestedFix: string | null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx && ctx.db;
  const now = ctx && ctx.now instanceof Date
    ? ctx.now
    : new Date(ctx && ctx.now != null ? ctx.now : Date.now());
  const jobs = ctx && Array.isArray(ctx.jobs) ? ctx.jobs : JOBS;
  const out = [await failedEventsCheck(db, now)];
  try {
    const rows = await checkJobHeartbeats({ db, now, jobs });
    for (const row of rows) {
      out.push(check(row.id, row.status, row.detail, row.suggestedFix ?? null));
    }
  } catch (err) {
    out.push(check("job-heartbeats", "skip", `job heartbeats not read: ${clip(err)}`));
  }
  return out;
}
