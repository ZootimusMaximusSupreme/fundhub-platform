// Job heartbeats — did every scheduled job actually run? (MB2, gap 2)
//
// Writers: the Inngest heartbeat add-on in src/workflows/client.mjs (every cron
// run, one place, so no job file can forget) and the seven Netlify scheduled
// functions in netlify/functions/ (one line each). Table: db/migrations/430.
//
// Reader: checkJobHeartbeats(), called by the daily pulse (Recon AG-07).
// A job is red when its newest heartbeat is older than 3x its schedule. Audit
// only: a red job is reported, never restarted from here.

/* Every scheduled job, with the schedule it is registered on. Two runners.
   src/pulse/heartbeats.test.mjs fails if this list drifts from the registered
   Inngest crons (src/workflows/index.mjs) or from netlify.toml. */
export const INNGEST_JOBS = Object.freeze([
  ["af-01-affiliate-drip", "*/15 * * * *"],
  ["affiliate-payout-run", "0 3 1 * *"],
  ["blake-lead-watch", "*/5 * * * *"],
  ["blueprint-closer-ready-sweeper", "0 * * * *"],
  ["blueprint-finance-os-alerts", "30 7 * * *"],
  ["blueprint-next-funding-sequence-sweeper", "30 6 * * *"],
  ["clickfunnels-analytics-sweeper", "15 7 * * *"],
  ["commas-inbox-drain", "* * * * *"],
  ["contract-chaser", "0 10 * * *"],
  ["daily-pulse", "TZ=America/Phoenix 0 6 * * *"],
  ["doc-check-retry-sweeper", "*/20 * * * *"],
  ["document-vault-chase", "45 16 * * *"],
  ["evening-brief", "0 4 * * *"],
  ["finance-os-card-due-reminders", "0 16 * * *"],
  ["finance-os-money-agent", "30 16 * * *"],
  ["finance-os-money-transfers", "*/15 * * * *"],
  ["finance-os-pull-sweeper", "0 6 * * *"],
  ["finance-os-trend-snapshots", "30 7 * * *"],
  ["hiring-bench-sweeper", "30 13 * * *"],
  ["hiring-outreach-cadence", "*/30 * * * *"],
  ["inquiry-call-sweeper", "*/15 * * * *"],
  ["meet-transcript-sweeper", "*/10 * * * *"],
  ["merchant-pull-sweeper", "30 7 * * *"],
  ["message-dispatch-sweeper", "*/5 * * * *"],
  ["meta-campaign-sync-hourly", "30 * * * *"],
  ["meta-campaign-sync-sweeper", "0 7 * * *"],
  ["next-action-catch-up", "*/5 * * * *"],
  ["paid-checkout-expiry-sweeper", "0 * * * *"],
  ["pulse-instant-watch", "*/5 * * * *"],
  ["partner-production-floor", "0 14 1 * *"],
  ["plaid-transactions-sweeper", "0 7 * * *"],
  ["slo-infinite-drip", "0 15 * * *"],
  ["subscription-billing-sweeper", "17 * * * *"],
  ["watch-curve-diagnosis-sweeper", "30 7 * * *"],
  ["waypoint-nudge-sweeper", "0 * * * *"]
]);

export const NETLIFY_JOBS = Object.freeze([
  ["staff-message-sweeper", "*/5 * * * *"],
  ["social-publish-sweeper", "*/5 * * * *"],
  ["creative-job-runner", "*/2 * * * *"],
  ["hubstaff-poll-sweeper", "*/10 * * * *"],
  ["ad-video-sweeper", "*/5 * * * *"],
  ["commas-inbox-sweeper", "* * * * *"],
  ["marketing-clock", "*/15 * * * *"]
]);

export const JOBS = Object.freeze([
  ...INNGEST_JOBS.map(([job, cron]) => Object.freeze({ job, cron, runner: "inngest" })),
  ...NETLIFY_JOBS.map(([job, cron]) => Object.freeze({ job, cron, runner: "netlify" }))
]);

export const STALE_MULTIPLE = 3;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* cronIntervalMs — the gap between two runs, for the shapes this repo uses.
   Returns null for a shape it does not understand, and the check then says
   "not checked" rather than guessing a window. Monthly (day-of-month set)
   returns null too: those use lastMonthlyFire() instead, because 3x a month
   is a quarter of silence. */
export function cronIntervalMs(cron) {
  let raw = String(cron || "").trim();
  // Inngest crons here may start with TZ=America/Phoenix. The clock is the
  // five fields after that. A timezone name is not part of the gap.
  if (raw.startsWith("TZ=")) raw = raw.split(/\s+/).slice(1).join(" ");
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*") return null;
  if (dom !== "*") return null;
  if (dow !== "*") return /^\d+$/.test(min) && /^\d+$/.test(hour) ? 7 * DAY : null;
  if (hour === "*") {
    if (min === "*") return MIN;
    const every = /^\*\/(\d+)$/.exec(min);
    if (every) return Number(every[1]) * MIN;
    if (/^\d+$/.test(min)) return HOUR;
    return null;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return DAY;
  const everyH = /^\*\/(\d+)$/.exec(hour);
  if (everyH && /^\d+$/.test(min)) return Number(everyH[1]) * HOUR;
  return null;
}

/* lastMonthlyFire — "M H D * *" in UTC: the most recent scheduled time at or
   before `now`. null when the shape is not monthly. */
export function lastMonthlyFire(cron, now = new Date()) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (![min, hour, dom].every((p) => /^\d+$/.test(p)) || mon !== "*" || dow !== "*") return null;
  const at = (y, m) => new Date(Date.UTC(y, m, Number(dom), Number(hour), Number(min)));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = at(y, m);
  return thisMonth.getTime() <= now.getTime() ? thisMonth : at(y, m - 1);
}

/* recordHeartbeat — one row. NEVER THROWS: a job that finished must not fail
   because its receipt could not be written. A missing receipt shows up the
   next morning as a red job, which is the honest outcome. */
export async function recordHeartbeat(db, {
  job,
  runner,
  startedAt = null,
  finishedAt = new Date(),
  outcome = "ok",
  itemCount = null,
  error = null
} = {}) {
  if (!db || typeof db.query !== "function" || !job) return { recorded: false, reason: "no_db_or_job" };
  const count = Number.isInteger(itemCount) && itemCount >= 0 ? itemCount : null;
  const started = startedAt instanceof Date && startedAt.getTime() <= finishedAt.getTime() ? startedAt : null;
  try {
    await db.query(
      `INSERT INTO job_heartbeats (job, runner, started_at, finished_at, outcome, item_count, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        String(job).slice(0, 120),
        runner === "netlify" ? "netlify" : "inngest",
        started,
        finishedAt,
        outcome === "error" ? "error" : "ok",
        count,
        error ? String(error).slice(0, 300) : null
      ]
    );
    return { recorded: true };
  } catch (err) {
    console.error(`[heartbeat] ${job} not recorded — ${String((err && err.message) || err).slice(0, 160)}`);
    return { recorded: false, reason: "write_failed" };
  }
}

/* itemCountOf — a count from a job's own result, only when it said one. */
/* noteScheduledRun — one receipt for a Netlify scheduled function.
   Never throws. A missing receipt shows up the next morning as a red job. */
export async function noteScheduledRun(db, job, result) {
  const failed = !!(result && result.ok === false);
  return recordHeartbeat(db, {
    job,
    runner: "netlify",
    outcome: failed ? "error" : "ok",
    itemCount: itemCountOf(result),
    error: failed ? (result.error || "failed") : null
  });
}

export function itemCountOf(result) {
  if (!result || typeof result !== "object") return null;
  for (const key of ["count", "claimed", "processed", "sent", "ran", "merged", "posted"]) {
    const v = result[key];
    if (Number.isInteger(v) && v >= 0) return v;
  }
  return null;
}

function ago(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} days`;
}

/* checkJobHeartbeats — one check per job, in the pulse's check shape.

   Not checked, never green, when:
     - there is no database in this run;
     - the table has no rows at all (heartbeats only started with this change);
     - the job has no row yet but heartbeats have not been recording for long
       enough to expect one. */
export async function checkJobHeartbeats({ db, now = new Date(), jobs = JOBS } = {}) {
  const mk = (row, status, detail, fix = null, customerSees = null) => ({
    id: `job:${row.job}`,
    group: "jobs",
    status,
    detail,
    suggestedFix: fix,
    customerSees
  });
  if (!db || typeof db.query !== "function") {
    return jobs.map((row) => mk(row, "skip", "no database in this run — job heartbeats not read"));
  }
  const { rows } = await db.query(
    `SELECT job,
            max(finished_at) AS last_at,
            (array_agg(outcome ORDER BY finished_at DESC))[1] AS last_outcome,
            (array_agg(error ORDER BY finished_at DESC))[1] AS last_error,
            (SELECT min(finished_at) FROM job_heartbeats) AS first_ever
       FROM job_heartbeats
      WHERE job = ANY($1::text[])
      GROUP BY job`,
    [jobs.map((j) => j.job)]
  );
  const firstEverRow = rows.length
    ? rows[0]
    : (await db.query(`SELECT min(finished_at) AS first_ever FROM job_heartbeats`)).rows[0];
  const firstEver = firstEverRow?.first_ever ? new Date(firstEverRow.first_ever) : null;
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const nowMs = now.getTime();

  return jobs.map((row) => {
    const hit = byJob.get(row.job);
    const interval = cronIntervalMs(row.cron);
    const monthly = interval == null ? lastMonthlyFire(row.cron, now) : null;
    if (interval == null && !monthly) {
      return mk(row, "skip", `schedule "${row.cron}" is a shape this check does not read`);
    }
    // When should the newest run have happened by?
    const dueBy = interval != null
      ? nowMs - STALE_MULTIPLE * interval
      : monthly.getTime();
    const graceMs = interval != null ? 0 : DAY;
    const fix = `Open the ${row.runner === "netlify" ? "Netlify scheduled function" : "Inngest function"} "${row.job}" and read its last run. Do not re-run it from this pulse.`;
    const sees = `${row.job} has stopped running, so whatever it does on a schedule is not happening.`;

    if (!hit) {
      if (!firstEver) return mk(row, "skip", "no job heartbeats recorded yet — the receipts start with this change");
      const tooSoon = firstEver.getTime() > dueBy || nowMs <= dueBy + graceMs && interval == null;
      if (tooSoon) {
        return mk(row, "skip", `no run recorded yet; heartbeats started ${ago(nowMs - firstEver.getTime())} ago, too soon to expect one`);
      }
      return mk(row, "FAIL", `no run recorded since heartbeats started ${ago(nowMs - firstEver.getTime())} ago (schedule ${row.cron})`, fix, sees);
    }
    const lastAt = new Date(hit.last_at);
    const lastMs = lastAt.getTime();
    const late = interval != null
      ? lastMs < dueBy
      : (nowMs > dueBy + graceMs && lastMs < dueBy);
    if (late) {
      return mk(row, "FAIL", `last run ${lastAt.toISOString()} (${ago(nowMs - lastMs)} ago); schedule ${row.cron}`, fix, sees);
    }
    if (hit.last_outcome === "error") {
      return mk(
        row,
        "FAIL",
        `last run ${lastAt.toISOString()} ended in an error: ${String(hit.last_error || "no message").slice(0, 120)}`,
        fix,
        `${row.job} is running but its last pass failed.`
      );
    }
    return mk(row, "PASS", `last run ${lastAt.toISOString()} (${ago(nowMs - lastMs)} ago), ok`);
  });
}

/* Inngest add-on — writes a heartbeat at the end of every SCHEDULED run.
   Only cron runs (event "inngest/scheduled.timer"): event-driven workflows have
   no schedule to be late against. `finished` can fire more than once for one
   run (Inngest's own note); a second row only makes the job look fresher, which
   is true. */
export const SCHEDULED_EVENT = "inngest/scheduled.timer";

export function heartbeatHooks({ getDb, nowFn = () => new Date() } = {}) {
  return {
    onFunctionRun({ fn, ctx }) {
      if (!ctx || !ctx.event || ctx.event.name !== SCHEDULED_EVENT) return {};
      const job = (fn && fn.opts && fn.opts.id) || (fn && typeof fn.id === "function" ? fn.id() : null);
      if (!job) return {};
      const startedAt = nowFn();
      return {
        async finished({ result }) {
          let db = null;
          try { db = getDb ? getDb() : null; } catch { db = null; }
          const err = result && result.error;
          await recordHeartbeat(db, {
            job,
            runner: "inngest",
            startedAt,
            finishedAt: nowFn(),
            outcome: err ? "error" : "ok",
            itemCount: itemCountOf(result && result.data),
            error: err ? String((err && err.message) || err) : null
          });
        }
      };
    }
  };
}
