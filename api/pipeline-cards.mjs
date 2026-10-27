// POST /api/pipeline-cards — move a client card to a stage (and optionally a
// different pipeline).
//
//   { action: "move", client_id, pipeline_key, stage_key }
//
// This is the write half of the Pipeline board. Drag and MOVE used to rearrange
// DOM nodes and stash positions in sessionStorage — a reload put every card
// back. The helper that actually updates cards.stage_id already existed
// (src/workflows/cards.mjs moveCardToStage); this endpoint is the HTTP face.
//
// Shift-gated: the owner rule names "moving a pipeline stage" as a write that
// needs an open shift (see api/tasks.mjs and requireActiveShift.mjs).
//
// Org from the session. The client must belong to that org. Nothing transmits.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { requireRole, ROLE_SETS, isUuid } from "../src/http/read-api.mjs";
import { moveCardToStage } from "../src/workflows/cards.mjs";
import { dbDown } from "../src/http/db-down.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "Moving a card is a save request, not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // requireAuth already attached req.staff. Owners are exempt — they do not
  // clock in (owner decision 2026-08-02, same as inquiries/messages).
  const shift = await requireActiveShift(req, res, { db, exempt: SUPER_ROLES });
  if (!shift) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "move").trim().toLowerCase();
  if (action !== "move") {
    return res.status(400).json({
      ok: false, error: "unknown_action",
      message: "Unknown action. Use move."
    });
  }

  if (!isUuid(body.client_id)) {
    return res.status(400).json({
      ok: false, error: "invalid_client_id",
      message: "client_id must be a client id."
    });
  }
  const pipelineKey = String(body.pipeline_key || "").trim();
  const stageKey = String(body.stage_key || "").trim();
  if (!pipelineKey || !stageKey) {
    return res.status(400).json({
      ok: false, error: "stage_required",
      message: "Send pipeline_key and stage_key for the destination column."
    });
  }

  try {
    const owned = await db.query(
      `SELECT id FROM clients WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [body.client_id, orgId]
    );
    if (!owned.rows[0]) {
      return res.status(404).json({
        ok: false, error: "not_found",
        message: "No client with that id in your company."
      });
    }

    const numOrNull = (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Cross-rail MOVE is a hand-off, not a copy. Without this the client kept
    // the old rail's card (Sales / Survey Complete) while also showing on the
    // destination rail, so one person sat open on two boards.
    const fromPipelineKey = String(
      body.from_pipeline_key || body.fromPipelineKey || ""
    ).trim();

    const result = await moveCardToStage(db, {
      orgId,
      clientId: String(body.client_id).trim(),
      pipelineKey,
      stageKey,
      approvedAmount: numOrNull(body.approved_amount ?? body.approvedAmount),
      fundedAmount: numOrNull(body.funded_amount ?? body.fundedAmount),
      roundNumber: numOrNull(body.round_number ?? body.roundNumber)
    });

    if (!result.moved) {
      if (result.reason === "deposit_payment_required") {
        return res.status(400).json({
          ok: false,
          error: "deposit_payment_required",
          message: result.message
        });
      }
      if (result.reason === "funded_amount_required") {
        return res.status(400).json({
          ok: false,
          error: "funded_amount_required",
          message: result.message ||
            "Cannot move to funded without funded_amount greater than zero.",
          suggested_funded_amount: result.suggestedFundedAmount ?? null
        });
      }
      /* A bank yes with no dollar amount on it blocks the round, because that
         approval would never be billed. This is a refusal, not a missing
         stage — 400, with the banks named so the answer is actionable. */
      if (result.reason === "approval_amounts_missing") {
        return res.status(400).json({
          ok: false,
          error: "approval_amounts_missing",
          message: result.message ||
            "Cannot move to funded while a bank approval has no dollar amount.",
          missing_approvals: result.missingApprovals ?? [],
          missing_approval_banks: result.missingApprovalBanks ?? []
        });
      }
      return res.status(404).json({
        ok: false,
        error: result.reason || "stage_not_found",
        message: result.message || "That pipeline stage was not found."
      });
    }

    let clearedFrom = false;
    if (fromPipelineKey && fromPipelineKey !== pipelineKey) {
      const cleared = await db.query(
        `DELETE FROM cards
           WHERE client_id = $1::uuid
             AND org_id = $2::uuid
             AND pipeline_id = (
               SELECT id FROM pipelines
                WHERE key = $3 AND org_id = $2::uuid LIMIT 1
             )`,
        [String(body.client_id).trim(), orgId, fromPipelineKey]
      );
      clearedFrom = (cleared.rowCount || 0) > 0;
    }

    return res.status(200).json({
      ok: true,
      action: "move",
      cleared_from_pipeline: clearedFrom,
      client_id: String(body.client_id).trim(),
      pipeline_key: pipelineKey,
      stage_key: stageKey,
      created: !!result.created,
      funded_amount: result.fundedAmount ?? null,
      round_event: result.roundEvent
        ? {
            event: result.roundEvent.eventName || null,
            deduped: !!result.roundEvent.deduped,
            round_number: result.roundEvent.roundNumber ?? null
          }
        : null
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
