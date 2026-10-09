// Event workflow rows — zero "not checked" (Ship 1 judged events only; Ship 2 adds run receipts), 2026-10-09.
//
// One row per bundled Inngest function that is not a pure cron: `wf:<id>`.
// Crons are the `job:` rows in heartbeats.mjs. This file judges the other 65
// (62 that start on an event, 3 that have no trigger).
//
// Two reads for ALL of them, no more:
//   events  one grouped SELECT on `events`: which trigger names had an event in the last 3 days.
//   runs    one SELECT on `workflow_runs` (written by src/pulse/run-evidence.mjs): the recent runs of
//           every workflow, the events that never started a run, when receipts began, and whether
//           the app can still write them.
//
// A row is a real green, a real red, or "nothing to judge" with a reason the audit re-checks.
// Rules, FIRST HIT WINS:
//
//   a. no trigger / switched off                       -> na   no-trigger
//   b. its newest finished run FAILED for good,
//      and that was over 15 minutes ago                -> FAIL  "last run failed"
//      (a failure with a retry still coming is "retrying", PASS, never red)
//   c. an event came (over 15 minutes ago, after
//      receipts began) and no run of THIS workflow
//      carries that event's id                         -> FAIL  "event came, workflow never started"
//      (if the app cannot write receipts any more:    -> skip  "receipts are off", never a guess)
//   d. a run that started and never finished:
//        a workflow that does not sleep, over 30 min   -> FAIL  "started, never finished"
//        a sleeper, past its longest wait + one day    -> FAIL
//        a sleeper inside its wait                     -> PASS  "asleep, waits by design"
//   e. its last 3 runs all skipped                     -> FAIL  "every run skipped"
//   f. a run in the last 30 days finished ok (or
//      one is asleep or still running)                 -> PASS  with the times
//   g. no event and no run                             -> na   no-demand
//   h. an event came and receipts cannot judge it      -> skip  (lands "not checked", red)
//        - the receipts table cannot be read, or has no start marker
//        - the event came before receipts began and receipts are not yet a day old
//
// The pulse only reports. Nothing here fixes anything. Nothing is written. No repo file is read at
// run time: the caller hands in the bundled `functions` list.

export const WORKFLOW_SINCE_DAYS = 3;
export const RUN_WINDOW_DAYS = 30;
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const READ_TIMEOUT_MS = 5000;

/* An event younger than this has not been given time to start a run. */
export const START_GRACE_MS = 15 * MIN_MS;
/* A failed-for-good run is judged red once it is this old. */
export const FAILED_JUDGE_AFTER_MS = 15 * MIN_MS;
/* A workflow that does not sleep has this long to finish. */
export const OPEN_LIMIT_MS = 30 * MIN_MS;
/* A sleeper may sleep this long past its longest wait before it is called lost. */
export const SLEEPER_SLACK_MS = DAY_MS;
/* Events in the first hour after the receipts marker are not judged: the code deploys a few minutes
   after the migration, and an event in that gap was handled by the old code. */
export const RECEIPTS_GRACE_MS = HOUR_MS;
/* A "nothing came since receipts began" claim needs a window at least this long (the audit's own floor). */
export const NO_DEMAND_MIN_WINDOW_MS = DAY_MS;
export const SKIPPED_RUNS_JUDGED = 3;
export const RUNS_PER_FUNCTION = 25;
/* The function id of the marker row db/migrations/478 inserts. Real ids never start with an underscore. */
export const RECORDER_FUNCTION_ID = "_recorder";

/* Workflows that are dark on purpose. Each needs a reason of 40+ characters.
   workflow-coverage.test.mjs fails when a function has no trigger and is not
   here, and when an entry here is not really dark any more. */
export const NOT_LIVE_WORKFLOWS = Object.freeze({
  "n-01-cold-nurture":
    "Retired 2026-08-22. Its entry.captured trigger was removed because cold copy was landing on leads eleven seconds old.",
  "n-02-warm-nurture":
    "Retired 2026-08-22. Its survey.submitted trigger was removed because warm copy was landing on brand-new leads.",
  "n-03-hot-nurture":
    "Retired 2026-08-22. Both triggers were removed and the workflow is switched off. Owner call: every lead is hot."
});

/* SLEEPERS — the workflows that call step.sleep, step.sleepUntil or step.waitForEvent, with the LONGEST
   time one run can stay open (sum of its sleeps, with room). A run of these has a start mark and no finish
   mark for as long as it sleeps, and that is by design. A run older than its wait plus a day is lost.

   A workflow that is NOT here has one request's worth of work: it is red if a run is still open after
   30 minutes. A workflow that sleeps and is missing here would be called lost 30 minutes into its first sleep.
   workflow-runs.test.mjs reads the bundled workflow files and fails when a sleeper is missing from this map,
   when an entry is not a sleeper, and when a workflow with cancelOn is missing (a cancelled run also stays open).

   Booking-based waits: the longest lead measured on 68 real bookings is 2 days 23 hours 59 minutes, so
   14 days is room, not a guess at the calendar. If bookings are ever taken further ahead, raise these. */
const H = HOUR_MS;
const D = DAY_MS;
export const SLEEPERS = Object.freeze({
  "ai-set-01-josh-setter": 1 * D, // sleeps to the end of quiet hours (8 p.m. to 8 a.m.), at most one night
  "ai-set-03-no-answer-cadence": 3 * H, // 30 minutes, then 2 hours
  "ai-set-04-3way-handoff": 14 * D, // sleeps until 15 minutes before a booked call
  "ar-collections": 14 * D, // 7 days, then 7 days
  "bc-01-customer-responsiveness": 3 * D, // 24 hours, then 48 hours
  "bs-01-precall-launcher": 21 * D, // until 48 hours before the call, then 3 days of touches
  "dpc-02-call-outcome-enforcement": 14 * D, // until 5 minutes after the booked call ends
  "dpc-05-no-progress-escalation": 3 * D, // 72 hours
  "f-02-portal-id-missing": 3 * D, // 3 hours, then 2 days
  "n-06-renewal-second-wave": 180 * D, // 180 days
  "s-02-incomplete-survey-nudge": 1 * H, // 20 minutes
  "s-04b-booking-reminders": 14 * D, // until 24 hours, then 2 hours, before a booked call
  "s-nobook-chase": 5 * D, // 2 hours, 24 hours, then 72 hours
  "s-05a-no-show-recovery": 8 * D, // 24 hours, 48 hours, then 96 hours
  "slo-genuine-followup": 1 * H, // 15 minutes
  "slo-no-reply-197": 2 * D, // 24 hours
  "slo-paid-form-nudge": 1 * H // 15 minutes
});

/** The start of the events look-back window: three days before `now`. */
export function workflowSince(now = new Date()) {
  return new Date(now.getTime() - WORKFLOW_SINCE_DAYS * DAY_MS);
}

/* workflowTriggers — what one bundled function listens for.
   Inngest 3.x exposes it as fn.opts: { id, enabled?, triggers: [{ event } | { cron }] }. */
export function workflowTriggers(fn) {
  const opts = (fn && fn.opts) || {};
  let id = typeof opts.id === "string" && opts.id ? opts.id : null;
  if (!id && fn && typeof fn.id === "function") {
    try { id = fn.id(); } catch { id = null; }
  }
  const triggers = Array.isArray(opts.triggers) ? opts.triggers : [];
  const events = [];
  const crons = [];
  for (const t of triggers) {
    if (t && typeof t.event === "string" && t.event) events.push(t.event);
    else if (t && typeof t.cron === "string" && t.cron) crons.push(t.cron);
  }
  return { id, events, crons, enabled: opts.enabled !== false, hasTrigger: events.length + crons.length > 0 };
}

/* The events read: how many events of each trigger name came since the window start. */
export const EVENTS_SQL = `SELECT name,
       count(*)::int AS n,
       min(created_at) AS first_at,
       max(created_at) AS last_at
  FROM events
 WHERE name = ANY($1::text[])
   AND created_at > $2::timestamptz
 GROUP BY name`;

/* The runs read. Three kinds of row come back, told apart by `kind`:
     run   the latest state of each recent run (the newest finished attempt wins; an unfinished run is
           shown by its start mark), with the time its first attempt began. At most $8 per workflow.
     miss  per workflow and event name: events after receipts began, over 15 minutes old, that NO run
           of that workflow carries the id of (count, first and last time). Nothing, when receipts have no marker.
     meta  one row: when receipts began (the marker row), and n = 1 when the app can still write receipts.
   $1 workflow ids, $2 their event names (same length, one pair per trigger), $3 events window start,
   $4 events window end (now minus 15 minutes), $5 runs window start, $6 unfinished-runs window start,
   $7 minutes of grace after the marker, $8 runs kept per workflow. */
export const RUNS_SQL = `WITH began AS (
  SELECT min(started_at) AS at FROM workflow_runs WHERE function_id = '${RECORDER_FUNCTION_ID}'
),
specs AS (
  SELECT function_id, name FROM unnest($1::text[], $2::text[]) AS s(function_id, name)
),
latest AS (
  SELECT DISTINCT ON (run_id)
         run_id, function_id, event_name, bus_event_id, attempt, max_attempts,
         min(started_at) OVER (PARTITION BY run_id) AS run_started_at,
         finished_at, outcome, "final", skipped, note, error
    FROM workflow_runs
   WHERE function_id <> '${RECORDER_FUNCTION_ID}'
     AND function_id IN (SELECT function_id FROM specs)
     AND (started_at > $5::timestamptz OR (finished_at IS NULL AND started_at > $6::timestamptz))
   ORDER BY run_id, finished_at DESC NULLS LAST, attempt DESC
),
ranked AS (
  SELECT latest.*, row_number() OVER (PARTITION BY function_id ORDER BY run_started_at DESC) AS rn
    FROM latest
)
SELECT 'run'::text AS kind, function_id, run_id, event_name, bus_event_id, attempt, max_attempts,
       run_started_at AS at, finished_at, outcome, "final", skipped, note, error, NULL::int AS n
  FROM ranked
 WHERE rn <= $8::int
UNION ALL
SELECT 'miss', s.function_id, NULL, s.name, NULL, NULL, NULL,
       min(e.created_at), max(e.created_at), NULL, NULL, NULL, NULL, NULL, count(*)::int
  FROM specs s
  JOIN events e ON e.name = s.name
 WHERE (SELECT at FROM began) IS NOT NULL
   AND e.created_at > greatest($3::timestamptz, (SELECT at FROM began) + make_interval(mins => $7::int))
   AND e.created_at <= $4::timestamptz
   AND NOT EXISTS (
     SELECT 1 FROM workflow_runs w
      WHERE w.function_id = s.function_id AND w.bus_event_id = e.id::text
   )
 GROUP BY s.function_id, s.name
UNION ALL
SELECT 'meta', NULL, NULL, NULL, NULL, NULL, NULL,
       (SELECT at FROM began), NULL, NULL, NULL, NULL, NULL, NULL,
       CASE WHEN has_table_privilege(current_user, 'public.workflow_runs', 'INSERT')
             AND has_table_privilege(current_user, 'public.workflow_runs', 'UPDATE') THEN 1 ELSE 0 END`;

// ── small helpers ────────────────────────────────────────────────────────────

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

function minuteOf(date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function nameList(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function clip(text, max) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* "30 minutes", "3 hours", "14 days". */
function human(ms) {
  if (ms < HOUR_MS) {
    const m = Math.max(1, Math.round(ms / MIN_MS));
    return `${m} ${plural(m, "minute", "minutes")}`;
  }
  if (ms < 2 * DAY_MS) {
    const h = Math.max(1, Math.round(ms / HOUR_MS));
    return `${h} ${plural(h, "hour", "hours")}`;
  }
  const d = Math.round(ms / DAY_MS);
  return `${d} days`;
}

function ago(ms) {
  return `${human(Math.max(0, ms))} ago`;
}

function whyFailed(err) {
  const code = err && err.code ? `${err.code} ` : "";
  return clip(`${code}${(err && err.message) || err || "unknown error"}`, 160) || "unknown error";
}

/* The one place a read can go wrong in words a person can use. */
function readFailure(err) {
  if (err && err.code === "42P01") return "the workflow_runs table does not exist yet (42P01)";
  return whyFailed(err);
}

async function readRows({ db, scope, text, params, timeoutMs }) {
  const canScope = typeof scope === "function";
  if (!canScope && (!db || typeof db.query !== "function")) {
    throw new Error("no database in this run, so nothing was read");
  }
  let timer;
  // Wrapped so a synchronous throw (no DATABASE_URL) becomes a rejection.
  const run = (async () => (canScope
    ? scope((tx) => tx.query(text, params))
    : db.query(text, params)))();
  run.catch(() => {}); // a late rejection after the timer won must not be unhandled
  try {
    const res = await Promise.race([
      run,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("the read took too long")), timeoutMs);
      })
    ]);
    return res && Array.isArray(res.rows) ? res.rows : [];
  } finally {
    clearTimeout(timer);
  }
}

function row(id, status, detail, extra = {}) {
  return {
    id: `wf:${id}`,
    kind: "coverage",
    group: "jobs",
    status,
    detail,
    suggestedFix: extra.suggestedFix || null,
    customerSees: extra.customerSees || null,
    schedule: extra.schedule || null,
    ...(extra.na ? { na: extra.na } : {})
  };
}

/* Turn the rows of the runs read into per-workflow lists. */
function readRunRows(rows) {
  const runs = new Map();
  const miss = new Map();
  let began = null;
  let canWrite = true;
  for (const r of rows) {
    if (r.kind === "run") {
      const startedAt = toDate(r.at);
      if (!startedAt || !r.function_id) continue;
      const list = runs.get(r.function_id) || [];
      list.push({
        runId: String(r.run_id),
        attempt: Number.isInteger(r.attempt) ? r.attempt : 0,
        maxAttempts: Number.isInteger(r.max_attempts) ? r.max_attempts : null,
        startedAt,
        finishedAt: toDate(r.finished_at),
        outcome: r.outcome === "error" ? "error" : (r.outcome === "ok" ? "ok" : null),
        final: r.final === true,
        skipped: r.skipped === true,
        note: r.note ? String(r.note) : null,
        error: r.error ? String(r.error) : null
      });
      runs.set(r.function_id, list);
    } else if (r.kind === "miss") {
      const list = miss.get(r.function_id) || [];
      list.push({ name: String(r.event_name), n: Number(r.n) || 0, first: toDate(r.at), last: toDate(r.finished_at) });
      miss.set(r.function_id, list);
    } else if (r.kind === "meta") {
      began = toDate(r.at);
      canWrite = Number(r.n) === 1;
    }
  }
  return { runs, miss, began, canWrite };
}

// ── the rules ────────────────────────────────────────────────────────────────

/* judgeFromRuns — rules b to f, from the run receipts alone. Returns a row, or null when the receipts
   have nothing to say (the caller then looks at demand: rules g and h). */
function judgeFromRuns(s, { runs, miss, canWrite, now }) {
  const nowMs = now.getTime();
  const schedule = s.events.join(" + ");
  const fix = `Open ${s.id} in Inngest and read that run. Do not re-run it from this pulse.`;
  const finished = runs
    .filter((r) => r.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt);
  const open = runs.filter((r) => !r.finishedAt).sort((a, b) => a.startedAt - b.startedAt);
  const newest = finished[0] || null;

  // b. its newest finished run failed for good.
  if (newest && newest.outcome === "error" && newest.final) {
    const age = nowMs - newest.finishedAt.getTime();
    if (age >= FAILED_JUDGE_AFTER_MS) {
      return row(
        s.id,
        "FAIL",
        `Its last run failed ${minuteOf(newest.finishedAt)}: ${newest.error || "no reason was saved"}. No retry is coming.`,
        {
          suggestedFix: fix,
          customerSees: `${s.id} stopped on its last run, so the work it does for leads and clients was not done.`,
          schedule
        }
      );
    }
    return row(
      s.id,
      "skip",
      `Its last run failed ${ago(age)}: ${newest.error || "no reason was saved"}. It is judged once it is ${human(FAILED_JUDGE_AFTER_MS)} old.`,
      { suggestedFix: fix, schedule }
    );
  }

  // c. an event came and no run of this workflow carries its id.
  const lost = miss.reduce((sum, m) => sum + m.n, 0);
  if (lost > 0) {
    const firsts = miss.map((m) => m.first).filter(Boolean).sort((a, b) => a - b);
    const said = miss.map((m) => `${m.n} ${m.name}`).join(" and ");
    if (!canWrite) {
      return row(
        s.id,
        "skip",
        `${said} ${plural(lost, "event", "events")} came, but run receipts are switched off (the app cannot write them). This workflow was not judged.`,
        { suggestedFix: "Put the write permission on workflow_runs back (GRANT INSERT, UPDATE to fundhub_app), or take the add-on out of src/workflows/client.mjs on purpose.", schedule }
      );
    }
    return row(
      s.id,
      "FAIL",
      `${said} ${plural(lost, "event", "events")} came and this workflow never started` +
        `${firsts.length ? ` (first ${minuteOf(firsts[0])})` : ""}. The engine did not run it.`,
      {
        suggestedFix: `Open ${s.id} in Inngest and look for the ${miss[0].name} event. If Inngest never got it, the send was lost. Do not re-run it from this pulse.`,
        customerSees: `Work that ${s.id} should have started for a lead or client was never started.`,
        schedule
      }
    );
  }

  // d. a run that started and never finished.
  const sleep = Object.prototype.hasOwnProperty.call(SLEEPERS, s.id) ? SLEEPERS[s.id] : null;
  const limit = sleep == null ? OPEN_LIMIT_MS : sleep + SLEEPER_SLACK_MS;
  const lostRuns = open.filter((r) => nowMs - r.startedAt.getTime() > limit);
  if (lostRuns.length > 0) {
    const oldest = lostRuns[0];
    const said = sleep == null
      ? `${lostRuns.length} ${plural(lostRuns.length, "run", "runs")} started and never finished. The oldest began ${minuteOf(oldest.startedAt)}. This workflow should finish in ${human(OPEN_LIMIT_MS)}.`
      : `${lostRuns.length} ${plural(lostRuns.length, "run", "runs")} ${plural(lostRuns.length, "has", "have")} been asleep too long. The oldest began ${minuteOf(oldest.startedAt)}. The longest wait for this workflow is ${human(sleep)}.`;
    return row(s.id, "FAIL", said, {
      suggestedFix: fix,
      customerSees: `A run of ${s.id} stopped part of the way, so the rest of its work was not done.`,
      schedule
    });
  }

  // A failure with a retry still coming. Never red.
  if (newest && newest.outcome === "error" && !newest.final) {
    const of = newest.maxAttempts ? ` of ${newest.maxAttempts}` : "";
    return row(
      s.id,
      "PASS",
      `Retrying: attempt ${newest.attempt + 1}${of} failed ${minuteOf(newest.finishedAt)}: ${newest.error || "no reason was saved"}. It is judged again when the retries are done.`,
      { schedule }
    );
  }

  // e. every one of its last runs did nothing on purpose.
  const lastRuns = finished.slice(0, SKIPPED_RUNS_JUDGED);
  if (lastRuns.length === SKIPPED_RUNS_JUDGED && lastRuns.every((r) => r.outcome === "ok" && r.skipped)) {
    const why = lastRuns[0].note ? `: ${lastRuns[0].note}` : " (no reason was saved)";
    return row(
      s.id,
      "FAIL",
      `Every run skipped${why}. Its last ${SKIPPED_RUNS_JUDGED} runs all ran and did nothing.`,
      {
        suggestedFix: `Read why ${s.id} skips. A switch or a key may be off. Do not re-run it from this pulse.`,
        customerSees: `${s.id} is running and doing nothing, so its work for leads and clients is not happening.`,
        schedule
      }
    );
  }

  // f. it ran, or it is asleep or running by design.
  const lastOk = finished.find((r) => r.outcome === "ok") || null;
  if (lastOk || open.length > 0) {
    const parts = [];
    if (lastOk) {
      parts.push(lastOk.skipped
        ? `Last run started ${minuteOf(lastOk.startedAt)} and finished ok ${minuteOf(lastOk.finishedAt)}. It skipped${lastOk.note ? `: ${lastOk.note}` : ""}.`
        : `Last run started ${minuteOf(lastOk.startedAt)} and finished ok ${minuteOf(lastOk.finishedAt)}.`);
    }
    if (open.length > 0) {
      const since = minuteOf(open[0].startedAt);
      parts.push(sleep == null
        ? `${open.length} ${plural(open.length, "run is", "runs are")} still running (the oldest began ${since}).`
        : `${open.length} ${plural(open.length, "run is", "runs are")} asleep (the oldest began ${since}). It waits by design, up to ${human(sleep)}.`);
    }
    return row(s.id, "PASS", parts.join(" "), { schedule });
  }
  return null;
}

/* judgeFromDemand — rules g and h, when the receipts have nothing to say. */
function judgeFromDemand(s, { events, eventsError, runsError, began, canWrite, now, since }) {
  const nowMs = now.getTime();
  const schedule = s.events.join(" + ");
  const fix = `Open ${s.id} in Inngest and read its runs. Do not re-run it from this pulse.`;
  if (eventsError) {
    return row(s.id, "skip", `Events could not be read: ${eventsError}. This workflow was not judged.`, { suggestedFix: fix, schedule });
  }
  const hits = s.events
    .map((name) => ({ name, ...(events.get(name) || { n: 0, first: null, last: null }) }))
    .filter((h) => h.n > 0);

  // g. nobody handed it work.
  if (hits.length === 0) {
    return row(
      s.id,
      "na",
      `No ${nameList(s.events)} event came since ${dayOf(since)}. Judged the day one comes.`,
      { schedule, na: { code: "no-demand", args: { names: [...s.events], since: since.toISOString() } } }
    );
  }

  // h. work came, and the receipts cannot judge it.
  const total = hits.reduce((sum, h) => sum + h.n, 0);
  const said = hits.map((h) => `${h.n} ${h.name}`).join(" and ");
  const lasts = hits.map((h) => h.last).filter(Boolean).sort((a, b) => b - a);
  const firsts = hits.map((h) => h.first).filter(Boolean).sort((a, b) => a - b);
  const came = `${said} ${plural(total, "event", "events")} came since ${dayOf(since)}${firsts.length ? ` (first ${minuteOf(firsts[0])})` : ""}`;
  if (runsError) {
    return row(s.id, "skip", `${came}, but run receipts could not be read: ${runsError}. This workflow was not judged.`, { suggestedFix: fix, schedule });
  }
  if (!began) {
    return row(s.id, "skip", `${came}, but run receipts have no start marker, so nothing says whether it ran. This workflow was not judged.`, { suggestedFix: fix, schedule });
  }
  if (!canWrite) {
    return row(s.id, "skip", `${came}, but run receipts are switched off (the app cannot write them). This workflow was not judged.`, {
      suggestedFix: "Put the write permission on workflow_runs back (GRANT INSERT, UPDATE to fundhub_app), or take the add-on out of src/workflows/client.mjs on purpose.",
      schedule
    });
  }
  const floor = new Date(began.getTime() + RECEIPTS_GRACE_MS);
  const lastAt = lasts[0] || null;
  if (lastAt && lastAt.getTime() > floor.getTime()) {
    // An event after receipts began. The receipts read found no missing run, and none is old enough to be late.
    if (nowMs - lastAt.getTime() < START_GRACE_MS) {
      return row(
        s.id,
        "PASS",
        `${said} ${plural(total, "event", "events")} came ${ago(nowMs - lastAt.getTime())}. The workflow has ${human(START_GRACE_MS)} to start.`,
        { schedule }
      );
    }
    return row(s.id, "skip", `${came}, but no receipt could be matched to it. This workflow was not judged.`, { suggestedFix: fix, schedule });
  }
  // Every event came before receipts began. Nothing records whether those ran.
  if (nowMs - floor.getTime() >= NO_DEMAND_MIN_WINDOW_MS) {
    return row(
      s.id,
      "na",
      `No ${nameList(s.events)} event came since ${dayOf(floor)}, when run receipts began. Judged the day one comes.`,
      { schedule, na: { code: "no-demand", args: { names: [...s.events], since: floor.toISOString() } } }
    );
  }
  return row(
    s.id,
    "skip",
    `${came}, before run receipts began (${minuteOf(began)}). Nothing says whether it ran. It is judged from the next event, or once receipts are a day old.`,
    { suggestedFix: fix, schedule }
  );
}

/**
 * checkWorkflowRuns — one row per bundled function that is not a pure cron.
 *
 *   functions   the list exported by src/workflows/index.mjs (required)
 *   db / scope  the plain pool, and the staff-scope runner when the pulse has one
 *   now         the clock
 *
 * Never throws. Rows keep the order of `functions`.
 */
export async function checkWorkflowRuns({
  db = null,
  scope = null,
  now = new Date(),
  functions,
  readTimeoutMs = READ_TIMEOUT_MS
} = {}) {
  if (!Array.isArray(functions)) {
    return [row("all", "skip", "The list of workflows was not handed to this check, so no workflow was judged.")];
  }
  const since = workflowSince(now);
  const specs = [];
  for (const fn of functions) {
    const t = workflowTriggers(fn);
    if (!t.id) continue;
    // A function that only runs on a clock is a `job:` row, not a `wf:` row.
    if (t.crons.length > 0 && t.events.length === 0) continue;
    specs.push(t);
  }

  // Which functions can be judged from events and receipts at all?
  const live = specs.filter((s) => s.enabled && s.events.length > 0);
  const names = [...new Set(live.flatMap((s) => s.events))];

  const events = new Map();
  let eventsError = null;
  let runsError = null;
  let receipts = { runs: new Map(), miss: new Map(), began: null, canWrite: true };

  if (live.length > 0) {
    const pairs = live.flatMap((s) => s.events.map((name) => [s.id, name]));
    const longestSleep = Math.max(0, ...live.map((s) => (Object.prototype.hasOwnProperty.call(SLEEPERS, s.id) ? SLEEPERS[s.id] : 0)));
    const runsFrom = new Date(now.getTime() - RUN_WINDOW_DAYS * DAY_MS);
    const openFrom = new Date(now.getTime() - Math.max(RUN_WINDOW_DAYS * DAY_MS, longestSleep + SLEEPER_SLACK_MS));
    const eventsUntil = new Date(now.getTime() - START_GRACE_MS);
    const [evRes, runRes] = await Promise.allSettled([
      readRows({ db, scope, text: EVENTS_SQL, params: [names, since.toISOString()], timeoutMs: readTimeoutMs }),
      readRows({
        db,
        scope,
        text: RUNS_SQL,
        params: [
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
          since.toISOString(),
          eventsUntil.toISOString(),
          runsFrom.toISOString(),
          openFrom.toISOString(),
          Math.round(RECEIPTS_GRACE_MS / MIN_MS),
          RUNS_PER_FUNCTION
        ],
        timeoutMs: readTimeoutMs
      })
    ]);
    if (evRes.status === "fulfilled") {
      for (const r of evRes.value) {
        events.set(String(r.name), { n: Number(r.n) || 0, first: toDate(r.first_at), last: toDate(r.last_at) });
      }
    } else {
      eventsError = whyFailed(evRes.reason);
    }
    if (runRes.status === "fulfilled") receipts = readRunRows(runRes.value);
    else runsError = readFailure(runRes.reason);
  }

  return specs.map((s) => {
    // a. nothing wakes this workflow.
    if (!s.enabled || s.events.length === 0) {
      return row(
        s.id,
        "na",
        "Turned off in code (no trigger). Judged the day a trigger is put back.",
        { na: { code: "no-trigger", args: { id: s.id } } }
      );
    }
    // b to f, from receipts.
    if (!runsError) {
      const judged = judgeFromRuns(s, {
        runs: receipts.runs.get(s.id) || [],
        miss: receipts.miss.get(s.id) || [],
        canWrite: receipts.canWrite,
        now
      });
      if (judged) return judged;
    }
    // g and h, from demand.
    return judgeFromDemand(s, {
      events,
      eventsError,
      runsError,
      began: receipts.began,
      canWrite: receipts.canWrite,
      now,
      since
    });
  });
}
