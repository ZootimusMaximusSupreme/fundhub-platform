// @ts-check
// The saved-step runner the flywheel's server stages share (copy, strategy).
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 ("The copy stage
// checkpoints per piece into marketing_jobs.result and re-queues itself under
// the 15-minute worker cap") and §5 rules 13, 17 and 18 (caps checked before
// every step, tapped jobs run while the machine is Off, a step is paid for
// once). Unit X3.
//
// HOW A RUN MOVES. A stage is a list of steps. The marketing worker
// (src/marketing/worker.mjs) claims the job and calls the stage's run(); this
// runner picks up at the saved step and works until its time slice is used,
// saving after every piece of work:
//
//   marketing_jobs.result = { progress: {step, step_n, steps_total, step_word,
//                             counts}, state: {...the step data so far},
//                             stopped_at_cap }
//
// When the slice is used it hands the job back (requeueJob: queued, due now, no
// attempt counted) and returns; the worker takes it again in the same pass or
// the next. A Netlify retry or a clock reclaim re-enters at the saved step, so
// work already saved is never paid for twice. NO TRANSACTION IS HELD ACROSS A
// MODEL CALL: every save is one short statement.
//
// COST (rule 13). Before each batch of calls the runner adds what the run has
// cost so far (marketing_model_usage rows for this job; an unpriced call counts
// at the highest known rate) to the batch's worst case and compares it with the
// run cap (marketing_settings.max_batch_cost_usd, $40 by default) and the month
// cap ($300). It shrinks the batch to what fits; when not even one call fits it
// stops with a plain sentence, keeps everything made so far, and fails the job
// at once (Retry starts it again only after Chris raises the cap).
//
// EVERY CALL IS FORCED TO CLAUDE (callModel provider 'anthropic', an explicit
// model, maxTokens and a timeout) and logged to marketing_model_usage with the
// model that served it. Nothing here can fall back to gpt-4o-mini.

import { callModel } from "../../agents/model.mjs";
import { requeueJob } from "../jobs.mjs";
import { logUsage, costStatus, costUsd, worstCaseUsd } from "../model-usage.mjs";
import { capsFor, runSpendUsd } from "./store.mjs";

export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";

/** Stop starting new work this long into one claim; then hand the job back. */
export const SLICE_MS = 2 * 60 * 1000;

/** One call's own limit, under Node's 300-second wait for headers. */
export const CALL_TIMEOUT_MS = 240_000;

/** A guess at a call's input size for the cap check (characters / 4, plus room). */
const inputEstimate = (chars) => Math.ceil(Number(chars || 0) / 3.5) + 2000;

export class StageStop extends Error {
  /** @param {string} message  @param {{cap?: boolean}} [opts] */
  constructor(message, { cap = false } = {}) {
    super(message);
    this.name = "StageStop";
    this.final = true;
    this.cap = cap;
  }
}

/** The worst a call can cost: its input estimate plus its whole output budget. */
export function callReserveUsd(model, { inputChars = 20000, maxTokens = 4000 } = {}) {
  const t = { input_tokens: inputEstimate(inputChars), output_tokens: maxTokens, cache_read_tokens: 0, cache_write_tokens: 0 };
  return costUsd(model, t) ?? worstCaseUsd(t);
}

const money = (v) => `$${Number(v).toFixed(2)}`;

/**
 * runSteps(job, ctx, { stage, steps, init })
 *
 * steps: [{ name, word, run: async (state, tools) => 'more' | 'done' | {done: result} }]
 *   'more'  this step has work left: save and, if time is left, call it again
 *   'done'  this step is finished: save and go to the next
 *   {done}  the stage is finished; the value is the job's result
 * init(job) → the starting state (only when nothing is saved yet)
 *
 * ctx = { db, env, deps: { call?, now?, logUsage?, requeue? } } (the worker's job ctx)
 * @param {any} job
 * @param {any} ctx
 * @param {{stage: number, steps: any[], init: (job: any) => any}} spec
 */
export async function runSteps(job, ctx, { stage, steps, init }) {
  const db = ctx.db;
  const deps = ctx.deps || {};
  const now = deps.now || (() => Date.now());
  const started = now();
  // The saved place: the running copy in result, else the copy kept in the
  // payload when the run last stopped (Retry clears result, never payload, so
  // a retried run picks up where it stopped and never pays for a step twice).
  const resume = job.payload && typeof job.payload === "object" ? job.payload.resume : null;
  const saved = job.result && typeof job.result === "object" && job.result.state
    ? job.result
    : (resume && typeof resume === "object" && resume.state ? resume : null);
  const state = saved ? saved.state : await init(job);
  let index = Math.max(0, Math.min(steps.length - 1, Number(saved && saved.progress && saved.progress.index) || 0));
  const caps = deps.caps || await capsFor(db, job.org_id);

  const progress = (i) => ({
    index: i,
    step: steps[i].name,
    step_n: i + 1,
    steps_total: steps.length,
    step_word: typeof steps[i].word === "function" ? steps[i].word(state) : steps[i].word,
    counts: state.counts || {}
  });

  const save = async (i, extra = {}) => {
    await db.query(
      `UPDATE marketing_jobs SET result = $2::jsonb, updated_at = now() WHERE id = $1 AND status = 'running'`,
      [job.id, JSON.stringify({ stage, progress: progress(i), state, ...extra })]
    );
  };

  const tools = makeTools({ job, ctx, caps, state });

  try {
    for (;;) {
      const step = steps[index];
      const out = await step.run(state, tools);
      if (out && typeof out === "object" && "done" in out) return out.done;
      if (out === "done") {
        if (index >= steps.length - 1) throw new Error(`step ${step.name} ended the list without a result`);
        index += 1;
      }
      await save(index);
      if (now() - started >= SLICE_MS) {
        await (deps.requeue || requeueJob)(db, job.id, { runAfter: new Date(now()) });
        return { handed_back: true, at_step: steps[index].name };
      }
    }
  } catch (err) {
    // Keep the place before the job fails or waits for its next try: the
    // running copy (with the cap flag, so the row says "Stopped at the cap")
    // and a copy in the payload that Retry does not clear.
    const cap = Boolean(err && /** @type {any} */ (err).cap);
    try {
      await save(index, cap ? { stopped_at_cap: true } : {});
      await db.query(
        `UPDATE marketing_jobs
            SET payload = payload || jsonb_build_object('resume', $2::jsonb), updated_at = now()
          WHERE id = $1`,
        [job.id, JSON.stringify({ progress: progress(index), state })]
      );
    } catch { /* the error below is the one worth reporting */ }
    throw err;
  }
}

/**
 * The tools a step gets: ask() (one forced-Claude call, logged), fit() (how many
 * of n calls the caps allow right now) and stopAtCap().
 */
export function makeTools({ job, ctx, caps, state }) {
  const db = ctx.db;
  const env = ctx.env || process.env;
  const deps = ctx.deps || {};
  const call = deps.call || callModel;
  const log = deps.logUsage || logUsage;

  const spentSoFar = async () => {
    const s = await runSpendUsd(db, job.id);
    return s.priced + worstCaseUsd({ input_tokens: s.nullInput, output_tokens: s.nullOutput, cache_read_tokens: 0, cache_write_tokens: 0 });
  };

  /** How many of `n` calls (each `reserveUsd` at worst) fit under both caps now. */
  const fit = async (n, reserveUsd) => {
    const spent = await spentSoFar();
    const month = deps.monthUsd ? await deps.monthUsd() : (await costStatus(db, { orgId: job.org_id, maxMonthUsd: caps.monthCapUsd })).month_usd;
    const room = Math.min(caps.runCapUsd - spent, caps.monthCapUsd - month);
    const k = reserveUsd > 0 ? Math.floor(room / reserveUsd) : n;
    state.spent_usd = Math.round(spent * 100) / 100;
    return Math.max(0, Math.min(n, k));
  };

  const stopAtCap = (stepWord) => {
    const which = state.spent_usd != null && state.spent_usd + 0.01 >= caps.runCapUsd
      ? `the ${money(caps.runCapUsd)} run cap`
      : `the ${money(caps.monthCapUsd)} month cap`;
    return new StageStop(
      `Stopped at ${which} while ${stepWord}. What it made so far is saved. Raise the cap in Settings and tap Retry to finish.`,
      { cap: true }
    );
  };

  /**
   * ask({label, model, system, user, schema, maxTokens, effort}) → json (with a
   * schema) or text. Throws a plain Error when Claude did not answer usefully;
   * the worker then tries the job again (3 tries in all, jobs.mjs failJob).
   */
  const ask = async ({ label, model = SONNET, system = "", user, schema = null, maxTokens = 4000, effort = "low" }) => {
    const out = await call({
      provider: "anthropic",
      model,
      system,
      user,
      env,
      maxTokens,
      effort,
      timeoutMs: deps.timeoutMs || CALL_TIMEOUT_MS,
      ...(schema ? { outputSchema: schema } : {}),
      fetchImpl: deps.fetchImpl
    });
    const u = out && out.usage ? out.usage : null;
    if (u && (u.input_tokens || u.output_tokens)) {
      await log(db, { orgId: job.org_id, jobId: job.id, model: out.servedModel || model, usage: u });
    }
    if (!out || out.error || out.mode === "shadow") {
      const why = String((out && out.error) || "no answer").replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]").slice(0, 300);
      throw new Error(`${label}: Claude did not answer (${why})`);
    }
    if (schema) {
      if (!out.json || typeof out.json !== "object") throw new Error(`${label}: the answer was not in the expected shape`);
      return out.json;
    }
    const text = String(out.text || "").trim();
    if (!text) throw new Error(`${label}: the answer was empty`);
    return text;
  };

  return { ask, fit, stopAtCap, spentSoFar };
}
