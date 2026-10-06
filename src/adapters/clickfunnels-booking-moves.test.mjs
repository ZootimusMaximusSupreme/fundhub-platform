// A booked call, moved and cancelled, through the real ClickFunnels message shape.
//
// WHAT THIS PINS. A real ClickFunnels appointment webhook has no top-level `id`:
// the envelope carries `event_id` (new on every delivery) and `subject_id`, and
// `data` is the scheduled event itself (shape from
// https://developers.myclickfunnels.com/docs/webhook-event-types.md, and
// measured 2026-10-05 on the 5 appointment webhooks ClickFunnels still lists for
// this workspace: data.id === subject_id on every one). The adapter used to save
// each booking under `event_id`, so a move made a second booking and a cancel
// closed nothing. These tests drive create → move → cancel through the adapter
// AND the booking handlers in src/handlers/comms.mjs, against an in-memory fake
// whose bookings branch honours the (org_id, provider_uid) unique index and the
// raw->'__history' append from src/bookings/store.mjs.
//
// The same claims run against a real database in
// src/http/webhooks-clickfunnels.pg.test.mjs (skipped without DATABASE_URL).

import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { handleClickFunnelsWebhook, normalizeClickFunnelsEvent } from "./clickfunnels.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";
import { onBookingCreated, onBookingRescheduled, onBookingCancelled } from "../handlers/comms.mjs";
import { bookingStateAt, SLOT_STATE } from "../bookings/store.mjs";

const SECRET = "whsec_cf_moves_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const iso = (v) => new Date(v).toISOString();
const sameInstant = (a, b) => a != null && b != null && Date.parse(a) === Date.parse(b);
const likeMatches = (value, like) => String(value ?? "").startsWith(String(like ?? "").replace(/%$/, ""));

/* The envelope exactly as ClickFunnels documents and sends it. */
function cfAppointment(kind, { eventId, callId = 72509, startOn, endOn, email = "mover@example.com" }) {
  return JSON.stringify({
    data: {
      id: callId,
      public_id: "jAqozx",
      workspace_id: 789,
      event_type: { name: "Meeting with Chris" },
      start_on: startOn,
      end_on: endOn,
      status: kind === "canceled" ? "canceled" : "scheduled",
      max_invitees: 1,
      order_id: null,
      primary_contact: {
        id: 1516037818, public_id: "asdfkj", email_address: email,
        first_name: "Mo", last_name: "Ver", phone_number: "+16025550111"
      },
      tzid: "America/Phoenix",
      comments: null,
      created_at: "2026-10-05T15:01:00.000Z",
      updated_at: "2026-10-05T15:01:00.000Z"
    },
    page: null,
    funnel: null,
    event_id: eventId,
    created_at: "2026-10-05T15:01:01.000Z",
    event_type: `appointments/scheduled_event.${kind}`,
    subject_id: callId,
    api_version: 2,
    subject_type: "Appointments::ScheduledEvent",
    workspace_id: 789
  });
}

/* clients + events + bookings + tasks, each branch mirroring the real SQL. */
function bookingDb() {
  const clients = [];
  const events = [];
  const bookings = [];
  const tasks = [];
  let n = 0;
  return {
    clients, events, bookings, tasks,
    async query(sql, params = []) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };

      // --- clients (resolveClient) ---
      if (/SELECT id, ghl_contact_id FROM clients/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && c.email === params[1]);
        return { rows: c ? [{ id: c.id, ghl_contact_id: "crm-1" }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (clients.find((c) => c.org_id === params[0] && c.email === params[1])) return { rows: [] };
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1] });
        return { rows: [{ id }] };
      }
      if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ ...c, ghl_contact_id: "crm-1" }] : [] };
      }
      if (/UPDATE clients/.test(sql)) return { rows: [] };

      // --- events (bus emit; idempotency key unique per org) ---
      if (/INSERT INTO events/.test(sql)) {
        const [org_id, name, version, idem, client_id, payload] = params;
        if (idem && events.some((e) => e.org_id === org_id && e.idempotency_key === idem)) return { rows: [] };
        const id = "evt-" + ++n;
        events.push({ id, org_id, name, version, idempotency_key: idem, client_id, payload });
        return { rows: [{ id }] };
      }

      // --- bookings ---
      if (/was_at_this_time/.test(sql)) {
        // bookingStateAt: WHERE org_id = $1 AND (client_id = $2 OR provider_uid = $4)
        const [orgId, clientId, at, uid] = params;
        const rows = bookings
          .filter((b) => b.org_id === orgId && ((clientId && b.client_id === clientId) || (uid && b.provider_uid === uid)))
          .map((b) => ({
            status: b.status,
            at_this_time: sameInstant(b.starts_at, at),
            was_at_this_time: (b.raw?.__history || []).some((h) => sameInstant(h.starts_at, at))
          }));
        return { rows };
      }
      if (/IS NOT DISTINCT FROM/.test(sql) && /FROM bookings/.test(sql)) {
        // findBookingBySlot
        const [orgId, email, start] = params;
        const b = bookings.find((b) => b.org_id === orgId
          && String(b.attendee_email || "").toLowerCase() === email && sameInstant(b.starts_at, start));
        return { rows: b ? [{ id: b.id, client_id: b.client_id, provider_uid: b.provider_uid }] : [] };
      }
      if (/source = 'clickfunnels'/.test(sql) && /FROM bookings/.test(sql)) {
        // adoptEarlierBooking candidates
        const [orgId, email, slot] = params;
        const floor = Date.now() - 24 * 3600 * 1000;
        const rows = bookings
          .filter((b) => b.org_id === orgId
            && String(b.attendee_email || "").toLowerCase() === email
            && b.source === "clickfunnels"
            && ["booked", "rescheduled"].includes(b.status ?? "booked")
            && b.starts_at && Date.parse(b.starts_at) >= floor
            && (slot == null || sameInstant(b.starts_at, slot)))
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
          .slice(0, 2)
          .map((b) => ({ id: b.id, client_id: b.client_id, provider_uid: b.provider_uid }));
        return { rows };
      }
      if (/SELECT id FROM bookings WHERE org_id = \$1 AND provider_uid = \$2/.test(sql)) {
        const b = bookings.find((b) => b.org_id === params[0] && b.provider_uid === params[1]);
        return { rows: b ? [{ id: b.id }] : [] };
      }
      if (/UPDATE bookings\s+SET provider_uid/.test(sql)) {
        // promoteBookingUid
        const [nextUid, meetingUrl, orgId, id] = params;
        const b = bookings.find((b) => b.org_id === orgId && b.id === id);
        if (b) { b.provider_uid = nextUid; b.meeting_url = meetingUrl ?? b.meeting_url; }
        return { rows: [] };
      }
      if (/UPDATE bookings\s+SET status/.test(sql)) {
        const [orgId, uid, status] = params;
        const hits = bookings.filter((b) => b.org_id === orgId && b.provider_uid === uid);
        for (const b of hits) b.status = status;
        return { rows: hits };
      }
      if (/INSERT INTO bookings/.test(sql)) {
        const [org_id, client_id, source, provider_uid, starts_at, ends_at, status,
          meeting_url, attendee_email, attendee_name, event_type_slug, rawJson] = params;
        const raw = rawJson == null ? null : JSON.parse(rawJson);
        const existing = provider_uid
          ? bookings.find((b) => b.org_id === org_id && b.provider_uid === provider_uid)
          : null;
        if (existing) {
          // DO UPDATE: COALESCE every field; append the old time to __history
          // when the start time really changes (src/bookings/store.mjs).
          const history = [...(existing.raw?.__history || [])];
          if (starts_at && existing.starts_at && !sameInstant(starts_at, existing.starts_at)) {
            history.push({ starts_at: existing.starts_at, ends_at: existing.ends_at, status: existing.status, superseded_at: iso(Date.now()) });
          }
          for (const [k, v] of Object.entries({ client_id, starts_at, ends_at, status, meeting_url, attendee_email, attendee_name, event_type_slug })) {
            if (v != null) existing[k] = v;
          }
          existing.raw = { ...(existing.raw || {}), ...(raw || {}), __history: history };
          return { rows: [existing] };
        }
        const row = {
          id: "bk-" + (bookings.length + 1), org_id, client_id, source, provider_uid,
          starts_at, ends_at, status, meeting_url, attendee_email, attendee_name, event_type_slug,
          raw: { ...(raw || {}), __history: [] }
        };
        bookings.push(row);
        return { rows: [row] };
      }

      // --- tasks ---
      if (/UPDATE tasks SET body = \$1 WHERE client_id = \$2 AND body = \$3/.test(sql)) {
        for (const t of tasks) if (t.client_id === params[1] && t.body === params[2]) t.body = params[0];
        return { rows: [] };
      }
      if (/UPDATE tasks[\s\S]*SET[\s\S]*due_at = COALESCE/.test(sql)) {
        const [clientId, uid, dueAt, meetingUrl, titleLike, newTitle] = params;
        const t = tasks.find((t) => t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike));
        if (!t) return { rows: [] };
        t.due_at = dueAt ?? t.due_at;
        t.meeting_url = meetingUrl ?? t.meeting_url;
        t.title = newTitle;
        t.done = false;
        return { rows: [{ id: t.id }] };
      }
      if (/UPDATE tasks SET done = true/.test(sql)) {
        const [clientId, uid, titleLike] = params;
        const t = tasks.find((t) => t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike) && !t.done);
        if (t) t.done = true;
        return { rows: [] };
      }
      if (/SELECT 1 FROM tasks/.test(sql)) {
        const [clientId, uid, titleLike] = params;
        const t = tasks.find((t) => t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike));
        return { rows: t ? [{ x: 1 }] : [] };
      }
      if (/SELECT id FROM tasks/.test(sql) && /source_workflow = \$2 AND body = \$3/.test(sql)) {
        const t = tasks.find((t) => t.client_id === params[0] && t.source_workflow === params[1] && t.body === params[2]);
        return { rows: t ? [{ id: t.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const row = {
          id: "task-" + (tasks.length + 1), org_id: params[0], client_id: params[1],
          title: params[2], body: params[3], due_at: params[4], source_workflow: params[5],
          assignee_role: params[6] ?? null, meeting_url: params[8] ?? null, done: false
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

function wireHandlers() {
  _resetOrgCache();
  clearHandlers();
  on("booking.created", onBookingCreated);
  on("booking.rescheduled", onBookingRescheduled);
  on("booking.cancelled", onBookingCancelled);
}

const deliver = (db, raw) => handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });

// ── the id ───────────────────────────────────────────────────────────────────

test("real envelope: the booking id is the call's own id, the bus key stays the message id", () => {
  const evt = normalizeClickFunnelsEvent(JSON.parse(cfAppointment("created", {
    eventId: "ab10330c-aa29-4755-a121-6f535809bc75", startOn: inHours(30), endOn: inHours(30.5)
  })));
  assert.equal(evt.type, "appointments/scheduled_event.created");
  assert.equal(evt.callId, "72509");
  assert.equal(evt.bookingUid, "72509", "the booking must be saved under data.id, not the message id");
  assert.equal(evt.id, "ab10330c-aa29-4755-a121-6f535809bc75",
    "the message id still keys repeat deliveries on the bus");
});

test("subject_id answers when data carries no id", () => {
  const body = JSON.parse(cfAppointment("rescheduled", { eventId: "msg-x", startOn: inHours(30), endOn: inHours(30.5) }));
  delete body.data.id;
  const evt = normalizeClickFunnelsEvent(body);
  assert.equal(evt.bookingUid, "72509");
});

test("a non-appointment post never gets a call id", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "form_submission.created", event_id: "fs-1",
    data: { id: 1, data: { contact: { email: "f@example.com" }, appointments_schedule_request: { email: "f@example.com", start_on: inHours(30) } } }
  });
  assert.equal(evt.callId, null);
  assert.equal(evt.bookingUid, "fs-1");
});

// ── create → move → cancel ──────────────────────────────────────────────────

test("create, move, cancel of one call land on ONE booking row and ONE task", async () => {
  wireHandlers();
  const db = bookingDb();
  const oldStart = inHours(30), oldEnd = inHours(30.5);
  const newStart = inHours(54), newEnd = inHours(54.5);

  const r1 = await deliver(db, cfAppointment("created", { eventId: "msg-create", startOn: oldStart, endOn: oldEnd }));
  assert.deepEqual(r1.emitted.map((e) => e.name), ["booking.created"]);
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].provider_uid, "72509");

  const r2 = await deliver(db, cfAppointment("rescheduled", { eventId: "msg-move", startOn: newStart, endOn: newEnd }));
  assert.deepEqual(r2.emitted.map((e) => e.name), ["booking.rescheduled"]);
  assert.equal(db.bookings.length, 1, "a move made a second booking");
  assert.equal(iso(db.bookings[0].starts_at), iso(newStart), "the booking did not move");
  assert.equal(db.bookings[0].status, "rescheduled");
  assert.equal(db.tasks.length, 1, "a move made a second closer task");
  assert.equal(db.tasks[0].title, "Strategy session rescheduled");
  assert.equal(iso(db.tasks[0].due_at), iso(newStart));

  // The jobs that wait for a call time can now tell what happened.
  const clientId = db.clients[0].id;
  assert.equal(await bookingStateAt(db, { orgId: "org-1", clientId, bookingUid: "72509", startTime: oldStart }), SLOT_STATE.MOVED);
  assert.equal(await bookingStateAt(db, { orgId: "org-1", clientId, bookingUid: "72509", startTime: newStart }), SLOT_STATE.ON);

  const r3 = await deliver(db, cfAppointment("canceled", { eventId: "msg-cancel", startOn: newStart, endOn: newEnd }));
  assert.deepEqual(r3.emitted.map((e) => e.name), ["booking.cancelled"]);
  assert.equal(db.bookings.length, 1, "a cancel made a booking");
  assert.equal(db.bookings[0].status, "cancelled", "the cancel closed nothing");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].done, true, "the closer task is still open after a cancel");
  assert.equal(await bookingStateAt(db, { orgId: "org-1", clientId, bookingUid: "72509", startTime: newStart }), SLOT_STATE.CANCELLED);

  // Every booking event names the same call.
  const uids = db.events.filter((e) => e.name.startsWith("booking.")).map((e) => e.payload.bookingUid);
  assert.deepEqual(uids, ["72509", "72509", "72509"]);
});

test("two moves of one call are two real messages: both land, on the same row", async () => {
  wireHandlers();
  const db = bookingDb();
  const t1 = inHours(30), t2 = inHours(54), t3 = inHours(78);
  await deliver(db, cfAppointment("created", { eventId: "m-1", startOn: t1, endOn: t1 }));
  await deliver(db, cfAppointment("rescheduled", { eventId: "m-2", startOn: t2, endOn: t2 }));
  const r = await deliver(db, cfAppointment("rescheduled", { eventId: "m-3", startOn: t3, endOn: t3 }));
  assert.equal(r.emitted[0].deduped, false, "the second move was swallowed as a repeat");
  assert.equal(db.bookings.length, 1);
  assert.equal(iso(db.bookings[0].starts_at), iso(t3));
  assert.deepEqual(db.bookings[0].raw.__history.map((h) => iso(h.starts_at)), [iso(t1), iso(t2)]);
});

test("ClickFunnels re-sending the SAME move message changes nothing the second time", async () => {
  wireHandlers();
  const db = bookingDb();
  const t1 = inHours(30), t2 = inHours(54);
  await deliver(db, cfAppointment("created", { eventId: "m-a", startOn: t1, endOn: t1 }));
  const raw = cfAppointment("rescheduled", { eventId: "m-b", startOn: t2, endOn: t2 });
  await deliver(db, raw);
  const again = await deliver(db, raw);
  assert.equal(again.emitted[0].deduped, true);
  assert.equal(db.events.filter((e) => e.name === "booking.rescheduled").length, 1);
  assert.equal(db.bookings[0].raw.__history.length, 1);
});

// ── a call booked before this fix (saved under a message id) ────────────────

function seedEarlierBooking(db, { start, end, uid = "1f2e3d4c-0000-4000-8000-000000000001", email = "mover@example.com" }) {
  db.clients.push({ id: "cl-old", org_id: "org-1", email });
  db.bookings.push({
    id: "bk-old", org_id: "org-1", client_id: "cl-old", source: "clickfunnels", provider_uid: uid,
    starts_at: iso(start), ends_at: iso(end), status: "booked", attendee_email: email,
    raw: { bookingUid: uid, __history: [] }
  });
  db.tasks.push({
    id: "task-old", org_id: "org-1", client_id: "cl-old", title: "Strategy session booked",
    body: uid, due_at: iso(start), source_workflow: "clickfunnels", assignee_role: "closer", done: false
  });
}

test("earlier booking: its move is re-keyed to the call id and moves the same row and task", async () => {
  wireHandlers();
  const db = bookingDb();
  const oldStart = inHours(30), newStart = inHours(54);
  seedEarlierBooking(db, { start: oldStart, end: inHours(30.5) });

  await deliver(db, cfAppointment("rescheduled", { eventId: "msg-move-old", startOn: newStart, endOn: inHours(54.5) }));
  assert.equal(db.bookings.length, 1, "the earlier booking was duplicated instead of moved");
  assert.equal(db.bookings[0].id, "bk-old");
  assert.equal(db.bookings[0].provider_uid, "72509");
  assert.equal(iso(db.bookings[0].starts_at), iso(newStart));
  assert.equal(db.tasks.length, 1, "the move made a second closer task");
  assert.equal(db.tasks[0].body, "72509");
  assert.equal(db.tasks[0].title, "Strategy session rescheduled");
  assert.equal(await bookingStateAt(db, { orgId: "org-1", clientId: "cl-old", startTime: oldStart }), SLOT_STATE.MOVED);
});

test("earlier booking: its cancel (same time) closes the same row", async () => {
  wireHandlers();
  const db = bookingDb();
  const start = inHours(30), end = inHours(30.5);
  seedEarlierBooking(db, { start, end });
  await deliver(db, cfAppointment("canceled", { eventId: "msg-cancel-old", startOn: start, endOn: end }));
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].status, "cancelled", "the cancel of an earlier booking closed nothing");
  assert.equal(db.tasks[0].done, true);
});

test("earlier booking: a cancel at a DIFFERENT time does not touch it", async () => {
  wireHandlers();
  const db = bookingDb();
  seedEarlierBooking(db, { start: inHours(30), end: inHours(30.5) });
  await deliver(db, cfAppointment("canceled", { eventId: "msg-cancel-other", startOn: inHours(80), endOn: inHours(80.5) }));
  assert.equal(db.bookings[0].provider_uid, "1f2e3d4c-0000-4000-8000-000000000001");
  assert.equal(db.bookings[0].status, "booked");
});

test("earlier bookings: two live ones for that email → neither is guessed at", async () => {
  wireHandlers();
  const db = bookingDb();
  seedEarlierBooking(db, { start: inHours(30), end: inHours(30.5) });
  db.bookings.push({
    id: "bk-old-2", org_id: "org-1", client_id: "cl-old", source: "clickfunnels",
    provider_uid: "2f2e3d4c-0000-4000-8000-000000000002", starts_at: iso(inHours(40)), ends_at: iso(inHours(40.5)),
    status: "booked", attendee_email: "mover@example.com", raw: { __history: [] }
  });
  await deliver(db, cfAppointment("rescheduled", { eventId: "msg-move-ambiguous", startOn: inHours(54), endOn: inHours(54.5) }));
  assert.equal(db.bookings.find((b) => b.id === "bk-old").provider_uid, "1f2e3d4c-0000-4000-8000-000000000001");
  assert.equal(db.bookings.find((b) => b.id === "bk-old-2").provider_uid, "2f2e3d4c-0000-4000-8000-000000000002");
});
