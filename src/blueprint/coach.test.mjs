import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "../testing/handler-harness.mjs";
import {
  prepareBlueprintCoachTurn, applyBlueprintCoachAction, blueprintCoachReminder,
  blueprintCoachCallTask, parseBlueprintCoachReply, BLUEPRINT_COACH_INSTRUCTIONS, blueprintCoachQuestion
} from "./coach.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const scope = { orgId: ORG, clientId: CLIENT, conversationId: "thread", channel: "sms",
  eventId: "inbound-1", inboundBody: "I am stuck mailing my letters. Please ask my advisor for help.",
  agent: { code: "BP-COACH", status: "live" } };
function context(over = {}) {
  return { client: { id: CLIENT, flags: {} }, as_prompt_block: "Current step: Mail letters. Prior call: agreed to upload receipt.",
    blueprint: { access_active: true, human_advisor: { id: "real-advisor", name: "Alex" } },
    checklist: { open_step: { id: "step-1", key: "mail_letters", title: "Mail letters", owner: "client", state: "not_started", verify_kind: "dispute_mail_receipt" } }, ...over };
}
function deps(ctx = context()) {
  return { isBuyerImpl: async (_db, ids) => { assert.deepEqual(ids, { orgId: ORG, clientId: CLIENT }); return true; },
    fetchContextImpl: async (_db, ids) => { assert.deepEqual(ids, { orgId: ORG, clientId: CLIENT, conversationId: "thread", channel: "sms" }); return ctx; } };
}

test("coach reads the actual saved org/client, current step and prior call without a provider call", async () => {
  const result = await prepareBlueprintCoachTurn(fakeDb(), scope, deps());
  assert.equal(result.ok, true);
  assert.match(result.context.as_prompt_block, /Prior call/);
  assert.match(result.instructions, /A promise is not proof/);
  assert.match(result.instructions, /not the client's human advisor/);
});

test("unpaid, inactive, wrong-client, halted and do-not-text files cannot coach", async () => {
  assert.equal((await prepareBlueprintCoachTurn(fakeDb(), scope, { isBuyerImpl: async () => false })).reason, "not_blueprint_buyer");
  for (const [over, reason] of [
    [{ blueprint: { access_active: false } }, "blueprint_access_inactive"],
    [{ client: { id: "someone-else" } }, "client_context_unavailable"],
    [{ conversation: { agent_halted_at: "today" } }, "halted"],
    [{ client: { id: CLIENT, flags: { dnd_sms: true } } }, "dnd_sms"]
  ]) assert.equal((await prepareBlueprintCoachTurn(fakeDb(), scope, deps(context(over)))).reason, reason);
  await assert.rejects(() => prepareBlueprintCoachTurn(fakeDb(), scope, { ...deps(), fetchContextImpl: async () => { throw new Error("context read failed"); } }), /context read failed/);
});

test("only the three narrow action schemas parse; completion, IDs, SQL, extra tools never do", () => {
  for (const [intent, action] of [["ask_progress", null], ["ask_proof", { type: "verify_progress" }],
    ["ask_advisor", { type: "request_advisor" }], ["ask_blocker", { type: "report_progress", waypointKey: "mail_letters", state: "blocked" }]]) {
    assert.equal(parseBlueprintCoachReply(JSON.stringify({ intent, action })).ok, true);
  }
  for (const action of [{ type: "complete" }, { type: "report_progress", waypointKey: "mail_letters", state: "done" },
    { type: "verify_progress", crsResult: { forged: true } }, { type: "request_advisor", clientId: "other" },
    { type: "request_advisor", assigneeStaffId: "demo" }, [], "complete"]) {
    assert.equal(parseBlueprintCoachReply(JSON.stringify({ intent: "ask_progress", action })).ok, false);
  }
  for (const text of ["not json", '{"reply":""}', '{"intent":"ask_progress","reply":"Proof passed","action":null}', "[]",
    '{"intent":"unknown","action":null}', '{"intent":"ask_progress"}',
    '{"intent":"ask_proof","action":{"type":"request_advisor"}}',
    '{"intent":"ask_progress","action":{"type":"report_progress","waypointKey":"mail_letters","state":"blocked"}}']) assert.equal(parseBlueprintCoachReply(text).ok, false);
  assert.match(BLUEPRINT_COACH_INSTRUCTIONS, /The server writes every question and every status\/result/);
});

test("closed intents render server-owned questions from the actual open client step, never arbitrary model words", () => {
  assert.equal(blueprintCoachQuestion("ask_progress", context()).text, 'What is your next update on "Mail letters"?');
  assert.equal(blueprintCoachQuestion("ask_blocker", context()).text, 'What is holding you up on "Mail letters"?');
  assert.equal(blueprintCoachQuestion("ask_proof", context()).text, 'Can you upload the proof for "Mail letters"?');
  assert.equal(blueprintCoachQuestion("ask_advisor", context()).text, "Would you like help from your human advisor?");
  for (const state of ["done", "skipped"]) assert.equal(blueprintCoachQuestion("ask_progress", context({ checklist: { open_step: { title: "Mail letters", owner: "client", state } } })).ok, false);
  assert.equal(blueprintCoachQuestion("ask_proof", context({ checklist: { open_step: { title: "Mail letters", owner: "client", state: "in_progress" } } })).reason, "step_has_no_proof_check");
  assert.equal(blueprintCoachQuestion("How does it feel now that your proof passed?", context()).ok, false);
});

test("shadow, draft, retired or unrelated live agents never change progress", async () => {
  const db = fakeDb();
  for (const agent of [{ code: "BP-COACH", status: "shadow" }, { code: "BP-COACH", status: "draft" },
    { code: "BP-COACH", status: "retired" }, { code: "AG-04", status: "live" }]) {
    assert.equal((await applyBlueprintCoachAction(db, { ...scope, agent }, { type: "verify_progress" })).reason, "not_live_coach");
  }
  assert.equal(db.calls.length, 0);
});

test("a progress report records the client's words but never closes proof or a racing completed step", async () => {
  const db = fakeDb([[/UPDATE client_waypoints/, [{ id: "step-1" }]]]);
  const action = { type: "report_progress", waypointKey: "mail_letters", state: "in_progress" };
  const result = await applyBlueprintCoachAction(db, scope, action, deps());
  assert.equal(result.ok, true);
  assert.match(result.message, /still open/);
  const write = db.find(/UPDATE client_waypoints/)[0];
  assert.deepEqual(write.params.slice(0, 4), [ORG, CLIENT, "mail_letters", "in_progress"]);
  assert.match(write.params[4], /I am stuck mailing my letters/);
  assert.match(write.sql, /state IN \('not_started', 'in_progress', 'blocked'\)/);
  assert.match(write.sql, /prior\.owner_kind = 'client'/);
  assert.doesNotMatch(write.sql, /SET state = 'done'/);
  assert.equal((await applyBlueprintCoachAction(fakeDb(), scope, action, deps())).reason, "step_changed");
  for (const step of [{ key: "other", owner: "client", state: "in_progress" },
    { key: "mail_letters", owner: "fundhub", state: "in_progress" }, { key: "mail_letters", owner: "client", state: "done" }]) {
    assert.equal((await applyBlueprintCoachAction(fakeDb(), scope, action, deps(context({ checklist: { open_step: step } })))).reason, "not_current_client_step");
  }
});

test("verification can only invoke the existing saved-evidence verifier with org/client; no client promise or model result", async () => {
  let calls = 0;
  const out = await applyBlueprintCoachAction(fakeDb(), scope, { type: "verify_progress" }, { ...deps(),
    evaluateWaypointsImpl: async (_db, ids) => { calls++; assert.deepEqual(ids, { orgId: ORG, clientId: CLIENT }); return { completed: [] }; } });
  assert.equal(calls, 1);
  assert.equal(out.changed, false);
  assert.match(out.message, /no new completion proof/);
});

test("real verifier keeps a mailing promise open and closes only on stored receipt proof", async () => {
  for (const hasReceipt of [false, true]) {
    const db = fakeDb([
      [/SELECT \* FROM client_waypoints/, [{ key: "mail_letters", state: "in_progress", verify_kind: "dispute_mail_receipt" }]],
      [/SELECT kind, subtype FROM documents/, hasReceipt ? [{ kind: "client_upload", subtype: "dispute_mail_receipt" }] : []],
      [/UPDATE client_waypoints/, [{ id: "step-1" }]]
    ]);
    const out = await applyBlueprintCoachAction(db, { ...scope, inboundBody: "I promise I mailed it" }, { type: "verify_progress" }, deps());
    assert.equal(out.changed, hasReceipt);
    assert.equal(db.find(/UPDATE client_waypoints/).length, hasReceipt ? 1 : 0);
    const proof = db.find(/SELECT kind, subtype FROM documents/)[0];
    assert.deepEqual(proof.params, [ORG, CLIENT]);
    if (hasReceipt) {
      const completion = db.find(/UPDATE client_waypoints/)[0];
      assert.deepEqual(completion.params.slice(0, 3), [ORG, CLIENT, "mail_letters"]);
      assert.match(completion.sql, /state = 'done', completed_at/);
    }
  }
});

test("advisor help uses actual saved staff and event idempotency, otherwise honest CSM queue", async () => {
  for (const assigned of [true, false]) {
    let written;
    const ctx = context({ blueprint: { access_active: true, human_advisor: assigned ? { id: "real-advisor" } : null } });
    const out = await applyBlueprintCoachAction(fakeDb(), scope, { type: "request_advisor" }, { ...deps(ctx),
      createTaskImpl: async (_db, spec) => { written = spec; return { created: true, id: "task-1" }; } });
    assert.equal(written.assigneeStaffId, assigned ? "real-advisor" : null);
    assert.equal(written.assigneeRole, "csm");
    assert.equal(written.eventId, "blueprint-coach:inbound-1:advisor");
    assert.match(written.detail, /Client message:/);
    assert.match(out.message, assigned ? /advisor has a saved/ : /team's queue/);
  }
  const failure = await applyBlueprintCoachAction(fakeDb(), scope, { type: "request_advisor" }, { ...deps(), createTaskImpl: async () => ({ created: false, id: null, reason: "duplicate_race" }) });
  assert.equal(failure.ok, false);
  assert.equal(failure.message, undefined);
});

test("a saved blocker also routes one event-deduped follow-up to the assigned human", async () => {
  const db = fakeDb([[/UPDATE client_waypoints/, [{ id: "step-1" }]]]);
  let task;
  const out = await applyBlueprintCoachAction(db, scope,
    { type: "report_progress", waypointKey: "mail_letters", state: "blocked" }, {
      ...deps(), createTaskImpl: async (_db, spec) => { task = spec; return { created: true, id: "help-task" }; }
    });
  assert.equal(out.taskId, "help-task");
  assert.equal(task.assigneeStaffId, "real-advisor");
  assert.equal(task.eventId, "blueprint-coach:inbound-1:advisor");
  assert.match(out.message, /blocker is saved/);
  assert.match(out.message, /advisor has a saved follow-up task/);
});

test("reminders/call task use only current saved step and reviewed live voice identity; missing facts stay missing", () => {
  const ctx = context();
  assert.match(blueprintCoachReminder(ctx), /AI coach: Your current step is Mail letters/);
  assert.match(blueprintCoachReminder(ctx), /needs saved proof/);
  assert.doesNotMatch(blueprintCoachReminder(ctx), /deposit|tomorrow|funding approval/i);
  assert.equal(blueprintCoachReminder(context({ checklist: { open_step: null } })), null);
  const agent = { code: "BP-COACH-VOICE", status: "live", runtime: "bland", prompt: "You are the AI coach." };
  const task = blueprintCoachCallTask(agent, ctx);
  assert.match(task, /Prior call: agreed to upload receipt/);
  assert.match(task, /cannot execute checklist actions during this call/);
  for (const over of [{ status: "draft" }, { prompt: "" }, { code: "AG-04" }, { runtime: "internal" }]) assert.equal(blueprintCoachCallTask({ ...agent, ...over }, ctx), null);
});
