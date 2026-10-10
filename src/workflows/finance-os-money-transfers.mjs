// FinanceOS money moves — the scheduled pass (wave 5, unit W7).
//
// Every 15 minutes, one pass of src/finance/money-transfers.mjs runTransfersPass:
//   1. expire   — a proposal not approved, or an approved move not started,
//                 3 days after its date is closed. Nothing moves.
//   2. send     — every move the CLIENT approved whose date has come: Plaid
//                 authorizes, then creates, the debit leg. Only approved moves —
//                 the database refuses a move with no client approval (466).
//   3. track    — Plaid's /transfer/event/sync from the saved cursor; each leg
//                 moves forward; when a debit's money is available in Fundhub's
//                 Plaid Ledger, the credit leg to the client's second account
//                 starts. Skips the Plaid call when nothing could hear from it.
//
// OFF UNLESS SWITCHED ON. With FINANCE_OS_TRANSFER_MAX_CENTS or
// FINANCE_OS_TRANSFER_DAILY_MAX_CENTS unset the pass returns at once — no query,
// no Plaid call. The sandbox host unless PLAID_ENV=production AND
// FINANCE_OS_TRANSFERS_LIVE=1.
//
// WHY EVERY 15 MINUTES, NOT DAILY. A move is a chain — debit, wait for the
// money, credit — and each link waits on the last. Daily would add a day per
// link. With nothing open the pass costs one indexed query.
//
// Each phase is its own Inngest step (Netlify cuts a request at 26 seconds).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { runTransfersPass } from "../finance/money-transfers.mjs";

export const SWEEP_CRON = "*/15 * * * *";
export const SOURCE_WORKFLOW = "finance-os-money-transfers";

/** One pass. db, env, clock and provider are arguments so tests drive it
    without Inngest or Plaid. */
export async function sweep(conn = db, { now = new Date(), env = process.env, provider = null, step = null, pass = runTransfersPass } = {}) {
  return pass(conn, { env, now, provider, step });
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron, so it
   sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const financeOsMoneyTransfers = inngest.createFunction(
  { id: "finance-os-money-transfers", name: "FinanceOS money moves (Plaid Transfer)" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
