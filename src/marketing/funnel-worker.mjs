// @ts-check
// Runs one funnel job by its id, start to finish (build unit X4).
//
// The thin shell netlify/functions/marketing-funnel-background.mjs calls this
// after it has checked the owner's session. U22's marketing worker is not on
// main yet, so this follows the offer writer's pattern (spec §6 Step 4 allows
// it: "else the offer background-function pattern"). The two job kinds are in
// src/marketing/job-kinds.mjs as well, so once U22's worker lands it can pick up
// a funnel job this shell did not finish; the claim below is one statement, so
// the two can never run the same job at once.
//
// The job queue's rules are kept (src/marketing/jobs.mjs): a handler that
// returns finishes the job; one that throws counts an attempt (failJob), and a
// FunnelJobError fails it at once with its reason. A job that comes back
// queued for another try is waited for inside this same run when the wait and
// the run both fit before the background function's 15 minutes are up
// (U22's "in-pass waits").

import { finishJob, failJob } from "./jobs.mjs";
import { JOB_KINDS } from "./job-kinds.mjs";
import { FUNNEL_JOB_KINDS } from "./funnel-store.mjs";
import { runnerIsLocal, isAiKind } from "./ai-runner.mjs";

/** The background function's own limit is 15 minutes; this leaves a margin. */
export const PASS_BUDGET_MS = 14 * 60_000;
/** How long one run of each kind can take at most (model timeout; proof waits). */
export const RUN_ESTIMATE_MS = Object.freeze({ funnel: 6 * 60_000, funnel_push: 3 * 60_000 });

const CLAIM_SQL = `
  UPDATE marketing_jobs
     SET status = 'running', claimed_at = now(), finished_at = NULL
   WHERE id = $1 AND org_id = $2 AND status = 'queued'
     AND kind = ANY($3::text[])
     AND run_after <= now() + interval '5 seconds'
  RETURNING *`;

/**
 * runFunnelJob(db, { jobId, orgId, env, deps }) → { status, job_id, result?, error? }
 * deps: { sleep?, now?, handlers? (kind → { run }), ...passed to the handler }
 * @param {any} db
 * @param {{ jobId: string, orgId: string, env?: any, deps?: any }} opts
 */
export async function runFunnelJob(db, { jobId, orgId, env = process.env, deps = {} }) {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const started = now();
  let last = { status: "skipped", job_id: jobId, error: "the job was not queued (already running, finished, or not a funnel job)" };
  /* MARKETING_AI_RUNNER=local (src/marketing/ai-runner.mjs): the page writer ('funnel')
     is AI work and is never claimed here; it waits for the Mac. The push still runs. */
  const kinds = runnerIsLocal(env) ? FUNNEL_JOB_KINDS.filter((k) => !isAiKind(k)) : [...FUNNEL_JOB_KINDS];

  for (let pass = 0; pass < 3; pass += 1) {
    const claimed = await db.query(CLAIM_SQL, [jobId, orgId, kinds]);
    const job = claimed.rows[0];
    if (!job) return last;

    let handler;
    try {
      handler = deps.handlers && deps.handlers[job.kind]
        ? deps.handlers[job.kind]
        : await JOB_KINDS[job.kind].load();
    } catch (err) {
      await failJob(db, job.id, `The ${job.kind} handler did not load: ${String((err && err.message) || err)}`, { final: true });
      return { status: "failed", job_id: job.id, error: "handler did not load" };
    }

    try {
      const result = await handler.run(job, { db, env, deps });
      await finishJob(db, job.id, result);
      return { status: "done", job_id: job.id, result };
    } catch (err) {
      const final = !!(err && err.final);
      const row = await failJob(db, job.id, err, { final });
      last = { status: row ? row.status : "failed", job_id: job.id, error: row ? row.error : String((err && err.message) || err) };
      if (!row || row.status !== "queued") return last;
      const waitMs = Math.max(0, new Date(row.run_after).getTime() - now());
      const fits = now() - started + waitMs + (RUN_ESTIMATE_MS[job.kind] ?? 6 * 60_000) < PASS_BUDGET_MS;
      if (!fits) return last;
      await sleep(waitMs);
    }
  }
  return last;
}
