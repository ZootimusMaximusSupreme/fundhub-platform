// Front-of-house Meet-link safety: real SQL against disposable GitHub Actions Postgres.
// This file is intentionally unable to write to Supabase or any remote DB.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createTask } from "../lib/create-task.mjs";
import { fillMeetingUrl } from "./store.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

const START = "2026-11-18T20:00:00.000Z";
const MEET = "https://meet.google.com/kcz-tqvb-xyz";
let orgId;
const clientIds = [];

before(async () => {
  if (SCRATCH) orgId = await resolveDefaultOrg(db);
});

after(async () => {
  if (!SCRATCH) return;
  try {
    if (clientIds.length) {
      await db.query("DELETE FROM tasks WHERE client_id = ANY($1::uuid[])", [clientIds]);
      await db.query("DELETE FROM bookings WHERE client_id = ANY($1::uuid[])", [clientIds]);
      await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [clientIds]);
    }
  } finally {
    await close();
  }
});

async function client(suffix) {
  const email = `front-house-meet+${suffix}@example.invalid`;
  const row = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, phone, custom_fields)
     VALUES ($1, $2, 'Meet', $3, '+15550009999', '{}'::jsonb)
     RETURNING id`,
    [orgId, email, suffix]
  );
  const id = row.rows[0].id;
  clientIds.push(id);
  return id;
}

async function booking(clientId, uid, status = "booked") {
  const r = await db.query(
    `INSERT INTO bookings (org_id, client_id, source, provider_uid, starts_at, status)
     VALUES ($1, $2, 'ci-synthetic', $3, $4, $5) RETURNING id`,
    [orgId, clientId, uid, START, status]
  );
  return r.rows[0].id;
}

async function task(clientId, uid, done = false) {
  const created = await createTask(db, {
    orgId, clientId, title: "Strategy session booked", sourceWorkflow: "ci-meet-ownership",
    assigneeRole: "closer", eventId: uid, dueAt: START
  });
  assert.equal(created.created, true);
  if (done) await db.query("UPDATE tasks SET done = true WHERE id = $1", [created.id]);
  return created.id;
}

async function linkOf(table, id) {
  const r = await db.query(`SELECT meeting_url FROM ${table} WHERE id=$1`, [id]);
  return r.rows[0]?.meeting_url ?? null;
}

test("wrong-client booking UID cannot receive another customer's Meet room or update their task", { skip: !SCRATCH }, async () => {
  const a = await client("wrong-owner-a");
  const b = await client("wrong-owner-b");
  const bBooking = await booking(b, "ci-meet-wrong-owner");
  const aTask = await task(a, "ci-meet-wrong-owner");
  const result = await fillMeetingUrl(db, {
    orgId, clientId: a, providerUid: "ci-meet-wrong-owner", startsAt: START, url: MEET
  });
  assert.deepEqual(result, { bookings: 0, tasks: 0 });
  assert.equal(await linkOf("bookings", bBooking), null, "no cross-client booking write");
  assert.equal(await linkOf("tasks", aTask), null, "no task link without matching active booking");
});

test("cancelled and no-show calls never acquire a stale Join link", { skip: !SCRATCH }, async () => {
  for (const status of ["cancelled", "noshow", "completed"]) {
    const c = await client(`terminal-${status}`);
    const uid = `ci-meet-terminal-${status}`;
    const b = await booking(c, uid, status);
    const t = await task(c, uid, true);
    const result = await fillMeetingUrl(db, { orgId, clientId: c, providerUid: uid, startsAt: START, url: MEET });
    assert.deepEqual(result, { bookings: 0, tasks: 0 }, status);
    assert.equal(await linkOf("bookings", b), null, `${status} booking stays closed`);
    assert.equal(await linkOf("tasks", t), null, `${status} task stays closed`);
  }
});

test("active matching booking fills exactly once; replay never changes its task again", { skip: !SCRATCH }, async () => {
  const c = await client("legitimate");
  const uid = "ci-meet-valid";
  const b = await booking(c, uid, "rescheduled");
  const t = await task(c, uid);
  const spec = { orgId, clientId: c, providerUid: uid, startsAt: START, url: MEET };
  assert.deepEqual(await fillMeetingUrl(db, spec), { bookings: 1, tasks: 1 });
  assert.equal(await linkOf("bookings", b), MEET);
  assert.equal(await linkOf("tasks", t), MEET);
  assert.deepEqual(await fillMeetingUrl(db, spec), { bookings: 0, tasks: 0 });
});

test("completed closer task is not reopened or supplied a Join link", { skip: !SCRATCH }, async () => {
  const c = await client("task-done");
  const uid = "ci-meet-task-done";
  const b = await booking(c, uid);
  const t = await task(c, uid, true);
  const result = await fillMeetingUrl(db, { orgId, clientId: c, providerUid: uid, startsAt: START, url: MEET });
  assert.deepEqual(result, { bookings: 1, tasks: 0 });
  assert.equal(await linkOf("bookings", b), MEET);
  assert.equal(await linkOf("tasks", t), null);
});

test("promoted appointment UID still fills its original form-ID task when the booking already has the same link", { skip: !SCRATCH }, async () => {
  const c = await client("promoted-uid");
  const b = await booking(c, "ci-meet-new-appointment-id");
  const t = await task(c, "ci-meet-old-form-id");
  await db.query("UPDATE bookings SET meeting_url = $1 WHERE id = $2", [MEET, b]);
  const result = await fillMeetingUrl(db, {
    orgId, clientId: c, providerUid: "ci-meet-old-form-id", startsAt: START, url: MEET
  });
  assert.deepEqual(result, { bookings: 0, tasks: 1 });
  assert.equal(await linkOf("bookings", b), MEET);
  assert.equal(await linkOf("tasks", t), MEET);
});
