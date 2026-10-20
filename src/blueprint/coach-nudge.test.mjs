import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "../testing/handler-harness.mjs";
import { sendBlueprintCoachNudge } from "./coach-nudge.mjs";
import { STEPS } from "../nudge/ladder.mjs";
import { deliverNudge } from "../nudge/run.mjs";

const scope = { orgId: "org-a", clientId: "client-a" };
const spec = { ...scope, templateKey: "SMS-WAYPOINT-DUE", channel: "sms", eventId: "existing-durable-nudge-claim",
  context: { waypoint: { key: "mail", title: "stale title" } } };
const ctx = { client: { id: "client-a", flags: {} }, blueprint: { access_active: true },
  checklist: { open_step: { key: "mail", title: "Mail letters", state: "in_progress", owner: "client", verify_kind: "dispute_mail_receipt" } },
  as_prompt_block: "Last call: receipt saved" };
const agent = { code: "BP-COACH", status: "live", agent_class: "client_facing", channel: "sms", runtime: "internal", prompt: "AI coach" };
const dbFor = (row = agent) => fakeDb([[/FROM agents/, (_sql, p) => p[0] === scope.orgId && p[1] === "BP-COACH" ? [row] : []]]);

test("existing nudge cadence stays due SMS / day2 email / day5 SMS / day9 human, with no automatic Bland calls", () => {
  assert.deepEqual(STEPS.map((s) => [s.daysOverdue, s.channel, s.kind]), [
    [0, "sms", "client_message"], [2, "email", "client_message"], [5, "sms", "client_message"], [9, null, "staff_task"]
  ]);
});

test("nonBlueprint reminders use the original approved-template path with unchanged arguments", async () => {
  const db = dbFor();
  const out = await sendBlueprintCoachNudge(db, spec, { isBuyerImpl: async () => false,
    sendTemplatedImpl: async (_db, input) => { assert.equal(input, spec); return { sent: true, messageId: "original" }; } });
  assert.equal(out.messageId, "original");
  assert.equal(db.calls.length, 0);
});

test("Blueprint uses real saved current title/proof and existing claim key through the approved-template sender", async () => {
  let queued;
  const out = await sendBlueprintCoachNudge(dbFor(), spec, {
    isBuyerImpl: async () => true, fetchContextImpl: async (_db, ids) => { assert.deepEqual(ids, { ...scope, channel: "sms", conversationId: null }); return ctx; },
    sendTemplatedImpl: async (_db, input) => { queued = input; return { sent: true, messageId: "queued" }; }
  });
  assert.equal(out.messageId, "queued");
  assert.equal(queued.templateKey, "SMS-BLUEPRINT-COACH-DUE");
  assert.equal(queued.eventId, spec.eventId);
  assert.equal(queued.context.waypoint.title, "Mail letters");
  assert.match(queued.context.coach.reminder, /Fundhub AI coach/);
  assert.match(queued.context.coach.reminder, /saved proof/);
  assert.doesNotMatch(queued.context.coach.reminder, /stale title|deposit|tomorrow/);
});

test("draft/missing coach, halted/inactive file, stale planned step never reaches the sender", async () => {
  for (const [row, context] of [[{ ...agent, status: "draft" }, ctx], [null, ctx],
    [agent, { ...ctx, blueprint: { access_active: false } }], [agent, { ...ctx, conversation: { agent_halted_at: "today" } }],
    [agent, { ...ctx, checklist: { open_step: { ...ctx.checklist.open_step, key: "new-step" } } }]]) {
    let sends = 0;
    const out = await sendBlueprintCoachNudge(dbFor(row), spec, { isBuyerImpl: async () => true, fetchContextImpl: async () => context,
      sendTemplatedImpl: async () => { sends++; } });
    assert.equal(out.sent, false);
    assert.equal(sends, 0);
  }
});

test("real template sender holds missing, unapproved and DRAFT Blueprint copy without any message insert", async () => {
  for (const template of [null, { body: "{{coach.reminder}}", compliance_passed: false }, { body: "[DRAFT] {{coach.reminder}}", compliance_passed: true }]) {
    const db = dbFor();
    const query = db.query;
    db.query = async (sql, params) => /FROM message_templates/.test(sql) ? { rows: template ? [template] : [] } : query(sql, params);
    const out = await sendBlueprintCoachNudge(db, spec, { isBuyerImpl: async () => true, fetchContextImpl: async () => ctx });
    assert.equal(out.sent, false);
    assert.ok(["template_pending", "draft_template"].includes(out.reason));
    assert.equal(db.find(/INSERT INTO messages/).length, 0);
  }
});

test("an SMS-only coach cannot send the email rung; sms_email uses the real email template", async () => {
  const emailSpec = { ...spec, channel: "email", templateKey: "EMAIL-WAYPOINT-NUDGE-1" };
  for (const channel of ["sms", "sms_email"]) {
    let sent;
    const out = await sendBlueprintCoachNudge(dbFor({ ...agent, channel }), emailSpec, {
      isBuyerImpl: async () => true, fetchContextImpl: async () => ctx,
      sendTemplatedImpl: async (_db, value) => { sent = value; return { sent: true }; }
    });
    assert.equal(!!sent, channel === "sms_email");
    if (channel === "sms") assert.equal(out.reason, "blueprint_coach_not_live");
    else assert.equal(sent.templateKey, "EMAIL-BLUEPRINT-COACH-NUDGE-1");
  }
});

// Real runner and template sender; only storage is simulated. The existing
// nudge PG suite remains the proof of its UNIQUE claim/day constraints.
function runnerFixture({ draft = false } = {}) {
  const now = new Date("2026-10-20T18:00:00Z");
  const waypoints = [
    { id: "wp-current", org_id: "org-a", client_id: "client-a", key: "mail", title: "Mail letters", position: 1, owner_kind: "client", state: "in_progress", due_at: now, verify_kind: "dispute_mail_receipt" },
    { id: "wp-later", org_id: "org-a", client_id: "client-a", key: "later", title: "Later client job", position: 2, owner_kind: "client", state: "not_started", due_at: now }
  ];
  const state = { agent: { ...agent, status: draft ? "draft" : "live" }, claims: [], messages: [] };
  const db = fakeDb([
    [/SELECT id, org_id, client_id, owner_kind/, (_sql, p) => waypoints.filter((w) => w.id === p[0])],
    [/SELECT \* FROM client_waypoints/, () => waypoints],
    [/SELECT step FROM waypoint_nudges/, (_sql, p) => state.claims.filter((r) => r.waypoint_id === p[0])],
    [/SELECT 1 FROM waypoint_nudges WHERE waypoint_id/, (_sql, p) => state.claims.filter((r) => r.waypoint_id === p[0] && r.step === p[1])],
    [/INSERT INTO waypoint_nudges/, (_sql, p) => {
      if (state.claims.some((r) => r.waypoint_id === p[2] && r.step === p[3])) return [];
      const row = { id: `claim-${state.claims.length + 1}`, waypoint_id: p[2], step: p[3], outcome: "claimed", message_id: null };
      state.claims.push(row); return [row];
    }],
    [/DELETE FROM waypoint_nudges/, (_sql, p) => {
      state.claims = state.claims.filter((r) => !(r.id === p[0] && r.outcome === "claimed" && !r.message_id)); return [];
    }],
    [/UPDATE waypoint_nudges SET outcome = 'queued'/, (_sql, p) => { Object.assign(state.claims.find((r) => r.id === p[0]), { outcome: "queued", message_id: p[1] }); return []; }],
    [/FROM agents/, () => [state.agent]],
    [/FROM transactions/, [{ id: "paid", status: "succeeded" }]],
    [/FROM v_client_entitlements/, [{ active: true }]],
    [/FROM clients c/, []],
    [/FROM clients/, [{ id: "client-a", org_id: "org-a", phone: "+16025550100", email: "e2e+aff-coach@example.com", custom_fields: { timezone: "America/Phoenix" } }]],
    [/FROM message_templates/, [{ body: "{{coach.reminder}} Reply STOP to opt out.", compliance_passed: true }]],
    [/INSERT INTO conversations/, [{ id: "saved-sms-thread" }]],
    [/INSERT INTO messages/, (_sql, p) => {
      if (state.messages.some((m) => m.provider_ref === p[5])) return [];
      const row = { id: `message-${state.messages.length + 1}`, created_at: now, provider_ref: p[5], body: p[4] };
      state.messages.push(row); return [row];
    }]
  ]);
  const candidate = (index = 0) => ({ orgId: "org-a", clientId: "client-a", waypointId: waypoints[index].id,
    key: waypoints[index].key, title: waypoints[index].title, step: 1 });
  return { db, state, waypoints, now, candidate };
}

test("draft coach leaves rung unspent; activation recovers the same claimed step and racing repeats queue once", async () => {
  const f = runnerFixture({ draft: true });
  const held = await deliverNudge(f.db, f.candidate(), { now: f.now });
  assert.equal(held.reasons[0], "blueprint_coach_not_live");
  assert.equal(f.state.claims.length, 0);
  f.state.agent.status = "live";
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => deliverNudge(f.db, f.candidate(), { now: f.now })));
  assert.equal(outcomes.filter((row) => row.action === "queued").length, 1);
  assert.equal(f.state.claims.length, 1);
  assert.equal(f.state.claims[0].outcome, "queued");
  assert.equal(f.state.messages.length, 1);
  assert.match(f.state.messages[0].body, /Mail letters/);
});

test("a later step's rung remains available until that step actually becomes current", async () => {
  const f = runnerFixture();
  const held = await deliverNudge(f.db, f.candidate(1), { now: f.now });
  assert.equal(held.reasons[0], "not_current_client_step");
  assert.equal(f.state.claims.length, 0);
  f.waypoints[0].state = "done";
  f.waypoints[0].completed_at = f.now;
  const resumed = await deliverNudge(f.db, f.candidate(1), { now: f.now });
  assert.equal(resumed.action, "queued");
  assert.equal(f.state.claims.length, 1);
  assert.equal(f.state.claims[0].waypoint_id, "wp-later");
});

test("a known pre-insert hold after claim releases only that unresolved claim for recovery", async () => {
  const f = runnerFixture();
  const held = await deliverNudge(f.db, f.candidate(), { now: f.now,
    send: async () => ({ sent: false, reason: "blueprint_coach_not_live", retryable: true }) });
  assert.equal(held.action, "skipped");
  assert.equal(f.state.claims.length, 0);
  assert.equal(f.state.messages.length, 0);
  const resumed = await deliverNudge(f.db, f.candidate(), { now: f.now });
  assert.equal(resumed.action, "queued");
  assert.equal(f.state.messages.length, 1);
});
