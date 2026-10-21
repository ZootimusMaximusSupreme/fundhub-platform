// AF-01 — queue catalog AF1 for plus-tag affiliate sims that never got it.
// Apply also queues AF1 for the one new affiliate. This sweeper is the backfill
// job. Dispatcher (queued → sent) is unchanged.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sweepAffiliateDrips } from "../affiliates/drip.mjs";

export const SWEEP_CRON = "20 * * * *";
export const SOURCE_WORKFLOW = "af-01-affiliate-drip";

export async function sweep(handleDb, options = {}) {
  try {
    return await sweepAffiliateDrips(handleDb, options);
  } catch (err) {
    return {
      ok: false,
      scanned: 0,
      queued: 0,
      results: [],
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const af01AffiliateDrip = inngest.createFunction(
  { id: "af-01-affiliate-drip", name: "AF-01 — Affiliate welcome drip (AF1)" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
