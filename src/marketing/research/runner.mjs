// @ts-check
// The saved-step runner for the research jobs: one step per worker claim, every step
// saved, a step that is done is never paid for twice.
//
// Design docs/specs/command-center-design-2026-10-05.md §5 safety rules 13, 17, 18 and
// §6 "Slice 1 additions" (the worker amendments). Unit X2. THE ONE SMALL IMPORT: the two
// research handlers (src/marketing/research/deep-research-job.mjs and
// src/marketing/flywheel/stage-job.mjs) reach saved steps only through runSavedSteps()
// below, so a shared runner built by another unit can replace this file behind the same
// call.
//
// HOW A RUN MOVES (drawn in docs/journeys/marketing-research-flow.md):
//
//   claim ──▶ read the checkpoint (marketing_jobs.result) ──▶ run ONE step
//      step done, more to do  ─▶ save checkpoint, status queued, run_after now + 5 s  (a yield)
//      step done, last one    ─▶ return the result; the worker marks the job done
//      step failed, tries left ─▶ save checkpoint, queued, run_after +1 min / +5 min
//      step failed 3 times     ─▶ save checkpoint, throw final: the job is failed with the reason
//      cap reached             ─▶ save checkpoint (what it found is kept), throw final:
//                                 "Stopped at the $40 run cap after step 2. …" → Resume
//
// THE CHECKPOINT lives in marketing_jobs.result:
//   { v:1, kind, step, step_n, steps_total, step_word, steps:{<name>:{attempts, done_at,
//     last_error}}, state:{…}, partial:{<call key>: …}, progress:{…}, stopped, error_last }
// `partial` holds each finished call of the step that is running, written the moment the
// call lands. A step that is cut off (the function killed at 15 minutes, a reclaim)
// re-enters, finds those calls in `partial` and does not pay for them again.
//
// ATTEMPTS ARE COUNTED PER STEP (result.steps[name].attempts), not on the row: a long
// run with a hiccup in step 1 and another in step 4 is not "out of tries". A yield never
// touches marketing_jobs.attempts (requeue, not failJob).
//
// WHY +5 SECONDS ON A YIELD. The worker calls finishJob(job.id, …) right after the
// handler returns; finishJob only touches a RUNNING row. A yield leaves the row queued,
// and the 5 seconds keep a second worker pass from claiming it (and turning it running)
// in the moment between the two statements.

import { jobSpend } from "./usage.mjs";

/** Tries per step before the run is failed with the step's reason. */
export const STEP_TRIES = 3;
/** Wait before trying a failed step again: after the 1st failure 1 minute, after the 2nd 5. */
export const STEP_BACKOFF_SECONDS = Object.freeze([60, 300]);
/** A yield between steps comes back this many seconds later. */
export const YIELD_SECONDS = 5;

/** A step that cannot go on: final = trying again will not help. */
export class StepError extends Error {
  /** @param {string} plain @param {{final?: boolean}} [opts] */
  constructor(plain, { final = false } = {}) {
    super(plain);
    this.name = "StepError";
    this.final = final;
  }
}

/** A cap was reached before the next call could start. */
export class CapStop extends Error {
  /** @param {string} sentence @param {{stop: string, capUsd?: number|null}} info */
  constructor(sentence, info) {
    super(sentence);
    this.name = "CapStop";
    this.stop = info.stop;
    this.capUsd = info.capUsd ?? null;
  }
}

const iso = (d) => new Date(d).toISOString();
const reasonOf = (err) => String((err && err.message) || err || "unknown error").replace(/\s+/g, " ").trim().slice(0, 500) || "unknown error";

/**
 * A fresh checkpoint for a job that has none yet.
 * @param {any} def @param {any} job @param {Date} now
 */
export function freshCheckpoint(def, job, now) {
  const first = def.first;
  const state = def.init(job.payload || {}, job);
  return {
    v: 1,
    kind: def.kind,
    step: first,
    step_n: def.steps[first].n,
    steps_total: def.stepsTotal,
    step_word: def.steps[first].word(state),
    steps: {},
    state,
    partial: {},
    progress: { started_at: iso(now), updated_at: iso(now), cost_usd_so_far: 0, searches_used: 0, fetches_used: 0, ...(def.progress ? def.progress(state) : {}) },
    stopped: null,
    error_last: null
  };
}

/** The checkpoint on the row, or null when the row holds none of this runner's shape. */
export function checkpointOf(job, def) {
  const r = job && job.result;
  if (!r || typeof r !== "object" || r.v !== 1 || r.kind !== def.kind || !r.state || typeof r.step !== "string") return null;
  return { partial: {}, steps: {}, ...r };
}

async function saveCheckpoint(db, jobId, cp) {
  await db.query(
    `UPDATE marketing_jobs SET result = $2::jsonb WHERE id = $1 AND status = 'running'`,
    [jobId, JSON.stringify(cp)]
  );
}

async function yieldJob(db, jobId, cp, seconds) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'queued', claimed_at = NULL, result = $2::jsonb,
            run_after = now() + make_interval(secs => $3::int)
      WHERE id = $1 AND status = 'running'
      RETURNING id`,
    [jobId, JSON.stringify(cp), Math.max(0, Math.floor(seconds))]
  );
  return r.rows.length > 0;
}

/**
 * runSavedSteps(job, ctx, def) → the final result (the worker marks the job done), or
 * { yielded: true } after saving the checkpoint and putting the job back in the queue.
 * Throws a final error (the worker fails the job with its words) on a cap stop or a
 * step that failed STEP_TRIES times.
 *
 * def = {
 *   kind, stepsTotal, first,
 *   init(payload, job) → state,
 *   steps: { [name]: { n, word(state) → words, run(state, io) → { state, next } } },
 *   progress?(state) → extra progress fields,
 *   finish?(state, io) → extra fields merged into the final result
 * }
 * `next` is another step name, the same name (one more round of it) or 'done'.
 *
 * io (what a step may use) = { db, env, deps, job, orgId, now(), spent(), once(key, fn),
 *   checkpoint } — once(key, fn) runs fn only when `partial[key]` is not saved yet, then
 *   saves what it returned (JSON) the moment it lands.
 *
 * @param {any} job the claimed marketing_jobs row
 * @param {{ db: any, env?: any, deps?: any }} ctx
 * @param {any} def
 */
export async function runSavedSteps(job, ctx, def) {
  const db = ctx.db;
  const env = ctx.env || process.env;
  const deps = ctx.deps || {};
  const now = typeof deps.now === "function" ? deps.now : () => new Date();

  let cp = checkpointOf(job, def);
  if (!cp) {
    cp = freshCheckpoint(def, job, now());
    await saveCheckpoint(db, job.id, cp);
  }
  if (cp.step === "done") return cp;

  const name = cp.step;
  const step = def.steps[name];
  if (!step) throw Object.assign(new Error(`The saved run is at a step this code does not know ("${name}").`), { final: true });

  const st = cp.steps[name] || { attempts: 0, done_at: null, last_error: null };
  cp.steps[name] = st;
  cp.stopped = null;
  const partial = cp.partial && typeof cp.partial === "object" ? cp.partial : {};
  cp.partial = partial;

  const io = {
    db, env, deps, job,
    orgId: job.org_id,
    now,
    checkpoint: cp,
    spent: () => jobSpend(db, job.id),
    /**
     * @template T @param {string} key @param {() => Promise<T>} fn
     * @param {(value: T) => boolean} [keep] save only when this says yes (default: always).
     *   A failed call is not saved, so trying the step again calls it again.
     * @returns {Promise<T>}
     */
    once: async (key, fn, keep) => {
      if (Object.prototype.hasOwnProperty.call(partial, key)) return partial[key];
      const value = await fn();
      if (typeof keep === "function" && !keep(value)) return value;
      const saved = value === undefined ? null : JSON.parse(JSON.stringify(value));
      partial[key] = saved;
      await db.query(
        `UPDATE marketing_jobs
            SET result = COALESCE(result, '{}'::jsonb)
                       || jsonb_build_object('partial', COALESCE(result -> 'partial', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb))
          WHERE id = $1 AND status = 'running'`,
        [job.id, key, JSON.stringify(saved)]
      );
      return saved;
    }
  };

  const refreshProgress = async () => {
    const s = await jobSpend(db, job.id);
    cp.progress = {
      ...cp.progress,
      ...(def.progress ? def.progress(cp.state) : {}),
      cost_usd_so_far: s.usd,
      searches_used: s.searches,
      fetches_used: s.fetches,
      updated_at: iso(now())
    };
  };

  let out;
  try {
    out = await step.run(cp.state, io);
  } catch (err) {
    if (err instanceof CapStop) {
      cp.stopped = { reason: err.stop, sentence: err.message, cap_usd: err.capUsd, at_step: name, step_n: step.n, at: iso(now()) };
      cp.error_last = err.message;
      await refreshProgress();
      await saveCheckpoint(db, job.id, cp);
      throw Object.assign(new Error(err.message), { final: true });
    }
    st.attempts = (Number(st.attempts) || 0) + 1;
    st.last_error = reasonOf(err);
    cp.error_last = st.last_error;
    await refreshProgress();
    const final = !!(err && err.final === true) || st.attempts >= STEP_TRIES;
    if (final) {
      await saveCheckpoint(db, job.id, cp);
      const tries = st.attempts >= STEP_TRIES && !(err && err.final === true) ? ` It failed ${st.attempts} times.` : "";
      throw Object.assign(new Error(`Step ${step.n} of ${def.stepsTotal} (${step.word(cp.state)}) could not finish: ${st.last_error}${tries}`), { final: true });
    }
    await yieldJob(db, job.id, cp, STEP_BACKOFF_SECONDS[Math.min(st.attempts, STEP_BACKOFF_SECONDS.length) - 1]);
    return { yielded: true, retry: true };
  }

  cp.state = out && out.state ? out.state : cp.state;
  const next = out && typeof out.next === "string" ? out.next : "done";
  if (next !== name) {
    st.done_at = iso(now());
    st.last_error = null;
  }
  cp.partial = {};
  cp.error_last = null;
  cp.step = next;
  if (next !== "done") {
    const ns = def.steps[next];
    if (!ns) throw Object.assign(new Error(`Step "${name}" asked for an unknown next step "${next}".`), { final: true });
    if (next !== name) cp.steps[next] = cp.steps[next] || { attempts: 0, done_at: null, last_error: null };
    cp.step_n = ns.n;
    cp.step_word = ns.word(cp.state);
  } else {
    cp.step_n = def.stepsTotal;
    cp.step_word = "Done";
  }
  await refreshProgress();

  if (next === "done") {
    const extra = def.finish ? await def.finish(cp.state, io) : {};
    await refreshProgress();
    return { ...cp, ...(extra || {}), finished_at: iso(now()) };
  }
  await yieldJob(db, job.id, cp, YIELD_SECONDS);
  return { yielded: true };
}
