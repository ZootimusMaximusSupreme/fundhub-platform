// @ts-check
// The Mac queue runner: runs the marketing AI jobs with Claude Code on Chris's Mac.
//
// Started by `npm run marketing:run-queue` (scripts/marketing-run-queue.mjs). Meant for
// MARKETING_AI_RUNNER=local on Netlify (src/marketing/ai-runner.mjs): the dashboard
// still STARTS every job, Netlify leaves the AI ones queued, and this picks them up.
//
// WHAT IT RUNS, with the same code Netlify uses:
//   * marketing_jobs of the AI kinds (write_slot, fix_script, funnel, avatar,
//     flywheel_stage, deep_research): the worker's own runPass (src/marketing/worker.mjs)
//     with the AI kinds only — the same claim (FOR UPDATE SKIP LOCKED, group caps under
//     an advisory lock), the same handlers, the same finishJob / failJob. The outbox
//     drain, the buzzes, the heartbeat and the wake are turned off here: Netlify still
//     does those.
//   * the Write offer jobs: runOfferJob (src/marketing/offer-run.mjs), the same function
//     the offer background function calls, with its claim by id.
//   * Write ad copy (generation_jobs with assetKind 'copy'): runDue
//     (src/creative/runner.mjs), the same function the creative cron calls.
// Every model call in this process goes to Claude Code (routeModelCallsToClaudeCode).
//
// THE LOOP. Run everything that is due; when something ran, look again at once; when
// nothing ran, wait 60 seconds and look again. `once: true` stops at the first look
// that finds nothing (drain and exit).
//
// STOPPING (Ctrl-C). stop() puts every job this process is running back in the queue
// (requeueJob: no try is counted) and ends the `claude` children. The claims are each
// one short statement and every step is saved as it goes, so the next run picks the
// job up where it stood. A copy job's claim is inside its own transaction, so it rolls
// back to queued by itself when the connection closes.

import { runPass as realRunPass } from "./worker.mjs";
import { macRegistry, AI_JOB_KINDS, AI_ASSET_KINDS } from "./ai-runner.mjs";
import { requeueJob as realRequeueJob, OFFER_KIND } from "./jobs.mjs";
import { runOfferJob as realRunOfferJob } from "./offer-run.mjs";
import { runDue as realRunDue } from "../creative/runner.mjs";
import { callModel } from "../agents/model.mjs";
import { routeModelCallsToClaudeCode, stopClaudeCodeCalls, CLAUDE_CODE } from "../agents/claude-code.mjs";

/** How long to wait between looks when nothing was waiting. */
export const POLL_MS = 60_000;

const short = (id) => String(id || "").slice(0, 8);
const reasonOf = (err) => String((err && typeof err === "object" && "message" in err ? err.message : err) ?? "unknown error")
  .replace(/\s+/g, " ").trim().slice(0, 200) || "unknown error";
const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

/**
 * The offer writer's ask() (src/marketing/offer-transport.mjs askAnthropic's shape),
 * through Claude Code. Model 'claude-code', so the offer's cost reads $0.
 * @param {Function} [call]
 */
export function macAsk(call = callModel) {
  return async ({ system, user, maxTokens, timeoutMs } = /** @type {any} */ ({})) => {
    const out = await call({ provider: CLAUDE_CODE, system, user, maxTokens, timeoutMs });
    return {
      text: (out && out.text) || null,
      error: (out && out.error) || null,
      status: out && out.status != null ? out.status : null,
      mode: out && out.mode,
      usage: (out && out.usage) || { input_tokens: 0, output_tokens: 0 },
      model: CLAUDE_CODE,
      stopReason: (out && out.stopReason) || null,
      timedOut: /timeout/.test(String((out && out.error) || ""))
    };
  };
}

/** A wait the stop() call can cut short. */
function realSleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); resolve(undefined); }, { once: true });
  });
}

/**
 * makeQueueRunner({ db, env, log, deps }) → { run({ once }), stop(), running }
 *
 * deps (tests): runPass, runOfferJob, runDue, requeueJob, requeueOffer, sleep, now,
 * registry, passDeps, ask, stopCalls, route.
 * @param {{ db: any, env?: Record<string, any>, log?: (line: string) => void, deps?: any }} opts
 */
export function makeQueueRunner({ db, env = process.env, log = (l) => console.log(l), deps = {} }) {
  const runPass = deps.runPass || realRunPass;
  const runOfferJob = deps.runOfferJob || realRunOfferJob;
  const runDue = deps.runDue || realRunDue;
  const requeueJob = deps.requeueJob || realRequeueJob;
  const sleep = deps.sleep || realSleep;
  const now = deps.now || (() => Date.now());
  const stopCalls = deps.stopCalls || stopClaudeCodeCalls;
  const ask = deps.ask || macAsk();
  const requeueOffer = deps.requeueOffer || (async (id) => {
    const r = await db.query(
      `UPDATE marketing_jobs SET status = 'queued', claimed_at = NULL
        WHERE id = $1 AND kind = '${OFFER_KIND}' AND status = 'running'
        RETURNING id`,
      [id]
    );
    return r.rows[0] || null;
  });

  let stopping = false;
  const ac = new AbortController();
  /** job id → 'job' | 'offer' */
  const running = new Map();

  /** Hold a settled handler when stopping, so a killed call is never counted as a failed try. */
  const hang = () => new Promise(() => {});

  /** The AI kinds, each handler wrapped for the one-line log and the stop bookkeeping. */
  const registry = Object.fromEntries(Object.entries(deps.registry || macRegistry()).map(([kind, entry]) => [kind, {
    ...entry,
    load: async () => {
      const mod = await entry.load();
      return {
        run: async (job, ctx) => {
          const t0 = now();
          running.set(String(job.id), "job");
          log(`${kind} ${short(job.id)} started`);
          try {
            const result = await mod.run(job, ctx);
            running.delete(String(job.id));
            if (stopping) return hang();
            log(`${kind} ${short(job.id)} done in ${secs(now() - t0)}`);
            return result;
          } catch (err) {
            running.delete(String(job.id));
            if (stopping) return hang();
            log(`${kind} ${short(job.id)} failed after ${secs(now() - t0)}: ${reasonOf(err)}`);
            throw err;
          }
        }
      };
    }
  }]));

  /** One worker pass over the AI kinds, with Netlify's chores turned off. */
  const pass = async () => {
    const summary = await runPass({
      db, env, registry,
      reclaimScope: { kinds: [...AI_JOB_KINDS] },
      deps: {
        beat: async () => null,
        lastDrain: async () => ({ at: null, detail: null }),
        outboxWaiting: async () => 0,
        drainOutbox: async () => ({ skipped: "mac" }),
        recordDrain: async () => null,
        sendDueBuzzes: async () => null,
        wake: async () => ({ skipped: "mac" }),
        log: () => {},
        ...(deps.passDeps || {})
      }
    });
    for (const e of (summary && summary.errors) || []) log(`problem: ${e}`);
    if (summary && summary.reclaimed) log(`took back ${summary.reclaimed} job(s) a stopped run left behind`);
    return Number(summary && summary.claimed) || 0;
  };

  /** Every queued Write offer job, one at a time. */
  const offers = async () => {
    const r = await db.query(
      `SELECT id, org_id FROM marketing_jobs
        WHERE kind = '${OFFER_KIND}' AND status = 'queued'
        ORDER BY created_at LIMIT 5`
    );
    let ran = 0;
    for (const row of r.rows) {
      if (stopping) break;
      const t0 = now();
      running.set(String(row.id), "offer");
      log(`offer ${short(row.id)} started`);
      const out = await runOfferJob(db, { jobId: row.id, orgId: row.org_id, ask, modelName: CLAUDE_CODE });
      running.delete(String(row.id));
      if (stopping) return ran;
      if (out && out.error === "not_queued") { log(`offer ${short(row.id)} was already taken`); continue; }
      ran += 1;
      log(out && out.ok
        ? `offer ${short(row.id)} done in ${secs(now() - t0)}`
        : `offer ${short(row.id)} failed after ${secs(now() - t0)}: ${reasonOf(out && out.error)}`);
    }
    return ran;
  };

  /** Write ad copy jobs (the creative factory's 'copy' kind). */
  const copy = async () => {
    const out = await runDue(db, { maxJobsPerPartner: 1, assetKinds: [...AI_ASSET_KINDS] });
    const jobs = (out && out.jobs) || [];
    for (const j of jobs) {
      const id = j.job_id || j.id;
      log(j.status === "succeeded"
        ? `ad copy ${short(id)} done`
        : `ad copy ${short(id)} ${j.status || "ended"}${j.error ? `: ${reasonOf(j.error)}` : ""}`);
    }
    return jobs.length;
  };

  /** One look at everything. Returns how many jobs ran. */
  const cycle = async () => {
    let ran = 0;
    for (const [what, step] of /** @type {const} */ ([["jobs", pass], ["offers", offers], ["ad copy", copy]])) {
      if (stopping) break;
      try { ran += await step(); }
      catch (err) { if (!stopping) log(`problem with ${what}: ${reasonOf(err)}`); }
    }
    return ran;
  };

  return {
    running,
    get stopping() { return stopping; },

    /** Loop until stopped (or, with once, until a look finds nothing). */
    async run({ once = false } = {}) {
      (deps.route || routeModelCallsToClaudeCode)(true);
      let total = 0;
      while (!stopping) {
        const ran = await cycle();
        total += ran;
        if (stopping) break;
        if (ran > 0) continue;
        if (once) break;
        await sleep(POLL_MS, ac.signal);
      }
      return { ran: total };
    },

    /** Put what is running back in the queue, then end the `claude` children. */
    async stop() {
      stopping = true;
      ac.abort();
      const back = [];
      for (const [id, what] of [...running.entries()]) {
        try {
          const row = what === "offer" ? await requeueOffer(id) : await requeueJob(db, id, { runAfter: null });
          if (row) back.push(id);
        } catch (err) {
          log(`could not put ${short(id)} back (${reasonOf(err)}); it is taken back on its own after 16 minutes`);
        }
      }
      stopCalls();
      return { requeued: back };
    }
  };
}
