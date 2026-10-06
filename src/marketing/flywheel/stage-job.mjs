// @ts-check
// The worker's handler for marketing_jobs kind 'flywheel_stage' (registered in
// src/marketing/job-kinds.mjs): one row is one run of one flywheel step for one
// campaign (payload {campaign, stage, …}), and this file sends it to that step's code.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 "Endpoints" / "Job kinds"
// ("Stages 2, 4 and 5 are kind='flywheel_stage' with payload={campaign, stage, …}").
//   2  market research   unit X2  src/marketing/flywheel/ad-research.mjs  run(job, ctx)
//   4  the copy          unit X3  src/marketing/flywheel/copy-stage.mjs   runStage(job, ctx)
//   5  the ad strategy   unit X3  src/marketing/flywheel/strategy-stage.mjs runStage(job, ctx)
// Wave 2b merge glue: X2 and X3 each wrote this file for their own stages; both
// registries are kept, and run() looks in X2's first. A stage with no line fails at
// once with a plain reason (final: never three tries for a step that cannot run).

import * as adResearch from "./ad-research.mjs";

/** X2's registry: modules that export run(job, ctx). */
/** @type {Record<number, { run: (job: any, ctx: any) => Promise<any> }>} */
export const STAGE_HANDLERS = {
  2: adResearch
};

/** X3's registry: lazy modules that export runStage(job, ctx). */
export const STAGE_JOB_RUNNERS = {
  4: () => import("./copy-stage.mjs"),
  5: () => import("./strategy-stage.mjs")
};

/**
 * run(job, ctx) — the worker contract (src/marketing/worker.mjs): return to
 * finish the job with that result, throw to fail it (final: true fails it now).
 * @param {any} job
 * @param {{db: any, env?: any, deps?: any}} ctx
 */
export async function run(job, ctx) {
  const stage = Number(job && job.payload && job.payload.stage);
  if (Object.prototype.hasOwnProperty.call(STAGE_HANDLERS, stage)) {
    return STAGE_HANDLERS[stage].run(job, ctx);
  }
  const load = /** @type {Record<number, () => Promise<any>>} */ (STAGE_JOB_RUNNERS)[stage];
  if (!load) {
    throw Object.assign(new Error(`Step ${Number.isFinite(stage) ? stage : "?"} of the flywheel does not run on the server yet.`), { final: true });
  }
  const campaign = job.payload && job.payload.campaign;
  if (typeof campaign !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(campaign)) {
    throw Object.assign(new Error("This run names no campaign folder, so it cannot read or save anything."), { final: true });
  }
  const mod = await load();
  return mod.runStage(job, ctx);
}
