// Run evidence — a receipt for every run of a workflow that an EVENT started.
// (zero "not checked", Ship 2, 2026-10-09)
//
// Owner law: "if something's not checked ever, you have to check it." A wf: row
// (src/pulse/workflow-runs.mjs) used to be able to say only "nothing to judge"
// or "not checked", because nothing recorded that an event-started workflow ran.
// This is the recorder. It is a second middleware on the shared Inngest client
// (src/workflows/client.mjs), next to the cron heartbeat (heartbeats.mjs, which
// is unchanged and keeps the cron receipts in job_heartbeats).
//
// WHAT IT WRITES (table: workflow_runs, db/migrations/478):
//   start mark   the FIRST request of a run (no steps remembered yet, attempt 0).
//                One insert. This is what makes a sleeper visible while it sleeps,
//                and a run that died mid-way visible after it died.
//   finish mark  the LAST request of an attempt (Inngest calls `finished` once
//                when a run returns, and once per failed attempt). One upsert on
//                (run_id, attempt): how it ended, whether it is over for good
//                (final), whether it returned { skipped: true }, a redacted note
//                and a redacted error (120 characters each).
// It also stores bus_event_id = ctx.event.data.id, the events.id the bus put in
// the event it handed to Inngest, so the pulse can ask the events table: "did
// every event of this workflow's trigger names start a run?" Nothing is written
// on the web path and src/events/bus.mjs is untouched.
//
// WHAT IT NEVER DOES
//   * It never changes what a workflow returns. The only hook it returns is
//     `finished`, and `finished` returns nothing. It has no transformInput, no
//     transformOutput and no onSendEvent: a transformInput hook would make the
//     SDK rebuild the step state on every request, a path this app has never run.
//   * It never throws into a workflow. Every hook body is wrapped, and so is every
//     database call (the pool throws synchronously when DATABASE_URL is unset).
//   * It never holds a request. Every write has a timer: 800 ms for the start
//     mark; for the finish mark, 20 s minus what the request already used, kept
//     between 500 ms and 5 s. Netlify cuts a request at 26 s.
//   * It never keeps trying a database that is not answering. After 3 failed or
//     timed-out writes it stops writing for 10 minutes and logs ONE line that
//     starts with [run-evidence]. Then one write is tried again.
//
// THE SWITCH-OFF THAT NEEDS NO DEPLOY (owner runs it through the Supabase SQL tool):
//   REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app;
// Every write then fails fast with a permission error, the breaker opens, and every
// workflow keeps running exactly as before. Undo with the matching GRANT. While it
// is off, audit:run-recorder goes red and the wf: rows say "receipts are off"
// instead of "never started" (workflow-runs.mjs reads the privilege).
// The switch-off with a deploy: take "Run evidence" out of the middleware list in
// src/workflows/client.mjs.

import { redact } from "../lib/outbound-fetch.mjs";
import { SCHEDULED_EVENT } from "./heartbeats.mjs";

export const RUN_EVIDENCE_NAME = "Run evidence";

export const START_CAP_MS = 800;
export const FINISH_FLOOR_MS = 500;
export const FINISH_CEIL_MS = 5000;
/* A request may use up to about 20 s before the finish mark is squeezed; Netlify cuts at 26 s. */
export const REQUEST_BUDGET_MS = 20000;
export const BREAKER_LIMIT = 3;
export const BREAKER_PAUSE_MS = 10 * 60 * 1000;
export const NOTE_MAX = 120;
export const ERROR_MAX = 120;
const LOG_EVERY_MS = 60 * 1000;

/* The two statements. Every value is a bound parameter, every one is cast, and "final" is quoted
   so no keyword rule can ever read it. START never overwrites; FINISH fills in the same row. */
export const START_SQL = `INSERT INTO workflow_runs
  (run_id, attempt, function_id, event_name, bus_event_id, max_attempts, started_at)
VALUES ($1::text, $2::int, $3::text, $4::text, $5::text, $6::int, $7::timestamptz)
ON CONFLICT (run_id, attempt) DO NOTHING`;

export const FINISH_SQL = `INSERT INTO workflow_runs
  (run_id, attempt, function_id, event_name, bus_event_id, max_attempts, started_at,
   finished_at, outcome, "final", skipped, note, error)
VALUES ($1::text, $2::int, $3::text, $4::text, $5::text, $6::int, $7::timestamptz,
        $8::timestamptz, $9::text, $10::boolean, $11::boolean, $12::text, $13::text)
ON CONFLICT (run_id, attempt) DO UPDATE SET
  finished_at = EXCLUDED.finished_at,
  outcome     = EXCLUDED.outcome,
  "final"     = EXCLUDED."final",
  skipped     = EXCLUDED.skipped,
  note        = EXCLUDED.note,
  error       = EXCLUDED.error,
  max_attempts = COALESCE(workflow_runs.max_attempts, EXCLUDED.max_attempts)`;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function oneLine(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

/* redactText — credential-shaped text out (the repo's one redactor), then email addresses and long
   token-like strings out too, then cut to `max`. Returns null for empty text. */
export function redactText(value, max = ERROR_MAX) {
  let s = oneLine(redact(oneLine(value)));
  s = s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function errorText(error) {
  if (error == null) return "";
  if (typeof error === "string") return error;
  const message = error.message != null ? String(error.message) : "";
  const name = error.name != null ? String(error.name) : "";
  if (message && name && name !== "Error") return `${name}: ${message}`;
  return message || name || "unknown error";
}

/* A run that will not be tried again: a NonRetriableError, or an error that a step already used up its
   retries on (StepError carries a stepId; Inngest treats it as not retriable). */
export function isNonRetriable(error) {
  if (!error || typeof error !== "object") return false;
  if (error.name === "NonRetriableError") return true;
  return typeof error.stepId === "string" && error.stepId !== "";
}

/**
 * finishFields — what the finish mark says, from the `result` Inngest hands to `finished`.
 *   outcome  "ok", unless it threw or returned { ok: false }
 *   final    the run is over: it returned; or it threw its last attempt, a NonRetriableError, or a
 *            StepError (a step already used up its retries)
 *   skipped  it returned { skipped: true }, and note says why
 * Pure.
 */
export function finishFields(result, { attempt = 0, maxAttempts = null } = {}) {
  const error = result && result.error;
  const data = result && result.data;
  if (error) {
    const last = Number.isInteger(attempt) && Number.isInteger(maxAttempts) && attempt + 1 >= maxAttempts;
    return {
      outcome: "error",
      final: !!(last || isNonRetriable(error)),
      skipped: false,
      note: null,
      error: redactText(errorText(error), ERROR_MAX) || "unknown error"
    };
  }
  if (data && typeof data === "object" && data.ok === false) {
    const why = data.error != null ? errorText(data.error) : (data.reason != null ? String(data.reason) : "");
    return {
      outcome: "error",
      final: true,
      skipped: false,
      note: null,
      error: redactText(why || "returned ok: false", ERROR_MAX)
    };
  }
  const skipped = !!data && typeof data === "object" && data.skipped === true;
  return {
    outcome: "ok",
    final: true,
    skipped,
    note: skipped ? redactText(data.reason != null ? data.reason : "", NOTE_MAX) : null,
    error: null
  };
}

/* describeRun — what the receipt needs from the hook's arguments. null = write nothing for this one. */
function describeRun({ fn, ctx }) {
  if (!ctx || !ctx.event) return null;
  const eventName = typeof ctx.event.name === "string" ? ctx.event.name : null;
  if (eventName === SCHEDULED_EVENT) return null; // crons keep job_heartbeats
  const fnId = fn && fn.opts && typeof fn.opts.id === "string" && fn.opts.id ? fn.opts.id : null;
  const runId = typeof ctx.runId === "string" && ctx.runId ? ctx.runId : null;
  if (!fnId || !runId) return null;
  const rawBusId = ctx.event.data && ctx.event.data.id;
  return {
    fnId: fnId.slice(0, 120),
    runId: runId.slice(0, 100),
    eventName: eventName ? eventName.slice(0, 120) : null,
    busEventId: typeof rawBusId === "string" && rawBusId && rawBusId.length <= 100 ? rawBusId : null,
    attempt: Number.isInteger(ctx.attempt) && ctx.attempt >= 0 ? ctx.attempt : 0,
    maxAttempts: Number.isInteger(ctx.maxAttempts) && ctx.maxAttempts >= 1 ? ctx.maxAttempts : null
  };
}

/**
 * createRunEvidence — the hooks and the breaker, for one container.
 *   getDb      () => { query } — the shared pool wrapper (called on every write; may throw)
 *   nowFn      the clock (tests move it)
 *   log        where the [run-evidence] lines go (default console.error)
 * Returns { hooks, breaker }. `hooks` is what the middleware's init() returns.
 */
export function createRunEvidence({
  getDb,
  nowFn = () => new Date(),
  log = (line) => console.error(line),
  startCapMs = START_CAP_MS,
  finishFloorMs = FINISH_FLOOR_MS,
  finishCeilMs = FINISH_CEIL_MS,
  breakerLimit = BREAKER_LIMIT,
  breakerPauseMs = BREAKER_PAUSE_MS
} = {}) {
  const nowMs = () => nowFn().getTime();

  /* Runs whose start mark this container already saved. A run that opens with parallel steps asks the
     function again for each step with nothing remembered, so the same start mark would be written again. */
  const marked = new Set();
  const MARKED_MAX = 500;

  let fails = 0;
  let openUntil = 0;
  let lastLogAt = 0;
  const say = (line) => {
    try { log(line); } catch { /* a logger that throws must not reach a workflow */ }
  };
  const breaker = {
    allow() {
      if (!openUntil) return true;
      if (nowMs() < openUntil) return false;
      // The pause is over: try once. One more failure closes it again at once.
      openUntil = 0;
      fails = Math.max(0, breakerLimit - 1);
      return true;
    },
    ok() { fails = 0; },
    fail(kind, why) {
      fails += 1;
      const t = nowMs();
      if (fails >= breakerLimit) {
        openUntil = t + breakerPauseMs;
        fails = 0;
        lastLogAt = t;
        say(`[run-evidence] paused for ${Math.round(breakerPauseMs / 60000)} minutes after ${breakerLimit} failed writes (last: ${kind}, ${why}). Workflows keep running. Run receipts are not saved while it is paused.`);
      } else if (t - lastLogAt >= LOG_EVERY_MS) {
        lastLogAt = t;
        say(`[run-evidence] ${kind} write failed (${why}). The workflow was not touched.`);
      }
    },
    state() { return { fails, openUntil, open: openUntil > nowMs() }; }
  };

  /* One database call with a timer. NEVER THROWS and never rejects: it resolves { written, reason }. */
  async function safeWrite(kind, text, values, capMs) {
    if (!breaker.allow()) return { written: false, reason: "paused" };
    let timer;
    try {
      const db = typeof getDb === "function" ? getDb() : null;
      if (!db || typeof db.query !== "function") throw new Error("no database");
      // The async wrapper turns a synchronous throw (no DATABASE_URL) into a rejection.
      const call = (async () => db.query({ text, values, query_timeout: capMs }))();
      call.catch(() => {}); // if the timer wins, a late rejection must not become an unhandled one
      await Promise.race([
        call,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`took longer than ${capMs} ms`)), capMs);
        })
      ]);
      breaker.ok();
      return { written: true, reason: null };
    } catch (err) {
      const why = redactText((err && (err.code ? `${err.code} ${err.message || ""}` : err.message)) || err, 100) || "unknown error";
      breaker.fail(kind, why);
      return { written: false, reason: why };
    } finally {
      clearTimeout(timer);
    }
  }

  const hooks = {
    async onFunctionRun({ fn, ctx, steps } = {}) {
      try {
        const run = describeRun({ fn, ctx });
        if (!run) return {};
        const reqStart = nowMs();
        // The first request of a run: nothing remembered yet, first attempt.
        if (Array.isArray(steps) && steps.length === 0 && run.attempt === 0 && !marked.has(run.runId)) {
          const res = await safeWrite("start", START_SQL, [
            run.runId, run.attempt, run.fnId, run.eventName, run.busEventId, run.maxAttempts, new Date(reqStart)
          ], startCapMs);
          if (res.written) {
            if (marked.size >= MARKED_MAX) marked.clear();
            marked.add(run.runId);
          }
        }
        return {
          async finished({ result } = {}) {
            try {
              const elapsed = nowMs() - reqStart;
              const cap = clamp(REQUEST_BUDGET_MS - elapsed, finishFloorMs, finishCeilMs);
              const f = finishFields(result, { attempt: run.attempt, maxAttempts: run.maxAttempts });
              await safeWrite("finish", FINISH_SQL, [
                run.runId, run.attempt, run.fnId, run.eventName, run.busEventId, run.maxAttempts,
                new Date(reqStart), nowFn(), f.outcome, f.final, f.skipped, f.note, f.error
              ], cap);
            } catch { /* never into the workflow */ }
          }
        };
      } catch {
        return {};
      }
    }
  };

  return { hooks, breaker };
}

/** The hooks object an Inngest middleware's init() returns. */
export function runEvidenceHooks(options = {}) {
  return createRunEvidence(options).hooks;
}
