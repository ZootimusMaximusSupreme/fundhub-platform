/* AFFILIATE PAYOUT AUTOPAY — every hour (src/affiliates/payout-rail.mjs
 * runAutopay). Every 15 minutes until 2026-10-20; slowed for the Inngest Free
 * plan run limit. A payout run is due the next day, so an hour costs nothing.
 *
 * Owner-set 2026-10-20 (Chris): "Plaid's going to take care of everything. ...
 * Paid them out immediately upon receiving the money. Once it clears, we just
 * pay it." So, each pass, in its own Inngest step:
 *
 *   build — commission earned since the last pass (the client's payment cleared
 *           and convert() set commission_due) goes on a payout run of its own,
 *           due the next day. Held if the affiliate has no signed license, no
 *           tax form or no linked bank; released by itself when they do.
 *   send  — every pending run goes to the affiliate's Plaid-linked bank with
 *           Plaid Transfer. No approval click.
 *   sync  — ask Plaid what happened: settled → paid; failed → back to pending.
 *
 * Same Plaid host gate as every transfer: sandbox unless PLAID_ENV=production
 * and FINANCE_OS_TRANSFERS_LIVE=1. On the sandbox only test affiliates can be
 * paid; a real affiliate's run waits with the reason written on it.
 * Flow: docs/journeys/affiliate-payout-flow.md.
 */

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { runAutopay } from "../affiliates/payout-rail.mjs";

export const AUTOPAY_CRON = "27 * * * *";

export async function sweep(conn = db, { now = new Date(), env = process.env, provider = null, step = null, pass = runAutopay } = {}) {
  return pass(conn, { env, now, provider, step });
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron, so it
   sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const affiliatePayoutAutopay = inngest.createFunction(
  { id: "affiliate-payout-autopay", name: "Affiliate payout autopay (Plaid)" },
  { cron: AUTOPAY_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
