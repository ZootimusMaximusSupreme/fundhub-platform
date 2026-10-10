// Beat: engine-alive. Every hour, did the two 5-minute alarms keep ticking? READ ONLY.
//
// WHY. On 2026-10-09 the workflow engine stopped for 46 minutes (2:05 to 2:51 p.m. Arizona).
// Both 5-minute jobs (pulse-instant-watch, the alarm that texts Chris, and message-dispatch-sweeper,
// the one that hands out texts and emails) saved no receipt, then ran a burst of catch-up ticks.
// Nothing live said so. The morning scorecard (outside:inngest-crons-stale) found it the next day.
// The engine cannot watch itself, but this beat runs on the Netlify clock, which kept ticking.
//
//   receipts-fresh      Each job saved a receipt in the last 20 minutes (4 missed ticks). Red now.
//   no-quiet-stretch    No gap over 20 minutes between receipts in the last 70 minutes. Catches a
//                       stall that has already ended (the hourly run lands after it healed).
//
// Reads one table, job_heartbeats (the same receipts outside:inngest-crons-stale reads). Takes its
// clock from the database (now()), never from this server. A job with no receipt at all in 95
// minutes is red at receipts-fresh. The words in a detail are job names, minutes and times.

export const id = "engine-alive";
export const title = "5-minute alarms kept ticking";
export const kind = "infra";
export const covers = ["job:message-dispatch-sweeper", "job:pulse-instant-watch"];
export const box = false;
export const reads = [];
export const damp = 1;
export const deadlineMs = 8000;
export const steps = ["receipts-fresh", "no-quiet-stretch"];

export const WATCHED_JOBS = Object.freeze(["message-dispatch-sweeper", "pulse-instant-watch"]);
/** Both jobs tick every 5 minutes. 4 missed ticks in a row is dark. */
export const DARK_AFTER_MIN = 20;
/** The hourly run sees a stall that ended since the last hourly run, plus slack. */
export const LOOKBACK_MIN = 70;
/** How far back the single read goes (the newest receipt before the look-back sets the first gap). */
export const READ_MIN = 95;

export const SQL_RECEIPTS =
  "/* pulse engine-alive: receipts */ " +
  "SELECT job, finished_at, now() AS db_now FROM job_heartbeats " +
  "WHERE job = ANY($1::text[]) AND finished_at > now() - make_interval(mins => $2::int) " +
  "ORDER BY job, finished_at";

const MIN_MS = 60 * 1000;
const asMs = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
/** "2:05 p.m." on the Arizona clock (UTC-7, no daylight saving). */
function arizonaTime(ms) {
  const d = new Date(ms - 7 * 60 * MIN_MS);
  const h24 = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m} ${h24 < 12 ? "a.m." : "p.m."}`;
}
/** Names are checked against our own two job names before they reach a sentence. */
const jobWord = (j) => (WATCHED_JOBS.includes(j) ? j : "a job");

export async function run(ctx) {
  let rows;
  try {
    rows = (await ctx.read(SQL_RECEIPTS, [[...WATCHED_JOBS], READ_MIN])).rows || [];
  } catch (err) {
    if (err && err.name === "PulseRefused") throw err;
    throw ctx.fail("receipts-fresh", "the job receipts could not be read, so the 5-minute alarms could not be checked");
  }
  const nowMs = rows.length ? asMs(rows[0].db_now) : NaN;
  const byJob = new Map(WATCHED_JOBS.map((j) => [j, []]));
  for (const r of rows) {
    const t = asMs(r.finished_at);
    if (byJob.has(r.job) && Number.isFinite(t)) byJob.get(r.job).push(t);
  }
  const evidence = { jobs: {} };

  await ctx.step("receipts-fresh", async () => {
    if (!Number.isFinite(nowMs)) {
      throw ctx.fail("receipts-fresh", `no receipt from either 5-minute alarm in the last ${READ_MIN} minutes. The workflow engine may be down`);
    }
    const stale = [];
    for (const [job, times] of byJob) {
      if (!times.length) {
        stale.push(`${jobWord(job)} saved no receipt in ${READ_MIN} minutes`);
        continue;
      }
      const newest = Math.max(...times);
      const age = Math.floor((nowMs - newest) / MIN_MS);
      evidence.jobs[job] = { ageMin: age };
      if (age > DARK_AFTER_MIN) stale.push(`${jobWord(job)} last ran ${age} minutes ago (${arizonaTime(newest)})`);
    }
    if (stale.length) throw ctx.fail("receipts-fresh", `${stale.join("; ")}. The workflow engine may be down`);
  });

  await ctx.step("no-quiet-stretch", async () => {
    const dark = [];
    const since = nowMs - LOOKBACK_MIN * MIN_MS;
    for (const [job, times] of byJob) {
      const sorted = [...times].sort((a, b) => a - b);
      let worst = 0;
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = (sorted[i] - sorted[i - 1]) / MIN_MS;
        if (sorted[i] >= since && gap > DARK_AFTER_MIN && gap > worst) {
          worst = gap;
          dark.push({ job, gap: Math.round(gap), from: sorted[i - 1], to: sorted[i] });
        }
      }
      evidence.jobs[job] = { ...(evidence.jobs[job] || {}), worstGapMin: Math.round(worst) };
    }
    if (dark.length) {
      const d = dark.sort((a, b) => b.gap - a.gap)[0];
      throw ctx.fail(
        "no-quiet-stretch",
        `${jobWord(d.job)} went quiet for ${d.gap} minutes (${arizonaTime(d.from)} to ${arizonaTime(d.to)}). ` +
          "The alarms were blind in that stretch and then ran a catch-up burst. A door could have broken with no text"
      );
    }
  });

  return ctx.done(`both 5-minute alarms are ticking (newest receipt ${Math.max(...Object.values(evidence.jobs).map((j) => j.ageMin ?? 0))} min old at most)`, evidence);
}

export const fixGuide = [
  "The 5-minute alarms stopped or went quiet. Texts and the instant door alarm were not running in that stretch.",
  "",
  "Likely causes:",
  "- The workflow engine (Inngest) paused or fell behind. Its dashboard shows the stretch. A burst of catch-up runs afterward is the sign.",
  "- A deploy or re-register changed the app address and the engine could not reach the functions for a while.",
  "- The database was slow or down, so receipts could not be saved (check db-health and the site health door).",
  "Steps:",
  "- Open the Inngest dashboard for the Fundhub app and look at the runs for pulse-instant-watch in that stretch.",
  "- Run node scripts/pulse/run-beat.mjs engine-alive to see which step stopped and which job.",
  "- If it is still down, check https://fundhub.ai/api/health and re-sync the app in Inngest. Do not unset INNGEST_EVENT_KEY.",
  "Files: src/pulse/heartbeats.mjs, src/pulse/instant-watch.mjs, src/pulse/coverage/gap-outside-inngest.mjs, src/workflows/index.mjs"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const NOW_ISO = "2026-10-10T04:07:00.000Z";
const NOW = Date.parse(NOW_ISO);
const everyFive = (jobs, { skipFromMin = null, skipToMin = null } = {}) => {
  const rows = [];
  for (const job of jobs) {
    for (let m = 90; m >= 2; m -= 5) {
      if (skipFromMin !== null && m < skipFromMin && m > skipToMin) continue;
      rows.push({ job, finished_at: new Date(NOW - m * MIN_MS).toISOString(), db_now: NOW_ISO });
    }
  }
  return rows;
};

export const selfTest = {
  pass: () => ({ read: [{ match: /FROM job_heartbeats/, rows: everyFive(WATCHED_JOBS) }] }),
  // Both jobs silent from 62 to 17 minutes ago, then back: a stall that already ended.
  fail: () => ({ read: [{ match: /FROM job_heartbeats/, rows: everyFive(WATCHED_JOBS, { skipFromMin: 62, skipToMin: 17 }) }] })
};
