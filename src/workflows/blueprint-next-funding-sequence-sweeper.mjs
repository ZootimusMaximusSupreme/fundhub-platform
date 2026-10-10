// Daily sweeper — the next funding sequence → closer task.
//
// Two passes, same task, same closer:
//   1. clients with a STAFF date that has come (sweep, next-funding-sequence.mjs)
//   2. clients with NO staff date whose file math says the file is ready
//      (sweepSuggested, next-sequence-plan.mjs)
// A client in pass 1 is skipped by pass 2, and each pass makes one task per date
// or per finished sequence, so running this twice a day alerts once.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sweep, SWEEP_CRON, SOURCE_WORKFLOW } from "../blueprint/next-funding-sequence.mjs";
import { sweepSuggested } from "../blueprint/next-sequence-plan.mjs";

export { SWEEP_CRON, SOURCE_WORKFLOW };

/** Both passes. The suggested pass never takes the staff pass down with it. */
export async function sweepAll(database, { now = new Date() } = {}) {
  const staff = await sweep(database, { now });
  let suggested;
  try {
    suggested = await sweepSuggested(database, { now });
  } catch (e) {
    suggested = { checked: 0, created: 0, waiting: 0, skipped: [], errored: [{ error: e && e.message ? e.message : String(e) }] };
  }
  return { ...staff, suggested };
}

export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweepAll(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const blueprintNextFundingSequenceSweeper = inngest.createFunction(
  { id: "blueprint-next-funding-sequence-sweeper", name: "Blueprint Next Funding Sequence sweeper" },
  { cron: SWEEP_CRON },
  () => sweepAll(db)
);

export default sweepAll;
