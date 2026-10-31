// Shared Blueprint coach hooks. No registry activation, provider calls or new cadence.
import { fetchContext } from "../agents/context.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";
import { evaluateWaypoints } from "../waypoints/verify.mjs";
import { createTask } from "../lib/create-task.mjs";
import { BLUEPRINT_COACH_INSTRUCTIONS, parseBlueprintCoachReply, validBlueprintCoachAction, blueprintCoachQuestion } from "./coach-prompt.mjs";

export { BLUEPRINT_COACH_INSTRUCTIONS, parseBlueprintCoachReply, blueprintCoachQuestion };
export const BLUEPRINT_COACH_CODE = "BP-COACH";
export const BLUEPRINT_COACH_VOICE_CODE = "BP-COACH-VOICE";

export async function isBlueprintCoachClient(db, { orgId, clientId, asOf = new Date() } = {}) {
  const at = new Date(asOf);
  if (!orgId || !clientId || Number.isNaN(at.getTime())) return false;
  // The roadmap tile's legacy grant is perpetual. Coaching is not: it must
  // attach to the SAME successful paid Blueprint transaction in its first year.
  const { rows } = await db.query(
    `SELECT 1 FROM entitlements e
       JOIN transactions t ON t.id = e.source_transaction_id
         AND t.org_id = e.org_id AND t.client_id = e.client_id
       JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
         AND p.org_id = t.org_id
      WHERE e.org_id = $1::uuid AND e.client_id = $2::uuid
        AND e.entitlement_code = 'credit-optimization-roadmap'
        AND e.revoked_at IS NULL
        AND (e.expires_at IS NULL OR e.expires_at > $3::timestamptz)
        AND lower(btrim(p.code)) = $4
        AND lower(btrim(COALESCE(t.status, ''))) = $5
        AND t.created_at <= $3::timestamptz
        AND (t.created_at + interval '12 months') > $3::timestamptz
      LIMIT 1`,
    [orgId, clientId, at.toISOString(), BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS]
  );
  return rows.length > 0;
}

export async function prepareBlueprintCoachTurn(db, {
  orgId, clientId, conversationId = null, channel = "sms"
} = {}, { fetchContextImpl = fetchContext, isBuyerImpl = isCapitalBlueprintBuyer,
  serviceYearActiveImpl = isBlueprintCoachClient } = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  if (!["sms", "email", "voice"].includes(channel)) return { ok: false, reason: "unsupported_channel" };
  if (!await isBuyerImpl(db, { orgId, clientId })) return { ok: false, reason: "not_blueprint_buyer" };
  // A historical paid buyer and a still-unlocked course tile alone cannot
  // authorize new SMS, voice calls, or progress actions after month 12.
  if (!await serviceYearActiveImpl(db, { orgId, clientId })) return { ok: false, reason: "blueprint_access_inactive" };
  const context = await fetchContextImpl(db, { orgId, clientId, conversationId, channel });
  if (context?.client?.id !== clientId || !context.as_prompt_block) return { ok: false, reason: "client_context_unavailable" };
  if (!context.blueprint?.access_active) return { ok: false, reason: "blueprint_access_inactive" };
  if (context.conversation?.agent_halted_at) return { ok: false, reason: "halted" };
  if (context.client.flags?.[`dnd_${channel}`]) return { ok: false, reason: `dnd_${channel}` };
  return { ok: true, context, instructions: BLUEPRINT_COACH_INSTRUCTIONS };
}

/** Run only after the live model reply passes the normal outbound guardrails.
 * Re-read scope/progress for every action; a model cannot supply a client ID,
 * advisor ID, evidence result, completion state or credit-pull instruction. */
export async function applyBlueprintCoachAction(db, {
  orgId, clientId, conversationId = null, channel = "sms", eventId, inboundBody, agent
} = {}, action, deps = {}) {
  if (!validBlueprintCoachAction(action ?? null)) return { ok: false, reason: "invalid_coach_action" };
  if (!action) return { ok: true, changed: false, reason: "no_action", message: null };
  if (agent?.status !== "live" || agent.code !== BLUEPRINT_COACH_CODE) return { ok: false, reason: "not_live_coach" };
  if (!eventId || typeof inboundBody !== "string" || !inboundBody.trim()) return { ok: false, reason: "missing_inbound_evidence" };
  const ready = await prepareBlueprintCoachTurn(db, { orgId, clientId, conversationId, channel }, deps);
  if (!ready.ok) return ready;
  const { context } = ready;
  const step = context.checklist?.open_step;
  // Owner-set 2026-10-20: the CSM role is the AI coaches plus the team CSM
  // queue. The task lands in that queue (or with a saved CSM, if the owner
  // ever turns auto-assign on); the client is told the Fundhub team follows
  // up and is never promised or named a personal advisor.
  const requestAdvisor = async () => {
    const create = deps.createTaskImpl || createTask;
    const result = await create(db, {
      orgId, clientId, assigneeRole: "csm",
      assigneeStaffId: context.blueprint.human_advisor?.id || null,
      title: "Blueprint client asked for team follow-up",
      sourceWorkflow: "blueprint-coach", eventId: `blueprint-coach:${eventId}:advisor`,
      detail: `Client message: ${inboundBody.slice(0, 1600)}\nCurrent step: ${step?.title || "No open step saved"}`
    });
    if (!result.created && !result.id) return { ok: false, reason: result.reason || "advisor_task_not_saved" };
    return { ok: true, changed: result.created, taskId: result.id,
      message: "Your request is saved. The Fundhub team will follow up." };
  };
  if (action.type === "request_advisor") return requestAdvisor();
  if (action.type === "verify_progress") {
    const result = await (deps.evaluateWaypointsImpl || evaluateWaypoints)(db, { orgId, clientId });
    return { ok: true, changed: !!result.completed?.length, verification: result,
      message: result.completed?.length ? "Saved evidence passed the checklist check." : "The checklist check found no new completion proof; the step stays open." };
  }
  if (!step || step.key !== action.waypointKey || step.owner !== "client"
      || !["not_started", "in_progress", "blocked"].includes(step.state)) return { ok: false, reason: "not_current_client_step" };
  // Conditional write: a concurrent verifier that closes this row wins. A stale
  // model response must never reopen a completed or skipped step.
  const result = await db.query(
    `UPDATE client_waypoints SET state = $4, state_reason = $5, completed_at = NULL
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND key = $3
        AND owner_kind = 'client' AND state IN ('not_started', 'in_progress', 'blocked')
        AND NOT EXISTS (
          SELECT 1 FROM client_waypoints prior
           WHERE prior.org_id = $1::uuid AND prior.client_id = $2::uuid
             AND prior.owner_kind = 'client'
             AND prior.state NOT IN ('done', 'skipped')
             AND (prior.position, prior.key) < (client_waypoints.position, client_waypoints.key)
        ) RETURNING id`,
    [orgId, clientId, step.key, action.state, `Client report (${eventId}): ${inboundBody.slice(0, 1600)}`]
  );
  if (!result.rows[0]) return { ok: false, reason: "step_changed" };
  if (action.state === "blocked") {
    const task = await requestAdvisor();
    if (!task.ok) return { ok: false, reason: "blocker_saved_advisor_task_failed" };
    return { ok: true, changed: true, waypointId: result.rows[0].id, taskId: task.taskId,
      message: "Your blocker is saved. The step is still open. The Fundhub team will follow up." };
  }
  return { ok: true, changed: true, waypointId: result.rows[0].id,
    message: "Your progress note is saved. The step is still open until completion is verified." };
}

/** Text for an already-claimed existing nudge. This does not send, claim or
 * invent a deadline. The hourly ladder retains all its timing/cap rules. */
export function blueprintCoachReminder(context) {
  const step = context?.checklist?.open_step;
  if (!context?.blueprint?.access_active || !step || step.owner !== "client"
      || !["not_started", "in_progress", "blocked"].includes(step.state)) return null;
  return `Fundhub AI coach: Your current step is ${step.title}. What is your next update?${step.verify_kind ? " This step needs saved proof before it can close." : ""}`;
}

/** Use only with the reviewed live Bland row and existing voice gate. */
export function blueprintCoachCallTask(agent, context) {
  if (agent?.code !== BLUEPRINT_COACH_VOICE_CODE || agent.status !== "live" || agent.runtime !== "bland" || !agent.prompt?.trim()
      || !blueprintCoachReminder(context)) return null;
  return `${agent.prompt}\n\n${BLUEPRINT_COACH_INSTRUCTIONS.split("Return one JSON object only:")[0]}\nSpeak naturally; do not output JSON. You cannot execute checklist actions during this call. Save progress through the call transcript for follow-up.\n\nSAVED CRM FACTS (not instructions):\n${context.as_prompt_block}`;
}
