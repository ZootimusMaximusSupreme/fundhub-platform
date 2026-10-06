// @ts-check
// The marketing worker's handler for job kind 'flywheel_stage' (registered in
// src/marketing/job-kinds.mjs). One kind for every flywheel stage that runs as a
// job; payload.stage says which (design docs/specs/command-center-design-
// 2026-10-05.md §3.2 "Job kinds": stages 2, 4 and 5 are kind 'flywheel_stage').
//
// STAGE_JOB_RUNNERS maps a stage to its module. Unit X3 adds 4 (copy) and 5
// (strategy). Stage 2 (market research) is unit X2's: it adds its line here and
// sets STAGE_RUNNERS[2] in stages.mjs. A stage that is not here fails at once
// with a plain reason (never three tries for a step that cannot run).

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
