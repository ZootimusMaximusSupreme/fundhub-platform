import { test } from "node:test";
import assert from "node:assert/strict";
import { createSetterTaskForEvent, setterTasksEnabled } from "./tasks.mjs";

const event = (name, id = "event-1") => ({ id, orgId: "org-1", clientId: "client-1", name, payload: {} });

test("setter has one open task per kind, then a new task after completion", async () => {
  const rows = [];
  const db = { async query(sql, params) {
    if (sql.includes("FROM clients") && sql.includes("FOR UPDATE")) return { rows: [{ id: params[1] }] };
    if (sql.includes("SELECT id FROM tasks")) {
      const hit = sql.includes("done = false")
        ? rows.find(r => r.orgId === params[0] && r.clientId === params[1] && r.source === params[2] && !r.done)
        : rows.find(r => r.clientId === params[0] && r.source === params[1] && r.eventId === params[2]);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (sql.includes("INSERT INTO tasks")) {
      rows.push({ id: `task-${rows.length + 1}`, orgId: params[0], clientId: params[1],
        eventId: params[3], source: params[5], role: params[6], done: false });
      return { rows: [{ id: rows.at(-1).id }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  } };
  assert.equal((await createSetterTaskForEvent(event("booking.created"), db)).created, true);
  assert.equal((await createSetterTaskForEvent(event("booking.created"), db)).created, false);
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-2"), db)).created, true);
  assert.deepEqual(await createSetterTaskForEvent(event("entry.captured", "event-3"), db),
    { created: false, id: "task-2", reason: "open_task" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.role), ["setter", "setter"]);
  assert.deepEqual(rows.map(r => r.source), ["setter-booking", "setter-entry"]);
  rows[1].done = true;
  assert.equal((await createSetterTaskForEvent(event("entry.captured", "event-4"), db)).created, true);
  assert.equal(rows.length, 3);
});

test("setter task creation is configurable and disabled events make no write", async () => {
  assert.equal(setterTasksEnabled({ SETTER_TASKS_ENABLED: "false" }), false);
  const db = { query() { throw new Error("should not write"); } };
  assert.deepEqual(await createSetterTaskForEvent(event("booking.created"), db, { SETTER_TASKS_ENABLED: "0" }),
    { created: false, reason: "disabled" });
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
    if (sql.includes("SELECT id FROM tasks")) return { rows: [] };
    if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "task-1" }] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  const result = await createSetterTaskForEvent({ ...event("entry.captured"), clientId: null,
    payload: { email: " Pat@Example.com " } }, db);
  assert.equal(result.created, true);
  assert.equal(sqlSeen.some(sql => /INSERT INTO clients|ghl/i.test(sql)), false);
});
