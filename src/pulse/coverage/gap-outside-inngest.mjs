// The engine that runs our alarms, and the alarm itself. Report only.
//
// Every tripwire we have runs on Inngest, the workflow engine. When the engine
// stops, the 6 a.m. job, the 5-minute watch and the 9 p.m. brief all go quiet
// together, and nothing outside it says so. The planned fix is a Netlify clock
// that watches from outside. That is a new function and a new text path, and it
// waits for Chris's go (worklist, lane 12). This file does the part that can be
// built now, from inside the morning job, with reads only:
//
//   outside:inngest-crons-stale     Did the engine go dark in the last 24 hours?
//   outside:health-down-text        If the database is down, will the 5-minute alarm text?
//   outside:morning-pulse-down-run  If the database is down, does the 6 a.m. pulse still finish?
//
// Where this differs from the plan, and why (also in
// ops/workflows/heartbeat-gaps-2026-10-08/outside-inngest.md):
//
//   1. The plan said "newest receipt over 20 minutes old". The morning pulse
//      already does that: the job:message-dispatch-sweeper and
//      job:pulse-instant-watch rows go red at 3 times the schedule (15 min).
//      The same question again would print twice. What nothing asks is the
//      history. An outage that ended before 6 a.m. leaves the newest receipt
//      fresh, every job row green, and Chris never learns the alarms were
//      blind for hours. This check reads the last 24 hours of receipts, plus
//      the newest receipt before them (where a stretch that began earlier
//      starts), and goes red on any quiet stretch over 20 minutes. It still catches the
//      "stopped right now" case too (the stretch runs from the last receipt to
//      now), so it is a superset of the plan.
//
//   2. The plan said "GET /api/health from the Netlify clock". The morning pulse
//      and the 5-minute watch already GET /api/health?strict=1 (check id
//      "health"). The break nobody watches is what happens AFTER health says
//      the database is down: the watch reads the database again before it
//      texts, with no catch around that read, so it crashes and sends nothing.
//      This check runs the real 5-minute watch against a database that is
//      down, with a pretend web client and a pretend text sender, and goes red
//      when no text comes out.
//
//   3. The same break sits in the 6 a.m. job (runDailyPulse reads the default
//      org first with no catch). It is checked on its own row, so that fixing
//      the 5-minute alarm does not make the hole look closed. The morning pulse
//      is run with the same pretend database and web client, a pretend text
//      sender, no coverage pass (so it cannot call this lane again), and a
//      board folder that cannot be written (so it leaves no scorecard file).
//
// What this file cannot do: it runs inside the morning job. If the engine is
// fully dead at 6 a.m., these checks never run. A total outage still needs the
// outside clock (netlify/functions/pulse-outside-watch.mjs, not built: it is a
// new function and a new text path, and it waits for Chris's go). The ids start
// with "outside:" because that is the hole they are aimed at, not because they
// run outside the engine. These checks see the outage that has already ended,
// and the engine that is up but has dropped one of the two 5-minute jobs. The
// PASS row says so in plain words.
//
// Rules this file keeps:
//   - Reads only. Two SELECTs on job_heartbeats. No write, no BEGIN, no SET.
//   - The pretend database, web client and text sender are made inside this
//     file. The real database, the real web and the real text sender are never
//     touched by checks 2 and 3.
//   - A read that failed is skip with the reason. Never PASS.
//   - No repo file is read at run time.

import { runInstantWatch } from "../instant-watch.mjs";
import { runDailyPulse } from "../daily-pulse.mjs";
import { inTextWindow, nextWindowStart } from "../quiet-hours.mjs";

export const CHECK_IDS = Object.freeze([
  "outside:inngest-crons-stale",
  "outside:health-down-text",
  "outside:morning-pulse-down-run"
]);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * The two jobs that tell us the engine is alive. Both run every 5 minutes on
 * Inngest (src/pulse/heartbeats.mjs INNGEST_JOBS). The sweeper hands waiting
 * texts and emails to the sender. The watch is the 5-minute alarm. A test fails
 * if either name leaves that list or stops running every 5 minutes.
 */
export const WATCHED_JOBS = Object.freeze([
  { job: "message-dispatch-sweeper", does: "hands waiting texts and emails to the sender" },
  { job: "pulse-instant-watch", does: "texts Chris when a door breaks" }
]);

/** Both jobs tick every 5 minutes. 4 missed ticks in a row is a dark stretch. */
export const TICK_MS = 5 * MIN;
export const DARK_AFTER_MS = 4 * TICK_MS;

/** Look back one day: the last morning text to this one. */
export const LOOKBACK_MS = 24 * HOUR;

/** How long the pretend outage may take before it counts as "did not finish". */
export const OUTAGE_RUN_TIMEOUT_MS = 8000;

/**
 * A folder that cannot exist (a path under /dev/null), so the morning pulse's
 * scorecard file write fails inside its own try/catch and no file is left behind.
 */
export const NO_WRITE_DIR = "/dev/null/fundhub-pulse-outage-probe";

/** A made-up number. Nothing is sent to it: the text sender here is a pretend one. */
export const PRETEND_PHONE = "+15555550100";

/** Every receipt inside the window, oldest first. $2 is the window start. */
export const RUNS_SQL = `
SELECT job, finished_at
  FROM job_heartbeats
 WHERE job = ANY($1::text[])
   AND finished_at >= $2::timestamptz
 ORDER BY job, finished_at
`.trim();

/**
 * The newest receipt BEFORE the window, one row per job. It is the start of the
 * first stretch: without it, a dark stretch that began before the window and
 * ended inside it has no start and is never measured. $2 is the window start.
 */
export const PRIOR_SQL = `
SELECT job, max(finished_at) AS last_at
  FROM job_heartbeats
 WHERE job = ANY($1::text[])
   AND finished_at < $2::timestamptz
 GROUP BY job
`.trim();

const FIX = Object.freeze({
  dark:
    "Read the engine's run list and the Netlify function log for the stretch named. Find out if the engine, a sync after a deploy, or the database was down, and fix that. " +
    "This pulse only reports. It does not restart anything.",
  outage:
    "In src/pulse/instant-watch.mjs, catch the failed read of the default org (defaultOrgId) so a dead database still sends the text with the web failures. " +
    "The 6 a.m. job has its own row (outside:morning-pulse-down-run). This pulse only reports.",
  morning:
    "In src/pulse/daily-pulse.mjs, catch the failed read of the default org in runDailyPulse (the line that calls defaultOrgId) so a dead database still builds the scorecard from the web checks. " +
    "With no org, the org checks already skip. The morning brief step that follows is a separate path. This pulse only reports."
});

/** Said on the PASS row so nobody reads it as "the engine is alive right now". */
const INSIDE_NOTE =
  "This check runs inside the morning job, so it sees an outage that already ended, not one still going at 6 a.m. " +
  "The clock outside the engine that would see that is not built yet (it waits for Chris's go).";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(v, n = 160) {
  const s = v && typeof v === "object" && "message" in v ? v.message : v;
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

/** Arizona time, which is the clock Chris reads at 6 a.m. */
const PHX = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Phoenix",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function phoenixTime(ms) {
  return PHX.format(new Date(ms)).replace(/[\s ]+/g, " ");
}

export function spanText(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 120) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function toMs(v) {
  if (v == null || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Every quiet stretch for one job: the gap between two receipts whose later one
 * falls inside the window, plus the stretch from the newest receipt to now.
 * Pure. times is a list of receipt times in ms.
 */
export function quietStretches(times, { windowStartMs, nowMs } = {}) {
  const t = (times || []).filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < t.length; i += 1) {
    if (t[i] >= windowStartMs) {
      out.push({ fromMs: t[i - 1], toMs: t[i], ms: t[i] - t[i - 1], open: false });
    }
  }
  if (t.length) {
    const last = t[t.length - 1];
    out.push({ fromMs: last, toMs: nowMs, ms: Math.max(0, nowMs - last), open: true });
  }
  return out;
}

/** The quiet stretches longer than the limit. A stretch of exactly the limit is fine. */
export function findDarkStretches(times, { windowStartMs, nowMs, darkAfterMs = DARK_AFTER_MS } = {}) {
  return quietStretches(times, { windowStartMs, nowMs }).filter((s) => s.ms > darkAfterMs);
}

/**
 * outside:inngest-crons-stale — did the engine that runs our alarms go dark?
 * Reads the last 24 hours of receipts for the sweeper and the 5-minute watch,
 * plus the newest receipt before that window (the start of the first stretch).
 * Red when either one has a quiet stretch over 20 minutes that ended inside the
 * window or is running right now.
 */
export async function inngestCronsStale({
  db,
  now = new Date(),
  darkAfterMs = DARK_AFTER_MS,
  lookbackMs = LOOKBACK_MS
} = {}) {
  const id = "outside:inngest-crons-stale";
  if (!db || typeof db.query !== "function") {
    return row(id, "skip", "No database came with this run, so the alarm engine's receipts were not read.");
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const windowStartMs = nowMs - lookbackMs;
  const jobs = WATCHED_JOBS.map((w) => w.job);

  let runRows;
  let priorRows;
  try {
    const startIso = new Date(windowStartMs).toISOString();
    const res = await db.query(RUNS_SQL, [jobs, startIso]);
    runRows = Array.isArray(res && res.rows) ? res.rows : [];
    const prior = await db.query(PRIOR_SQL, [jobs, startIso]);
    priorRows = Array.isArray(prior && prior.rows) ? prior.rows : [];
  } catch (err) {
    return row(id, "skip", `The alarm engine's receipts could not be read: ${clip(err)}.`);
  }

  const timesByJob = new Map(jobs.map((j) => [j, []]));
  for (const r of runRows) {
    const ms = toMs(r && r.finished_at);
    if (ms != null && timesByJob.has(r.job)) timesByJob.get(r.job).push(ms);
  }
  const priorByJob = new Map();
  for (const r of priorRows) {
    const ms = toMs(r && r.last_at);
    if (ms != null && jobs.includes(r.job)) priorByJob.set(r.job, ms);
  }

  const dark = [];
  const unread = [];
  const facts = [];
  for (const w of WATCHED_JOBS) {
    const inWindow = timesByJob.get(w.job).sort((a, b) => a - b);
    const priorMs = priorByJob.has(w.job) ? priorByJob.get(w.job) : null;
    if (priorMs == null && !inWindow.length) {
      unread.push(w.job);
      continue;
    }
    // The newest receipt before the window starts the first stretch. With none,
    // the history begins at the first receipt in the window.
    const times = priorMs == null ? inWindow : [priorMs, ...inWindow];
    const all = quietStretches(times, { windowStartMs, nowMs });
    const longestMs = all.reduce((m, s) => Math.max(m, s.ms), 0);
    // No receipt before the window, and the first one came well after it opened:
    // the part of the 24 hours before that cannot be proved either way.
    const beginsAtMs = priorMs == null && inWindow[0] - windowStartMs > darkAfterMs ? inWindow[0] : null;
    facts.push({ job: w.job, runs: inWindow.length, longestMs, beginsAtMs });
    for (const s of all) if (s.ms > darkAfterMs) dark.push({ job: w.job, ...s });
  }

  if (dark.length) {
    dark.sort((a, b) => b.ms - a.ms);
    const shown = dark.slice(0, 3).map((s) => {
      const from = phoenixTime(s.fromMs);
      const to = s.open ? "now (still quiet)" : phoenixTime(s.toMs);
      return `${s.job} saved no run from ${from} to ${to}, ${spanText(s.ms)}`;
    });
    const more = dark.length > shown.length ? ` ${dark.length - shown.length} more stretch(es) not shown.` : "";
    const does = WATCHED_JOBS.filter((w) => dark.some((s) => s.job === w.job)).map((w) => `${w.job} ${w.does}`).join("; ");
    return row(
      id,
      "FAIL",
      `The engine that runs our alarms went quiet (limit ${spanText(darkAfterMs)}; times are Arizona time). ${shown.join(". ")}.${more} ` +
        `In that time nothing ran: ${does}. The cause is the workflow engine or the database.`,
      FIX.dark
    );
  }
  if (unread.length) {
    return row(
      id,
      "skip",
      `${unread.join(" and ")} has no receipt at all, so there is no history to read. This is new or renamed, not proved quiet.`
    );
  }
  const said = facts.map((f) => `${f.job} saved ${f.runs} runs (longest quiet stretch ${spanText(f.longestMs)})`).join("; ");
  const late = facts.filter((f) => f.beginsAtMs != null);
  const lead = late.length
    ? "No quiet stretch over the limit in the receipts on file."
    : "Both 5-minute jobs ticked through the last 24 hours.";
  const lateNote = late.length
    ? ` ${late.map((f) => `${f.job} has no receipt before ${phoenixTime(f.beginsAtMs)}`).join(" and ")}, so the part of the 24 hours before that is not proved.`
    : "";
  return row(id, "PASS", `${lead} ${said}. The limit is ${spanText(darkAfterMs)}.${lateNote} ${INSIDE_NOTE}`);
}

/** A database that is down: every question it is asked fails. */
export function deadDatabase() {
  return {
    query: async () => {
      throw new Error("connection terminated unexpectedly (pretend outage: the database is down)");
    }
  };
}

/** A web client that answers every door the way a site with a dead database does: 503. */
export function outageFetch() {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ ok: false, db: "down", state: "down", error: "database unreachable" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  };
  return { fetchImpl, asked };
}

/** Thrown by withTimeout, so a hang is told apart from a crash. */
export class OutageRunTimeout extends Error {
  constructor(ms) {
    super(`did not finish in ${ms} ms`);
    this.name = "OutageRunTimeout";
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OutageRunTimeout(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The pretend half hour must sit inside Chris's texting hours (6 a.m. to 10 p.m. Arizona). The real watch is
 * held outside them on purpose, so a half hour that crosses 10 p.m. (or starts before 6 a.m.) texts nothing and
 * would read as a broken alarm. The question here is "will the alarm text when it is allowed to", so a run that
 * would cross the window is moved to the next 6 a.m. Inside the window the start is the real now.
 */
export function outageStartMs(nowMs) {
  const lastRun = nowMs + 25 * MIN;
  if (inTextWindow(new Date(nowMs)) && inTextWindow(new Date(lastRun))) return nowMs;
  return nextWindowStart(new Date(nowMs + 30 * MIN)).getTime();
}

/**
 * outside:health-down-text — if the database is down, will anyone be told?
 *
 * Runs the real 5-minute watch against a database that is down, six times, five
 * minutes apart: one half hour. With no database the watch has no cooldown
 * record, so it only texts in the first 5 minutes of each half hour (at most 2
 * texts an hour). The question is "is Chris told within 30 minutes?", not "did
 * this one run text?". The web client and the text sender are pretend ones made
 * here, so nothing real is read or sent. Red when the watch crashes, hangs, or
 * a whole half hour passes with no text. runWatch is a parameter so a test can
 * stand in a fixed or a broken watch.
 */
export async function healthDownText({
  runWatch = runInstantWatch,
  now = new Date(),
  timeoutMs = OUTAGE_RUN_TIMEOUT_MS
} = {}) {
  const id = "outside:health-down-text";
  const texts = [];
  const sendImpl = async (message) => {
    texts.push(message);
    return { ok: true, status: "sent" };
  };
  const { fetchImpl } = outageFetch();
  let thrown = null;
  const startMs = outageStartMs(now instanceof Date ? now.getTime() : Date.now());
  for (let k = 0; k < 6 && !thrown; k += 1) {
    try {
      await withTimeout(
        Promise.resolve(runWatch({
          db: deadDatabase(),
          env: { PULSE_SMS_TO: PRETEND_PHONE },
          fetchImpl,
          baseUrl: "https://fundhub.ai",
          now: new Date(startMs + k * 5 * 60 * 1000),
          sendImpl
        })),
        timeoutMs
      );
    } catch (err) {
      thrown = err;
    }
  }
  if (thrown instanceof OutageRunTimeout) {
    return row(
      id,
      "FAIL",
      `With the database down, the 5-minute alarm hangs: it ${clip(thrown)}. A hung alarm sends no text, so nobody is told.`,
      FIX.outage
    );
  }
  if (thrown) {
    return row(
      id,
      "FAIL",
      `With the database down, the 5-minute alarm does not text. It stopped with: ${clip(thrown)}. ` +
        "The site health check said the database was down, then the alarm read the database again before texting and crashed. " +
        "The one time the alarm matters most, nobody is told. The 6 a.m. job is checked on its own row.",
      FIX.outage
    );
  }
  if (!texts.length) {
    return row(
      id,
      "FAIL",
      "With the database down, the 5-minute alarm ran for a whole half hour and sent no text, even though every door answered 503. Nobody is told.",
      FIX.outage
    );
  }
  const body = clip(texts[0] && texts[0].body, 100).replace(/"/g, "'");
  return row(
    id,
    "PASS",
    `With a pretend dead database and every door answering 503, the 5-minute alarm texted within half an hour (${texts.length} ${texts.length === 1 ? "text" : "texts"} in 6 runs): "${body}".`
  );
}

/**
 * outside:morning-pulse-down-run — if the database is down, does the 6 a.m. pulse
 * still run to the end?
 *
 * Runs the real 6 a.m. pulse (runDailyPulse) against a database that is down.
 * Every part that could reach outside is a pretend one made here: the web client
 * answers 503, the text senders only record, no gate-relay folder is read, the
 * scorecard folder cannot be written, and the coverage pass is switched off
 * (coverageRows is an empty list). That last one also stops the pulse from
 * calling this lane again. dryRun is on and recordRun is off, so nothing is
 * stored. Red when the pulse crashes, hangs, returns nothing, or finishes
 * without reporting the site as down. runPulse is a parameter so a test can
 * stand in a fixed or a broken pulse.
 */
export async function morningPulseDownRun({
  runPulse = runDailyPulse,
  now = new Date(),
  timeoutMs = OUTAGE_RUN_TIMEOUT_MS
} = {}) {
  const id = "outside:morning-pulse-down-run";
  const { fetchImpl } = outageFetch();
  const pretendSend = async () => ({ ok: true, status: "sent" });
  let result = null;
  let thrown = null;
  try {
    result = await withTimeout(
      Promise.resolve(runPulse({
        db: deadDatabase(),
        orgId: null,
        env: {},
        dryRun: true,
        now,
        fetchImpl,
        baseUrl: "https://fundhub.ai",
        boardDir: NO_WRITE_DIR,
        gateRelayDirs: null,
        staffScope: null,
        coverageRows: [],
        sendPulseText: false,
        recordRun: false,
        sendSms: pretendSend,
        sendWhatsApp: pretendSend
      })),
      timeoutMs
    );
  } catch (err) {
    thrown = err;
  }
  if (thrown instanceof OutageRunTimeout) {
    return row(
      id,
      "FAIL",
      `With the database down, the 6 a.m. pulse hangs: it ${clip(thrown)}. A pulse that never finishes builds no scorecard and the morning brief never runs.`,
      FIX.morning
    );
  }
  if (thrown) {
    return row(
      id,
      "FAIL",
      `With the database down, the 6 a.m. pulse does not finish. It stopped with: ${clip(thrown)}. ` +
        "It reads the default org from the database before the scorecard is built, with nothing to catch a failure, so the step throws. " +
        "No scorecard is built and the morning brief step never runs. The one morning Chris most needs it, he gets nothing.",
      FIX.morning
    );
  }
  const checks = Array.isArray(result && result.checks) ? result.checks : [];
  if (!checks.length) {
    return row(
      id,
      "FAIL",
      "With the database down, the 6 a.m. pulse ran but returned no check rows, so there is nothing to build a scorecard from.",
      FIX.morning
    );
  }
  const health = checks.find((c) => c && c.id === "health");
  if (!health || (health.status !== "FAIL" && health.status !== "down")) {
    return row(
      id,
      "FAIL",
      `With the database down and every door answering 503, the 6 a.m. pulse finished (${checks.length} rows) but did not report the site as down. ` +
        `Its health row says ${health ? `"${clip(health.status, 20)}"` : "nothing at all"}. A site that is down would read as fine.`,
      FIX.morning
    );
  }
  return row(
    id,
    "PASS",
    `With a pretend dead database and every door answering 503, the 6 a.m. pulse still ran to the end (${checks.length} rows) and reported the site down: ` +
      `"${clip(health.detail, 100).replace(/"/g, "'")}". The morning brief step that follows is not run here.`
  );
}

/**
 * Three tripwires on the engine behind every other tripwire.
 * ctx: { db, now }. Nothing else is read. The web and the text sender are never touched.
 * The three run side by side, so a hung pretend run cannot push this lane past
 * the 20 seconds one Inngest step may take.
 */
export async function gapChecks(ctx = {}) {
  const c = ctx || {};
  const now = c.now instanceof Date ? c.now : new Date();
  const db = c.db;
  return Promise.all([
    inngestCronsStale({ db, now }).catch((err) =>
      row(CHECK_IDS[0], "skip", `The alarm engine's receipts could not be read: ${clip(err)}.`)
    ),
    healthDownText({ now }).catch((err) =>
      row(CHECK_IDS[1], "skip", `The pretend outage could not be run: ${clip(err)}.`)
    ),
    morningPulseDownRun({ now }).catch((err) =>
      row(CHECK_IDS[2], "skip", `The pretend morning outage could not be run: ${clip(err)}.`)
    )
  ]);
}
