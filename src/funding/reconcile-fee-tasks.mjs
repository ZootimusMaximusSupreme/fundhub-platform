// One-time repair for legacy card-stacking rounds already marked Funded before
// the confirmed-approval guard existed. This creates internal advisor work only:
// no fee amount, invoice, customer message, or round state is changed.

import { confirmedApprovalConditions } from "./success-fee.mjs";
import { createTask } from "../lib/create-task.mjs";

export const LEGACY_FEE_TASK_SOURCE = "f-07-funding-locked-fee-not-ready";
export const legacyFeeTaskKey = (roundId) => `legacy-funded-no-confirmed-approvals:${roundId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRoundIds(roundIds) {
  const ids = [...new Set((roundIds || []).map((value) => String(value).trim().toLowerCase()))];
  for (const id of ids) if (!UUID.test(id)) throw new Error(`Invalid funding round ID: ${id}`);
  return ids;
}

/** Only rounds with no confirmed bank amount AND no linked fee invoice. */
export async function listLegacyFundedFeeGaps(db, { roundIds = [] } = {}) {
  const ids = normalizeRoundIds(roundIds);
  const rows = await db.query(
    `SELECT fr.id, fr.org_id, fr.client_id, fr.round_number
       FROM funding_rounds fr
      WHERE fr.product = 'card_stacking'
        AND fr.status = 'funded'
        AND ($1::uuid[] IS NULL OR fr.id = ANY($1::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM applications a
           WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
             AND ${confirmedApprovalConditions("a")}
        )
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
           WHERE i.funding_round_id = fr.id AND i.org_id = fr.org_id
             AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
        )
      ORDER BY fr.org_id, fr.client_id, fr.round_number, fr.id`,
    [ids.length ? ids : null]
  );
  return rows.rows || [];
}

/** Apply only to an explicit, reviewed list of round IDs; dry-run is default. */
export async function reconcileLegacyFundedFeeTasks(db, { apply = false, roundIds = [] } = {}) {
  const ids = normalizeRoundIds(roundIds);
  if (apply && !ids.length) throw new Error("Apply requires explicit funding round IDs");
  const candidates = await listLegacyFundedFeeGaps(db, { roundIds: ids });
  if (!apply) return { applied: false, candidates, created: 0 };
  if (candidates.length !== ids.length) {
    throw new Error(`Candidate mismatch: requested ${ids.length} round(s), found ${candidates.length}; no tasks created`);
  }

  const outcomes = [];
  for (const round of candidates) {
    // Re-read immediately before writing. New bank answers or an invoice
    // recorded since preview must prevent stale work, never get billed here.
    const stillMissing = await listLegacyFundedFeeGaps(db, { roundIds: [round.id] });
    if (!stillMissing.length) {
      outcomes.push({ roundId: round.id, created: false, reason: "changed_since_preview" });
      continue;
    }
    const task = await createTask(db, {
      orgId: round.org_id,
      clientId: round.client_id,
      sourceWorkflow: LEGACY_FEE_TASK_SOURCE,
      assigneeRole: "funding_advisor",
      title: `Funded round ${round.round_number ?? "?"}: verify bank approvals before invoicing`,
      body: legacyFeeTaskKey(round.id),
      detail: "Record the real bank approval and approved amount, or correct the Funded status. Do not calculate or send a fee invoice from the funded amount."
    });
    outcomes.push({ roundId: round.id, created: task.created, reason: task.reason });
  }
  return { applied: true, candidates, created: outcomes.filter((row) => row.created).length, outcomes };
}
