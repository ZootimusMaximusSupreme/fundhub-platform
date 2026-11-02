// Real-Postgres proof for reversible setter dial logs. Never run against production.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { latestUndoableDial, setterNumbers, updateSetterHandoff } from "./dashboard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const slug = `setter-undo-${process.pid}-${Date.now()}`;
let orgId;
let otherOrgId;
let actorId;
let otherActorId;

const actor = () => ({ id: actorId, org_id: orgId, role: "owner", name: "Undo Owner" });
const otherActor = () => ({ id: otherActorId, org_id: orgId, role: "owner", name: "Other Owner" });
const now = () => new Date();
const phoenixDay = value => {
  const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query("INSERT INTO orgs (slug, name) VALUES ($1, 'Undo Test') RETURNING id", [slug])).rows[0].id;
  otherOrgId = (await db.query("INSERT INTO orgs (slug, name) VALUES ($1, 'Other Undo Test') RETURNING id", [`${slug}-other`])).rows[0].id;
  actorId = (await db.query("INSERT INTO staff (org_id, name, role) VALUES ($1, 'Undo Owner', 'owner') RETURNING id", [orgId])).rows[0].id;
  otherActorId = (await db.query("INSERT INTO staff (org_id, name, role) VALUES ($1, 'Other Owner', 'owner') RETURNING id", [orgId])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  // The audit tables intentionally grant no DELETE to the app role. The test
  // database is disposable; its unique synthetic rows leave with that database.
  await close();
});

async function client() {
  return (await db.query(
    `INSERT INTO clients (org_id, first_name, email, custom_fields)
     VALUES ($1, 'Undo', $2, '{}'::jsonb) RETURNING id`,
    [orgId, `${randomUUID()}@undo.test`]
  )).rows[0].id;
}

async function handoff(clientId) {
  const row = (await db.query("SELECT custom_fields->'setter_handoff' AS h FROM clients WHERE id = $1", [clientId])).rows[0];
  return row.h || {};
}

async function log(clientId, operationId = randomUUID(), at = now()) {
  return updateSetterHandoff(db, actor(), {
    client_id: clientId, action: "log_dial", operation_id: operationId, handoff: {}
  }, { now: () => at });
}

async function undo(clientId, eventId, staff = actor(), at = null) {
  return updateSetterHandoff(db, staff, { client_id: clientId, action: "undo_dial", event_id: eventId },
    at ? { now: () => at } : {});
}

test("dial retry logs once; Undo restores count and Phoenix-day KPI with audit", { skip: !HAS_DB }, async () => {
  const id = await client();
  const op = randomUUID();
  const first = await log(id, op);
  assert.equal(first.status, 200);
  assert.ok(first.body.dial_event.event_id);
  const replay = await log(id, op);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.dial_event.event_id, first.body.dial_event.event_id);
  assert.equal(replay.body.dial_event.replayed, true);
  assert.equal((await handoff(id)).call_attempts, 1);
  assert.equal((await setterNumbers(db, actor())).dials, 1);
  assert.equal((await latestUndoableDial(db, actor())).event_id, first.body.dial_event.event_id);

  // A later checklist edit is kept while Undo changes only the dial counters.
  const edit = await updateSetterHandoff(db, actor(), { client_id: id, action: "save", handoff: { goal: "Keep this" } });
  assert.equal(edit.status, 200);
  const reversed = await undo(id, first.body.dial_event.event_id);
  assert.equal(reversed.status, 200);
  const h = await handoff(id);
  assert.equal(h.call_attempts, 0);
  assert.equal(h.goal, "Keep this");
  assert.equal(h.dial_attempt_days?.[phoenixDay(now())] ?? 0, 0);
  assert.equal((await setterNumbers(db, actor())).dials, 0);
  assert.equal(await latestUndoableDial(db, actor()), null);
  assert.equal((await undo(id, first.body.dial_event.event_id)).status, 200);
  const audit = await db.query(
    `SELECT e.setter_staff_id, e.reversed_by_staff_id, r.actor_staff_id,
            e.attempt_before, e.attempt_after, count(r.event_id) OVER () AS reversals
       FROM setter_dial_events e JOIN setter_dial_reversals r USING (event_id)
      WHERE e.event_id = $1`, [first.body.dial_event.event_id]
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].setter_staff_id, actorId);
  assert.equal(audit.rows[0].actor_staff_id, actorId);
  assert.equal(audit.rows[0].attempt_before, 0);
  assert.equal(audit.rows[0].attempt_after, 1);
});

test("two concurrent retries of one operation produce one dial", { skip: !HAS_DB }, async () => {
  const id = await client();
  const op = randomUUID();
  const [a, b] = await Promise.all([log(id, op), log(id, op)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.dial_event.event_id, b.body.dial_event.event_id);
  assert.equal((await handoff(id)).call_attempts, 1);
  const count = await db.query("SELECT count(*)::int AS n FROM setter_dial_events WHERE client_id = $1", [id]);
  assert.equal(count.rows[0].n, 1);
  const [firstUndo, secondUndo] = await Promise.all([
    undo(id, a.body.dial_event.event_id), undo(id, a.body.dial_event.event_id)
  ]);
  assert.equal(firstUndo.status, 200);
  assert.equal(secondUndo.status, 200);
  assert.equal((await handoff(id)).call_attempts, 0);
  const reversals = await db.query("SELECT count(*)::int AS n FROM setter_dial_reversals WHERE event_id = $1", [a.body.dial_event.event_id]);
  assert.equal(reversals.rows[0].n, 1);
});

test("a Save read before a concurrent dial preserves the dial ledger and day", { skip: !HAS_DB }, async () => {
  const id = await client();
  assert.equal((await log(id)).status, 200);
  let interleaved = false;
  const racedDb = { query: async (sql, params) => {
    if (!interleaved && sql.includes("UPDATE clients") && sql.includes("'{setter_handoff}'")) {
      interleaved = true;
      assert.equal((await log(id)).status, 200);
    }
    return db.query(sql, params);
  } };
  const saved = await updateSetterHandoff(racedDb, actor(), {
    client_id: id, action: "save", expected_call_attempts: 1,
    handoff: { call_attempts: 1, goal: "Saved after the dial" }
  });
  assert.equal(saved.status, 200);
  const h = await handoff(id);
  assert.equal(h.call_attempts, 2);
  assert.equal(h.dial_attempt_days[phoenixDay(now())], 2);
  assert.equal(h.goal, "Saved after the dial");
  const events = await db.query("SELECT count(*)::int AS n FROM setter_dial_events WHERE client_id = $1", [id]);
  assert.equal(events.rows[0].n, 2);
});

test("a completed handoff hides Undo and keeps its dial count and completion", { skip: !HAS_DB }, async () => {
  const id = await client();
  const event = (await log(id)).body.dial_event.event_id;
  await db.query(
    `UPDATE clients SET custom_fields = jsonb_set(custom_fields, '{setter_handoff,complete_at}', to_jsonb($2::text), true)
      WHERE id = $1`, [id, now().toISOString()]
  );
  assert.notEqual((await latestUndoableDial(db, actor()))?.event_id, event);
  const refused = await undo(id, event);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "handoff_already_complete");
  const h = await handoff(id);
  assert.equal(h.call_attempts, 1);
  assert.ok(h.complete_at);
  const audit = await db.query("SELECT reversed_at FROM setter_dial_events WHERE event_id = $1", [event]);
  assert.equal(audit.rows[0].reversed_at, null);
});

test("an already reversed dial still returns success after later completion", { skip: !HAS_DB }, async () => {
  const id = await client();
  const event = (await log(id)).body.dial_event.event_id;
  assert.equal((await undo(id, event)).status, 200);
  await db.query(
    `UPDATE clients SET custom_fields = jsonb_set(custom_fields, '{setter_handoff,complete_at}', to_jsonb($2::text), true)
      WHERE id = $1`, [id, now().toISOString()]
  );
  const retry = await undo(id, event);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.dial_event.undone, true);
});

test("a later dial blocks Undo after a manual reset makes both counts equal", { skip: !HAS_DB }, async () => {
  const id = await client();
  const futurePhoenixDay = phoenixDay(new Date(Date.now() + 2 * 86400000));
  const midnight = new Date(`${futurePhoenixDay}T07:00:00Z`);
  const beforeMidnight = new Date(midnight.getTime() - 60000);
  const afterMidnight = new Date(midnight.getTime() + 60000);
  const first = await log(id, randomUUID(), beforeMidnight);
  await db.query(
    `UPDATE clients SET custom_fields = jsonb_set(custom_fields, '{setter_handoff,call_attempts}', '0'::jsonb, true)
      WHERE id = $1`, [id]
  );
  const second = await log(id, randomUUID(), afterMidnight);
  assert.equal(first.body.item.setter_handoff.call_attempts, 1);
  assert.equal(second.body.item.setter_handoff.call_attempts, 1);
  assert.equal((await handoff(id)).dial_attempt_days[phoenixDay(beforeMidnight)], 1);
  assert.equal((await latestUndoableDial(db, actor()))?.event_id, second.body.dial_event.event_id);
  assert.equal((await undo(id, first.body.dial_event.event_id, actor(), new Date(afterMidnight.getTime() + 60000))).status, 409);
  assert.equal((await handoff(id)).call_attempts, 1);
});

test("No answer Log Dial is not undoable because it can queue a text cadence", { skip: !HAS_DB }, async () => {
  const id = await client();
  const at = now();
  const result = await updateSetterHandoff(db, actor(), {
    client_id: id, action: "log_dial", operation_id: randomUUID(), handoff: { disposition: "no_answer" }
  }, { now: () => at, emit: async () => ({ id: randomUUID() }) });
  assert.equal(result.status, 200);
  assert.ok(new Date(result.body.dial_event.undo_until).getTime() < at.getTime());
  assert.notEqual((await latestUndoableDial(db, actor()))?.event_id, result.body.dial_event.event_id);
  const refused = await undo(id, result.body.dial_event.event_id, actor(), at);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "dial_undo_blocked_by_followup");
  assert.equal((await handoff(id)).call_attempts, 1);
});

test("saving No answer permanently blocks Undo before the text cadence", { skip: !HAS_DB }, async () => {
  const id = await client();
  const event = (await log(id)).body.dial_event.event_id;
  const saved = await updateSetterHandoff(db, actor(), {
    client_id: id, action: "save", expected_call_attempts: 1,
    handoff: { disposition: "no_answer", call_attempts: 1 }
  }, { emit: async () => ({ id: randomUUID() }) });
  assert.equal(saved.status, 200);
  const blocked = await db.query("SELECT undo_blocked_at FROM setter_dial_events WHERE event_id = $1", [event]);
  assert.ok(blocked.rows[0].undo_blocked_at);
  assert.notEqual((await latestUndoableDial(db, actor()))?.event_id, event);
  assert.equal((await undo(id, event)).body.error, "dial_undo_blocked_by_followup");
  const changed = await updateSetterHandoff(db, actor(), {
    client_id: id, action: "save", expected_call_attempts: 1, handoff: { disposition: "reached" }
  });
  assert.equal(changed.status, 200);
  assert.notEqual((await latestUndoableDial(db, actor()))?.event_id, event);
  assert.equal((await undo(id, event)).body.error, "dial_undo_blocked_by_followup");
  assert.equal((await handoff(id)).call_attempts, 1);
});

test("newer dial blocks stale Undo; a fake clock proves the expiry", { skip: !HAS_DB }, async () => {
  const id = await client();
  const first = await log(id);
  const second = await log(id);
  assert.equal((await undo(id, first.body.dial_event.event_id)).status, 409);
  assert.equal((await handoff(id)).call_attempts, 2);
  assert.equal((await undo(id, second.body.dial_event.event_id)).status, 200);
  assert.equal((await handoff(id)).call_attempts, 1);

  const olderId = await client();
  const at = new Date("2026-10-30T20:00:00Z");
  const oldEvent = await log(olderId, randomUUID(), at);
  const expired = await undo(olderId, oldEvent.body.dial_event.event_id,
    actor(), new Date("2026-10-30T20:11:00Z"));
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error, "dial_undo_expired");
  assert.equal((await handoff(olderId)).call_attempts, 1);
});

test("another actor, another org, and an unassigned setter cannot reverse the event", { skip: !HAS_DB }, async () => {
  const id = await client();
  const event = (await log(id)).body.dial_event.event_id;
  assert.equal((await undo(id, event, otherActor())).status, 404);
  assert.equal((await undo(id, event, { ...actor(), org_id: otherOrgId })).status, 404);
  assert.equal((await undo(id, event, { ...actor(), role: "setter" })).status, 403);
  assert.equal((await handoff(id)).call_attempts, 1);
});

test("a fixed operation key cannot be reused for another client", { skip: !HAS_DB }, async () => {
  const firstId = await client();
  const secondId = await client();
  const op = randomUUID();
  assert.equal((await log(firstId, op)).status, 200);
  const conflict = await log(secondId, op);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "dial_operation_conflict");
  assert.equal((await handoff(secondId)).call_attempts ?? 0, 0);
});

test("crossing Phoenix midnight and Undo changes only the newest day's dial", { skip: !HAS_DB }, async () => {
  const id = await client();
  const beforeMidnight = new Date("2026-11-01T06:59:00Z"); // Oct 31 11:59 p.m. Phoenix
  const afterMidnight = new Date("2026-11-01T07:01:00Z");  // Nov 1 12:01 a.m. Phoenix
  const first = await log(id, randomUUID(), beforeMidnight);
  const second = await log(id, randomUUID(), afterMidnight);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const persistedDay = await db.query(
    "SELECT phoenix_day::text AS day FROM setter_dial_events WHERE event_id = $1",
    [second.body.dial_event.event_id]
  );
  assert.equal(persistedDay.rows[0].day, "2026-11-01");
  assert.deepEqual((await handoff(id)).dial_attempt_days, { "2026-10-31": 1, "2026-11-01": 1 });
  const reversed = await undo(id, second.body.dial_event.event_id, actor(), new Date("2026-11-01T07:02:00Z"));
  assert.equal(reversed.status, 200);
  const h = await handoff(id);
  assert.equal(h.call_attempts, 1);
  assert.equal(h.dial_attempt_days["2026-10-31"], 1);
  assert.equal(h.dial_attempt_days["2026-11-01"] ?? 0, 0);
  assert.equal(h.dialed_at, beforeMidnight.toISOString());
});

test("a later legacy dial hides the old Undo arrow and blocks stale reversal", { skip: !HAS_DB }, async () => {
  const id = await client();
  const event = (await log(id)).body.dial_event.event_id;
  const legacy = await updateSetterHandoff(db, actor(), { client_id: id, action: "log_dial", handoff: {} });
  assert.equal(legacy.status, 200);
  assert.notEqual((await latestUndoableDial(db, actor()))?.event_id, event);
  assert.equal((await undo(id, event)).status, 409);
  assert.equal((await handoff(id)).call_attempts, 2);
});


test("legacy dial writes serialize with Undo instead of restoring a stale counter", {skip: !HAS_DB}, async () => {
  const id=await client();
  const first=await log(id);
  const [legacy,reversed]=await Promise.all([
    updateSetterHandoff(db,actor(),{client_id:id,action:"log_dial",handoff:{}}),
    undo(id,first.body.dial_event.event_id)
  ]);
  assert.equal(legacy.status,200);
  assert.ok([200,409].includes(reversed.status));
  const expected=reversed.status===200?1:2;
  const current=await handoff(id);
  assert.equal(current.call_attempts,expected);
  assert.equal(current.dial_attempt_days[phoenixDay(now())],expected);
});
test("two legacy dial requests retain both real dial increments", {skip: !HAS_DB}, async () => {
  const id=await client();
  const results=await Promise.all([1,2].map(()=>updateSetterHandoff(db,actor(),
    {client_id:id,action:"log_dial",handoff:{}})));
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  const current=await handoff(id);
  assert.equal(current.call_attempts,2);
  assert.equal(current.dial_attempt_days[phoenixDay(now())],2);
});
