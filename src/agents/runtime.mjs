// Agent runtime — the module that makes registry agents converse.
//
// Trigger: message.inbound (registered alongside the comms writer). The inbound
// message is already persisted by onMessageInbound before this runs; failures
// here must never lose that row (catch-all at the bottom).
//
// Pipeline:
//   select agent → respect status (draft=noop, shadow=log only, live=send)
//   → opt-out short-circuit → guardrail inbound check → fetch context
//   → call model (shadow if no ANTHROPIC_API_KEY) → guardrail outbound check
//   → composeAgentReply → dispatchMessage → gate (quiet hours / opt-out / words)
//
// Never bypasses the messaging gate. Agent sends always use sender_kind='agent'.

import { on } from "../events/registry.mjs";
import { isOptedOut } from "../lib/opt-out.mjs";
import { selectAgent } from "./select.mjs";
import { fetchContext } from "./context.mjs";
import {
  checkInbound, checkOutbound, countAgentMessagesToday, haltConversation
} from "./guardrails.mjs";
import { callModel } from "./model.mjs";
import { composeAgentReply } from "./reply.mjs";
import { recordShadow, recordRun } from "./shadow-log.mjs";
import {
  BLUEPRINT_COACH_CODE, prepareBlueprintCoachTurn, parseBlueprintCoachReply,
  applyBlueprintCoachAction, blueprintCoachQuestion
} from "../blueprint/coach.mjs";

/**
 * handleInbound(event, db, options?) — core entry. Exported for tests.
 * Never throws to the bus: every failure is logged / shadowed.
 */
export async function handleInbound(event, db, options = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    callModelFn = callModel,
    dispatchOptions = {}
  } = options;

  /* ONE RECORDING POINT, AT THE BOUNDARY. run() has a dozen early returns and
     they all pass through here, so every outcome is recorded exactly once
     without threading a recorder through the pipeline. recordRun never throws —
     see its header — so this cannot cost anybody their reply. */
  try {
    const outcome = await run(event, db, { env, fetchImpl, now, callModelFn, dispatchOptions });
    await noteRun(db, event, outcome);
    return outcome;
  } catch (err) {
    console.error(
      `[agent-runtime] failed for event ${event && event.id}: ${err && err.message}`
    );
    const failed = {
      ok: false, reason: "runtime_error",
      detail: String(err && err.message || err).slice(0, 300)
    };
    await noteRun(db, event, failed);
    return failed;
  }
}

/** Flatten whatever run() returned into one agent_runs row. */
async function noteRun(db, event, outcome) {
  const p = (event && event.payload) || {};
  await recordRun(db, {
    orgId: event && event.orgId,
    agentCode: outcome && outcome.agent ? outcome.agent : null,
    clientId: (event && event.clientId) || null,
    triggerEvent: (event && event.name) || "message.inbound",
    eventId: (event && event.id) || null,
    channel: p.channel || null,
    outcome: (outcome && outcome.reason) || "unknown",
    detail: (outcome && outcome.detail) || null,
    sentMessageId: (outcome && outcome.messageId) || null
  });
}

async function run(event, db, { env, fetchImpl, now, callModelFn, dispatchOptions }) {
  const p = event.payload || {};
  const channel = p.channel || "sms";
  const orgId = event.orgId;
  const clientId = event.clientId || null;
  const body = p.body || "";
  const inboundRef = p.sid || null;

  if (!orgId || !clientId) {
    return { ok: true, reason: "no_client" };
  }
  if (channel !== "sms" && channel !== "email") {
    return { ok: true, reason: "unsupported_channel" };
  }

  // Resolve the inbound message id (for shadow log linkage) and conversation.
  let inboundMessageId = null;
  let conversationId = null;
  if (inboundRef) {
    const { rows } = await db.query(
      `SELECT id, conversation_id FROM messages
        WHERE org_id = $1 AND provider_ref = $2 AND client_id = $3 LIMIT 1`,
      [orgId, inboundRef, clientId]
    );
    inboundMessageId = rows[0]?.id || null;
    conversationId = rows[0]?.conversation_id || null;
  }
  if (!conversationId) {
    const { rows } = await db.query(
      `SELECT id FROM conversations
        WHERE org_id = $1 AND client_id = $2 AND channel = $3
          AND COALESCE(kind, 'client') = 'client'
        LIMIT 1`,
      [orgId, clientId, channel]
    );
    conversationId = rows[0]?.id || null;
  }

  const selected = await selectAgent(db, { orgId, clientId, channel, conversationId });
  if (!selected.agent) {
    return { ok: true, reason: selected.reason, detail: selected.detail || null };
  }

  const agent = selected.agent;
  conversationId = selected.conversationId || conversationId;

  // status='draft' — do nothing.
  if (agent.status === "draft" || agent.status === "retired") {
    return { ok: true, reason: "draft", agent: agent.code };
  }

  // Opt-out: do not call the model, do not send. Gate would also block, but
  // skipping the model call is cheaper and clearer in the shadow log.
  if (await isOptedOut(db, clientId, channel)) {
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: null, reason: "opted_out"
    });
    return { ok: true, reason: "opted_out", agent: agent.code };
  }

  const outboundToday = await countAgentMessagesToday(db, {
    orgId, clientId, agentCode: agent.code, now: now()
  });

  const inboundCheck = checkInbound({
    body,
    guardrails: agent.guardrails,
    prompt: agent.prompt,
    agentOutboundCountToday: outboundToday
  });

  if (!inboundCheck.ok) {
    if (inboundCheck.halt && conversationId) {
      await haltConversation(db, {
        conversationId,
        reason: inboundCheck.detail || inboundCheck.reason
      });
    }
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: null,
      reason: inboundCheck.halt ? "guardrail_halt" : inboundCheck.reason,
      contextSnapshot: { detail: inboundCheck.detail }
    });
    return {
      ok: true,
      reason: inboundCheck.reason,
      halted: !!inboundCheck.halt,
      agent: agent.code
    };
  }

  const coachTurn = agent.code === BLUEPRINT_COACH_CODE
    ? await prepareBlueprintCoachTurn(db, { orgId, clientId, conversationId, channel }) : null;
  if (coachTurn && !coachTurn.ok) return { ok: true, reason: coachTurn.reason, agent: agent.code };
  const context = coachTurn?.context || await fetchContext(db, { orgId, clientId, conversationId, channel });

  const system = [
    agent.prompt || "",
    coachTurn?.instructions || "",
    "",
    "---",
    context.as_prompt_block,
    "",
    agent.from_name ? `Sign messages as: ${agent.from_name}` : "",
    agent.booking_enabled ? "Booking is enabled for this agent." : "Booking is OFF for this agent.",
    agent.guardrails && typeof agent.guardrails === "object" && agent.guardrails.block
      ? `HARD GUARDRAILS:\n${agent.guardrails.block}`
      : ""
  ].filter(Boolean).join("\n");

  const user = channel === "email" && p.subject
    ? `Subject: ${p.subject}\n\n${body}`
    : String(body || "");

  const modelResult = await callModelFn({
    system, user, env, fetchImpl,
    ...(coachTurn ? { maxTokens: 128, timeoutMs: 8000, signal: AbortSignal.timeout(8000) } : {})
  });

  // Keyless OR status=shadow → log, send nothing.
  const forceShadow = agent.status === "shadow" || modelResult.mode === "shadow";

  if (modelResult.error && !modelResult.text) {
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: null,
      contextSnapshot: { summary: context.conversation?.summary || null },
      modelRequest: modelResult.request,
      reason: "model_error"
    });
    return { ok: true, reason: "model_error", detail: modelResult.error, agent: agent.code };
  }

  if (forceShadow) {
    const reason = agent.status === "shadow" ? "shadow_status"
      : (modelResult.mode === "shadow" ? "no_api_key" : "shadow_status");
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: modelResult.text,
      contextSnapshot: {
        summary: context.conversation?.summary || null,
        snapshot: context.snapshot,
        survey: context.survey
      },
      modelRequest: modelResult.request,
      reason
    });
    return {
      ok: true,
      reason,
      agent: agent.code,
      shadowed: true,
      wouldSend: modelResult.text
    };
  }

  if (!modelResult.text) {
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: null, modelRequest: modelResult.request,
      reason: "model_error"
    });
    return { ok: true, reason: "empty_model_reply", agent: agent.code };
  }

  if (coachTurn && modelResult.mode !== "live") return { ok: true, reason: "model_error", agent: agent.code, blocked: true };
  const coachReply = coachTurn ? parseBlueprintCoachReply(modelResult.text) : null;
  if (coachReply && !coachReply.ok) return { ok: true, reason: coachReply.reason, agent: agent.code, blocked: true };
  let freshCoachTurn = coachTurn;
  if (coachReply) {
    // A reply is a decision about the facts the model saw, not permission to
    // act on an old file after its step, access or human ownership changed.
    const currentSelection = await selectAgent(db, { orgId, clientId, channel, conversationId });
    const currentAgent = currentSelection.agent;
    if (currentAgent?.code !== agent.code || currentAgent.status !== agent.status
        || currentAgent.prompt !== agent.prompt || currentAgent.runtime !== agent.runtime
        || currentAgent.channel !== agent.channel || currentAgent.agent_class !== agent.agent_class
        || JSON.stringify(currentAgent.guardrails) !== JSON.stringify(agent.guardrails)
        || (currentSelection.conversationId || conversationId) !== conversationId) {
      return { ok: true, reason: "blueprint_coach_context_changed", agent: agent.code, blocked: true };
    }
    freshCoachTurn = await prepareBlueprintCoachTurn(db, { orgId, clientId, conversationId, channel });
    if (!freshCoachTurn.ok) return { ok: true, reason: freshCoachTurn.reason, agent: agent.code, blocked: true };
    if (await isOptedOut(db, clientId, channel)) return { ok: true, reason: "opted_out", agent: agent.code, blocked: true };
    const before = coachTurn.context;
    const current = freshCoachTurn.context;
    if (current.as_prompt_block !== before.as_prompt_block
        || JSON.stringify(current.checklist?.open_step) !== JSON.stringify(before.checklist?.open_step)
        || JSON.stringify(current.blueprint?.human_advisor) !== JSON.stringify(before.blueprint?.human_advisor)
        || JSON.stringify(current.client?.flags) !== JSON.stringify(before.client?.flags)
        || current.conversation?.id !== before.conversation?.id
        || current.conversation?.agent_code !== before.conversation?.agent_code
        || current.conversation?.agent_halted_at !== before.conversation?.agent_halted_at) {
      return { ok: true, reason: "blueprint_coach_context_changed", agent: agent.code, blocked: true };
    }
  }
  const coachQuestion = coachReply ? blueprintCoachQuestion(coachReply.intent, freshCoachTurn.context) : null;
  if (coachQuestion && !coachQuestion.ok) return { ok: true, reason: coachQuestion.reason, agent: agent.code, blocked: true };
  let replyBody = coachQuestion?.text || modelResult.text;
  const outboundCheck = checkOutbound({
    draft: replyBody,
    guardrails: agent.guardrails
  });
  if (!outboundCheck.ok) {
    await recordShadow(db, {
      orgId, agentCode: agent.code, clientId, conversationId,
      inboundMessageId, channel, inboundBody: body,
      wouldSendBody: modelResult.text,
      contextSnapshot: { detail: outboundCheck.detail },
      modelRequest: modelResult.request,
      reason: "guardrail_block"
    });
    return {
      ok: true,
      reason: outboundCheck.reason,
      agent: agent.code,
      blocked: true
    };
  }

  if (coachReply?.action) {
    const action = await applyBlueprintCoachAction(db, {
      orgId, clientId, conversationId, channel, eventId: inboundRef || inboundMessageId || event.id,
      inboundBody: String(body), agent
    }, coachReply.action);
    const currentSelection = await selectAgent(db, { orgId, clientId, channel, conversationId });
    if (currentSelection.agent?.code !== agent.code || currentSelection.agent.status !== agent.status
        || currentSelection.agent.prompt !== agent.prompt
        || await isOptedOut(db, clientId, channel)) {
      return { ok: true, reason: "blueprint_coach_context_changed", agent: agent.code, blocked: true };
    }
    const current = await prepareBlueprintCoachTurn(db, { orgId, clientId, conversationId, channel });
    if (!current.ok) return { ok: true, reason: current.reason, agent: agent.code, blocked: true };
    let nextQuestion = coachQuestion.text;
    if (action.ok && action.verification?.completed?.length) {
      // Evidence can advance the checklist. Never ask for proof on the step
      // the real verifier just closed; choose from the newly saved file.
      const next = blueprintCoachQuestion("ask_progress", current.context);
      nextQuestion = next.ok ? next.text : blueprintCoachQuestion("ask_advisor", current.context).text;
    } else if (action.ok) {
      const next = blueprintCoachQuestion(coachReply.intent, current.context);
      nextQuestion = next.ok ? next.text : blueprintCoachQuestion("ask_advisor", current.context).text;
    }
    // A successful write is historical truth; its old "still open" wording
    // is not. A verifier can close the step while this action is finishing.
    const currentStep = current.context.checklist?.open_step;
    const originalStep = freshCoachTurn.context.checklist?.open_step;
    const sameOpenStep = currentStep?.key === originalStep?.key
      && ["not_started", "in_progress", "blocked"].includes(currentStep?.state);
    let acknowledgement = action.message || "";
    if (action.ok && coachReply.action.type === "report_progress") {
      acknowledgement = coachReply.action.state === "blocked"
        ? "Your blocker is saved. A follow-up task is saved for the advisor team."
        : "Your progress note is saved.";
      if (sameOpenStep) acknowledgement += " The step is still open until completion is verified.";
    } else if (action.ok && coachReply.action.type === "verify_progress" && !action.verification?.completed?.length) {
      acknowledgement = "The checklist check found no new completion proof" + (sameOpenStep ? "; the step stays open." : ".");
    } else if (action.ok && coachReply.action.type === "request_advisor") {
      acknowledgement = "A human advisor follow-up task is saved.";
    }
    // Failed writes never inherit the model's claims of success. A partial
    // blocker write is reported honestly instead of pretending it vanished.
    replyBody = action.ok ? `${acknowledgement}\n${nextQuestion}`.trim()
      : action.reason === "blocker_saved_advisor_task_failed"
        ? "Your blocker is saved, but the advisor follow-up could not be saved. Please contact your advisor."
        : "Your request could not be saved. Please try again or contact your advisor.";
    const finalCheck = checkOutbound({ draft: replyBody, guardrails: agent.guardrails });
    if (!finalCheck.ok) return { ok: true, reason: finalCheck.reason, agent: agent.code, blocked: true };
  }

  const reply = await composeAgentReply(db, {
    orgId,
    agentCode: agent.code,
    clientId,
    conversationId,
    channel,
    body: replyBody,
    subject: channel === "email" ? `Re: ${p.subject || "your message"}` : null,
    idempotencyKey: inboundRef || inboundMessageId || `${event.id}`
  }, { ...dispatchOptions, env, now, fetchImpl });

  return {
    ok: true,
    reason: "replied",
    agent: agent.code,
    outcome: reply.outcome,
    messageId: reply.message?.id || null
  };
}

export function register() {
  on("message.inbound", handleInbound);
}

export default handleInbound;
