// Adapter inside the existing hourly ladder; eligibility precedes its durable
// claim and is rechecked before queueing.
// No new clock, rung, provider, model call or parallel client-message path.
import { sendTemplated } from "../workflows/messaging.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import { BLUEPRINT_COACH_CODE, prepareBlueprintCoachTurn, blueprintCoachReminder } from "./coach.mjs";
import { channelCompatible } from "../agents/select.mjs";

export const BLUEPRINT_NUDGE_TEMPLATES = Object.freeze({
  "SMS-WAYPOINT-DUE": "SMS-BLUEPRINT-COACH-DUE",
  "EMAIL-WAYPOINT-NUDGE-1": "EMAIL-BLUEPRINT-COACH-NUDGE-1",
  "SMS-WAYPOINT-NUDGE-2": "SMS-BLUEPRINT-COACH-NUDGE-2"
});

export async function blueprintCoachNudgeEligibility(db, spec, {
  isBuyerImpl = isCapitalBlueprintBuyer, fetchContextImpl
} = {}) {
  const { orgId, clientId, channel, templateKey } = spec;
  if (!BLUEPRINT_NUDGE_TEMPLATES[templateKey] || !await isBuyerImpl(db, { orgId, clientId })) {
    return { ok: true, blueprint: false };
  }
  const { rows } = await db.query(
    `SELECT code, status, channel, runtime, agent_class, prompt FROM agents
      WHERE org_id = $1 AND code = $2 LIMIT 1`, [orgId, BLUEPRINT_COACH_CODE]
  );
  const agent = rows[0];
  if (agent?.code !== BLUEPRINT_COACH_CODE || agent.status !== "live"
      || agent.agent_class !== "client_facing" || !channelCompatible(agent.channel, channel)
      || ["bland", "ghl"].includes(agent.runtime) || !agent.prompt?.trim()) {
    return { ok: false, sent: false, retryable: true, reason: "blueprint_coach_not_live" };
  }
  const ready = await prepareBlueprintCoachTurn(db, { orgId, clientId, channel }, {
    isBuyerImpl, ...(fetchContextImpl ? { fetchContextImpl } : {})
  });
  if (!ready.ok) return { ok: false, sent: false, retryable: true, reason: ready.reason };
  const step = ready.context.checklist?.open_step;
  if (!step?.key || step.key !== spec.context?.waypoint?.key) return { ok: false, sent: false, retryable: true, reason: "not_current_client_step" };
  const reminder = blueprintCoachReminder(ready.context);
  if (!reminder) return { ok: false, sent: false, retryable: true, reason: "no_open_client_step" };
  return { ok: true, blueprint: true, step, reminder };
}

export async function sendBlueprintCoachNudge(db, spec, {
  sendTemplatedImpl = sendTemplated, ...deps
} = {}) {
  const eligible = await blueprintCoachNudgeEligibility(db, spec, deps);
  if (!eligible.ok) return eligible;
  if (!eligible.blueprint) return sendTemplatedImpl(db, spec);
  const { step, reminder } = eligible;
  // Still requires a real reviewed template. A missing/draft template is held,
  // never replaced with raw model words or a pretend approved template.
  const result = await sendTemplatedImpl(db, { ...spec, templateKey: BLUEPRINT_NUDGE_TEMPLATES[spec.templateKey],
    context: { ...spec.context, waypoint: { title: step.title, key: step.key },
      coach: { reminder, current_step: step.title, state: step.state, proof_required: step.verify_kind ? "yes" : "no" } } });
  // The template sender returns these before inserting anything. A missing or
  // draft approval must not permanently consume a real client's reminder rung.
  return !result?.sent && ["template_pending", "draft_template"].includes(result?.reason)
    ? { ...result, retryable: true } : result;
}
