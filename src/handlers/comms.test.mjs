import { test } from "node:test";
import assert from "node:assert";
import {
  onMessageInbound, onCallCompleted, onMailResponse, onBookingCreated,
  onBookingRescheduled, onBookingCancelled, onBookingNoshow
} from "./comms.mjs";
import { SLO_NURTURE_TITLE, SLO_POST_PURCHASE_ENABLED } from "../slo/purchase.mjs";

// Fake pg covering the queries comms.mjs + resolveClient issue. Messages dedup is
// DB-level (ON CONFLICT) and proven in the pg integration test; the guard-based
// dedup for bank_inbox + tasks lives in app code and IS exercised here.
//
// *** A FAKE THAT DOES NOT MATCH THE REAL SQL PROVES NOTHING. ***
//
// This fake used to find a booking's task with `t.source_workflow === "calcom"`
// in both the reschedule branch and the cancel/no-show branch, while the real
// queries had already stopped filtering on the vendor label and matched on
// `title LIKE 'Strategy session%'` instead. So the fake would have gone on
// passing code that still hunted for 'calcom' — which is the exact regression
// these tests stand in front of. The branches below now mirror the real WHERE
// clauses clause for clause: matched by client, booking id and title, never by
// the label.
//
// The `bookings` branches emulate the two partial unique indexes from
// db/migrations/225_bookings.sql — (org_id, provider_uid), and
// (org_id, raw->>'__event_id') for a booking that has no provider id — so a
// replay and a phantom cancellation are both provable here, with no database.

/* The only LIKE form the real queries bind is a trailing '%'. */
const likeMatches = (value, like) =>
  String(value ?? "").startsWith(String(like ?? "").replace(/%$/, ""));

async function withSloPostPurchase(value, fn) {
  const prev = process.env[SLO_POST_PURCHASE_ENABLED];
  if (value === undefined) delete process.env[SLO_POST_PURCHASE_ENABLED];
  else process.env[SLO_POST_PURCHASE_ENABLED] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[SLO_POST_PURCHASE_ENABLED];
    else process.env[SLO_POST_PURCHASE_ENABLED] = prev;
  }
}

function pgFake() {
  const clients = [], messages = [], bank = [], tasks = [], optOuts = [], bookings = [];
  let n = 0;
  return {
    clients, messages, bank, tasks, optOuts, bookings,
    async query(sql, params = []) {
      // opt_outs support (TCPA STOP/START handling)
      if (/INSERT INTO opt_outs/.test(sql)) {
        const existing = optOuts.find((r) => r.client_id === params[0] && r.channel === params[2]);
        if (existing) { existing.opted_in_at = null; existing.source = params[3]; }
        else optOuts.push({ client_id: params[0], org_id: params[1], channel: params[2], source: params[3], opted_in_at: null });
        return { rows: [] };
      }
      if (/UPDATE opt_outs SET opted_in_at/.test(sql)) {
        const r = optOuts.find((r) => r.client_id === params[0] && r.channel === params[1]);
        if (r) r.opted_in_at = new Date();
        return { rows: [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = optOuts.find((r) => r.client_id === params[0] && r.channel === params[1] && !r.opted_in_at);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql) && /lower\(email\)/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && String(c.email || "").toLowerCase() === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql) && /phone=\$2/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && c.phone === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      // Digits-only fallback, mirroring idx_clients_phone_digits. Twilio sends
      // E.164; clients.phone is free text and not every live row is E.164.
      if (/SELECT id FROM clients/.test(sql) && /regexp_replace\(phone/.test(sql)) {
        const wanted = new Set(params[1] || []);
        const c = clients.find((c) =>
          c.org_id === params[0] && wanted.has(String(c.phone || "").replace(/\D+/g, "")));
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (clients.find((c) => c.org_id === params[0] && String(c.email || "").toLowerCase() === String(params[1]).toLowerCase())) return { rows: [] };
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], phone: params[4], tags: [], custom_fields: {} });
        return { rows: [{ id }] };
      }
      if (/INSERT INTO messages/.test(sql)) { messages.push({ sql, params }); return { rows: [] }; }
      if (/SELECT 1 FROM bank_inbox/.test(sql)) {
        return { rows: bank.find((b) => b.org_id === params[0] && b.__event_id === String(params[1])) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO bank_inbox/.test(sql)) {
        const raw = JSON.parse(params[5]);
        // subject, body_preview and raw are recorded too: the row used to carry
        // the SAME sentence in subject and body_preview, which is what erased
        // the paragraph stating the approved amount. Tests below hold that shut.
        bank.push({
          org_id: params[0], client_id: params[1], classification: params[2],
          subject: params[3], body_preview: params[4], raw,
          __event_id: raw.__event_id
        });
        return { rows: [] };
      }
      // --- clients.tags add (addTags, mirrors src/workflows/tags.mjs) ---
      if (/UPDATE clients SET tags = array\(SELECT DISTINCT unnest\(tags \|\|/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = Array.from(new Set([...(c.tags || []), ...params[1]]));
        return { rows: [] };
      }
      // --- clients.custom_fields merge (mergeCustomFields, mirrors src/workflows/custom-fields.mjs) ---
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.custom_fields = { ...(c.custom_fields || {}), ...JSON.parse(params[1]) };
        return { rows: [] };
      }
      // --- tasks: reschedule update (RETURNING id when an open row matches) ---
      // Real WHERE: client_id = $1 AND body = $2 AND title LIKE $5.
      // NO source_workflow filter — that is the whole point.
      if (/UPDATE tasks[\s\S]*SET[\s\S]*due_at = COALESCE/.test(sql)) {
        const [clientId, uid, dueAt, meetingUrl, titleLike, newTitle] = params;
        const t = tasks.find((t) =>
          t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike));
        if (!t) return { rows: [] };
        // Match the live UPDATE: a new slot invalidates the old Meet URL;
        // a replay for the SAME slot preserves any newly discovered URL.
        const moved = dueAt != null && (
          t.due_at == null || new Date(dueAt).getTime() !== new Date(t.due_at).getTime()
        );
        t.meeting_url = moved ? (meetingUrl ?? null) : (meetingUrl ?? t.meeting_url);
        t.due_at = dueAt ?? t.due_at;
        t.title = newTitle;
        t.done = false;
        return { rows: [{ id: t.id }] };
      }
      // --- SLO nurture close-out from booking.created (purchase.mjs) ---
      // Real WHERE: client_id, optional org_id, assignee_role, source_workflow, title.
      if (/UPDATE tasks SET done = true/.test(sql) && /source_workflow/.test(sql)) {
        const [clientId, orgId, role, sourceWorkflow, title] = params;
        const hits = [];
        for (const t of tasks) {
          if (
            t.client_id === clientId
            && (orgId == null || t.org_id === orgId)
            && t.assignee_role === role
            && t.source_workflow === sourceWorkflow
            && t.title === title
            && !t.done
          ) {
            t.done = true;
            hits.push({ id: t.id });
          }
        }
        return { rows: hits };
      }
      // --- tasks: cancel/no-show close-out (mark the open task done) ---
      // Real WHERE: client_id = $1 AND body = $2 AND title LIKE $3 AND done = false.
      if (/UPDATE tasks SET done = true/.test(sql)) {
        const [clientId, uid, titleLike] = params;
        const t = tasks.find((t) =>
          t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike) && !t.done);
        if (t) t.done = true;
        return { rows: [] };
      }
      // Real WHERE: client_id = $1 AND body = $2 AND title LIKE $3.
      if (/SELECT 1 FROM tasks/.test(sql)) {
        const [clientId, uid, titleLike] = params;
        const t = tasks.find((t) =>
          t.client_id === clientId && t.body === uid && likeMatches(t.title, titleLike));
        return { rows: t ? [{ x: 1 }] : [] };
      }
      // findByProviderUid — same-org/current-provider row. The booking-created
      // replay guard MUST see the real persisted terminal state in this fake.
      if (/FROM bookings\s+WHERE org_id = \$1 AND provider_uid = \$2/.test(sql)) {
        const [orgId, uid] = params;
        const row = bookings.find((b) => b.org_id === orgId && b.provider_uid === uid);
        return { rows: row ? [row] : [] };
      }
      // --- bookings: the terminal-status update, matched by uid ACROSS sources ---
      if (/UPDATE bookings[\s\S]*SET status/.test(sql)) {
        const [orgId, uid, status] = params;
        const hits = bookings.filter((b) => b.org_id === orgId && b.provider_uid === uid);
        for (const b of hits) b.status = status;
        return { rows: hits };
      }
      // --- bookings: upsert, honouring BOTH partial unique indexes ---
      if (/INSERT INTO bookings/.test(sql)) {
        const [org_id, client_id, source, provider_uid, starts_at, ends_at, status,
          meeting_url, attendee_email, attendee_name, event_type_slug, rawJson] = params;
        const raw = rawJson == null ? null : JSON.parse(rawJson);
        const eventId = raw && raw.__event_id != null ? String(raw.__event_id) : null;
        const existing = provider_uid
          ? bookings.find((b) => b.org_id === org_id && b.provider_uid === provider_uid)
          : eventId
            ? bookings.find((b) => b.org_id === org_id && b.provider_uid == null && b.__event_id === eventId)
            : null;
        if (existing) {
          // Mirror the PostgreSQL ON CONFLICT WHERE guard (PR #208): an
          // accepted provider UID is never transferred or rewound by a stale
          // booking.created. A stub that omits this would mask task leakage.
          if ((existing.client_id && client_id && existing.client_id !== client_id) ||
              (status === "booked" && ["rescheduled", "cancelled", "noshow", "completed"].includes(existing.status))) {
            return { rows: [] };
          }
          // A moved slot is the exception to COALESCE: a missing Meet URL
          // cannot carry the previous call's link into the new appointment.
          const moved = starts_at != null && (
            existing.starts_at == null || new Date(starts_at).getTime() !== new Date(existing.starts_at).getTime()
          );
          if (moved) existing.meeting_url = meeting_url ?? null;
          // Mirrors the DO UPDATE branch: a later event that omits a field does
          // not erase what an earlier one told us, except the moved-slot URL.
          for (const [k, v] of Object.entries({
            client_id, starts_at, ends_at, status, meeting_url,
            attendee_email, attendee_name, event_type_slug
          })) if (v != null) existing[k] = v;
          return { rows: [existing] };
        }
        const row = {
          id: "bk-" + (bookings.length + 1),
          org_id, client_id, source, provider_uid, starts_at, ends_at, status,
          meeting_url, attendee_email, attendee_name, event_type_slug,
          raw, __event_id: eventId
        };
        bookings.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const row = {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1], title: params[2], body: params[3],
          due_at: params[4], source_workflow: params[5],
          assignee_role: params[6] ?? null,
          meeting_url: params[8] ?? null,
          done: false
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

test("message.inbound: logs an sms message, linked to client by phone", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "hi", sid: "SM1", channel: "sms", source: "twilio" }), db);
  assert.equal(db.messages.length, 1);
  assert.match(db.messages[0].sql, /'inbound'/);
  assert.equal(db.messages[0].params[1], "cl-1", "linked to the client by phone");
});

test("call.completed: logs a voice message row", async () => {
  const db = pgFake();
  await onCallCompleted(ev("call.completed", { callId: "call_1", status: "completed", disposition: "transferred", source: "bland" }, { clientId: "cl-9" }), db);
  assert.equal(db.messages.length, 1);
  assert.match(db.messages[0].sql, /'voice'/);
  assert.equal(db.messages[0].params[1], "cl-9");
});

test("call.completed: closer dispositions are not Bland voice rows", async () => {
  const db = pgFake();
  await onCallCompleted(ev("call.completed", {
    disposition: "closer",
    outcome: "deposit",
    offerKey: "FUNDING_DFY",
    repairReferral: false,
    declineReason: null
  }, { clientId: "cl-9" }), db);
  assert.equal(db.messages.length, 0);
});

test("mail.response: inserts bank_inbox once, replay guard skips the second", async () => {
  const db = pgFake();
  const e = ev("mail.response", { from: "bank@lender.com", subject: "Approved", classification: "APPROVED", source: "mailgun" }, { id: "evt-mail-1" });
  await onMailResponse(e, db);
  await onMailResponse(e, db);
  assert.equal(db.bank.length, 1);
  assert.equal(db.bank[0].classification, "APPROVED");
});

/* THE PREVIEW COLUMN NO LONGER DUPLICATES THE SUBJECT.
   It used to bind p.subject to both columns, so every Bank Inbox row read the
   same sentence twice, the text of the email was never kept, and the screen's
   `body_preview || classification || received_at` fallback could never reach
   its second or third option. */
test("mail.response: body_preview is the email's preview, NOT the subject again", async () => {
  const db = pgFake();
  await onMailResponse(ev("mail.response", {
    from: "bank@lender.com",
    subject: "Your application decision",
    bodyPreview: "Congratulations! You have been approved for a credit limit of $5,000.",
    classification: "APPROVED",
    amountCandidates: ["5000.00"],
    amountCandidatesFound: 1,
    source: "mailgun"
  }, { id: "evt-mail-preview" }), db);
  const row = db.bank[0];
  assert.equal(row.subject, "Your application decision");
  assert.equal(row.body_preview, "Congratulations! You have been approved for a credit limit of $5,000.");
  assert.notEqual(row.body_preview, row.subject);
});

test("mail.response: no preview stores NULL, so the screen can fall through", async () => {
  const db = pgFake();
  await onMailResponse(ev("mail.response", {
    from: "bank@lender.com", subject: "Approved", classification: "APPROVED", source: "mailgun"
  }, { id: "evt-mail-nopreview" }), db);
  assert.equal(db.bank[0].body_preview, null, "NULL, never the subject and never an empty string");
});

test("mail.response: a blank preview is stored as NULL, not as an empty string", async () => {
  const db = pgFake();
  await onMailResponse(ev("mail.response", {
    from: "bank@lender.com", subject: "Approved", bodyPreview: "   ",
    classification: "APPROVED", source: "mailgun"
  }, { id: "evt-mail-blankpreview" }), db);
  assert.equal(db.bank[0].body_preview, null);
});

test("mail.response: the bank's own dollar figures survive into the row", async () => {
  const db = pgFake();
  await onMailResponse(ev("mail.response", {
    from: "bank@lender.com", subject: "Your new card", classification: "APPROVED",
    bodyPreview: "Credit limit $7,500. Annual fee $95.",
    amountCandidates: ["7500.00", "95.00"], amountCandidatesFound: 2, source: "mailgun"
  }, { id: "evt-mail-amounts" }), db);
  assert.deepEqual(db.bank[0].raw.amountCandidates, ["7500.00", "95.00"]);
  assert.equal(db.bank[0].raw.amountCandidatesFound, 2);
});

test("mail.response: a denial carries no amounts into the row", async () => {
  const db = pgFake();
  await onMailResponse(ev("mail.response", {
    from: "bank@lender.com", subject: "Your application decision", classification: "DENIED",
    bodyPreview: "Unfortunately you were not approved for the requested $10,000.",
    source: "mailgun"
  }, { id: "evt-mail-denied" }), db);
  assert.equal(db.bank[0].classification, "DENIED");
  assert.equal("amountCandidates" in db.bank[0].raw, false);
});

test("booking.created: creates a task once (dedup by booking uid), creates client from email", async () => {
  const db = pgFake();
  const e = ev("booking.created", { email: "lead@x.com", name: "Lead Person", bookingUid: "bk_1", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" });
  await onBookingCreated(e, db);
  await onBookingCreated(e, db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].body, "bk_1");
  assert.equal(db.clients.length, 1, "resolved+created the client from the booking email");
});

test("booking.created: stores meetingUrl on the task", async () => {
  const db = pgFake();
  const e = ev("booking.created", {
    email: "meet@x.com", name: "Meet Person", bookingUid: "bk_meet", startTime: "2026-08-01T15:00:00Z",
    source: "clickfunnels", meetingUrl: "https://meet.example.com/abc"
  });
  await onBookingCreated(e, db);
  assert.equal(db.tasks[0].meeting_url, "https://meet.example.com/abc");
});

test("a new call clears an old confirmation; a replay does not", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-new", org_id: "org-1", email: "new@x.com", tags: [], custom_fields: { call_confirmed: true } });
  const e = ev("booking.created", { clientId: "cl-new", bookingUid: "bk-new", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" }, { clientId: "cl-new" });
  await onBookingCreated(e, db);
  assert.equal(db.clients[0].custom_fields.call_confirmed, false);
  db.clients[0].custom_fields.call_confirmed = true;
  await onBookingCreated(e, db);
  assert.equal(db.clients[0].custom_fields.call_confirmed, true);
});

// booking.rescheduled — updates the existing task in place (no second task).
test("booking.rescheduled: updates the existing open task's due_at + meeting_url in place", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "resched@x.com", bookingUid: "bk_2", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" });
  await onBookingCreated(created, db);
  const rescheduled = ev("booking.rescheduled", {
    clientId: db.clients[0].id, bookingUid: "bk_2", startTime: "2026-08-02T15:00:00Z",
    meetingUrl: "https://meet.example.com/new", source: "clickfunnels"
  }, { clientId: db.clients[0].id });
  await onBookingRescheduled(rescheduled, db);
  assert.equal(db.tasks.length, 1, "no second task created — the open one was updated");
  assert.equal(db.tasks[0].due_at, "2026-08-02T15:00:00Z");
  assert.equal(db.tasks[0].meeting_url, "https://meet.example.com/new");
  assert.equal(db.tasks[0].title, "Strategy session rescheduled");
  assert.equal(db.clients[0].custom_fields.call_outcome, "rescheduled");
  assert.equal(db.clients[0].custom_fields.call_confirmed, false, "a moved call needs a fresh confirmation");
});

test("a moved call drops its old Meet link but a same-slot replay preserves the refreshed one", async () => {
  const db = pgFake();
  const uid = "bk-moved-meet";
  const initial = "2026-08-12T15:00:00Z";
  const moved = "2026-08-13T18:00:00Z";
  const oldMeet = "https://meet.google.com/old-room";
  const newMeet = "https://meet.google.com/new-room";
  await onBookingCreated(ev("booking.created", {
    email: "moved-meet@example.com", bookingUid: uid,
    startTime: initial, meetingUrl: oldMeet, source: "clickfunnels"
  }), db);
  assert.equal(db.tasks[0].meeting_url, oldMeet);
  assert.equal(db.bookings[0].meeting_url, oldMeet);

  const rescheduled = ev("booking.rescheduled", {
    clientId: db.clients[0].id, bookingUid: uid,
    startTime: moved, meetingUrl: null, source: "clickfunnels"
  }, { clientId: db.clients[0].id });
  await onBookingRescheduled(rescheduled, db);
  assert.equal(db.tasks[0].meeting_url, null, "closer Join must not open the old slot's room");
  assert.equal(db.bookings[0].meeting_url, null, "saved booking must await new slot's calendar");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.bookings.length, 1);

  // Mimic the exact-time calendar lookup saving the new link, then provider
  // re-delivering the same rescheduled slot without a meetingUrl field.
  db.tasks[0].meeting_url = newMeet;
  db.bookings[0].meeting_url = newMeet;
  await onBookingRescheduled(rescheduled, db);
  assert.equal(db.tasks[0].meeting_url, newMeet, "same-slot replay overwrote refreshed task URL");
  assert.equal(db.bookings[0].meeting_url, newMeet, "same-slot replay overwrote refreshed booking URL");
});

test("booking.rescheduled: no open task found → creates one (rescheduled before created seen)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-resched", org_id: "org-1", email: "noopen@x.com", tags: [], custom_fields: {} });
  const e = ev("booking.rescheduled", { clientId: "cl-resched", bookingUid: "bk_3", startTime: "2026-08-03T15:00:00Z", source: "clickfunnels" }, { clientId: "cl-resched" });
  await onBookingRescheduled(e, db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].body, "bk_3");
  assert.equal(db.clients[0].custom_fields.call_outcome, "rescheduled");
});

// booking.cancelled — closes the open task, tags, sets custom field. No re-nurture task.
test("booking.cancelled: marks the open task done, tags call:cancelled, sets call_outcome", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "cancel@x.com", bookingUid: "bk_4", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const cancelled = ev("booking.cancelled", { clientId, bookingUid: "bk_4", source: "clickfunnels" }, { clientId });
  await onBookingCancelled(cancelled, db);
  assert.equal(db.tasks[0].done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:cancelled"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "cancelled");
});

test("booking.cancelled: replay is idempotent (task stays done, tag not duplicated)", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "cancel2@x.com", bookingUid: "bk_5", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const cancelled = ev("booking.cancelled", { clientId, bookingUid: "bk_5", source: "clickfunnels" }, { clientId });
  await onBookingCancelled(cancelled, db);
  await onBookingCancelled(cancelled, db);
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:cancelled"]);
});

// booking.noshow — closes the open task, tags call:no_show, sets call_outcome.
test("booking.noshow: marks the open task done, tags call:no_show, sets call_outcome", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "noshow@x.com", bookingUid: "bk_6", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const noshow = ev("booking.noshow", { clientId, bookingUid: "bk_6", source: "clickfunnels" }, { clientId });
  await onBookingNoshow(noshow, db);
  assert.equal(db.tasks[0].done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:no_show"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "no_show");
});

// ── the source label: honest, or nothing ────────────────────────────────────

// This is the DB-free half of the proof. The same claim is checked against a
// real Postgres in src/http/bookings.pg.test.mjs, but that file SKIPS whenever
// DATABASE_URL is unset — which is the default `npm test` run — so without this
// test nothing in a normal run proves that an unnamed source is recorded as
// "we were not told" rather than as a vendor nobody named.
test("booking.created: a payload naming no source is recorded as 'unknown', NEVER 'calcom'", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "nosource@x.com", bookingUid: "bk_nosource", startTime: "2026-08-01T15:00:00Z"
  }), db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].source_workflow, "unknown",
    "an unnamed source was filled in with a guess");
  assert.notEqual(db.tasks[0].source_workflow, "calcom");
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].source, "unknown");
  assert.notEqual(db.bookings[0].source, "calcom");
});

test("booking.created: the true source off the payload reaches both the task and the booking", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "cf@x.com", bookingUid: "bk_cf", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }), db);
  assert.equal(db.tasks[0].source_workflow, "clickfunnels");
  assert.equal(db.bookings[0].source, "clickfunnels");
});

// The regression the old fake could not see: a task stored under the wrong
// vendor label must still be found by the reschedule, which matches on the
// booking id and the title, not on the label.
test("booking.rescheduled: finds a task still labelled 'calcom' and does not add a second", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-legacy", org_id: "org-1", email: "legacy@x.com", tags: [], custom_fields: {} });
  db.tasks.push({
    id: "task-legacy", org_id: "org-1", client_id: "cl-legacy",
    title: "Strategy session booked", body: "bk_legacy",
    due_at: "2026-08-01T15:00:00Z", source_workflow: "calcom", done: false
  });
  await onBookingRescheduled(ev("booking.rescheduled", {
    clientId: "cl-legacy", bookingUid: "bk_legacy",
    startTime: "2026-08-04T15:00:00Z", source: "clickfunnels"
  }, { clientId: "cl-legacy" }), db);
  assert.equal(db.tasks.length, 1, "the reschedule missed the legacy task and created a duplicate");
  assert.equal(db.tasks[0].title, "Strategy session rescheduled");
  assert.equal(db.tasks[0].due_at, "2026-08-04T15:00:00Z");
});

// ── one booking, one row ────────────────────────────────────────────────────

test("booking.rescheduled: a later event with NO source is the same booking, not a second one", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "onerow@x.com", bookingUid: "UID-D", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }), db);
  const clientId = db.clients[0].id;
  await onBookingRescheduled(ev("booking.rescheduled", {
    clientId, bookingUid: "UID-D", startTime: "2026-08-05T15:00:00Z"
  }, { clientId, id: "evt-y" }), db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.bookings.length, 1, "the same appointment was stored as two bookings");
  assert.equal(db.bookings[0].starts_at, "2026-08-05T15:00:00.000Z");
});

test("booking.created: a redelivered event does not add a second booking with no uid", async () => {
  const db = pgFake();
  const e = ev("booking.created", {
    email: "nouid@x.com", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }, { id: "evt-nouid" });
  await onBookingCreated(e, db);
  await onBookingCreated(e, db);
  await onBookingCreated(e, db);
  assert.equal(db.bookings.length, 1, "a replay multiplied a booking that has no provider id");
});

test("booking.created: two DIFFERENT bookings with no uid stay two rows", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "two@x.com", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }, { id: "evt-two-a" }), db);
  await onBookingCreated(ev("booking.created", {
    email: "two@x.com", startTime: "2026-08-02T15:00:00Z", source: "clickfunnels"
  }, { id: "evt-two-b" }), db);
  assert.equal(db.bookings.length, 2,
    "two bookings we cannot tell apart were silently merged into one");
});

test("booking.cancelled: a cancellation matching no booking does NOT invent one", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "phantom@x.com", bookingUid: "UID-G1", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }), db);
  const clientId = db.clients[0].id;
  await onBookingCancelled(ev("booking.cancelled", {
    clientId, bookingUid: "UID-G2", source: "clickfunnels"
  }, { clientId, id: "evt-phantom" }), db);
  assert.equal(db.bookings.length, 1, "an unmatched cancellation created a phantom booking");
  assert.equal(db.bookings[0].provider_uid, "UID-G1");
  assert.equal(db.bookings[0].status, "booked", "the real booking was closed by an unrelated event");
});

test("booking.cancelled: a cancellation that DOES match still sets the status", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "realcancel@x.com", bookingUid: "UID-H", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }), db);
  const clientId = db.clients[0].id;
  await onBookingCancelled(ev("booking.cancelled", {
    clientId, bookingUid: "UID-H", source: "clickfunnels"
  }, { clientId, id: "evt-realcancel" }), db);
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].status, "cancelled");
  // The task was created under 'clickfunnels' and the cancellation names
  // 'calcom'. Closing it proves the close-out matches on the booking id and the
  // title rather than on either label.
  assert.equal(db.tasks[0].done, true, "the cancellation did not close its own task");
});

test("booking.created replay cannot reopen a cancelled booking or its closer task", async () => {
  const db = pgFake();
  const payload = { email: "cancelled-replay@example.com", bookingUid: "bk-terminal-cancel",
    startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" };
  await onBookingCreated(ev("booking.created", payload, { id: "evt-first" }), db);
  const id = db.clients[0].id;
  await onBookingCancelled(ev("booking.cancelled", payload, { id: "evt-cancel", clientId: id }), db);
  const result = await onBookingCreated(ev("booking.created", payload, { id: "evt-stale-create", clientId: id }), db);
  assert.deepEqual(result, { skipped: "terminal_booking_replay" });
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].status, "cancelled");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].done, true, "cancelled closer task must stay closed");
  assert.equal(db.clients[0].custom_fields.call_outcome, "cancelled");
});

test("booking.created replay cannot reopen a no-show", async () => {
  const db = pgFake();
  const payload = { email: "noshow-replay@example.com", bookingUid: "bk-terminal-noshow",
    startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" };
  await onBookingCreated(ev("booking.created", payload), db);
  const id = db.clients[0].id;
  await onBookingNoshow(ev("booking.noshow", payload, { id: "evt-noshow", clientId: id }), db);
  const result = await onBookingCreated(ev("booking.created", payload, { id: "evt-replay", clientId: id }), db);
  assert.equal(result?.skipped, "terminal_booking_replay");
  assert.equal(db.bookings[0].status, "noshow");
  assert.equal(db.tasks[0].done, true);
  assert.equal(db.clients[0].custom_fields.call_outcome, "no_show");
});

test("booking.created cannot silently reassign a provider appointment to another client", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", { email: "owner-a@example.com",
    bookingUid: "bk-shared-id", startTime: "2026-08-01T15:00:00Z" }), db);
  const original = db.bookings[0].client_id;
  const result = await onBookingCreated(ev("booking.created", { email: "owner-b@example.com",
    bookingUid: "bk-shared-id", startTime: "2026-08-01T15:00:00Z" }, { id: "evt-second" }), db);
  assert.equal(result?.skipped, "booking_client_mismatch");
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].client_id, original);
  assert.equal(db.tasks.length, 1, "another buyer was not assigned to this call");
});

test("booking.created: a stale create cannot rewind a rescheduled call", async () => {
  const db = pgFake();
  const original = { email: "same-client@example.com", bookingUid: "bk-rescheduled-stale-create",
    startTime: "2026-08-01T15:00:00Z", source: "clickfunnels" };
  await onBookingCreated(ev("booking.created", original), db);
  const id = db.clients[0].id;
  await onBookingRescheduled(ev("booking.rescheduled", {
    ...original, startTime: "2026-08-07T15:00:00Z"
  }, { clientId: id, id: "evt-rescheduled" }), db);
  const result = await onBookingCreated(ev("booking.created", original,
    { clientId: id, id: "evt-original-replayed" }), db);
  assert.deepEqual(result, { skipped: "booking_already_recorded" });
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].status, "rescheduled");
  assert.equal(db.bookings[0].starts_at, "2026-08-07T15:00:00.000Z");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].due_at, "2026-08-07T15:00:00Z");
  assert.equal(db.clients[0].custom_fields.call_outcome, "rescheduled");
});

test("booking.created: duplicate confirmed appointment cannot reset confirmation or add tasks", async () => {
  const db = pgFake();
  const payload = { email: "confirmed-replay@example.com",
    bookingUid: "bk-confirmed-repeat", startTime: "2026-08-01T15:00:00Z" };
  await onBookingCreated(ev("booking.created", payload), db);
  db.clients[0].custom_fields.call_confirmed = true;
  const result = await onBookingCreated(ev("booking.created", payload, { id: "evt-replay-confirmed" }), db);
  assert.deepEqual(result, { skipped: "booking_already_recorded" });
  assert.equal(db.clients.length, 1);
  assert.equal(db.bookings.length, 1);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.clients[0].custom_fields.call_confirmed, true);
});

test("booking.created: conflicting provider UID cannot create a second lead before refusing it", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "original-owner@example.com", bookingUid: "bk-reused-provider-uid",
    startTime: "2026-08-01T15:00:00Z"
  }), db);
  const result = await onBookingCreated(ev("booking.created", {
    email: "different-new-lead@example.com", bookingUid: "bk-reused-provider-uid",
    startTime: "2026-08-01T15:00:00Z"
  }, { id: "evt-malformed-second" }), db);
  assert.deepEqual(result, { skipped: "booking_client_mismatch" });
  assert.equal(db.clients.length, 1, "must not create an unrelated lead for the reused booking ID");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.bookings.length, 1);
});

test("booking.created: failed UID identity read creates neither a new lead nor a closer task", async () => {
  const db = pgFake();
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes("FROM bookings") && sql.includes("WHERE org_id = $1 AND provider_uid = $2")) {
      throw new Error("booking storage temporarily unreachable");
    }
    return originalQuery(sql, params);
  };
  const result = await onBookingCreated(ev("booking.created", {
    email: "new-person@example.com", bookingUid: "bk-db-unavailable",
    startTime: "2026-08-01T15:00:00Z"
  }), db);
  assert.deepEqual(result, { skipped: "booking_identity_unavailable" });
  assert.equal(db.clients.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.bookings.length, 0);
});

test("booking.created: losing a concurrent UID insert never creates a closer task or sales-stage update", async () => {
  const db = pgFake();
  const originalQuery = db.query.bind(db);
  let injected = false;
  db.query = async (sql, params) => {
    // The pre-read saw nothing. Another webhook committed the same UID just
    // before our INSERT; the real store returns no row under the PG row lock.
    if (!injected && /INSERT INTO bookings/.test(sql)) {
      injected = true;
      db.bookings.push({
        id: "bk-existing-winner", org_id: "org-1", client_id: "cl-other",
        provider_uid: "uid-concurrent-claim", status: "booked",
        attendee_email: "other@example.invalid", starts_at: "2026-11-10T20:00:00Z"
      });
    }
    return originalQuery(sql, params);
  };
  const result = await onBookingCreated(ev("booking.created", {
    email: "losing-client@example.invalid", bookingUid: "uid-concurrent-claim",
    startTime: "2026-11-10T20:00:00Z", source: "clickfunnels"
  }), db);
  assert.deepEqual(result, { skipped: "booking_not_accepted" });
  assert.equal(db.tasks.length, 0, "a losing booking must not reach the closer");
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].client_id, "cl-other", "original buyer keeps their slot");
  assert.equal(db.clients[0]?.custom_fields?.call_outcome, undefined);
  assert.equal(db.clients[0]?.tags?.includes("call:booked"), false);
});

test("booking.created: failed booking INSERT is not silently treated as a successful handoff", async () => {
  const db = pgFake();
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/INSERT INTO bookings/.test(sql)) throw new Error("synthetic booking storage failure");
    return originalQuery(sql, params);
  };
  await assert.rejects(
    onBookingCreated(ev("booking.created", {
      email: "storage-error@example.invalid", bookingUid: "uid-booking-write-error",
      startTime: "2026-11-10T20:00:00Z"
    }), db), /synthetic booking storage failure/
  );
  assert.equal(db.tasks.length, 0, "no phantom closer task on storage failure");
  assert.equal(db.bookings.length, 0);
  assert.equal(db.clients[0]?.custom_fields?.call_outcome, undefined);
});

test("booking.created: interview booking must never create a sales lead", async () => {
  const db = pgFake();
  const result = await onBookingCreated(ev("booking.created", {
    email: "interview-only@example.com",
    bookingUid: "bk-interview-not-sales",
    eventTypeSlug: "customer-insights-interview",
    startTime: "2026-08-01T15:00:00Z"
  }), db);
  assert.deepEqual(result, { skipped: "interview" });
  assert.equal(db.clients.length, 0);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.bookings.length, 0);
});

test("a fresh provider appointment after cancellation still books a new call", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", { email: "rebook@example.com", bookingUid: "old-call",
    startTime: "2026-08-01T15:00:00Z" }), db);
  const id = db.clients[0].id;
  await onBookingCancelled(ev("booking.cancelled", { bookingUid: "old-call" }, { clientId: id }), db);
  const result = await onBookingCreated(ev("booking.created", { email: "rebook@example.com", bookingUid: "new-call",
    startTime: "2026-08-06T15:00:00Z" }, { clientId: id, id: "evt-rebook" }), db);
  assert.equal(result?.skipped, undefined);
  assert.equal(db.bookings.length, 2);
  assert.equal(db.bookings.find((b) => b.provider_uid === "old-call").status, "cancelled");
  assert.equal(db.bookings.find((b) => b.provider_uid === "new-call").status, "booked");
  assert.equal(db.tasks.filter((t) => !t.done).length, 1);
});

test("booking.created: a booking id with stray spaces is ONE booking and ONE task", async () => {
  const db = pgFake();
  await onBookingCreated(ev("booking.created", {
    email: "spacey@x.com", bookingUid: "AbC-1", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }, { id: "evt-space-1" }), db);
  await onBookingCreated(ev("booking.created", {
    email: "spacey@x.com", bookingUid: " AbC-1 ", startTime: "2026-08-01T15:00:00Z", source: "clickfunnels"
  }, { id: "evt-space-2" }), db);
  assert.equal(db.tasks.length, 1, "the same booking id produced two closer follow-ups");
  assert.equal(db.tasks[0].body, "AbC-1", "the task stored an untrimmed booking id");
  assert.equal(db.bookings.length, 1);
});

test("booking.created: inbound book closes SLO CSM nurture and still makes only a closer task", async () => {
  await withSloPostPurchase("true", async () => {
    const db = pgFake();
    db.clients.push({
      id: "cl-slo-nurture", org_id: "org-1", email: "slo-nurture@x.com",
      tags: [], custom_fields: {}
    });
    db.tasks.push({
      id: "task-slo-nurture",
      org_id: "org-1",
      client_id: "cl-slo-nurture",
      title: SLO_NURTURE_TITLE,
      body: "slo-nurture-notes",
      source_workflow: "customer-insights-mid",
      assignee_role: "csm",
      done: false
    });
    db.tasks.push({
      id: "task-halfway",
      org_id: "org-1",
      client_id: "cl-slo-nurture",
      title: "Accountability call — halfway check-in",
      body: "halfway-notes",
      source_workflow: "customer-insights-mid",
      assignee_role: "csm",
      done: false
    });
    await onBookingCreated(ev("booking.created", {
      email: "slo-nurture@x.com",
      bookingUid: "bk_slo_nurture",
      startTime: "2026-08-01T15:00:00Z",
      source: "clickfunnels"
    }, { clientId: "cl-slo-nurture" }), db);
    const nurture = db.tasks.find((t) => t.id === "task-slo-nurture");
    const halfway = db.tasks.find((t) => t.id === "task-halfway");
    const closer = db.tasks.find((t) => t.title === "Strategy session booked");
    assert.equal(nurture.done, true);
    assert.equal(halfway.done, false);
    assert.equal(closer.assignee_role, "closer");
    assert.equal(db.tasks.filter((t) => t.assignee_role === "closer").length, 1);
  });
});

test("booking.created: flag off leaves the SLO CSM nurture and still makes a closer task", async () => {
  await withSloPostPurchase(undefined, async () => {
    const db = pgFake();
    db.clients.push({
      id: "cl-slo-nurture", org_id: "org-1", email: "slo-nurture@x.com",
      tags: [], custom_fields: {}
    });
    db.tasks.push({
      id: "task-slo-nurture",
      org_id: "org-1",
      client_id: "cl-slo-nurture",
      title: SLO_NURTURE_TITLE,
      body: "slo-nurture-notes",
      source_workflow: "customer-insights-mid",
      assignee_role: "csm",
      done: false
    });
    await onBookingCreated(ev("booking.created", {
      email: "slo-nurture@x.com",
      bookingUid: "bk_slo_off",
      startTime: "2026-08-01T15:00:00Z",
      source: "clickfunnels"
    }, { clientId: "cl-slo-nurture" }), db);
    const nurture = db.tasks.find((t) => t.id === "task-slo-nurture");
    const closer = db.tasks.find((t) => t.title === "Strategy session booked");
    assert.equal(nurture.done, false);
    assert.equal(closer.assignee_role, "closer");
  });
});

// TCPA STOP/START keyword handling

test("message.inbound STOP: records opt-out for known client", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "STOP", sid: "SM2", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 1);
  assert.equal(db.optOuts[0].client_id, "cl-1");
  assert.equal(db.optOuts[0].channel, "sms");
  assert.equal(db.optOuts[0].opted_in_at, null);
});

test("message.inbound STOPALL: also records opt-out (case-insensitive)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-2", org_id: "org-1", phone: "+15550000001" });
  await onMessageInbound(ev("message.inbound", { from: "+15550000001", body: "stopall", sid: "SM3", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 1);
});

test("message.inbound START: sets opted_in_at (resumes after prior STOP)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  // First opt out
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "STOP", sid: "SM4", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts[0].opted_in_at, null, "opted out");
  // Then opt back in
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "START", sid: "SM5", channel: "sms", source: "twilio" }), db);
  assert.notEqual(db.optOuts[0].opted_in_at, null, "opted back in");
});

test("message.inbound: non-STOP body does not create opt-out row", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "Hello there!", sid: "SM6", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 0);
  assert.equal(db.messages.length, 1, "normal message still logged");
});

test("message.inbound STOP: unknown sender (no client match) does not crash", async () => {
  const db = pgFake();
  // No clients seeded — should resolve clientId to null and skip opt-out silently
  await onMessageInbound(ev("message.inbound", { from: "+19999999999", body: "STOP", sid: "SM7", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 0);
});

/* EMAIL STOP — T5-01.

   Proven broken on the live site 2026-08-18: a client emailed a body of exactly
   "STOP", it was stored as message e9a17306, and opt_outs stayed empty, so the
   next campaign would have mailed them again. These pin the fix. */

const emailEv = (body, sid) => ev("message.inbound",
  { from: "person@example.com", body, sid, channel: "email", source: "mailgun" });

test("message.inbound email STOP: records an opt-out on the EMAIL channel", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-e1", org_id: "org-1", email: "person@example.com" });
  await onMessageInbound(emailEv("STOP", "<mg-1@mg.fundhub.ai>"), db);
  assert.equal(db.optOuts.length, 1, "an emailed STOP must record an opt-out");
  assert.equal(db.optOuts[0].client_id, "cl-e1");
  assert.equal(db.optOuts[0].channel, "email", "email opt-out, not sms");
  assert.equal(db.optOuts[0].source, "inbound_keyword");
  assert.equal(db.optOuts[0].opted_in_at, null);
  assert.equal(db.messages.length, 1, "and the message is still filed in the thread");
});

test("message.inbound email UNSUBSCRIBE / REMOVE / lower case all count", async () => {
  for (const [i, word] of ["UNSUBSCRIBE", "remove", "Opt Out", "  stop  "].entries()) {
    const db = pgFake();
    db.clients.push({ id: "cl-e2", org_id: "org-1", email: "person@example.com" });
    await onMessageInbound(emailEv(word, `<mg-w${i}@mg.fundhub.ai>`), db);
    assert.equal(db.optOuts.length, 1, `"${word}" should opt the person out`);
    assert.equal(db.optOuts[0].channel, "email");
  }
});

test("message.inbound email CANCEL is NOT an opt-out — it means the meeting", async () => {
  // The SMS list treats CANCEL / END / QUIT as opt-out words. On email they are
  // ambiguous: a one-word reply to a booking note means cancel the booking, and
  // reading it as "stop all email" would cut somebody off from the updates about
  // their own credit file. See EMAIL_STOP_KEYWORDS in comms.mjs.
  for (const [i, word] of ["CANCEL", "END", "QUIT"].entries()) {
    const db = pgFake();
    db.clients.push({ id: "cl-e3", org_id: "org-1", email: "person@example.com" });
    await onMessageInbound(emailEv(word, `<mg-c${i}@mg.fundhub.ai>`), db);
    assert.equal(db.optOuts.length, 0, `"${word}" must not silence email`);
    assert.equal(db.messages.length, 1, "it is an ordinary message");
  }
});

test("message.inbound email: a sentence containing STOP is a message, not an opt-out", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-e4", org_id: "org-1", email: "person@example.com" });
  await onMessageInbound(emailEv("Please stop by the office on Tuesday", "<mg-2@mg.fundhub.ai>"), db);
  assert.equal(db.optOuts.length, 0, "matching is whole-body and exact");
  assert.equal(db.messages.length, 1);
});

test("message.inbound email STOP suppresses email only — the client still gets texts", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-e5", org_id: "org-1", email: "person@example.com", phone: "+15551110000" });
  await onMessageInbound(emailEv("STOP", "<mg-3@mg.fundhub.ai>"), db);
  const live = (ch) => db.optOuts.some((r) => r.client_id === "cl-e5" && r.channel === ch && !r.opted_in_at);
  assert.equal(live("email"), true, "email is stopped");
  assert.equal(live("sms"), false, "sms is untouched — they never asked us to stop texting");
});

test("message.inbound email START: opts back in on the email channel", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-e6", org_id: "org-1", email: "person@example.com" });
  await onMessageInbound(emailEv("STOP", "<mg-4@mg.fundhub.ai>"), db);
  assert.equal(db.optOuts[0].opted_in_at, null, "opted out");
  await onMessageInbound(emailEv("START", "<mg-5@mg.fundhub.ai>"), db);
  assert.notEqual(db.optOuts[0].opted_in_at, null, "opted back in");
  assert.equal(db.optOuts[0].channel, "email");
});

test("message.inbound: a voice message never touches opt_outs", async () => {
  // There is no keyword list for voice, so the branch is skipped entirely
  // rather than falling back to the SMS words.
  const db = pgFake();
  db.clients.push({ id: "cl-v1", org_id: "org-1", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound",
    { from: "+15551234567", body: "STOP", sid: "V1", channel: "voice", source: "bland" }), db);
  assert.equal(db.optOuts.length, 0);
});

test("message.inbound SMS: a client stored without +1 formatting is still found", async () => {
  // T5-07. Twilio always sends E.164. clients.phone is free text and two live
  // records are not E.164, so an exact-text match alone loses their STOP.
  const db = pgFake();
  db.clients.push({ id: "cl-p1", org_id: "org-1", phone: "(555) 123-4567" });
  await onMessageInbound(ev("message.inbound",
    { from: "+15551234567", body: "STOP", sid: "SM8", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 1, "digits-only fallback must resolve the client");
  assert.equal(db.optOuts[0].client_id, "cl-p1");
  assert.equal(db.optOuts[0].channel, "sms");
});
