// Money A for the morning pulse: funding, fees and payouts. Report only. Read only.
//
// The SQL, timing windows, and verdicts live in the beat-safe module below. Keeping one copy means
// the morning lane and the hourly beat ask the same six questions and return the same answers.

import {
  runMoneyFundingChecks
} from "../beats/lib/money-funding-truth.mjs";

export {
  APPROVED_NO_AMOUNT_AFTER_MS,
  APPROVED_NO_AMOUNT_SQL,
  APPROVED_UNPAID_AFTER_MS,
  APPROVED_UNPAID_SQL,
  CARD_BOARD_KEY,
  CARD_STACKING,
  CHECK_IDS,
  FUNDED_BILL_WAIT_MS,
  FUNDED_CARDS_SQL,
  FUNDED_ROUNDS_SQL,
  FUNDED_STAGE_KEY,
  HELD_PAYOUTS_SQL,
  LEDGER_RULE_SQL,
  LOOKBACK_MS,
  OPEN_VERSIONS_SQL,
  PAYOUT_HELD_AFTER_MS,
  SAMPLE_ROWS_SQL,
  SEED_CLIENT_EMAIL_RE,
  SEED_PAYMENT_REF_RE,
  SLO_PRODUCTS_SQL,
  SLO_SALE_NOTE,
  SLO_SALE_REF_LIKE,
  heldReason,
  judgeApprovedNoAmount,
  judgeFundedBills,
  judgeHeldPayouts,
  judgeLedger,
  judgeSampleRows,
  judgeSloMap,
  roundProblems
} from "../beats/lib/money-funding-truth.mjs";

/**
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const read = db && typeof db.query === "function"
    ? (sql, params) => db.query(sql, params)
    : null;
  return runMoneyFundingChecks({ read, orgId: ctx.orgId, now: ctx.now });
}
