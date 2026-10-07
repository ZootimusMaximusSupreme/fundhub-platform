// Plan source "funding-rounds" — FinanceOS wave 5, unit W2; the suggested date,
// Capital Blueprint launch unit B4.
//
// Contract: ops/workflows/finance-os-wave5-2026-10-06.md ("Shared contract —
// plan pins"). W1 owns src/finance/plan-sources/index.mjs; the orchestrator adds
// this file to it at merge.
//
// Pins:
//   apply  the next funding sequence, on the date staff set
//          (src/blueprint/next-funding-sequence.mjs), with the funding estimate
//          on file (custom field total_funding_estimate, then the newest pull's
//          fundingEstimate — the precedence matchForClient uses). Unknown → null.
//          NO STAFF DATE: the date the file math suggests
//          (src/blueprint/next-sequence-plan.mjs), when that answer is computed
//          with nothing blocking it and the client bought the Blueprint. Staff
//          dates always win, so the file math is not even read when one is set.
//   apply  each past round in funding_rounds, on the day it was opened, with the
//          funded (else approved) amount the round row holds.
// Status of the next funding sequence on a staff date: done once a round row
// exists on or after that date, missed when the date passed with none, planned
// before it. A suggested pin is always planned.

import { nextSequenceDate, fundingEstimate, roundPins } from "../bank-strategy.mjs";
import { computeNextSequenceDate } from "../../blueprint/next-sequence-plan.mjs";

export const name = "funding-rounds";

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
  const cf = c.rows[0].custom_fields || {};
  const nextDate = nextSequenceDate(cf);
  const [crs, rounds, suggestion] = await Promise.all([
    db.query(
      `SELECT result, created_at FROM crs_results
        WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1`, [clientId, orgId]),
    db.query(
      `SELECT id, round_number, status, approved_amount, funded_amount, created_at
         FROM funding_rounds
        WHERE client_id = $1 AND org_id = $2
        ORDER BY round_number ASC, created_at ASC`, [clientId, orgId]),
    /* The staff date wins, so the file math is only read when there is none. A
       failure here costs the suggested pin and nothing else: the plan source
       must still answer for the rounds and the staff date. */
    nextDate
      ? Promise.resolve(null)
      : computeNextSequenceDate(db, { orgId, clientId, asOf: new Date(`${day}T12:00:00.000Z`) }).catch((e) => {
        console.error("plan: next funding sequence suggestion failed", e && e.message ? e.message : e);
        return null;
      })
  ]);
  return roundPins({
    nextDate,
    estimateCents: fundingEstimate(cf, crs.rows).cents,
    rounds: rounds.rows,
    today: day,
    clientId,
    from,
    to,
    suggestion
  });
}

export default { name, pins };
