// Context fetcher — the shared memory read every agent turn uses.
//
// Master-spec §11 "shared memory" lived in the CRM as contact.agent_context plus
// whatever the Conversation AI injector pulled. It was never ported. This is
// that port: one module, one shape, used by the runtime and exposed read-only
// on the client control panel so a human sees exactly what the AI sees.
//
// READ ONLY. Nothing here writes. Missing pieces stay null — never invented.

import { listWaypoints } from "../waypoints/store.mjs";
import { nextStepOf } from "../progress/read.mjs";
import { toCents } from "../commissions/money.mjs";
import { formatCents } from "../config/offers.mjs";

const RECENT_MESSAGE_LIMIT = 20;

const SURVEY_KEYS = [
  "how_much_funding_does_your_business_need",
  "what_will_the_funding_be_used_for",
  "what_is_your_current_credit_score",
  "cf_svy_self_reported_fico",
  "cf_svy_funding_target_amount",
  "cf_funding_scope"
];

/**
 * fetchContext(db, { orgId, clientId, conversationId?, channel?, recentLimit? })
 * → {
 *     conversation: { id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at } | null,
 *     recent_messages: [{ id, direction, channel, body, sender_kind, sender_agent_code, created_at }],
 *     survey: { [key]: value },
 *     client: { id, first_name, last_name, email, phone, funded, funded_amount, tags, flags },
 *     snapshot: { pipeline_stage, funding_round, fico, prequal_amount, agent_context_field, outcome_tier },
 *     insights: [{ stage, channel, answers, notes, recording_url, meeting_url, occurred_at }],
 *     recent_calls: [{ outcome, notes, recording_url, transcript, logged_at }],
 *     checklist: { open_step, open_count } | null,
 *     blueprint: { access_active, payment, contract, human_advisor, advisor_assignment_status },
 *     selected_conversation_id: string | null, // reply/halt scope; history spans the client's channels
 *     open_tasks: [], proof_documents: [],
 *     as_prompt_block: string   // ready to inject under the system prompt
 *   }
 */
export async function fetchContext(db, {
  orgId, clientId, conversationId = null, channel = null, recentLimit = RECENT_MESSAGE_LIMIT
} = {}) {
  if (!orgId) throw new Error("fetchContext: orgId is required");
  if (!clientId) throw new Error("fetchContext: clientId is required");

  const [clientRes, convoRes, messagesRes, stageRes, roundRes, cfRes, insightRes, callRes,
    blueprintPaymentRes, blueprintAccessRes, blueprintContractRes, advisorRes, taskRes, proofRes] = await Promise.all([
    db.query(
      `SELECT id, first_name, last_name, email, phone, funded, funded_amount,
              tags, outcome_tier, dnd_sms, dnd_email, dnd_voice
         FROM clients
        WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    ),
    conversationId
      ? db.query(
          `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
             FROM conversations
            WHERE id = $1 AND org_id = $2 AND client_id = $3`,
          [conversationId, orgId, clientId]
        )
      : channel
        ? db.query(
            `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
               FROM conversations
              WHERE org_id = $1 AND client_id = $2 AND channel = $3
                AND COALESCE(kind, 'client') = 'client'
              LIMIT 1`,
            [orgId, clientId, channel]
          )
        : db.query(
            `SELECT id, channel, summary, agent_code, agent_halted_at, agent_halt_reason, last_pulse_at
               FROM conversations
              WHERE org_id = $1 AND client_id = $2
                AND COALESCE(kind, 'client') = 'client'
              ORDER BY last_pulse_at DESC NULLS LAST, updated_at DESC
              LIMIT 1`,
            [orgId, clientId]
          ),
    db.query(
      `SELECT id, direction, channel, rendered_body AS body, sender_kind,
              sender_agent_code, created_at, subject, status, provider, provider_ref
         FROM messages
        WHERE org_id = $1 AND client_id = $2
        ORDER BY created_at DESC
        LIMIT $3`,
      [orgId, clientId, recentLimit]
    ),
    db.query(
      `SELECT ps.name AS stage_name, p.name AS pipeline_name
         FROM cards c
         JOIN pipeline_stages ps ON ps.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1 AND c.org_id = $2
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT id, round_number, status, submitted_amount, approved_amount, funded_amount
         FROM funding_rounds
        WHERE client_id = $1 AND org_id = $2
        ORDER BY round_number DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT agent_context, crs_fico_score, primary_fico_score,
              analyzer_prequal_amount, cf_reanalyzer_prequal_amount,
              total_funding_estimate, funding_round_number, funding_fico_band,
              how_much_funding_does_your_business_need,
              what_will_the_funding_be_used_for,
              what_is_your_current_credit_score,
              cf_svy_self_reported_fico, cf_svy_funding_target_amount,
              cf_funding_scope, employee_next_action, analyzer_path_raw
         FROM client_custom_fields
        WHERE client_id = $1 AND org_id = $2`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT stage, channel, answers, notes, recording_url, meeting_url, occurred_at
         FROM customer_insights
        WHERE client_id = $1 AND org_id = $2
        ORDER BY occurred_at DESC
        LIMIT 6`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT outcome, notes, recording_url, transcript, logged_at
         FROM call_outcomes
        WHERE client_id = $1 AND org_id = $2
        ORDER BY logged_at DESC
        LIMIT 3`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT t.id, t.amount_paid, t.status, t.created_at
         FROM transactions t
         JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
        WHERE t.org_id = $1 AND t.client_id = $2 AND p.org_id = t.org_id
          AND p.code = 'consulting-package'
        ORDER BY t.created_at DESC, t.id DESC LIMIT 1`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT entitlement_code, active, expires_at
         FROM v_client_entitlements
        WHERE org_id = $1 AND client_id = $2
          AND entitlement_code = 'credit-optimization-roadmap' AND active
        ORDER BY granted_at DESC NULLS LAST LIMIT 1`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT id, status, merge_values, sent_at, signed_at, created_at
         FROM contracts
        WHERE org_id = $1 AND client_id = $2
          AND template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT c.assigned_csm_staff_id, s.id AS staff_id, s.name, s.status, s.is_demo
         FROM clients c
         LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
        WHERE c.org_id = $1 AND c.id = $2`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT id, title, detail, done, due_at, assignee_role, assignee_staff_id, source_workflow
         FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND done = false
        ORDER BY due_at ASC NULLS LAST, created_at DESC LIMIT 10`,
      [orgId, clientId]
    ),
    db.query(
      `SELECT id, title, kind, subtype, created_at
         FROM documents
        WHERE org_id = $1 AND client_id = $2
          AND ((kind = 'client_upload' AND subtype = 'dispute_mail_receipt') OR kind = 'bureau_response')
        ORDER BY created_at DESC, id DESC LIMIT 10`,
      [orgId, clientId]
    )
  ]);

  const clientRow = clientRes.rows[0] || null;
  const cf = cfRes.rows[0] || {};
  const convo = convoRes.rows[0] || null;
  const recent = (messagesRes.rows || []).slice().reverse();

  const survey = {};
  for (const key of SURVEY_KEYS) {
    if (cf[key] != null && cf[key] !== "") survey[key] = cf[key];
  }

  const fico = cf.crs_fico_score ?? cf.primary_fico_score ?? null;
  const prequal = cf.analyzer_prequal_amount
    || cf.cf_reanalyzer_prequal_amount
    || cf.total_funding_estimate
    || null;

  const stage = stageRes.rows[0] || null;
  const round = roundRes.rows[0] || null;

  const snapshot = {
    pipeline_stage: stage
      ? { pipeline: stage.pipeline_name, stage: stage.stage_name }
      : null,
    funding_round: round
      ? {
          id: round.id,
          number: round.round_number ?? cf.funding_round_number ?? null,
          status: round.status || null,
          submitted_amount: round.submitted_amount ?? null,
          approved_amount: round.approved_amount ?? null,
          funded_amount: round.funded_amount ?? null
        }
      : (cf.funding_round_number != null
        ? { id: null, number: cf.funding_round_number, status: null,
            submitted_amount: null, approved_amount: null, funded_amount: null }
        : null),
    fico: fico != null ? Number(fico) : null,
    fico_band: cf.funding_fico_band || null,
    prequal_amount: prequal,
    agent_context_field: cf.agent_context || null,
    outcome_tier: clientRow?.outcome_tier || null,
    analyzer_path: cf.analyzer_path_raw || null,
    employee_next_action: cf.employee_next_action || null
  };

  const context = {
    selected_conversation_id: conversationId,
    conversation: convo
      ? {
          id: convo.id,
          channel: convo.channel,
          summary: convo.summary || null,
          agent_code: convo.agent_code || null,
          agent_halted_at: convo.agent_halted_at || null,
          agent_halt_reason: convo.agent_halt_reason || null,
          last_pulse_at: convo.last_pulse_at || null
        }
      : null,
    recent_messages: recent.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      subject: m.subject || null,
      sender_kind: m.sender_kind || null,
      sender_agent_code: m.sender_agent_code || null,
      created_at: m.created_at,
      status: m.status || null, provider: m.provider || null, provider_ref: m.provider_ref || null
    })),
    survey,
    client: clientRow
      ? {
          id: clientRow.id,
          first_name: clientRow.first_name,
          last_name: clientRow.last_name,
          email: clientRow.email,
          phone: clientRow.phone,
          funded: clientRow.funded,
          funded_amount: clientRow.funded_amount,
          tags: clientRow.tags || [],
          flags: {
            dnd_sms: !!clientRow.dnd_sms,
            dnd_email: !!clientRow.dnd_email,
            dnd_voice: !!clientRow.dnd_voice
          }
        }
      : null,
    snapshot
  };

  const payment = blueprintPaymentRes.rows[0] || null;
  const contract = blueprintContractRes.rows[0] || null;
  const advisor = advisorRes.rows[0] || null;
  const humanAssigned = !!advisor?.staff_id && advisor.is_demo === false && advisor.status === "active";
  context.blueprint = {
    access_active: blueprintAccessRes.rows.length > 0,
    payment: payment ? { id: payment.id, status: payment.status,
      amount_cents: payment.amount_paid == null ? null : toCents(payment.amount_paid), created_at: payment.created_at } : null,
    contract: contract ? { id: contract.id, status: contract.status,
      package_fee: contract.merge_values?.package_fee || null, sent_at: contract.sent_at || null,
      signed_at: contract.signed_at || null } : null,
    human_advisor: humanAssigned ? { id: advisor.staff_id, name: advisor.name || null } : null,
    advisor_assignment_status: humanAssigned ? "assigned"
      : (advisor?.assigned_csm_staff_id ? "assignment_unavailable" : "unassigned")
  };
  context.open_tasks = taskRes.rows.map((row) => ({ ...row }));
  context.proof_documents = proofRes.rows.map((row) => ({ ...row }));

  context.insights = (insightRes.rows || []).map((row) => ({
    stage: row.stage || null,
    channel: row.channel || null,
    answers: row.answers && typeof row.answers === "object" ? row.answers : {},
    notes: row.notes || null,
    recording_url: row.recording_url || null,
    meeting_url: row.meeting_url || null,
    occurred_at: row.occurred_at || null
  }));
  context.recent_calls = (callRes.rows || []).map((row) => ({
    outcome: row.outcome || null,
    notes: row.notes || null,
    recording_url: row.recording_url || null,
    transcript: row.transcript || null,
    logged_at: row.logged_at || null
  }));

  const waypoints = await listWaypoints(db, { orgId, clientId });
  const next = nextStepOf(waypoints.map((w) => ({ ...w, owner: w.owner_kind })));
  const openStepRow = next
    ? waypoints.find((w) => w.id === next.waypointId) || null
    : null;
  context.checklist = {
    open_step: openStepRow
      ? {
          id: openStepRow.id,
          key: openStepRow.key,
          title: openStepRow.title,
          detail: openStepRow.detail || null,
          state: openStepRow.state,
          owner: openStepRow.owner_kind || next.owner || null,
          due_at: openStepRow.due_at || null,
          overdue: !!openStepRow.overdue,
          verify_kind: openStepRow.verify_kind || null
        }
      : null,
    steps: waypoints.map((w) => ({ id: w.id, title: w.title, state: w.state,
      verify_kind: w.verify_kind || null, completed_at: w.completed_at || null })),
    open_count: waypoints.filter((w) =>
      w.state === "not_started" || w.state === "in_progress" || w.state === "blocked"
    ).length
  };

  context.as_prompt_block = formatPromptBlock(context);
  return context;
}

/* formatPromptBlock — compact text the model reads. Nulls omitted so the
   model is not told "unknown" for facts we do not have. */
export function formatPromptBlock(ctx) {
  const lines = ["CLIENT CONTEXT (read-only facts; do not invent missing values)"];
  const c = ctx.client;
  if (c) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
    if (name) lines.push(`Name: ${name}`);
    if (c.email) lines.push(`Email: ${c.email}`);
    if (c.phone) lines.push(`Phone: ${c.phone}`);
    if (c.funded) lines.push(`Funded: yes${c.funded_amount != null ? ` (${c.funded_amount})` : ""}`);
    if (c.tags?.length) lines.push(`Tags: ${c.tags.join(", ")}`);
  }
  const s = ctx.snapshot || {};
  if (ctx.blueprint) {
    const b = ctx.blueprint;
    lines.push(`Capital Blueprint access: ${b.access_active ? "active" : "not active"}`);
    if (b.payment) lines.push(`Blueprint payment: ${b.payment.status || "status not recorded"}${b.payment.amount_cents == null ? "" : " · " + formatCents(b.payment.amount_cents)}`);
    if (b.contract) lines.push(`Blueprint agreement: ${b.contract.status || "status not recorded"}${b.contract.package_fee ? " · " + b.contract.package_fee : ""}`);
    // Owner-set 2026-10-20: the CSM role is the AI coaches plus the Fundhub
    // team's CSM queue. No staff name goes to the model, so it cannot name or
    // promise a personal advisor to the client.
    lines.push(`Team follow-up: Fundhub team CSM queue${b.human_advisor ? " (a staff CSM is linked)"
      : b.advisor_assignment_status === "assignment_unavailable" ? " (saved staff link is not an active real staff member)" : ""}`);
    lines.push("The AI coach does touch-base check-ins for the Fundhub team. Never name a person or promise a personal advisor. A queued message is not proof of delivery.");
  }
  if (s.pipeline_stage) {
    lines.push(`Pipeline: ${s.pipeline_stage.pipeline} / ${s.pipeline_stage.stage}`);
  }
  if (s.funding_round) {
    lines.push(
      `Funding round: #${s.funding_round.number ?? "?"}` +
      (s.funding_round.status ? ` (${s.funding_round.status})` : "")
    );
  }
  if (s.fico != null) lines.push(`FICO: ${s.fico}`);
  if (s.fico_band) lines.push(`FICO band: ${s.fico_band}`);
  if (s.prequal_amount) lines.push(`Prequal: ${s.prequal_amount}`);
  if (s.outcome_tier) lines.push(`Outcome tier: ${s.outcome_tier}`);
  if (s.analyzer_path) lines.push(`Analyzer path: ${s.analyzer_path}`);
  if (s.employee_next_action) lines.push(`Employee next action: ${s.employee_next_action}`);
  if (s.agent_context_field) {
    lines.push("Stored agent context:");
    lines.push(String(s.agent_context_field).slice(0, 2000));
  }
  const surveyKeys = Object.keys(ctx.survey || {});
  if (surveyKeys.length) {
    lines.push("Survey answers:");
    for (const k of surveyKeys) lines.push(`  - ${k}: ${ctx.survey[k]}`);
  }
  if (ctx.conversation?.summary) {
    lines.push(`Conversation summary: ${ctx.conversation.summary}`);
  }
  if (ctx.recent_messages?.length) {
    lines.push("Recent messages (oldest first):");
    for (const m of ctx.recent_messages) {
      const who = m.direction === "inbound"
        ? "CLIENT"
        : (m.sender_kind === "agent"
          ? `AGENT(${m.sender_agent_code || "?"})`
          : (m.sender_kind || "OUTBOUND").toUpperCase());
      lines.push(`  [${who}${m.channel ? " · " + m.channel : ""}${m.status ? " · " + m.status : ""}] ${(m.body || "").slice(0, 1200)}`);
    }
  }
  if (ctx.insights?.length) {
    lines.push("Customer interviews / check-ins:");
    for (const i of ctx.insights) {
      const when = i.occurred_at ? ` ${i.occurred_at}` : "";
      lines.push(`  - ${i.stage || "insight"} ${i.channel || ""}${when}`.trim());
      if (i.notes) lines.push(`    notes: ${String(i.notes).slice(0, 400)}`);
      const answers = i.answers && typeof i.answers === "object" ? i.answers : {};
      for (const [k, v] of Object.entries(answers).slice(0, 12)) {
        if (v == null || v === "") continue;
        lines.push(`    ${k}: ${String(v).slice(0, 200)}`);
      }
      if (i.recording_url) lines.push(`    recording: ${i.recording_url}`);
    }
  }
  if (ctx.recent_calls?.length) {
    lines.push("Recent sales calls:");
    for (const call of ctx.recent_calls) {
      const rec = call.recording_url ? ` recording: ${call.recording_url}` : "";
      lines.push(`  - ${call.outcome || "logged"} ${call.logged_at || ""}${rec}`.trim());
      if (call.notes) lines.push(`    notes: ${String(call.notes).slice(0, 400)}`);
      if (call.transcript) {
        lines.push(`    said: ${String(call.transcript).slice(0, 1200)}`);
      }
    }
  }
  const step = ctx.checklist?.open_step;
  if (step) {
    lines.push("Open checklist step (Capital Blueprint coach — stay on this step only):");
    lines.push(`  Title: ${step.title}`);
    if (step.detail) lines.push(`  Detail: ${String(step.detail).slice(0, 800)}`);
    if (step.due_at) lines.push(`  Due: ${step.due_at}${step.overdue ? " (overdue)" : ""}`);
    lines.push(`  State: ${step.state}`);
    if (step.verify_kind) lines.push(`  Proof check: ${step.verify_kind}. A promise does not complete this step.`);
  } else if (ctx.checklist && ctx.checklist.open_count === 0) {
    lines.push("Checklist: no open steps (all done or not seeded).");
  }
  if (ctx.proof_documents?.length) {
    lines.push("Saved proof documents (an upload alone does not complete a step):");
    for (const doc of ctx.proof_documents) lines.push(`  - ${doc.title || doc.subtype} · ${doc.created_at || "date not recorded"}`);
  }
  if (ctx.open_tasks?.length) {
    lines.push("Open staff tasks:");
    for (const task of ctx.open_tasks) {
      lines.push(`  - ${task.title}${task.due_at ? " · due " + task.due_at : ""}`);
      if (task.detail) lines.push(`    ${String(task.detail).slice(0, 500)}`);
    }
  }
  return lines.join("\n");
}

export default fetchContext;
