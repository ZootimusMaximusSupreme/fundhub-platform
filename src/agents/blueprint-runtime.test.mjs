import test from "node:test";
import assert from "node:assert/strict";
import { handleInbound } from "./runtime.mjs";
import { selectAgent, isEligibleAgent } from "./select.mjs";
import { fakeDb } from "../testing/handler-harness.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const event = { id: "event-1", orgId: ORG, clientId: CLIENT, name: "message.inbound",
  payload: { channel: "sms", sid: "inbound-1", body: "I am working on mailing the letters" } };
const coach = (over = {}) => ({ code: "BP-COACH", name: "Blueprint AI Coach", status: "live", channel: "sms",
  agent_class: "client_facing", runtime: "internal", prompt: "Fundhub AI coach.",
  guardrails: { stop_words: ["complaint"], authority: { msgcap: 6 }, flags: { noamount: true } }, ...over });

function database({ agent = coach(), assignment = "BP-COACH", halted = false, paid = true, active = true,
  optedOut = false, failWrite = false, clientId = CLIENT } = {}) {
  const convo = { id: "thread", agent_code: assignment, agent_halted_at: halted ? "today" : null };
  return fakeDb([
    [/FROM messages\s+WHERE org_id = \$1 AND provider_ref/, (_sql, p) => p[0] === ORG && p[1] === "inbound-1" && p[2] === CLIENT ? [{ id: "in-1", conversation_id: "thread" }] : []],
    [/FROM conversations/, (_sql, p) => (p.includes(ORG) && p.includes(CLIENT)) ? [convo] : []],
    [/FROM agents WHERE org_id = \$1 AND code = \$2/, (_sql, p) => p[0] === ORG && p[1] === agent.code ? [agent] : []],
    [/FROM agents/, [agent]],
    [/FROM transactions/, (_sql, p) => paid && p[0] === ORG && p[1] === CLIENT ? [{ id: "paid", status: "succeeded", amount_paid: "7500.00" }] : []],
    [/FROM v_client_entitlements/, (_sql, p) => active && p[0] === ORG && p[1] === CLIENT ? [{ active: true }] : []],
    [/FROM clients c/, [{ assigned_csm_staff_id: "human", staff_id: "human", name: "Alex", status: "active", is_demo: false }]],
    [/FROM clients\s+WHERE id = \$1 AND org_id = \$2/, (_sql, p) => p[0] === CLIENT && p[1] === ORG ? [{ id: clientId, first_name: "Pat", phone: "+16025550100" }] : []],
    [/FROM opt_outs/, optedOut ? [{ "?column?": 1 }] : []],
    [/count\(\*\)::int AS n/, [{ n: 0 }]],
    [/SELECT \* FROM client_waypoints/, [{ id: "wp-1", key: "mail_letters", title: "Mail letters", owner_kind: "client", state: "in_progress", verify_kind: "dispute_mail_receipt", position: 1 }]],
    [/FROM messages\s+WHERE org_id = \$1 AND client_id/, [{ id: "call-1", direction: "outbound", channel: "voice", status: "completed", body: "Last call: client saved the receipt" }]],
    [/UPDATE client_waypoints/, failWrite ? [] : [{ id: "wp-1" }]],
    [/INSERT INTO tasks/, [{ id: "advisor-task" }]],
    [/SELECT phone AS address/, [{ address: "+16025550100" }]],
    [/INSERT INTO messages/, [{ id: "reply-1", created_at: "2026-10-20T15:00:00Z" }]],
    [/FROM messages WHERE id = \$1/, [{ id: "reply-1", status: "queued" }]]
  ]);
}
const model = (text, options = {}) => ({ env: {}, now: () => new Date("2026-10-20T15:00:00Z"),
  callModelFn: async ({ system, user }) => {
    assert.match(system, /Last call: client saved the receipt/);
    assert.match(system, /report_progress/);
    assert.equal(user, event.payload.body);
    return { mode: "live", text, ...options };
  } });

test("Blueprint coach is never a global fallback and is scoped to canonical paid active clients", async () => {
  assert.equal(isEligibleAgent(coach(), "sms"), false);
  for (const [options, reason] of [[{ paid: false }, "blueprint_coach_unavailable"],
    [{ active: false }, "blueprint_coach_unavailable"], [{ agent: coach({ status: "draft" }) }, "blueprint_coach_unavailable"],
    [{ halted: true }, "halted"]]) {
    const picked = await selectAgent(database(options), { orgId: ORG, clientId: CLIENT, channel: "sms", conversationId: "thread" });
    assert.equal(picked.agent, null);
    assert.equal(picked.reason, reason);
  }
  const picked = await selectAgent(database({ assignment: null }), { orgId: ORG, clientId: CLIENT, channel: "sms" });
  assert.equal(picked.agent.code, "BP-COACH");
  assert.equal(picked.reason, "blueprint_coach");
  const unownedUnpaid = await selectAgent(database({ assignment: null, paid: false }), { orgId: ORG, clientId: CLIENT, channel: "sms" });
  assert.equal(unownedUnpaid.agent, null);
  const generic = coach({ code: "EXISTING" });
  const preserved = await selectAgent(database({ agent: generic, assignment: generic.code }), { orgId: ORG, clientId: CLIENT, channel: "sms" });
  assert.equal(preserved.agent.code, "EXISTING");
  const wrongOrg = await selectAgent(database(), { orgId: "other-company", clientId: CLIENT, channel: "sms" });
  assert.equal(wrongOrg.agent, null);
});

test("live SMS turn reads actual call context, saves narrow progress and queues truthful text through real reply/dispatch", async () => {
  const db = database();
  const out = await handleInbound(event, db, model(JSON.stringify({ intent: "ask_progress", action: { type: "report_progress", waypointKey: "mail_letters", state: "in_progress" } })));
  assert.equal(out.reason, "replied");
  assert.equal(db.find(/UPDATE client_waypoints/).length, 1);
  const reply = db.find(/INSERT INTO messages/)[0];
  assert.deepEqual(reply.params.slice(0, 4), [ORG, CLIENT, "thread", "sms"]);
  assert.match(reply.params[4], /What is your next update on "Mail letters"\?/);
  assert.match(reply.params[4], /progress note is saved/);
  assert.doesNotMatch(reply.params[4], /"action"|completed|delivered/);
  assert.match(reply.params[5], /agent:BP-COACH:inbound-1/);
  assert.equal(reply.params[8], "BP-COACH");
});

test("invalid actions, intent-action mismatches and model text cannot write progress or send", async () => {
  for (const text of [JSON.stringify({ intent: "ask_progress", action: { type: "complete", waypointKey: "mail_letters" } }),
    JSON.stringify({ intent: "ask_progress", reply: "You are approved for $50,000", action: null }),
    JSON.stringify({ intent: "ask_progress", action: { type: "report_progress", waypointKey: "mail_letters", state: "blocked" } })]) {
    const db = database();
    const out = await handleInbound(event, db, model(text));
    assert.equal(out.blocked, true);
    assert.equal(db.find(/UPDATE client_waypoints|INSERT INTO messages|INSERT INTO tasks/).length, 0);
  }
});

test("shadow/keyless coach can show proposed JSON but never execute its action or send", async () => {
  for (const [status, mode] of [["shadow", "live"], ["live", "shadow"]]) {
    const db = database({ agent: coach({ status }) });
    const out = await handleInbound(event, db, model(JSON.stringify({ intent: "ask_advisor", action: { type: "request_advisor" } }), { mode }));
    assert.equal(out.shadowed, true);
    assert.equal(db.find(/UPDATE client_waypoints|INSERT INTO messages|INSERT INTO tasks/).length, 0);
    assert.equal(db.find(/INSERT INTO agent_shadow_log/).length, 1);
  }
});

test("failed action discards model wording and does not claim success; opt-out and STOP do not call a model", async () => {
  const db = database({ failWrite: true });
  await handleInbound(event, db, model(JSON.stringify({ intent: "ask_blocker", action: { type: "report_progress", waypointKey: "mail_letters", state: "blocked" } })));
  assert.equal(db.find(/INSERT INTO messages/)[0].params[4], "Your request could not be saved. Please try again or contact your advisor.");
  for (const [options, inbound] of [[{ optedOut: true }, event], [{}, { ...event, payload: { ...event.payload, body: "STOP" } }]]) {
    const stopped = database(options);
    const out = await handleInbound(inbound, stopped, { env: {}, callModelFn: async () => { throw new Error("must not call model"); } });
    assert.notEqual(out.reason, "runtime_error");
    assert.equal(stopped.find(/INSERT INTO messages|INSERT INTO tasks|UPDATE client_waypoints/).length, 0);
  }
});

test("model-authored completion, payment, pull and task claims cannot queue, even with null action or no verification proof", async () => {
  for (const reply of ["Your checklist step is complete; I verified the proof.", "Your payment was received.",
    "I created an advisor task.", "I pulled your credit.", "What will you do now that your step is complete?", "Is your paid deposit all set?",
    "How does it feel now that your proof passed?", "What would you like next now that I have checked off this step?"]) {
    for (const action of [null, { type: "verify_progress" }]) {
      const db = database();
      for (const value of [{ reply, action }, { intent: "ask_progress", reply, action }, { intent: reply, action }]) {
        const out = await handleInbound(event, db, model(JSON.stringify(value)));
        assert.equal(out.blocked, true, reply);
        assert.equal(db.find(/INSERT INTO messages|INSERT INTO tasks|UPDATE client_waypoints/).length, 0, reply);
      }
    }
  }
  const db = database();
  const out = await handleInbound(event, db, model(JSON.stringify({ intent: "ask_proof", action: { type: "verify_progress" } })));
  assert.equal(out.reason, "replied");
  const body = db.find(/INSERT INTO messages/)[0].params[4];
  assert.match(body, /^The checklist check found no new completion proof; the step stays open/);
  assert.match(body, /Can you upload the proof for "Mail letters"\?/);
  assert.doesNotMatch(body, /I verified|step is complete/);
});

test("null-action questions are closed server-owned words, not a model-provided question or status", async () => {
  for (const [intent, question] of [["ask_progress", 'What is your next update on "Mail letters"?'],
    ["ask_blocker", 'What is holding you up on "Mail letters"?'], ["ask_proof", 'Can you upload the proof for "Mail letters"?'],
    ["ask_advisor", "Would you like help from your human advisor?"]]) {
    const db = database();
    const out = await handleInbound(event, db, model(JSON.stringify({ intent, action: null })));
    assert.equal(out.reason, "replied");
    assert.equal(db.find(/INSERT INTO messages/)[0].params[4], question);
    assert.equal(db.find(/INSERT INTO tasks|UPDATE client_waypoints/).length, 0);
  }
});

test("verified completion asks about the newly saved current step, not proof for the closed step", async () => {
  const db = database();
  const query = db.query;
  let completed = false;
  db.query = async (sql, params) => {
    if (/SELECT kind, subtype FROM documents/.test(sql)) return { rows: [{ kind: "client_upload", subtype: "dispute_mail_receipt" }] };
    if (/UPDATE client_waypoints\s+SET state = 'done'/.test(sql)) completed = true;
    if (completed && /SELECT \* FROM client_waypoints/.test(sql)) return { rows: [{ id: "next-step", key: "next_job", title: "Next actual client job", owner_kind: "client", state: "not_started", position: 2 }] };
    return query(sql, params);
  };
  const out = await handleInbound(event, db, model(JSON.stringify({ intent: "ask_proof", action: { type: "verify_progress" } })));
  assert.equal(out.reason, "replied");
  assert.equal(completed, true);
  const body = db.find(/INSERT INTO messages/)[0].params[4];
  assert.match(body, /^Saved evidence passed the checklist check/);
  assert.match(body, /What is your next update on "Next actual client job"\?/);
  assert.doesNotMatch(body, /Can you upload the proof for "Mail letters"/);
});
