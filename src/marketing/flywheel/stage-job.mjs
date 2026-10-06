// @ts-check
// The worker's handler for marketing_jobs kind 'flywheel_stage': one row is one run of one
// flywheel step for one campaign (payload {campaign, stage, …}), and this file sends it to
// that step's code.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 "Endpoints" ("Stages 2, 4 and
// 5 are kind='flywheel_stage' with payload={campaign, stage, …}"). Unit X2 adds stage 2
// (market research). Stages 4 and 5 add their own line to STAGE_HANDLERS when they land.
// A stage with no line here fails at once with a plain reason, never runs something else.

import * as adResearch from "./ad-research.mjs";

/** @type {Record<number, { run: (job: any, ctx: any) => Promise<any> }>} */
export const STAGE_HANDLERS = {
  2: adResearch
};

/** @param {any} job @param {any} ctx */
export async function run(job, ctx) {
  const stage = Number(job && job.payload && job.payload.stage);
  const handler = Object.prototype.hasOwnProperty.call(STAGE_HANDLERS, stage) ? STAGE_HANDLERS[stage] : null;
  if (!handler) {
    throw Object.assign(new Error(`Flywheel step ${Number.isFinite(stage) ? stage : "?"} has no server job yet.`), { final: true });
  }
  return handler.run(job, ctx);
}
