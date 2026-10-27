import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchContext, formatPromptBlock } from "./context.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";

function mockDb(extra = {}) {
  return {
    async query(sql, params) {
      extra.queries?.push({ sql, params });
      if (/FROM clients c/.test(sql)) return { rows: extra.advisor ? [extra.advisor] : [] };
      if (/FROM clients/i.test(sql)) {
        return {
          rows: [{
            id: CLIENT, first_name: "Jane", last_name: "Doe",
            email: "jane@x.test", phone: null, funded: true,
            funded_amount: 50000, tags: [], outcome_tier: null,
            dnd_sms: false, dnd_email: false, dnd_voice: false,
            custom_fields: extra.customFields || {}
          }]
        };
      }
      if (/FROM conversations/i.test(sql)) return { rows: extra.conversation ? [extra.conversation] : [] };
      if (/FROM messages/i.test(sql)) return { rows: extra.messages || [] };
      if (/FROM transactions/i.test(sql)) return { rows: extra.payment ? [extra.payment] : [] };
      if (/FROM v_client_entitlements/i.test(sql)) return { rows: extra.access ? [{ active: true }] : [] };
      if (/FROM contracts/i.test(sql)) return { rows: extra.contract ? [extra.contract] : [] };
      if (/FROM tasks/i.test(sql)) return { rows: extra.tasks || [] };
      if (/FROM documents/i.test(sql)) return { rows: extra.proofs || [] };
      if (/FROM cards/i.test(sql)) return { rows: [] };
      if (/FROM funding_rounds/i.test(sql)) return { rows: [] };
      if (/FROM client_custom_fields/i.test(sql)) return { rows: [{}] };
      if (/FROM customer_insights/i.test(sql)) {
        return { rows: extra.insights || [] };
      }
      if (/FROM call_outcomes/i.test(sql)) {
        return { rows: extra.calls || [] };
      }
      if (/FROM client_waypoints/i.test(sql)) {
        return {
          rows: extra.waypoints || [{
            id: "wp-1",
            key: "paydown_capital_one",
            title: "Pay Capital One down to $300",
            detail: null,
            position: 1,
            owner_kind: "client",
            state: "in_progress",
            due_at: "2026-10-01T00:00:00Z",
            paid_alternative_price_cents: null
          }]
        };
      }
      return { rows: [] };
    }
  };
}

test("completed setter handoff is available to the closer and Present context", async () => {
  const handoff = { complete_at: "2026-10-27T02:00:00Z", problem: "Slow approvals",
    goal: "Open a second location", computer_ready: true,
    handoff_text: "Jane is opening a second location." };
  const ctx = await fetchContext(mockDb({ customFields: { setter_handoff: handoff } }),
    { orgId: ORG, clientId: CLIENT });
  assert.deepEqual(ctx.setter_handoff, handoff);
  assert.match(ctx.as_prompt_block, /Setter handoff/);
  assert.match(ctx.as_prompt_block, /Open a second location/);
});

test("an unfinished setter checklist stays off the closer context", async () => {
  const ctx = await fetchContext(mockDb({ customFields: {
    setter_handoff: { problem: "Draft problem", goal: "Draft goal" }
  } }), { orgId: ORG, clientId: CLIENT });
  assert.equal(ctx.setter_handoff, null);
  assert.doesNotMatch(ctx.as_prompt_block, /Setter handoff|Draft problem|Draft goal/);
});

test("fetchContext includes interview answers and the recording link", async () => {
  const ctx = await fetchContext(mockDb({
    insights: [{
      stage: "post",
      channel: "google_meet",
      answers: { what_almost_stopped_you: "Price" },
      notes: "Loved the closer",
      recording_url: "https://drive.google.com/file/d/rec",
      meeting_url: "https://meet.google.com/abc",
      occurred_at: "2026-08-15T16:00:00Z"
    }],
    calls: [{
      outcome: "deposit",
      notes: "Closed",
      recording_url: "https://drive.google.com/file/d/call",
      transcript: "three thousand is a start and part of ten percent",
      logged_at: "2026-08-14T16:00:00Z"
    }]
  }), { orgId: ORG, clientId: CLIENT });

  assert.equal(ctx.insights.length, 1);
  assert.equal(ctx.insights[0].answers.what_almost_stopped_you, "Price");
  assert.equal(ctx.recent_calls[0].outcome, "deposit");
  assert.match(ctx.as_prompt_block, /Price/);
  assert.match(ctx.as_prompt_block, /Loved the closer/);
  assert.match(ctx.as_prompt_block, /deposit/);
  assert.match(ctx.as_prompt_block, /three thousand is a start/);
});

test("fetchContext includes open checklist step for the coach", async () => {
  const ctx = await fetchContext(mockDb(), { orgId: ORG, clientId: CLIENT });
  assert.ok(ctx.checklist?.open_step);
  assert.match(ctx.checklist.open_step.title, /Capital One/);
  assert.match(ctx.as_prompt_block, /Open checklist step/);
});

test("current step is the client's open job even when Fundhub has an earlier open job", async () => {
  const ctx = await fetchContext(mockDb({ waypoints: [
    { id: "ours", key: "prepare", title: "Prepare letters", position: 0, owner_kind: "fundhub", state: "in_progress" },
    { id: "theirs", key: "mail", title: "Mail letters", position: 1, owner_kind: "client", state: "in_progress" }
  ] }), { orgId: ORG, clientId: CLIENT });
  assert.equal(ctx.checklist.open_step.id, "theirs");
  assert.equal(ctx.checklist.open_step.owner, "client");
});

test("formatPromptBlock omits empty interview blocks", () => {
  const text = formatPromptBlock({
    client: { first_name: "Jane", last_name: "Doe" },
    snapshot: {},
    survey: {},
    insights: [],
    recent_calls: []
  });
  assert.doesNotMatch(text, /Customer interviews/);
  assert.match(text, /Jane Doe/);
});

test("closer context reads spoken words from call_outcomes.transcript", () => {
  const src = readFileSync(fileURLToPath(new URL("./context.mjs", import.meta.url)), "utf8");
  assert.match(src, /SELECT outcome, notes, recording_url, transcript, logged_at/);
  assert.match(src, /said: /);
});

test("an SMS reply reads the client's voice and SMS history while retaining its selected halt scope", async () => {
  const queries = [];
  const ctx = await fetchContext(mockDb({
    queries,
    conversation: { id: "sms-thread", channel: "sms", agent_halted_at: "2026-10-20T12:00:00Z", agent_halt_reason: "stop" },
    messages: [
      { id: "sms-2", channel: "sms", direction: "inbound", body: "I uploaded the mail receipt", status: "received" },
      { id: "voice-1", channel: "voice", direction: "outbound", body: "On our call, client agreed to upload the receipt", status: "completed", provider: "bland", provider_ref: "bland-call" }
    ]
  }), { orgId: ORG, clientId: CLIENT, conversationId: "sms-thread", channel: "sms" });
  assert.deepEqual(ctx.recent_messages.map((m) => m.id), ["voice-1", "sms-2"]);
  assert.equal(ctx.selected_conversation_id, "sms-thread");
  assert.equal(ctx.conversation.agent_halt_reason, "stop");
  assert.equal(ctx.recent_messages[0].provider_ref, "bland-call");
  const history = queries.find((q) => /FROM messages/.test(q.sql));
  assert.doesNotMatch(history.sql, /conversation_id\s*=/);
  assert.deepEqual(history.params, [ORG, CLIENT, 20]);
  assert.match(ctx.as_prompt_block, /voice · completed/);
  assert.match(ctx.as_prompt_block, /sms · received/);
});

test("shared Blueprint facts include exact price, access, human advisor, proof state and real tasks", async () => {
  const queries = [];
  const ctx = await fetchContext(mockDb({
    queries,
    payment: { id: "paid", amount_paid: "7500.00", status: "succeeded" }, access: true,
    contract: { id: "signed", status: "signed", merge_values: { package_fee: "$7,500" } },
    advisor: { assigned_csm_staff_id: "real-csm", staff_id: "real-csm", name: "Alex Advisor", status: "active", is_demo: false },
    waypoints: [{ id: "wp-proof", title: "Upload mailing proof", key: "dispute_mail", state: "in_progress",
      owner_kind: "client", verify_kind: "dispute_mail_receipt", due_at: "2026-10-21T00:00:00Z" }],
    proofs: [{ id: "proof", title: "October mailing receipt", kind: "client_upload", subtype: "dispute_mail_receipt" }],
    tasks: [{ id: "exception", title: "Review mailing receipt", done: false, assignee_role: "csm", assignee_staff_id: "real-csm" }]
  }), { orgId: ORG, clientId: CLIENT });
  assert.equal(ctx.blueprint.payment.amount_cents, 750000);
  assert.equal(ctx.blueprint.access_active, true);
  assert.equal(ctx.blueprint.contract.package_fee, "$7,500");
  assert.equal(ctx.blueprint.human_advisor.name, "Alex Advisor");
  assert.equal(ctx.checklist.open_step.verify_kind, "dispute_mail_receipt");
  assert.equal(ctx.checklist.steps[0].state, "in_progress", "saved proof must not close a step in a read");
  // Owner-set 2026-10-20: the CSM is the AI coaches plus the team queue. The
  // model-facing block never carries a staff name it could repeat to a client.
  assert.match(ctx.as_prompt_block, /Team follow-up: Fundhub team CSM queue \(a staff CSM is linked\)/);
  assert.doesNotMatch(ctx.as_prompt_block, /Alex Advisor|Human advisor/);
  assert.match(ctx.as_prompt_block, /Never name a person or promise a personal advisor/);
  assert.match(ctx.as_prompt_block, /A promise does not complete this step/);
  assert.match(ctx.as_prompt_block, /October mailing receipt/);
  assert.match(ctx.as_prompt_block, /Review mailing receipt/);
  assert.match(ctx.as_prompt_block, /succeeded · \$7,500/);
  for (const query of queries.filter((q) => /FROM transactions|FROM v_client_entitlements|FROM contracts|FROM clients c|FROM tasks|FROM documents/.test(q.sql))) {
    assert.deepEqual(query.params, [ORG, CLIENT]);
    assert.match(query.sql, /org_id/);
    assert.match(query.sql, /client_id|c\.id/);
  }
});

test("a demo, inactive or missing advisor is never presented as the assigned human", async () => {
  for (const advisor of [null,
    { assigned_csm_staff_id: "demo", staff_id: "demo", name: "Demo Person", status: "active", is_demo: true },
    { assigned_csm_staff_id: "inactive", staff_id: "inactive", name: "Inactive Person", status: "inactive", is_demo: false }
  ]) {
    const ctx = await fetchContext(mockDb({ advisor }), { orgId: ORG, clientId: CLIENT });
    assert.equal(ctx.blueprint.human_advisor, null);
    assert.doesNotMatch(ctx.as_prompt_block, /(Demo|Inactive) Person|staff CSM is linked/);
    assert.match(ctx.as_prompt_block, advisor ? /saved staff link is not an active real staff member/ : /Team follow-up: Fundhub team CSM queue\n/);
  }
});

test("a shared payment read error propagates instead of inventing an unpaid status", async () => {
  const db = mockDb();
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM transactions/.test(sql)) throw new Error("payment_read_failed");
    return query(sql, params);
  };
  await assert.rejects(() => fetchContext(db, { orgId: ORG, clientId: CLIENT }), /payment_read_failed/);
});
