// Background jobs that can stall with nobody noticing.
//
// Read only. This does not start a clock, drain the dead-letter queue, or
// re-run a job. Two reads, neither of them a copy of an existing check:
//
//   failed-events           Dead-letter rows that sit failed. An event handler
//                           that throws leaves a row in failed_events and
//                           nothing else, so nobody hears about it.
//   job-heartbeats-unlisted A scheduled job that reports a run but is not on
//                           the heartbeat list (src/pulse/heartbeats.mjs JOBS),
//                           so nobody would hear when it goes quiet.
//
// Claude review 2026-10-08: this file used to also run the job heartbeat check
// and hand back one `job:` row per known job. The morning pulse already runs
// that same check (daily-pulse.mjs), so every job printed twice,
// once as job:x and once as gap-jobs:job:x, and 40 extra PASS rows inflated the
// count. Late jobs are the existing check's job; they are not repeated here.
//
// A dead-letter row is stuck when it has given up (exhausted), or when it is
// still pending and already late. doc-check pending rows are not late until
// they are older than 3 times the document retry sweeper (every 20 minutes).
// That sweeper is the clock for those rows. Every other handler has no clock,
// so a pending row is stuck as soon as its next try time has passed.
//
// A row whose payload email sits on a name that can never receive mail
// (example.com, example.net, example.org, .test, .example, .invalid,
// .localhost) came from a test walk, not a customer. It is counted and left
// out of the failure. Measured 2026-10-08: all 24 pending rows were that.

import { JOBS, STALE_MULTIPLE, cronIntervalMs } from "../heartbeats.mjs";

/** Same string as doc-check-retry-sweeper.mjs SWEEP_CRON. */
export const DOC_CHECK_RETRY_CRON = "*/20 * * * *";

/** Handler name on failed_events for the document reader. */
export const DOC_CHECK_HANDLER = "doc-check";

/** Names that can never receive mail (RFC 2606 / 6761). Same list as the Resend provider refuses. */
export const TEST_ADDRESS_RE =
  "@([a-z0-9-]+\\.)*(example\\.(com|net|org)|[a-z0-9-]+\\.(test|example|invalid|localhost))$";

/** A job that reported a run in this long and is not on the list is unlisted. */
export const UNLISTED_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const STUCK_SQL = `
WITH due AS (
  SELECT handler_name, status, last_seen_at, error_message,
         (lower(coalesce(payload->>'email', '')) ~ $4::text) AS is_test
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
)
SELECT count(*) FILTER (WHERE NOT is_test)::int AS n,
       count(*) FILTER (WHERE NOT is_test AND status = 'exhausted')::int AS exhausted,
       count(*) FILTER (WHERE NOT is_test AND status = 'pending')::int AS pending,
       count(*) FILTER (WHERE is_test)::int AS test_rows,
       (array_agg(handler_name ORDER BY last_seen_at DESC) FILTER (WHERE NOT is_test))[1] AS latest_handler,
       (array_agg(left(error_message, 160) ORDER BY last_seen_at DESC) FILTER (WHERE NOT is_test))[1] AS latest_error
  FROM due
`.trim();

export const UNLISTED_SQL = `
WITH recent AS (
  SELECT job, max(finished_at) AS last_at
    FROM job_heartbeats
   WHERE finished_at >= $1::timestamptz
   GROUP BY job
)
SELECT count(*)::int AS recent_jobs,
       (array_agg(job ORDER BY last_at DESC) FILTER (WHERE NOT (job = ANY($2::text[]))))[1:10] AS unlisted
  FROM recent
`.trim();

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/* An error text can quote a row. The morning text must not carry a person's
   email or phone number. */
export function scrub(text) {
  return String(text == null ? "" : text)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]");
}

function clip(err) {
  return String((err && err.message) || err || "unknown")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/* 42P01 (no such table) and 42703 (no such column) mean the read itself is
   broken, which stays broken every morning. Anything else may be a blip. */
function schemaDrift(err) {
  return Boolean(err && (err.code === "42P01" || err.code === "42703"));
}

function noRead(id, what, err) {
  if (schemaDrift(err)) {
    return check(
      id,
      "FAIL",
      `${what} cannot be read: ${clip(err)}`,
      "Restore the table or column this read uses. Do not add a second watcher from this pulse."
    );
  }
  return check(id, "skip", `${what} not read: ${clip(err)}`);
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
    const { rows } = await db.query(STUCK_SQL, [now, due, DOC_CHECK_HANDLER, TEST_ADDRESS_RE]);
    const row = rows && rows[0] ? rows[0] : {};
    const n = Number(row.n || 0);
    const tests = Number(row.test_rows || 0);
    if (!Number.isFinite(n)) {
      return check("failed-events", "skip", "failed events count was not a number");
    }
    if (n === 0) {
      const left = tests > 0
        ? ` ${tests} old dead-letter ${tests === 1 ? "row is" : "rows are"} on test addresses (example.com, .test) and left alone.`
        : "";
      return check("failed-events", "PASS", `No stuck dead-letter rows.${left}`);
    }
    const exhausted = Number(row.exhausted || 0);
    const pending = Number(row.pending || 0);
    const handler = row.latest_handler ? String(row.latest_handler).slice(0, 80) : "unknown handler";
    const error = row.latest_error ? scrub(row.latest_error).replace(/\s+/g, " ").slice(0, 160) : "no error text";
    const noun = n === 1 ? "row" : "rows";
    return check(
      "failed-events",
      "FAIL",
      `${n} stuck dead-letter ${noun} (${exhausted} exhausted, ${pending} pending overdue). Latest: ${handler} — ${error}`,
      "Open the dead-letter list and read the handler and the error. Do not retry them from this pulse."
    );
  } catch (err) {
    return noRead("failed-events", "failed events", err);
  }
}

async function unlistedJobsCheck(db, now, jobs) {
  const id = "job-heartbeats-unlisted";
  if (!db || typeof db.query !== "function") {
    return check(id, "skip", "no database in this run — job heartbeats not read");
  }
  try {
    const since = new Date(now.getTime() - UNLISTED_WINDOW_MS);
    const { rows } = await db.query(UNLISTED_SQL, [since, jobs.map((j) => j.job)]);
    const row = rows && rows[0] ? rows[0] : {};
    const recent = Number(row.recent_jobs || 0);
    if (!Number.isFinite(recent) || recent === 0) {
      return check(id, "skip", "no job reported a run in the last 3 days, so there is nothing to compare to the list");
    }
    const unlisted = Array.isArray(row.unlisted) ? row.unlisted.map((name) => String(name).slice(0, 80)) : [];
    if (unlisted.length > 0) {
      return check(
        id,
        "FAIL",
        `${unlisted.length} scheduled ${unlisted.length === 1 ? "job reports" : "jobs report"} a run but ${unlisted.length === 1 ? "is" : "are"} not on the heartbeat list: ${unlisted.join(", ")}. Nobody would hear if ${unlisted.length === 1 ? "it" : "they"} went quiet.`,
        "Add each name to INNGEST_JOBS or NETLIFY_JOBS in src/pulse/heartbeats.mjs. Do not add a second watcher from this pulse."
      );
    }
    return check(id, "PASS", `all ${recent} jobs that reported a run in the last 3 days are on the heartbeat list`);
  } catch (err) {
    return noRead(id, "job heartbeats", err);
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
  return [
    await failedEventsCheck(db, now),
    await unlistedJobsCheck(db, now, jobs)
  ];
}
