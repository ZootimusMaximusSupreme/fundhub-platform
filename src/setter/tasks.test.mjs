import { test } from "node:test";
import assert from "node:assert/strict";
import { createSetterTaskForEvent, setterTasksEnabled } from "./tasks.mjs";

const event = (name, id = "event-1") => ({ id, orgId: "org-1", clientId: "client-1", name, payload: {} });

test("setter task groups repeat opt-ins and booking posts but keeps separate work types", async () => {
  const rows = [];
  const db = { async query(sql, params) {
    if (sql.includes("FROM clients") && sql.includes("FOR UPDATE")) return { rows: [{ id: params[1] }] };
    if (sql.includes("SELECT t.id, t.body")) {
      return { rows: rows.filter(r => r.orgId === params[0] && r.clientId === params[1] &&
        r.source === "setter-booking" && !r.done).map(r => ({ id: r.id, body: r.body, done: r.done,
          event_start_time: r.startTime })) };
    }
    if (sql.includes("SELECT id, done FROM tasks")) {
      const hit = rows.filter(r => r.orgId === params[0] && r.clientId === params[1] &&
        r.source === "setter-entry").sort((a, b) => Number(a.done) - Number(b.done) ||
        Number(b.id.slice(5)) - Number(a.id.slice(5)))[0];
      return { rows: hit ? [{ id: hit.id, done: hit.done }] : [] };
    }
    if (sql.includes("SELECT id FROM tasks")) {
      const hit = sql.includes("done = false")
        ? rows.find(r => r.orgId === params[0] && r.clientId === params[1] && r.source === params[2] && !r.done)
        : rows.find(r => r.clientId === params[0] && r.source === params[1] && r.body === params[2]);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (sql.includes("INSERT INTO tasks")) {
      rows.push({ id: `task-${rows.length + 1}`, orgId: params[0], clientId: params[1],
        body: params[3], source: params[5], role: params[6], done: false,
        startTime: String(params[3] || "").startsWith("setter-booking:") ? String(params[3]).slice(15) : null });
      return { rows: [{ id: rows.at(-1).id }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  } };
  const booking = { ...event("booking.created"), payload: { startTime: "2026-10-29T23:00:00Z" } };
  assert.equal((await createSetterTaskForEvent(booking, db)).created, true);
  assert.equal((await createSetterTaskForEvent({ ...booking, id: "event-3",
    payload: { startTime: "2026-10-29T23:00:00.000Z" } }, db)).created, false);
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-2"), db)).created, true);
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-4"), db)).created, false);
  assert.deepEqual(await createSetterTaskForEvent({ ...booking, id: "event-5",
    payload: { startTime: "2026-10-30T23:00:00Z" } }, db),
    { created: false, id: "task-1", reason: "open_task" });
  assert.equal(rows.length, 2);
  rows[0].done = true;
  assert.equal((await createSetterTaskForEvent({ ...booking, id: "event-5",
    payload: { startTime: "2026-10-30T23:00:00Z" } }, db)).created, true);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.role), ["setter", "setter", "setter"]);
  assert.deepEqual(rows.map(r => r.source), ["setter-booking", "setter-entry", "setter-booking"]);
  rows[1].done = true;
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-6"), db)).created, true);
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-7"), db)).created, false);
  assert.equal(rows.length, 4);
});

test("setter task creation is configurable and disabled events make no write", async () => {
  assert.equal(setterTasksEnabled({ SETTER_TASKS_ENABLED: "false" }), false);
  const db = { query() { throw new Error("should not write"); } };
  assert.deepEqual(await createSetterTaskForEvent(event("booking.created"), db, { SETTER_TASKS_ENABLED: "0" }),
    { created: false, reason: "disabled" });
});

test("a historical booking task with an event-ID body still blocks the same call slot", async () => {
  const db = { async query(sql, params) {
    if (sql.includes("FROM clients") && sql.includes("FOR UPDATE")) return { rows: [{ id: "client-1" }] };
    assert.match(sql, /SELECT t\.id, t\.body/);
    assert.deepEqual(params, ["org-1", "client-1"]);
    return { rows: [{ id: "old-task", body: "old-event-id", done: false,
      event_start_time: "2026-10-29T23:00:00Z" }] };
  } };
  const result = await createSetterTaskForEvent({ ...event("booking.created", "new-event-id"),
    payload: { startTime: "2026-10-29T23:00:00.000Z" } }, db);
  assert.deepEqual(result, { created: false, id: "old-task", reason: "duplicate_open_task" });
});

test("setter task resolves the existing event client by email without creating a CRM contact", async () => {
  const sqlSeen = [];
  const db = { async query(sql, params) {
    sqlSeen.push(sql);
    if (sql.includes("FROM clients")) {
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: "client-1" }] };
      assert.deepEqual(params, ["org-1", "pat@example.com"]);
      return { rows: [{ id: "client-1" }] };
    }
    if (sql.includes("FROM tasks")) return { rows: [] };
    if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "task-1" }] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  const result = await createSetterTaskForEvent({ ...event("entry.captured"), clientId: null,
    payload: { email: " Pat@Example.com " } }, db);
  assert.equal(result.created, true);
  assert.equal(sqlSeen.some(sql => /INSERT INTO clients|ghl/i.test(sql)), false);
});
