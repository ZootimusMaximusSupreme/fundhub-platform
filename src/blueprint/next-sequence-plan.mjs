// Capital Blueprint — the next funding sequence planner: the one entry point.
//
//   computeNextSequenceDate(db, { orgId, clientId, asOf })
//     → { suggested_date, reasons[], blockers[], confidence: 'computed'|'partial', ... }
//     or null when the client is not in that org. READ ONLY.
//
//   sweepSuggested(db, { now })
//     the daily pass for clients whose staff date is NOT set: when the file math
//     says the file is ready, the closer gets the same task the staff date makes.
//
// WHERE THE MATH LIVES. next-sequence-math.mjs, pure, with the source of every
// window. This file only reads (the same rows GET /api/money/banks reads, plus
// next-sequence-facts.mjs) and calls it.
//
// THE STAFF DATE WINS. When clients.custom_fields.blueprint_next_sequence_ready_date
// is set, `effective_date` is that date and the suggestion rides next to it. The
// alert for a staff date is the existing pass (sweep in next-funding-sequence.mjs);
// this file's pass skips every client who has one.
//
// ALERT ONCE. The task's dedupe key is the finished sequence (the last funded
// round), not the date. The suggested date can move as inquiries age and cards
// are paid down, but a client gets one "file is ready" task per sequence. See
// nextSequenceAlertKey in next-funding-sequence.mjs.
//
// WHEN THE CLOSER IS TOLD. Only when the answer is "computed" (no factor is
// unknown), nothing blocks it (no open application, no unpaid-down file, a fresh
// credit file), and the suggested day is today or earlier. A partial answer is
// shown to staff and never alerts anyone.

import { runUnderwrite, CRS_SQL, TRADELINE_SQL, LIABILITY_SQL, BUSINESS_SQL } from "../finance/bank-strategy.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import {
  NEXT_SEQUENCE_READY_DATE_KEY, createNextSequenceCloserTask
} from "./next-funding-sequence.mjs";
import { readSequenceFacts, planFromRows } from "./next-sequence-facts.mjs";

/**
 * computeNextSequenceDate(db, { orgId, clientId, asOf }) — see the header.
 * Every query carries org_id and client_id.
 */
export async function computeNextSequenceDate(db, { orgId, clientId, asOf = new Date() } = {}) {
  const clientRes = await db.query(
    `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const [crs, lines, liabilities, businesses, facts, buyer] = await Promise.all([
    db.query(CRS_SQL, [clientId, orgId]),
    db.query(TRADELINE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId]),
    db.query(BUSINESS_SQL, [clientId, orgId]),
    readSequenceFacts(db, { orgId, clientId }),
    isCapitalBlueprintBuyer(db, { orgId, clientId })
  ]);
  const customFields = client.custom_fields || {};
  const { underwrite } = runUnderwrite({
    tradelineRows: lines.rows,
    liabilities: liabilities.rows,
    crsRows: crs.rows,
    customFields,
    businesses: businesses.rows
  });
  const plan = planFromRows({
    asOf, customFields, crsRows: crs.rows, tradelineRows: lines.rows, underwrite, facts
  });
  return { ...plan, blueprint_buyer: !!buyer };
}

/* Clients who funded at least one round and have no staff date: the ones the
   suggestion can alert for. Demo rows never alert. */
const CANDIDATES_SQL = `
  SELECT DISTINCT c.id AS client_id, c.org_id
    FROM clients c
    JOIN funding_rounds fr ON fr.client_id = c.id AND fr.org_id = c.org_id
   WHERE COALESCE(c.is_demo, false) = false
     AND COALESCE(fr.is_demo, false) = false
     AND (lower(btrim(COALESCE(fr.status, ''))) = 'funded' OR COALESCE(fr.funded_amount, 0) > 0)
     AND COALESCE(btrim(c.custom_fields->>$1), '') = ''`;

export async function suggestionCandidates(db) {
  const r = await db.query(CANDIDATES_SQL, [NEXT_SEQUENCE_READY_DATE_KEY]);
  return r.rows;
}

/**
 * One pass. For every funded client with no staff date, compute the plan and,
 * when it says ready, open the closer task keyed on the finished sequence.
 * Never throws the whole pass: a client that fails is reported and the rest run.
 *
 * @returns {{ checked, created, waiting, skipped: object[], errored: object[] }}
 *   waiting = the file math is not ready yet (a later date, a missing fact or a blocker)
 */
export async function sweepSuggested(db, {
  now = new Date(),
  compute = computeNextSequenceDate,
  create = createNextSequenceCloserTask
} = {}) {
  const tally = { checked: 0, created: 0, waiting: 0, skipped: [], errored: [] };
  const rows = await suggestionCandidates(db);
  tally.checked = rows.length;

  for (const row of rows) {
    try {
      const plan = await compute(db, { orgId: row.org_id, clientId: row.client_id, asOf: now });
      if (!plan) {
        tally.skipped.push({ clientId: row.client_id, reason: "client_not_found" });
        continue;
      }
      if (plan.staff_date) {
        tally.skipped.push({ clientId: row.client_id, reason: "staff_date_set" });
        continue;
      }
      if (!plan.ready || !plan.after_funding.alert_key) {
        tally.waiting += 1;
        continue;
      }
      const out = await create(db, {
        orgId: row.org_id,
        clientId: row.client_id,
        readyDate: plan.suggested_date,
        basis: "suggested",
        alertKey: plan.after_funding.alert_key
      });
      if (out.created) tally.created += 1;
      else tally.skipped.push({ clientId: row.client_id, reason: out.reason || "not_created" });
    } catch (e) {
      tally.errored.push({ clientId: row.client_id, error: e && e.message ? e.message : String(e) });
    }
  }
  return tally;
}

export default computeNextSequenceDate;
