import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDb } from "../testing/handler-harness.mjs";
import { BLUEPRINT_CALL_ELIGIBILITY_SQL, BLUEPRINT_CALL_EXCEPTION_SOURCE, blueprintCallKey,
  deliverBlueprintCoachCall, runBlueprintCoachCalls } from "./coach-call.mjs";
import { runNudges } from "../nudge/run.mjs";

const now = new Date("2026-10-20T18:00:00Z");
const candidate = { waypoint_id: "waypoint-a", org_id: "org-a", client_id: "client-a", key: "mail", title: "Mail letters" };
const context = { client: { id: candidate.client_id, flags: {} }, blueprint: { access_active: true },
  checklist: { open_step: { key: "mail", title: "Mail letters", owner: "client", state: "in_progress", verify_kind: "dispute_mail_receipt" } },
  as_prompt_block: "Current step Mail letters. Prior SMS: asked for receipt. Prior call: client needs help." };
const agent = { code: "BP-COACH-VOICE", name: "Capital Blueprint AI Coach — Voice", status: "live", channel: "voice", agent_class: "client_facing", runtime: "bland", prompt: "You are the Fundhub AI coach, not the human advisor.", guardrails: { authority: { msgcap: 3 } } };

function fixture(overrides = {}) {
  let claim = null;
  let calls = 0;
  let receipts = 0;
  let tasks = 0;
  const storedClient = { id: candidate.client_id, org_id: candidate.org_id, phone: "+16025550100", custom_fields: { timezone: "America/Phoenix" }, ...(overrides.client || {}) };
  const db = fakeDb([
    [/FROM clients/, () => [{ ...storedClient }]],
    [/FROM agents/, [overrides.agent || agent]],
    [/FROM messaging_settings/, [{ outbound_enabled: true, daily_send_cap: 500, ...(overrides.settings || {}) }]],
    [/SELECT count\(\*\)::int AS n/, [{ n: overrides.count || 0 }]],
    [/INSERT INTO waypoint_nudges/, () => claim ? [] : [claim = { id: "claim-a", outcome: "claimed" }]],
    [/DELETE FROM waypoint_nudges/, () => { claim = null; return []; }],
    [/INSERT INTO messages/, overrides.messageFailure ? new Error("receipt save failed") : [{ id: "voice-message-a" }]],
    [/SELECT org_id,client_id FROM outbound_calls/, [{ org_id: candidate.org_id, client_id: overrides.attributedClient || candidate.client_id }]],
    [/UPDATE waypoint_nudges SET outcome='queued'/, () => { claim.outcome = "queued"; return [{ id: claim.id }]; }]
  ]);
  const deps = { now, env: { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: "unit-placeholder" },
    currentCandidateImpl: async () => candidate,
    blockersForImpl: async () => [], isOptedOutImpl: async () => false,
    prepareTurnImpl: async () => ({ ok: true, context }),
    gateImpl: async () => ({ state: "allowed" }),
    placeCallImpl: async (spec) => { calls++; assert.match(spec.agent.prompt, /Prior SMS.*Prior call/); assert.equal(spec.metadata.org_id, candidate.org_id); return { status: "sent", callId: "call-a" }; },
    recordDispatchImpl: async (spec) => { receipts++; assert.equal(spec.kind, BLUEPRINT_CALL_EXCEPTION_SOURCE); },
    threadMessageImpl: async () => {},
    createTaskImpl: async (_db, spec) => { tasks++; assert.equal(spec.sourceWorkflow, BLUEPRINT_CALL_EXCEPTION_SOURCE); assert.equal(spec.eventId, blueprintCallKey(candidate.waypoint_id)); return { created: true, id: "task-a" }; },
    ...(overrides.deps || {}) };
  return { db, deps, storedClient, stats: () => ({ calls, receipts, tasks, claim }) };
}

test("automatic call eligibility requires two actual accepted Blueprint SMS receipts on the same unchanged current step", () => {
  for (const fragment of ["n1.step = 1", "n3.step = 3", "first_message.status IN ('sent', 'delivered')",
    "second_message.status IN ('sent', 'delivered')", "provider_message_id", "NOT IN ('internal', 'memory')",
    "SMS-BLUEPRINT-COACH-DUE", "SMS-BLUEPRINT-COACH-NUDGE-2", "w.updated_at <= first_message.created_at",
    "prior.owner_kind = 'client'", "reply.direction = 'inbound'", "reply.created_at >= first_message.created_at",
    "cv.agent_halted_at IS NOT NULL", "NOT IN ('BP-COACH', 'BP-COACH-VOICE')", "e.active", "called.step = 5"]) {
    assert.ok(BLUEPRINT_CALL_ELIGIBILITY_SQL.includes(fragment), fragment);
  }
  assert.doesNotMatch(BLUEPRINT_CALL_ELIGIBILITY_SQL, /status\s*=\s*'queued'|interval '[0-9]+ (?:days|hours)'/);
});

test("one provider call saves dispatch attribution, canonical voice message and shared ledger receipt", async () => {
  const { db, deps, stats } = fixture();
  const result = await deliverBlueprintCoachCall(db, candidate, deps);
  assert.equal(result.placed, true);
  assert.equal(result.callId, "call-a");
  assert.deepEqual(stats(), { calls: 1, receipts: 1, tasks: 0, claim: { id: "claim-a", outcome: "queued" } });
  const claim = db.find(/INSERT INTO waypoint_nudges/)[0];
  assert.match(claim.sql, /5,'voice_call','voice'.*'claimed'/s);
  assert.equal(claim.params[5], "2026-10-20");
  assert.equal(claim.params[7], "6025550100");
  const message = db.find(/INSERT INTO messages/)[0];
  assert.equal(message.params[3], blueprintCallKey(candidate.waypoint_id));
  assert.equal(message.params[4], "call-a");
  assert.match(message.sql, /'sent',true,'agent'/);
});

test("parallel scheduler attempts win a single call claim, not a second call", async () => {
  const { db, deps, stats } = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => deliverBlueprintCoachCall(db, candidate, deps)));
  assert.equal(results.filter((result) => result.placed).length, 1);
  assert.equal(stats().calls, 1);
});

test("quiet hours, DND, synthetic records, opt-out, paused org, draft agent and cap hold before any claim", async () => {
  for (const override of [
    { deps: { now: new Date("2026-10-20T08:00:00Z") } },
    { client: { dnd_voice: true } }, { client: { is_demo: true } }, { client: { custom_fields: { synthetic: true } } },
    { deps: { isOptedOutImpl: async () => true } }, { settings: { outbound_enabled: false } },
    { agent: { ...agent, status: "draft" } }, { count: 500 },
    { deps: { env: {} } }, { deps: { blockersForImpl: async () => ["escalation"] } },
    { deps: { prepareTurnImpl: async () => ({ ok: false, reason: "blueprint_access_inactive" }) } }
  ]) {
    const { db, deps, stats } = fixture(override);
    assert.equal((await deliverBlueprintCoachCall(db, candidate, deps)).placed, false);
    assert.equal(stats().calls, 0);
    assert.equal(db.find(/INSERT INTO waypoint_nudges/).length, 0);
  }
});

test("reply/progress/current-step changes during model/context preparation prevent a stale call", async () => {
  for (const stopAt of [1, 2, 3, 4]) {
    let checks = 0;
    const { db, deps, stats } = fixture({ deps: { currentCandidateImpl: async () => ++checks === stopAt ? null : candidate } });
    assert.equal((await deliverBlueprintCoachCall(db, candidate, deps)).reason, "call_sequence_changed");
    assert.equal(stats().calls, 0);
    assert.equal(stats().claim, null);
    if (stopAt >= 3) assert.equal(db.find(/DELETE FROM waypoint_nudges/).length, 1);
  }
});

test("explicit provider fence hold gives back only its unresolved own claim, so later activation can recover", async () => {
  const f = fixture({ deps: { placeCallImpl: async () => ({ status: "failed", blocked: true }) } });
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, f.deps)).reason, "messaging_fence_held");
  assert.equal(f.stats().claim, null);
  const deletion = f.db.find(/DELETE FROM waypoint_nudges/)[0];
  assert.match(deletion.sql, /step = 5.*kind = 'voice_call'.*outcome = 'claimed'.*message_id IS NULL/s);
  const retry = fixture();
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, { ...f.deps, placeCallImpl: retry.deps.placeCallImpl })).placed, true);
});

test("uncertain provider errors retain the claim and save a human exception, never automatically redial", async () => {
  const f = fixture({ deps: { placeCallImpl: async () => { throw new Error("timeout after provider may have accepted"); } } });
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, f.deps)).failed, true);
  assert.equal(f.stats().claim.outcome, "claimed");
  assert.equal(f.stats().tasks, 1);
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, f.deps)).reason, "call_or_daily_cap_claimed");
  assert.equal(f.db.find(/DELETE FROM waypoint_nudges/).length, 0);
});

test("accepted call whose receipt save fails is reported as placed but incomplete and never releases the claim", async () => {
  const f = fixture({ messageFailure: true });
  const result = await deliverBlueprintCoachCall(f.db, candidate, f.deps);
  assert.equal(result.placed, true);
  assert.equal(result.reason, "call_attribution_incomplete");
  assert.equal(f.stats().tasks, 1);
  assert.equal(f.stats().claim.outcome, "claimed");
  assert.equal(f.db.find(/DELETE FROM waypoint_nudges/).length, 0);
});

test("a reused provider call ID belonging to another client cannot be filed as this client's successful call", async () => {
  const f = fixture({ attributedClient: "other-client" });
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, f.deps)).reason, "call_attribution_incomplete");
  assert.equal(f.db.find(/INSERT INTO messages/).length, 0);
  assert.equal(f.stats().tasks, 1);
});

test("the existing hourly nudge pass revisits accepted-text call candidates even with no new text candidates", async () => {
  let callPasses = 0;
  const db = fakeDb();
  const result = await runNudges(db, { now, runCoachCalls: async (_db, spec) => {
    callPasses++; assert.equal(spec.now, now); return { considered: 1, placed: 1, skipped: 0, failed: 0 };
  } });
  assert.equal(callPasses, 1);
  assert.equal(result.coach_calls.placed, 1);
});

test("call sweep plan/check failures stay visible and never escape the hourly pass", async () => {
  const result = await runBlueprintCoachCalls({ query: async () => { throw new Error("db down"); } }, { now });
  assert.equal(result.failed, 1);
  assert.equal(result.reason, "call_plan_failed");
});

test("call orchestration uses one durable plan and per-client steps, preserving SDK yield control flow", async () => {
  const steps = [];
  const db = fakeDb([[/SELECT w.id AS waypoint_id/, [candidate]]]);
  const result = await runBlueprintCoachCalls(db, { now, step: { run: async (id, run) => {
    steps.push(id); return run();
  } }, currentCandidateImpl: async () => null });
  assert.deepEqual(steps, ["blueprint-coach-call-plan", "blueprint-coach-call:waypoint-a"]);
  assert.equal(result.skipped, 1);
  const control = new Error("SDK yield");
  await assert.rejects(runBlueprintCoachCalls(db, { now, step: { run: async () => { throw control; } } }), (error) => error === control);
});

test("a durable old plan uses the current delivery window and current day's cap", async () => {
  for (const [at, expected] of [[new Date("2026-10-21T04:00:00Z"), false], [new Date("2026-10-21T18:00:00Z"), true]]) {
    const f = fixture();
    const query = f.db.query;
    f.db.query = (sql, params) => /SELECT w.id AS waypoint_id/.test(sql)
      ? Promise.resolve({ rows: [candidate] }) : query(sql, params);
    const result = await runBlueprintCoachCalls(f.db, { ...f.deps, now,
      deliveryNow: () => at, step: { run: async (_id, run) => run() } });
    assert.equal(result.placed, expected ? 1 : 0);
    if (expected) assert.equal(f.db.find(/INSERT INTO waypoint_nudges/)[0].params[5], "2026-10-21");
    else assert.equal(result.results[0].reason, "quiet_hours");
  }
});

test("a call whose preparation crosses into quiet hours releases its unsent claim", async () => {
  const f = fixture({ deps: { deliveryNow: () => new Date("2026-10-21T04:00:00Z") } });
  assert.equal((await deliverBlueprintCoachCall(f.db, candidate, f.deps)).reason, "quiet_hours");
  assert.equal(f.stats().calls, 0);
  assert.equal(f.stats().claim, null);
});

test("phone, zone, DND and demo changes during call preparation release the old contact claim before dialing", async () => {
  for (const changed of [{ phone: "+16025550200" }, { custom_fields: { timezone: "America/New_York" } },
    { dnd_voice: true }, { is_demo: true }, { custom_fields: { timezone: "America/Phoenix", synthetic: true } }]) {
    const f = fixture();
    let preparations = 0;
    const result = await deliverBlueprintCoachCall(f.db, candidate, { ...f.deps,
      prepareTurnImpl: async () => {
        if (++preparations === 2) Object.assign(f.storedClient, changed);
        return { ok: true, context };
      } });
    assert.equal(result.placed, false);
    assert.ok(["call_contact_changed", "dnd_voice", "synthetic_client"].includes(result.reason));
    assert.equal(f.stats().calls, 0);
    assert.equal(f.stats().claim, null);
    const clientReads = f.db.find(/SELECT id, org_id, phone, dnd_voice, is_demo, custom_fields FROM clients/);
    assert.equal(clientReads.length, 2);
    assert.deepEqual(clientReads[1].params, [candidate.client_id, candidate.org_id]);
    assert.equal(f.db.find(/DELETE FROM waypoint_nudges/).length, 1);
  }
});

test("489 extends only exact Blueprint voice receipt shape and preserves existing daily indexes and human rung", () => {
  const sql = readFileSync(new URL("../../db/migrations/489_blueprint_coach_call_ledger.sql", import.meta.url), "utf8");
  assert.match(sql, /kind = 'staff_task' AND step = 4/);
  assert.match(sql, /kind = 'voice_call' AND step = 5 AND channel = 'voice'/);
  assert.match(sql, /template_key IS NOT NULL/);
  assert.match(sql, /template_key = 'BP-COACH-VOICE'/);
  assert.match(sql, /channel IS NOT NULL AND channel IN \('sms', 'email'\)/);
  assert.doesNotMatch(sql, /DROP (?:TABLE|INDEX)|DELETE FROM|TRUNCATE|UPDATE public|GRANT|DISABLE ROW LEVEL/i);
});
