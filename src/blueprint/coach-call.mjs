// One contextual AI call after the two existing Blueprint SMS reminders were
// actually accepted, not merely queued. The existing hourly nudge clock owns
// this pass. The same ledger's UNIQUE day/destination caps guard text and voice.
import { prepareBlueprintCoachTurn, blueprintCoachCallTask, BLUEPRINT_COACH_VOICE_CODE } from "./coach.mjs";
import { placeCall, readiness, normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { gate, inQuietHours, QUIET_HOURS_TZ } from "../messaging/gate.mjs";
import { isOptedOut } from "../lib/opt-out.mjs";
import { messagingBlocked } from "../lib/dry-run.mjs";
import { recordDispatch } from "../lib/outbound-calls.mjs";
import { threadMessage } from "../conversations/store.mjs";
import { createTask } from "../lib/create-task.mjs";
import { isSynthetic } from "../messaging/live-fence.mjs";
import { DEFAULTS as OUTBOUND_DEFAULTS } from "../messaging/outbox.mjs";
import { countAgentMessagesToday, normalizeGuardrails } from "../agents/guardrails.mjs";
import { zoneForClient, isDaytime, localDate } from "../nudge/clock.mjs";
import { destinationKey } from "../nudge/destination.mjs";
import { blockersFor } from "../nudge/exits.mjs";

export const BLUEPRINT_CALL_STEP = 5;
export const BLUEPRINT_CALL_WORKFLOW = "blueprint-coach-call";
export const BLUEPRINT_CALL_EXCEPTION_SOURCE = BLUEPRINT_CALL_WORKFLOW;
export const blueprintCallKey = (waypointId) => `${BLUEPRINT_CALL_WORKFLOW}:${waypointId}`;

async function outboundCallSettings(db, orgId) {
  // Reuse the existing missing-row defaults, but never treat a failed read as
  // permission to dial. settingsFor's legacy error fallback is not suitable
  // for a call that cannot be recalled.
  const { rows } = await db.query(`SELECT outbound_enabled,daily_send_cap FROM messaging_settings
    WHERE org_id=$1::uuid LIMIT 1`, [orgId]);
  return { ...OUTBOUND_DEFAULTS, ...rows[0] };
}

// $1 optional org; $2 evaluation time. The receipt anti-join excludes claims,
// refusals and accepted calls alike: an uncertain dial may never auto-redial.
export const BLUEPRINT_CALL_ELIGIBILITY_SQL = `
SELECT w.id AS waypoint_id, w.org_id, w.client_id, w.key, w.title,
       first_message.id AS first_message_id, second_message.id AS second_message_id,
       first_message.created_at AS first_text_at, second_message.created_at AS second_text_at
  FROM client_waypoints w
  JOIN clients c ON c.id = w.client_id AND c.org_id = w.org_id
  JOIN waypoint_nudges n1 ON n1.org_id = w.org_id AND n1.client_id = w.client_id
    AND n1.waypoint_id = w.id AND n1.step = 1 AND n1.channel = 'sms'
  JOIN messages first_message ON first_message.id = n1.message_id
    AND first_message.org_id = w.org_id AND first_message.client_id = w.client_id
    AND first_message.direction = 'outbound' AND first_message.channel = 'sms'
    AND first_message.template_key = 'SMS-BLUEPRINT-COACH-DUE'
    AND first_message.status IN ('sent', 'delivered') AND first_message.provider NOT IN ('internal', 'memory')
    AND NULLIF(btrim(first_message.provider_message_id), '') IS NOT NULL
  JOIN waypoint_nudges n3 ON n3.org_id = w.org_id AND n3.client_id = w.client_id
    AND n3.waypoint_id = w.id AND n3.step = 3 AND n3.channel = 'sms'
  JOIN messages second_message ON second_message.id = n3.message_id
    AND second_message.org_id = w.org_id AND second_message.client_id = w.client_id
    AND second_message.direction = 'outbound' AND second_message.channel = 'sms'
    AND second_message.template_key = 'SMS-BLUEPRINT-COACH-NUDGE-2'
    AND second_message.status IN ('sent', 'delivered') AND second_message.provider NOT IN ('internal', 'memory')
    AND NULLIF(btrim(second_message.provider_message_id), '') IS NOT NULL
 WHERE ($1::uuid IS NULL OR w.org_id = $1::uuid)
   AND w.owner_kind = 'client' AND w.state IN ('not_started', 'in_progress')
   AND w.completed_at IS NULL AND w.due_at <= $2::timestamptz
   AND second_message.id <> first_message.id
   AND second_message.provider_message_id <> first_message.provider_message_id
   AND second_message.created_at >= first_message.created_at
   AND w.updated_at <= first_message.created_at
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.custom_fields->>'synthetic', 'false') <> 'true'
   AND NOT EXISTS (SELECT 1 FROM client_waypoints prior
     WHERE prior.org_id = w.org_id AND prior.client_id = w.client_id
       AND prior.owner_kind = 'client' AND prior.state NOT IN ('done', 'skipped')
       AND (prior.position, prior.key) < (w.position, w.key))
   AND EXISTS (SELECT 1 FROM transactions t
     JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
     WHERE t.org_id = w.org_id AND t.client_id = w.client_id
       AND lower(p.code) = 'consulting-package'
       AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded')
   AND EXISTS (SELECT 1 FROM v_client_entitlements e
     WHERE e.org_id = w.org_id AND e.client_id = w.client_id
       AND e.entitlement_code = 'credit-optimization-roadmap' AND e.active)
   AND NOT EXISTS (SELECT 1 FROM messages reply
     WHERE reply.org_id = w.org_id AND reply.client_id = w.client_id
       AND reply.direction = 'inbound' AND reply.created_at >= first_message.created_at)
   AND NOT EXISTS (SELECT 1 FROM conversations cv
     WHERE cv.org_id = w.org_id AND cv.client_id = w.client_id
       AND (cv.agent_halted_at IS NOT NULL OR NULLIF(btrim(cv.agent_code), '')
         NOT IN ('BP-COACH', 'BP-COACH-VOICE')))
   AND NOT EXISTS (SELECT 1 FROM waypoint_nudges called
     WHERE called.org_id = w.org_id AND called.waypoint_id = w.id AND called.step = 5)`;

export async function planBlueprintCoachCalls(db, { orgId = null, now = new Date(), limit = 200 } = {}) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return [];
  const { rows } = await db.query(`${BLUEPRINT_CALL_ELIGIBILITY_SQL}
    ORDER BY second_message.created_at, w.id LIMIT $3`, [orgId, at.toISOString(), Math.max(1, Math.min(Number(limit) || 200, 200))]);
  return rows;
}

async function currentCandidate(db, candidate, now, claimId = null) {
  const ownClaimAllowed = BLUEPRINT_CALL_ELIGIBILITY_SQL.replace(
    "AND called.step = 5)", "AND called.step = 5 AND called.id IS DISTINCT FROM $4::uuid)");
  const { rows } = await db.query(`${ownClaimAllowed}
    AND w.id = $3::uuid LIMIT 1`, [candidate.org_id, now.toISOString(), candidate.waypoint_id, claimId]);
  return rows[0] || null;
}

async function exception(db, candidate, claimId, detail, createTaskImpl) {
  const task = await createTaskImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id,
    assigneeRole: "csm", sourceWorkflow: BLUEPRINT_CALL_EXCEPTION_SOURCE,
    title: "Check the Blueprint AI coach call before trying again",
    eventId: blueprintCallKey(candidate.waypoint_id),
    detail: `Call receipt: ${claimId}. ${detail}. Check the saved provider receipt; do not automatically redial.` });
  return task;
}

export async function deliverBlueprintCoachCall(db, candidate, {
  now = new Date(), deliveryNow = null, env = process.env, fetchImpl,
  prepareTurnImpl = prepareBlueprintCoachTurn, gateImpl = gate,
  isOptedOutImpl = isOptedOut, readinessImpl = readiness, blockersForImpl = blockersFor,
  placeCallImpl = placeCall, recordDispatchImpl = recordDispatch,
  threadMessageImpl = threadMessage, createTaskImpl = createTask,
  currentCandidateImpl = currentCandidate
} = {}) {
  const at = new Date(now);
  const skip = (reason) => ({ placed: false, reason, waypointId: candidate.waypoint_id });
  if (!candidate?.waypoint_id || !candidate.org_id || !candidate.client_id || Number.isNaN(at.getTime())) return skip("missing_call_scope");
  if (!await currentCandidateImpl(db, candidate, at)) return skip("call_sequence_changed");
  const blockers = await blockersForImpl(db, { waypointId: candidate.waypoint_id, now: at });
  if (blockers.length) return skip(blockers[0]);
  const client = (await db.query(`SELECT id, org_id, phone, dnd_voice, is_demo, custom_fields FROM clients
    WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [candidate.client_id, candidate.org_id])).rows[0];
  if (!client) return skip("client_missing");
  if (client.dnd_voice || client.is_demo || isSynthetic(client)) return skip(client.dnd_voice ? "dnd_voice" : "synthetic_client");
  if (await isOptedOutImpl(db, candidate.client_id, "voice") || await isOptedOutImpl(db, candidate.client_id, "sms")) return skip("opted_out");
  const phone = normalizePhone(client.phone);
  const destination = destinationKey("sms", phone); // voice and SMS share the same phone cap.
  if (!phone || !destination) return skip("no_phone");
  const { zone } = zoneForClient(client);
  if (!isDaytime(at, zone) || inQuietHours(at, QUIET_HOURS_TZ)) return skip("quiet_hours");
  const settings = await outboundCallSettings(db, candidate.org_id);
  if (!settings.outbound_enabled) return skip("outbound_paused");
  if (settings.daily_send_cap > 0) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM messages
      WHERE org_id = $1::uuid AND direction = 'outbound' AND status IN ('sent', 'delivered')
        AND created_at >= date_trunc('day', $2::timestamptz)`, [candidate.org_id, at.toISOString()]);
    if (Number(rows[0]?.n || 0) >= settings.daily_send_cap) return skip("org_daily_cap");
  }
  const agent = (await db.query(`SELECT code, name, status, channel, agent_class, runtime, prompt, guardrails
    FROM agents WHERE org_id = $1::uuid AND code = $2 LIMIT 1`, [candidate.org_id, BLUEPRINT_COACH_VOICE_CODE])).rows[0];
  if (agent?.agent_class !== "client_facing" || agent.channel !== "voice") return skip("voice_agent_not_ready");
  const configured = readinessImpl(agent, env);
  if (!configured.ok) return skip(configured.reason || "voice_agent_not_ready");
  if (messagingBlocked(env)) return skip("messaging_dry_run");
  const cap = normalizeGuardrails(agent.guardrails).authority.msgcap;
  if (cap > 0 && await countAgentMessagesToday(db, { orgId: candidate.org_id, clientId: candidate.client_id, agentCode: agent.code, now: at }) >= cap) return skip("agent_daily_cap");
  const ready = await prepareTurnImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id, channel: "voice" });
  if (!ready.ok) return skip(ready.reason);
  if (ready.context.checklist?.open_step?.key !== candidate.key) return skip("not_current_client_step");
  let task = blueprintCoachCallTask(agent, ready.context);
  if (!task) return skip("voice_context_not_ready");
  const verdict = await gateImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id, channel: "voice", body: task }, { now: () => at });
  if (verdict.state !== "allowed") return skip(`gate_${verdict.state}`);
  // Recheck after all asynchronous preparation, immediately before the atomic
  // claim. A reply, saved progress or step change abandons the old escalation.
  if (!await currentCandidateImpl(db, candidate, at)) return skip("call_sequence_changed");
  const key = blueprintCallKey(candidate.waypoint_id);
  const claimId = (await db.query(`INSERT INTO waypoint_nudges
    (org_id,client_id,waypoint_id,step,kind,channel,template_key,outcome,
      idempotency_key,client_local_date,client_time_zone,destination_key)
    VALUES ($1,$2,$3,5,'voice_call','voice',$4,'claimed',$5,$6::date,$7,$8)
    ON CONFLICT DO NOTHING RETURNING id`, [candidate.org_id, candidate.client_id, candidate.waypoint_id,
    BLUEPRINT_COACH_VOICE_CODE, key, localDate(at, zone), zone, destination])).rows[0]?.id;
  if (!claimId) return skip("call_or_daily_cap_claimed");
  const release = async (reason) => {
    await db.query(`DELETE FROM waypoint_nudges WHERE id = $1 AND step = 5
      AND kind = 'voice_call' AND outcome = 'claimed' AND message_id IS NULL`, [claimId]);
    return skip(reason);
  };
  // The eligibility anti-join now sees OUR claim, so recheck only mutable stop
  // conditions via the real gate/context; do not mistake our receipt for a race.
  try {
    if (!await currentCandidateImpl(db, candidate, at, claimId)) return release("call_sequence_changed");
    const latest = await prepareTurnImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id, channel: "voice" });
    const newBlockers = await blockersForImpl(db, { waypointId: candidate.waypoint_id, now: at });
    if (!latest.ok || latest.context.checklist?.open_step?.key !== candidate.key || newBlockers.length) return release(latest.reason || newBlockers[0] || "step_changed");
    if (await isOptedOutImpl(db, candidate.client_id, "voice")) return release("opted_out");
    task = blueprintCoachCallTask(agent, latest.context);
    if (!task) return release("voice_context_not_ready");
    const latestVerdict = await gateImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id, channel: "voice", body: task }, { now: () => at });
    if (latestVerdict.state !== "allowed") return release(`gate_${latestVerdict.state}`);
    const latestAgent = (await db.query(`SELECT code, name, status, channel, agent_class, runtime, prompt, guardrails
      FROM agents WHERE org_id = $1::uuid AND code = $2 LIMIT 1`, [candidate.org_id, BLUEPRINT_COACH_VOICE_CODE])).rows[0];
    if (!readinessImpl(latestAgent, env).ok || latestAgent?.prompt !== agent.prompt
        || latestAgent.agent_class !== "client_facing" || latestAgent.channel !== "voice"
        || JSON.stringify(latestAgent.guardrails) !== JSON.stringify(agent.guardrails)) return release("voice_agent_changed");
    if (!(await outboundCallSettings(db, candidate.org_id)).outbound_enabled) return release("outbound_paused");
    if (await isOptedOutImpl(db, candidate.client_id, "voice") || await isOptedOutImpl(db, candidate.client_id, "sms")) return release("opted_out");
    if (!await currentCandidateImpl(db, candidate, at, claimId)) return release("call_sequence_changed");
    const freshClient = (await db.query(`SELECT id, org_id, phone, dnd_voice, is_demo, custom_fields FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`, [candidate.client_id, candidate.org_id])).rows[0];
    if (!freshClient) return release("client_missing");
    if (freshClient.dnd_voice || freshClient.is_demo || isSynthetic(freshClient)) return release(freshClient.dnd_voice ? "dnd_voice" : "synthetic_client");
    const freshPhone = normalizePhone(freshClient.phone);
    const freshDestination = destinationKey("sms", freshPhone);
    const freshZone = zoneForClient(freshClient).zone;
    // Never dial the old number, nor a replacement number against a cap that
    // was reserved for another destination or local day. The next pass uses
    // the fresh client record and makes its own new atomic claim.
    if (freshPhone !== phone || freshDestination !== destination || freshZone !== zone) return release("call_contact_changed");
    const sendAt = typeof deliveryNow === "function" ? new Date(deliveryNow()) : at;
    if (!isDaytime(sendAt, zone) || inQuietHours(sendAt, QUIET_HOURS_TZ)) return release("quiet_hours");
    // A day that changed while preparing must be claimed afresh by the next
    // pass. Never put a call against yesterday's daily allowance.
    if (localDate(sendAt, zone) !== localDate(at, zone)) return release("call_day_changed");
  } catch {
    return release("call_preflight_failed"); // No provider was called.
  }
  let result;
  try {
    result = await placeCallImpl({ agent: { ...agent, prompt: task }, phone, clientId: candidate.client_id,
      metadata: { org_id: candidate.org_id, source: BLUEPRINT_CALL_WORKFLOW, waypoint_id: candidate.waypoint_id }, env, fetchImpl });
  } catch {
    result = { status: "failed", reason: "provider_result_unknown" };
  }
  if (result?.blocked === true) return release("messaging_fence_held");
  if (result?.status !== "sent" || !result.callId) {
    const reason = result?.reason || "provider_result_unknown";
    await db.query(`UPDATE waypoint_nudges SET detail = $2 WHERE id = $1 AND outcome = 'claimed'`, [claimId, `call_uncertain:${reason}`]);
    await exception(db, candidate, claimId, reason, createTaskImpl);
    return { ...skip(reason), failed: true, claimId };
  }
  // From here the phone may be ringing. No error can release this receipt.
  try {
    await db.query(`UPDATE waypoint_nudges SET detail = $2 WHERE id = $1`, [claimId, `accepted:${result.callId}`]);
    await recordDispatchImpl({ callId: result.callId, clientId: candidate.client_id, orgId: candidate.org_id, kind: BLUEPRINT_CALL_WORKFLOW, db });
    const attribution = (await db.query(`SELECT org_id,client_id FROM outbound_calls WHERE call_id=$1 LIMIT 1`, [result.callId])).rows[0];
    if (attribution?.org_id !== candidate.org_id || attribution?.client_id !== candidate.client_id) throw new Error("voice_dispatch_scope_mismatch");
    const message = (await db.query(`INSERT INTO messages
      (org_id,client_id,direction,channel,rendered_body,provider,provider_ref,provider_message_id,status,
        compliance_check_passed,sender_kind,sender_agent_code,last_attempt_at)
      VALUES ($1,$2,'outbound','voice',$3,'bland',$4,$5,'sent',true,'agent',$6,$7)
      ON CONFLICT (org_id,provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING RETURNING id`,
    [candidate.org_id, candidate.client_id, `Fundhub AI coach call started for the saved current step: ${candidate.title}.`, key, result.callId, agent.code, at.toISOString()])).rows[0];
    if (!message?.id) throw new Error("voice_receipt_not_saved");
    await threadMessageImpl(db, { orgId: candidate.org_id, clientId: candidate.client_id, channel: "voice", messageId: message.id, createdAt: at, source: BLUEPRINT_CALL_WORKFLOW });
    const resolved = await db.query(`UPDATE waypoint_nudges SET outcome='queued',message_id=$2,detail=$3
      WHERE id=$1 AND outcome='claimed' RETURNING id`, [claimId, message.id, `accepted:${result.callId}`]);
    if (!resolved.rows[0]) throw new Error("voice_claim_not_resolved");
    return { placed: true, waypointId: candidate.waypoint_id, claimId, messageId: message.id, callId: result.callId };
  } catch {
    await exception(db, candidate, claimId, `Accepted call ${result.callId}; finish saving its attribution`, createTaskImpl);
    return { placed: true, failed: true, reason: "call_attribution_incomplete", waypointId: candidate.waypoint_id, claimId, callId: result.callId };
  }
}

export async function runBlueprintCoachCalls(db, { orgId = null, now = new Date(), limit = 200, step = null, deliveryNow = null, ...deps } = {}) {
  const result = { considered: 0, placed: 0, skipped: 0, failed: 0, results: [] };
  const durable = (name, run) => typeof step?.run === "function" ? step.run(name, run) : run();
  // Catch database/business errors INSIDE the durable callback. Inngest's
  // yielding/retry control flow outside that callback must reach its SDK.
  const planned = await durable("blueprint-coach-call-plan", async () => {
    try { return { ok: true, candidates: await planBlueprintCoachCalls(db, { orgId, now, limit }) }; }
    catch { return { ok: false, candidates: [] }; }
  });
  if (!planned.ok) return { ...result, failed: 1, reason: "call_plan_failed" };
  result.considered = planned.candidates.length;
  for (const candidate of planned.candidates) {
    const call = await durable(`blueprint-coach-call:${candidate.waypoint_id}`, async () => {
      try {
        const callAt = typeof deliveryNow === "function" ? new Date(deliveryNow()) : now;
        return await deliverBlueprintCoachCall(db, candidate, { now: callAt, deliveryNow, ...deps });
      } catch { return { placed: false, failed: true, reason: "call_check_failed", waypointId: candidate.waypoint_id }; }
    });
    result.results.push(call);
    if (call.placed) result.placed += 1;
    else result.skipped += 1;
    if (call.failed) result.failed += 1;
  }
  return result;
}
