/* AFFILIATE PAYOUT TRANSFER SYNC — every 15 minutes, ask Plaid what happened to
 * each affiliate payout in flight (src/affiliates/payout-rail.mjs
 * syncPayoutTransfers).
 *
 *   settled              → the run is paid; the Plaid transfer id is its reference
 *   failed/cancelled/returned → back to pending with the reason, for staff to fix
 *   a return AFTER paid  → written on the row; the pulse goes red on it
 *
 * With nothing in flight the pass is one indexed query and no Plaid call. It
 * sends no money: a payout only starts when finance staff press Send. Same
 * Plaid host gate as every transfer (sandbox unless PLAID_ENV=production and
 * FINANCE_OS_TRANSFERS_LIVE=1). Flow: docs/journeys/affiliate-payout-flow.md.
 */

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { syncPayoutTransfers } from "../affiliates/payout-rail.mjs";

export const SYNC_CRON = "*/15 * * * *";

export async function sweep(conn = db, { now = new Date(), env = process.env, provider = null, sync = syncPayoutTransfers } = {}) {
  return sync(conn, { env, now, provider });
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron, so it
   sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("payout-transfer-sync", run) : run();
}

export const affiliatePayoutTransferSync = inngest.createFunction(
  { id: "affiliate-payout-transfer-sync", name: "Affiliate payout transfer sync (Plaid)" },
  { cron: SYNC_CRON },
  ({ step }) => step.run("payout-transfer-sync", () => sweep(db))
);

export default sweep;
