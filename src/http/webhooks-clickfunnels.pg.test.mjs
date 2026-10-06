/* Postgres-backed: one booked call, moved and cancelled, through the real
 * ClickFunnels door (src/http/router.mjs → src/adapters/clickfunnels.mjs →
 * src/handlers/comms.mjs → src/bookings/store.mjs).
 *
 * WHAT THIS PINS THAT THE IN-MEMORY TESTS CANNOT. src/adapters/
 * clickfunnels-booking-moves.test.mjs proves the decisions against a fake. It
 * cannot prove that the real unique index (org_id, provider_uid) makes a move
 * UPDATE the row instead of adding one, that upsertBooking's raw->'__history'
 * append really records the old time, that the re-key of an earlier booking is
 * legal SQL, or that bookingStateAt's jsonb_array_elements / timestamptz cast
 * reads that history back. Every claim here is asserted against ROWS.
 *
 * cf-calendar-switch-plan-2026-09-22 §4(a) named this file: "a booking, then a
 * move, then a cancel all land on one booking row".
 *
 * SAFETY. INNGEST_EVENT_KEY and GHL_API_KEY are removed for the run, so no event
 * leaves for the workflow engine (no text can be queued by a workflow) and no
 * contact goes to the CRM. Every row this file writes carries NONCE in the email
 * and is removed afterwards. Run it against a scratch database only:
 *   DATABASE_URL="postgres://…/scratch" node --test src/http/webhooks-clickfunnels.pg.test.mjs
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs. It lives under
 * src/http/ because package.json's test glob never reaches api/ (CLAUDE.md §12).
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { handleWebhook } from "./router.mjs";
import { _resetOrgCache, defaultOrgId } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";
import { bookingStateAt, SLOT_STATE } from "../bookings/store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const NONCE = `m8calmoves${process.pid}${Date.now()}`;
const SECRET = "cf_moves_pg_secret";
const hmac = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const iso = (v) => new Date(v).toISOString();
// A ClickFunnels-shaped numeric call id nobody else's row will hold.
const callIdBase = 900000000 + (Date.now() % 90000000);

function cfAppointment(kind, { eventId, callId, startOn, endOn, email }) {
  return JSON.stringify({
    data: {
      id: callId,
      public_id: "pgM8",
      workspace_id: 789,
      event_type: { name: "Meeting with Chris" },
      start_on: startOn,
      end_on: endOn,
      status: kind === "canceled" ? "canceled" : "scheduled",
      primary_contact: { id: 1, email_address: email, first_name: "Mo", last_name: "Ver", phone_number: "+16025550111" },
      tzid: "America/Phoenix"
    },
    page: null,
    funnel: null,
    event_id: eventId,
    created_at: new Date().toISOString(),
    event_type: `appointments/scheduled_event.${kind}`,
    subject_id: callId,
    api_version: 2,
    subject_type: "Appointments::ScheduledEvent",
    workspace_id: 789
  });
}

describe("ClickFunnels booked call: create → move → cancel on one row", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  const saved = {};
  let orgId;

  const deliver = async (raw) => {
    _resetOrgCache(); clearHandlers(); _resetRegistered();
    const out = await handleWebhook({
      db, provider: "clickfunnels", rawBody: raw,
      headers: { "x-webhook-clickfunnels-signature": hmac(raw) },
      url: "https://x/api/webhooks/clickfunnels",
      env: { CLICKFUNNELS_WEBHOOK_SECRET: SECRET }
    });
    assert.equal(out.status, 200, `delivery refused: ${JSON.stringify(out.body).slice(0, 200)}`);
    return out;
  };
  const bookingsFor = async (email) => (await db.query(
    `SELECT * FROM bookings WHERE org_id = $1 AND lower(attendee_email) = $2 ORDER BY created_at`,
    [orgId, email])).rows;
  const clientFor = async (email) => (await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2`, [orgId, email])).rows[0]?.id;
  const tasksFor = async (clientId) => (await db.query(
    `SELECT title, body, done, due_at FROM tasks WHERE client_id = $1 AND title LIKE 'Strategy session%' ORDER BY created_at`,
    [clientId])).rows;

  async function purge() {
    if (!orgId) return;
    const like = `%${NONCE}%`;
    const ids = (await db.query(`SELECT id FROM clients WHERE org_id = $1 AND email LIKE $2`, [orgId, like])).rows.map((r) => r.id);
    await db.query(`DELETE FROM bookings WHERE org_id = $1 AND attendee_email LIKE $2`, [orgId, like]);
    if (ids.length) await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM events WHERE org_id = $1 AND payload->>'email' LIKE $2`, [orgId, like]);
    await db.query(`DELETE FROM webhook_captures WHERE provider = 'clickfunnels' AND raw_body LIKE $1`, [like]);
    if (ids.length) await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
  }

  before(async () => {
    for (const k of ["INNGEST_EVENT_KEY", "GHL_API_KEY", "CF_CAPTURE_MODE"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    _resetOrgCache();
    orgId = await defaultOrgId(db);
    await purge();
  });

  after(async () => {
    await purge();
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    await close();
  });

  test("one call: create, move, cancel → ONE bookings row, ONE task, history kept", async () => {
    const email = `mover-${NONCE}@example.com`;
    const callId = callIdBase + 1;
    const oldStart = inHours(30), oldEnd = inHours(30.5);
    const newStart = inHours(54), newEnd = inHours(54.5);

    await deliver(cfAppointment("created", { eventId: `${NONCE}-c`, callId, startOn: oldStart, endOn: oldEnd, email }));
    let rows = await bookingsFor(email);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider_uid, String(callId), "the booking was not saved under the call's own id");
    assert.equal(rows[0].status, "booked");
    const clientId = await clientFor(email);
    assert.ok(clientId);

    await deliver(cfAppointment("rescheduled", { eventId: `${NONCE}-m`, callId, startOn: newStart, endOn: newEnd, email }));
    rows = await bookingsFor(email);
    assert.equal(rows.length, 1, "a move made a second booking");
    assert.equal(iso(rows[0].starts_at), iso(newStart));
    assert.equal(rows[0].status, "rescheduled");
    const history = rows[0].raw.__history || [];
    assert.equal(history.length, 1, "the old time was not kept");
    assert.equal(iso(history[0].starts_at), iso(oldStart));
    assert.equal(await bookingStateAt(db, { orgId, clientId, bookingUid: String(callId), startTime: oldStart }), SLOT_STATE.MOVED);
    assert.equal(await bookingStateAt(db, { orgId, clientId, bookingUid: String(callId), startTime: newStart }), SLOT_STATE.ON);
    let tasks = await tasksFor(clientId);
    assert.equal(tasks.length, 1, "a move made a second closer task");
    assert.equal(tasks[0].body, String(callId));
    assert.equal(tasks[0].title, "Strategy session rescheduled");

    await deliver(cfAppointment("canceled", { eventId: `${NONCE}-x`, callId, startOn: newStart, endOn: newEnd, email }));
    rows = await bookingsFor(email);
    assert.equal(rows.length, 1, "a cancel made a booking");
    assert.equal(rows[0].status, "cancelled", "the cancel closed nothing");
    assert.equal(await bookingStateAt(db, { orgId, clientId, bookingUid: String(callId), startTime: newStart }), SLOT_STATE.CANCELLED);
    tasks = await tasksFor(clientId);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].done, true);

    const evts = (await db.query(
      `SELECT name, payload->>'bookingUid' AS uid FROM events
        WHERE org_id = $1 AND payload->>'email' = $2 AND name LIKE 'booking.%' ORDER BY created_at`,
      [orgId, email])).rows;
    assert.deepEqual(evts.map((e) => e.name), ["booking.created", "booking.rescheduled", "booking.cancelled"]);
    assert.ok(evts.every((e) => e.uid === String(callId)), "an event named a different booking id");
  });

  test("ClickFunnels re-sending the same move message is stored once", async () => {
    const email = `resend-${NONCE}@example.com`;
    const callId = callIdBase + 2;
    await deliver(cfAppointment("created", { eventId: `${NONCE}-rc`, callId, startOn: inHours(30), endOn: inHours(30.5), email }));
    const move = cfAppointment("rescheduled", { eventId: `${NONCE}-rm`, callId, startOn: inHours(54), endOn: inHours(54.5), email });
    await deliver(move);
    await deliver(move);
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM events WHERE org_id = $1 AND payload->>'email' = $2 AND name = 'booking.rescheduled'`,
      [orgId, email])).rows[0].n;
    assert.equal(n, 1);
    const rows = await bookingsFor(email);
    assert.equal(rows.length, 1);
    assert.equal((rows[0].raw.__history || []).length, 1);
  });

  test("a call saved under an old message id is re-keyed by its move, not duplicated", async () => {
    const email = `earlier-${NONCE}@example.com`;
    const callId = callIdBase + 3;
    const oldUid = crypto.randomUUID();
    const oldStart = inHours(30), newStart = inHours(54);
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name) VALUES ($1, $2, 'Earlier') RETURNING id`,
      [orgId, email])).rows[0].id;
    await db.query(
      `INSERT INTO bookings (org_id, client_id, source, provider_uid, starts_at, ends_at, status, attendee_email, raw)
       VALUES ($1, $2, 'clickfunnels', $3, $4, $5, 'booked', $6, '{}'::jsonb)`,
      [orgId, clientId, oldUid, oldStart, inHours(30.5), email]);
    await db.query(
      `INSERT INTO tasks (org_id, client_id, title, body, due_at, source_workflow, assignee_role)
       VALUES ($1, $2, 'Strategy session booked', $3, $4, 'clickfunnels', 'closer')`,
      [orgId, clientId, oldUid, oldStart]);

    await deliver(cfAppointment("rescheduled", { eventId: `${NONCE}-em`, callId, startOn: newStart, endOn: inHours(54.5), email }));
    const rows = await bookingsFor(email);
    assert.equal(rows.length, 1, "the earlier booking was duplicated instead of moved");
    assert.equal(rows[0].provider_uid, String(callId));
    assert.equal(iso(rows[0].starts_at), iso(newStart));
    const tasks = await tasksFor(clientId);
    assert.equal(tasks.length, 1, "the move made a second closer task");
    assert.equal(tasks[0].body, String(callId));
    assert.equal(await bookingStateAt(db, { orgId, clientId, startTime: oldStart }), SLOT_STATE.MOVED);
  });
});
