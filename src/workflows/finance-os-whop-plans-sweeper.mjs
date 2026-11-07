// FinanceOS Whop plans — the daily read behind the Whop plans on Payments (unit W, owner ask
// 2026-11-07: track the plans clients pay Fundhub on Whop like the Clarity plans, with a phone
// alert before each payment).
//
// ONE PASS: syncWhopMemberships (src/finance/whop-plans-sync.mjs) reads Fundhub's own Whop
// account, GET only, and saves each client's open Whop plans in whop_memberships
// (db/migrations/584). It changes nothing at Whop, moves no money and sends nothing.
//
// 07:00 UTC daily: before the 07:30 alerts pass (blueprint-finance-os-alerts), so a Whop
// charge 3 days out is queued for its phone alert the same morning.
//
// THROWS when Whop cannot be read (no key, a refused key, a broken list), so the clock's
// receipt says error. The morning check payments:whop-plans-current goes red once a saved
// copy is 36 hours old.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { syncWhopMemberships } from "../finance/whop-plans-sync.mjs";

export const SWEEP_CRON = "0 7 * * *";
export const SOURCE_WORKFLOW = "finance-os-whop-plans-sweeper";

/** sweep — one pass. The database, the clock and the sync are arguments so tests drive it
    without Whop or Postgres. `step` is the clock's step stand-in when present. */
export async function sweep(conn = db, { now = new Date(), env = process.env, sync = syncWhopMemberships, step = null } = {}) {
  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());
  const tally = await run("read-whop-plans", () => sync(conn, { now, env }));
  // `count` is what the job receipt records (itemCountOf in src/pulse/heartbeats.mjs).
  return { ...tally, count: Number.isInteger(tally?.saved) ? tally.saved : 0 };
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no event
   trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const financeOsWhopPlansSweeper = inngest.createFunction(
  { id: "finance-os-whop-plans-sweeper", name: "FinanceOS Whop plans" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
