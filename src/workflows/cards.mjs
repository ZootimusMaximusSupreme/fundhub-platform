// moveCardToStage — the CRM's "Move Opportunity to Stage X" action, ported as a
// find-or-create against cards/pipelines/pipeline_stages (seeded in
// db/seed/002_pipelines.sql — pipeline/stage keys must match that seed exactly).
// Idempotent: find-or-create + a plain UPDATE, safe to run twice.
//
// Card Stacking (funding_card_stacking): after a successful move, emits the
// matching round.* event so money-chain + funding workflows fire. Funded moves
// are refused when funded_amount is missing/zero/negative, and also when any
// bank yes on the round still has no dollar amount against it — that approval
// would never be billed (CLOSEOUT-FEE-BASIS).

import {
  PIPELINE_KEY as CARD_STACKING_PIPELINE,
  eventForStage,
  guardFundedAmount,
  emitCardStackingRoundTransition
} from "../funding/card-stacking-rounds.mjs";
import { isBlockingFundingHold } from "../inquiry-ops/doc-gate.mjs";

export async function moveCardToStage(db, {
  orgId,
  clientId,
  pipelineKey,
  stageKey,
  approvedAmount = null,
  fundedAmount = null,
  roundNumber = null
} = {}) {
  // Org is required. Looking up by key alone used to pick another company's
  // pipeline when two orgs shared the same key names (every org has "sales"),
  // then INSERT a card with this org_id and that foreign pipeline_id. The
  // dashboard read joins on p.org_id = cd.org_id, so those cards vanished from
  // every board — sample markup painted, the API answered "ok, 0 cards", and
  // the screen went blank.
  if (!orgId) return { moved: false, reason: "org_required" };
  const stage = await db.query(
    `SELECT ps.id AS stage_id, ps.pipeline_id FROM pipeline_stages ps
     JOIN pipelines p ON p.id = ps.pipeline_id
     WHERE p.key = $1 AND ps.key = $2 AND p.org_id = $3 AND ps.org_id = $3
     LIMIT 1`,
    [pipelineKey, stageKey, orgId]
  );
  const row = stage.rows[0];
  if (!row) return { moved: false, reason: "stage_not_found" };

  if (pipelineKey === "sales" && stageKey === "closed_won") {
    const paid = await db.query(
      `SELECT 1 FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id AND s.org_id = sp.org_id
       JOIN products p ON p.id = s.product_id AND p.org_id = s.org_id
       WHERE s.org_id = $1 AND s.client_id = $2
         AND s.status = 'active' AND p.code = 'card-stacking-dfy'
         AND sp.kind = 'deposit' AND sp.amount > 0
       LIMIT 1`,
      [orgId, clientId]
    );
    if (!paid.rows[0]) {
      return { moved: false, reason: "deposit_payment_required", message: "A paid funding deposit is required for Closed Won." };
    }
  }

  let resolvedFunded = null;
  let resolvedApproved = approvedAmount != null ? Number(approvedAmount) : null;
  let resolvedRoundNumber = roundNumber != null ? Number(roundNumber) : null;

  // Funding document / new-negative gates block later stages, not Closed /
  // Action Required, and not Apply Now — staff MOVE onto that column is the job.
  const allowedWhileHeld = stageKey === "closed" || stageKey === "action_required" || stageKey === "apply_now";
  if (pipelineKey === CARD_STACKING_PIPELINE && !allowedWhileHeld) {
    const hold = await db.query(
      `SELECT custom_fields FROM clients WHERE id = $1 LIMIT 1`,
      [clientId]
    );
    const reason = hold.rows[0]?.custom_fields?.round_hold_reason;
    if (isBlockingFundingHold(reason)) {
      return {
        moved: false,
        reason: "funding_gate_closed",
        message: `Funding is paused (${reason}). Clear the gate before moving this card.`
      };
    }
  }

  // Hard guard BEFORE the card moves — never park a card on funded with no dollars.
  if (pipelineKey === CARD_STACKING_PIPELINE && stageKey === "funded") {
    const guard = await guardFundedAmount(db, {
      orgId,
      clientId,
      fundedAmount,
      approvedAmount,
      roundNumber: resolvedRoundNumber
    });
    if (!guard.ok) {
      return {
        moved: false,
        reason: guard.reason,
        message: guard.message,
        suggestedFundedAmount: guard.suggestedFundedAmount ?? null,
        // Which banks are still blank, so the screen can name them.
        missingApprovals: guard.missingApprovals ?? null,
        missingApprovalBanks: guard.missingApprovalBanks ?? null
      };
    }
    resolvedFunded = guard.fundedAmount;
    if (resolvedApproved == null && guard.approvedAmount != null) {
      resolvedApproved = guard.approvedAmount;
    }
    if (guard.round && resolvedRoundNumber == null) {
      resolvedRoundNumber = Number(guard.round.round_number);
    }
  }

  const existing = await db.query(
    `SELECT id FROM cards WHERE client_id = $1 AND pipeline_id = $2 LIMIT 1`,
    [clientId, row.pipeline_id]
  );
  let created = false;
  if (existing.rows[0]) {
    await db.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`, [existing.rows[0].id, row.stage_id]);
  } else {
    await db.query(
      `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id, pipeline_id) DO UPDATE SET stage_id = EXCLUDED.stage_id`,
      [orgId, clientId, row.pipeline_id, row.stage_id]
    );
    created = true;
  }

  let roundEvent = null;
  if (pipelineKey === CARD_STACKING_PIPELINE && eventForStage(stageKey)) {
    try {
      // Dynamic import avoids cards ↔ register-all ↔ inquiry-gate ↔ cards cycle.
      const { ensureRegistered } = await import("../register-all.mjs");
      ensureRegistered();
      roundEvent = await emitCardStackingRoundTransition(db, {
        orgId,
        clientId,
        stageKey,
        roundNumber: resolvedRoundNumber,
        approvedAmount: resolvedApproved,
        fundedAmount: resolvedFunded ?? (fundedAmount != null ? Number(fundedAmount) : null)
      });
    } catch (err) {
      // Card position is already correct — never undo the move for an emit failure.
      console.warn(
        `[cards] card_stacking emit failed after move ` +
        `(client=${clientId} stage=${stageKey}): ${String(err?.message || err).slice(0, 200)}`
      );
      roundEvent = { emitted: false, reason: "emit_failed", error: String(err?.message || err) };
    }
  }

  return {
    moved: true,
    created,
    fundedAmount: resolvedFunded,
    roundEvent
  };
}

/**
 * Move a card forward only. Uses pipeline_stages.sort_order so a later
 * webhook (entry after book, mid-survey after complete) cannot shove the
 * card backward on the board.
 */
export async function advanceCardToStage(db, {
  orgId,
  clientId,
  pipelineKey,
  stageKey,
  allowRebookFromLost = false,
  ...rest
} = {}) {
  if (!orgId) return { moved: false, reason: "org_required" };
  if (!clientId) return { moved: false, reason: "client_required" };

  const target = await db.query(
    `SELECT ps.id AS stage_id, ps.pipeline_id, ps.sort_order
       FROM pipeline_stages ps
       JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE p.key = $1 AND ps.key = $2 AND p.org_id = $3 AND ps.org_id = $3
      LIMIT 1`,
    [pipelineKey, stageKey, orgId]
  );
  const targetRow = target.rows[0];
  if (!targetRow) return { moved: false, reason: "stage_not_found" };

  const current = await db.query(
    `SELECT ps.key AS stage_key, ps.sort_order
       FROM cards c
       JOIN pipeline_stages ps ON ps.id = c.stage_id
       JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.client_id = $1 AND p.key = $2 AND p.org_id = $3
      LIMIT 1`,
    [clientId, pipelineKey, orgId]
  );
  const cur = current.rows[0];
  if (cur && Number(cur.sort_order) >= Number(targetRow.sort_order) &&
      !(allowRebookFromLost && pipelineKey === "sales" && stageKey === "booked" && cur.stage_key === "lost")) {
    return {
      moved: false,
      reason: "already_at_or_past",
      stageKey: cur.stage_key
    };
  }

  return moveCardToStage(db, { orgId, clientId, pipelineKey, stageKey, ...rest });
}
