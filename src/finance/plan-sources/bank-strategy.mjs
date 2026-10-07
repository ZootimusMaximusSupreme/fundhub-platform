// Plan source "bank-strategy" — FinanceOS wave 5, unit W2.
//
// Contract: ops/workflows/finance-os-wave5-2026-10-06.md ("Shared contract —
// plan pins"). W1 owns src/finance/plan-sources/index.mjs; the orchestrator adds
// this file to it at merge.
//
// Pins for the bank relationship tracker (src/finance/bank-strategy.mjs):
//   open_account  the day staff planned to open it (status planned, or missed
//                 once the day passes), or the day it was opened (done)
//   deposit       each deposit staff recorded (done)
//   checkpoint    the day the bank's own seasoning period ends (bank book)
// When no open day is planned but a next-round date is set, the open pin sits on
// the last day that still leaves the bank's seasoning period before that round.
// No date is ever made up: a bank with no plan and no rule gets no pin.

import { readRelationships, bankPins, nextRoundDate } from "../bank-strategy.mjs";

export const name = "bank-strategy";

/**
 * @param {object} db
 * @param {{orgId: string, clientId: string, from?: string|null, to?: string|null, env?: object,
 *          now?: Date, today?: string}} args  `today`/`now`: the registry's one clock
 *          (src/finance/plan-sources/index.mjs); either may be left out.
 * @returns {Promise<object[]>} pins in the board's shape
 */
export async function pins(db, { orgId, clientId, from = null, to = null, now = new Date(), today = null } = {}) {
  if (!orgId || !clientId) return [];
  const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date(now).toISOString().slice(0, 10);
  const c = await db.query(`SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  if (!c.rows[0]) return [];
  const relationships = await readRelationships(db, { orgId, clientId, today: day });
  return bankPins(relationships, { today: day, nextDate: nextRoundDate(c.rows[0].custom_fields || {}), from, to });
}

export default { name, pins };
