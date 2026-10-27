import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_TEMPLATE_KEY, aiSet043WayHandoff, sendKeyFor } from "./ai-set-04-3way-handoff.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

/* A booking is in the future or it is not a booking. These fixtures used to be a
   hard-coded August date that has since slid into the past, which made every one
   of them a test about an appointment that had already happened. */
const inHours = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

test("happy path: sends the handoff SMS + advisor task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const res = await handle({ event: ev("booking.created", { startTime: inHours(3) }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 1);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks[0].assignee_role, "closer");
});

test("branch: no start time — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_start_time");
});

test("duplicate delivery: replaying does not double-send or double-task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const event = ev("booking.created", { startTime: inHours(3) }, { id: "evt-dup-aiset04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
});

/* ── F49: the handoff text used to hand the customer a full stop ──────────────
 *
 * Received 2026-09-03: "I've intro'd your advisor so you're not walking in cold
 * — link: ." The template asks for the meeting location; this workflow sent no
 * context, so the tag rendered as nothing.
 */
const HANDOFF_BODY = "Josh here. Your call starts in 15 minutes — link: {{appointment.meeting_location}}. Reply STOP to opt out.";

const handoffTemplates = () => [
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: HANDOFF_BODY, compliance_passed: true }
];

test("F49: the meeting link from the booking is printed in the text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", {
      startTime: inHours(3),
      meetingUrl: "https://meet.google.com/abc-defg-hij"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "payload");
  assert.match(db.messages[0].rendered_body, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.doesNotMatch(db.messages[0].rendered_body, /link: \./);
});

test("F49: with no meeting link anywhere the text names portal sign-in as a fallback, not the meeting link", async () => {
  // ClickFunnels sets meetingUrl null on EVERY booking it takes, so this is the
  // ordinary case, not the edge case.
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), meetingUrl: null }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "portal_sign_in");
  const body = db.messages[0].rendered_body;
  assert.doesNotMatch(body, /link: \./);
  assert.match(res.link.url, /^https?:\/\//, "the fallback must be a real web address");
  assert.ok(body.includes(res.link.url), "the resolved link must appear in the text");
  assert.match(body, /portal sign-in fallback/i);
  assert.match(body, /not the meeting link/i);
});

test("F49: the saved booking row answers when the webhook did not", async () => {
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const db = {
    ...base,
    async query(sql, params) {
      if (/FROM bookings/.test(sql) && /starts_at = \$3/.test(sql)) {
        assert.deepEqual(params.slice(0, 2), ["org-1", "cl-1"]);
        assert.equal(params[2], new Date(params[2]).toISOString());
        assert.equal(params[3], "cf-appt-9");
        return { rows: [{ meeting_url: "https://meet.google.com/from-the-row" }] };
      }
      return base.query(sql, params);
    }
  };
  const res = await handle({
    event: ev("booking.created", {
      startTime: inHours(3), meetingUrl: null, bookingUid: "cf-appt-9"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "booking_exact_call");
  assert.match(base.messages[0].rendered_body, /from-the-row/);
});

test("current call: never borrows an older Meet link from the same client", async () => {
  const oldMeet = "https://meet.google.com/old-call-link";
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  let bookingReads = 0;
  const db = {
    ...base,
    async query(sql, params) {
      if (/SELECT meeting_url FROM bookings/.test(sql)) {
        bookingReads += 1;
        assert.match(sql, /starts_at = \$3::timestamptz/);
        assert.doesNotMatch(sql, /ORDER BY created_at DESC/);
        assert.equal(params[1], "cl-1");
        return { rows: [] };
      }
      return base.query(sql, params);
    }
  };
  const res = await handle({
    event: ev("booking.created", {
      startTime: inHours(3), bookingUid: "current-call", meetingUrl: null
    }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    findLink: async () => ({ ok: false, reason: "no_matching_event" })
  });
  assert.equal(bookingReads, 1, "only the exact call is read");
  assert.equal(res.link.from, "portal_sign_in");
  assert.ok(!base.messages[0].rendered_body.includes(oldMeet));
  assert.match(base.messages[0].rendered_body, /portal sign-in fallback/i);
});

test("F49: a start time nothing can read sends no handoff text at all", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "whenever" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "unreadable_start_time");
  assert.equal(db.messages.length, 0);
});

/* ── The clock, not just the date ─────────────────────────────────────────────
 *
 * Round 2 found the other half of F47 living here. This workflow refused a start
 * time nothing could read, but not one that had already gone: a durable sleep
 * set to a moment in the past ends immediately, so a booking carrying yesterday's
 * start time sent "Your call starts in 15 minutes" the instant it arrived.
 */
test("F47b: a booking whose call has already started sends no handoff text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(-48) }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "appointment_already_started");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("F47b: a booking taken inside the last fifteen minutes sends no handoff text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    // The call is real and still ahead, but "fifteen minutes before it" is not.
    event: ev("booking.created", { startTime: inHours(0.1) }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "booked_inside_15m");
  assert.equal(db.messages.length, 0);
});

test("F47b: the send moment is decided once, so a replay hours later sends nothing", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const startAtMs = Date.now() + 3 * 60 * 60 * 1000;
  const event = ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" });

  /* A step shim that records each step's answer by id and hands the same answer
     back on every later pass — which is what Inngest does. Without the plan
     being inside a step, the second pass below would recompute it against a
     clock that is now past the call and refuse a run that had already sent. */
  const memo = new Map();
  const step = {
    run: async (id, fn) => {
      if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify((await fn()) ?? null)));
      return memo.get(id);
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };

  const first = await handle({ event, db, step, now: () => Date.now() });
  assert.equal(first.done, true);
  assert.equal(db.messages.length, 1);

  // Now drive it again, three hours after the call ended.
  const again = await handle({ event, db, step, now: () => startAtMs + 3 * 60 * 60 * 1000 });
  assert.equal(again.done, true);
  assert.equal(db.messages.length, 1, "the handoff text must not be sent twice");
});

/* ── A moved or cancelled call (cf-calendar-switch-plan-2026-09-22 step b) ─────
 *
 * The run slept since the call was booked. A move used to leave it asleep, so
 * the customer got "your call starts in 15 minutes" at the OLD time; only a
 * cancel stopped it. Now a move cancels the old-time run, starts a run for the
 * new time, and every run re-checks the saved booking on waking.
 *
 * withBookings answers the bookingStateAt read (src/bookings/store.mjs) from a
 * list of saved booking rows, mirroring its WHERE clause and its two columns.
 */
const sameInstant = (a, b) => a != null && b != null && Date.parse(a) === Date.parse(b);
function withBookings(base, bookings) {
  return {
    ...base,
    async query(sql, params = []) {
      if (/was_at_this_time/.test(sql)) {
        const [orgId, clientId, at, uid] = params;
        return {
          rows: bookings
            .filter((b) => b.org_id === orgId && ((clientId && b.client_id === clientId) || (uid && b.provider_uid === uid)))
            .map((b) => ({
              status: b.status,
              at_this_time: sameInstant(b.starts_at, at),
              was_at_this_time: (b.history || []).some((t) => sameInstant(t, at))
            }))
        };
      }
      return base.query(sql, params);
    }
  };
}
const handoffDb = (bookings) => {
  const base = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: handoffTemplates() });
  return { base, db: withBookings(base, bookings) };
};

test("move: a booking.rescheduled starts a run (the new time gets its text)", () => {
  const triggers = (aiSet043WayHandoff.opts.triggers || []).map((t) => t.event);
  assert.deepEqual(triggers.sort(), ["booking.created", "booking.rescheduled"]);
});

test("move: the old-time run is cancelled by a move to a DIFFERENT time, never by its own trigger", () => {
  const rules = aiSet043WayHandoff.opts.cancelOn || [];
  const moves = rules.filter((r) => r.event === "booking.rescheduled");
  assert.equal(moves.length, 2, "a move must cancel the old run by call id and by email");
  for (const r of moves) {
    assert.match(r.if, /event\.data\.payload\.startTime != async\.data\.payload\.startTime/,
      "without the time check the run a move starts could be cancelled by that same move");
  }
  assert.ok(moves.some((r) => /bookingUid == async\.data\.payload\.bookingUid/.test(r.if)));
  assert.ok(moves.some((r) => /email == async\.data\.payload\.email/.test(r.if)));
  // The cancel rules are unchanged.
  assert.equal(rules.filter((r) => r.event === "booking.cancelled").length, 2);
});

test("move: the run for the OLD time wakes, sees the call moved, sends nothing", async () => {
  const oldStart = inHours(3), newStart = inHours(27);
  const { base, db } = handoffDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: newStart, status: "rescheduled", history: [oldStart] }
  ]);
  const res = await handle({
    event: ev("booking.created", { startTime: oldStart, bookingUid: "72509", email: "a@b.com" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "call_moved");
  assert.equal(base.messages.length, 0, "a moved call got the 15-minute text at its old time");
  assert.equal(base.tasks.length, 0);
});

test("move: the run for the NEW time sends, once", async () => {
  const oldStart = inHours(3), newStart = inHours(27);
  const { base, db } = handoffDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: newStart, status: "rescheduled", history: [oldStart] }
  ]);
  const res = await handle({
    event: ev("booking.rescheduled", { startTime: newStart, bookingUid: "72509", email: "a@b.com" }, { id: "evt-move", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(base.messages.length, 1);
  assert.equal(base.messages[0].provider_ref, `workflow:${SMS_TEMPLATE_KEY}:${sendKeyFor("cl-1", newStart)}`);
});

test("cancel: a run that wakes for a cancelled call sends nothing", async () => {
  const start = inHours(3);
  const { base, db } = handoffDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: start, status: "cancelled" }
  ]);
  const res = await handle({
    event: ev("booking.created", { startTime: start, bookingUid: "72509" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.reason, "call_cancelled");
  assert.equal(base.messages.length, 0);
});

test("never double-send: the booking's run and a same-time move's run write ONE text", async () => {
  const start = inHours(3);
  const { base, db } = handoffDb([
    { org_id: "org-1", client_id: "cl-1", provider_uid: "72509", starts_at: start, status: "rescheduled" }
  ]);
  await handle({ event: ev("booking.created", { startTime: start, bookingUid: "72509" }, { id: "evt-a", clientId: "cl-1" }), db, step: fakeStep() });
  // Same instant written another way, from a different event.
  const sameTimeOtherShape = new Date(start).toISOString().replace(".000Z", "Z");
  await handle({ event: ev("booking.rescheduled", { startTime: sameTimeOtherShape, bookingUid: "72509" }, { id: "evt-b", clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(base.messages.length, 1, "two runs for one call time both queued the text");
  assert.equal(base.tasks.length, 1);
});

test("never for a past time: a move to a time already gone sends nothing", async () => {
  const { base, db } = handoffDb([]);
  const res = await handle({
    event: ev("booking.rescheduled", { startTime: inHours(-1), bookingUid: "72509" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.reason, "appointment_already_started");
  assert.equal(base.messages.length, 0);
});

test("no saved booking speaks to this time: the text still goes (acts as before)", async () => {
  const { base, db } = handoffDb([]);
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), bookingUid: "72509" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(base.messages.length, 1);
});

/* ── The real join link: the Meet link on the host's calendar event ──────────
 *
 * ClickFunnels books the call on the host's Google Calendar, and Google puts a
 * Meet link on that event. The webhook carries none. So the run reads the host
 * calendar (src/bookings/meet-link.mjs, injected here as findLink — no network)
 * and keeps the link on the booking and the closer's call task.
 */
const MEET = "https://meet.google.com/kcz-tqvb-xyz";

function linkDb() {
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "lead@acme.com" }],
    templates: handoffTemplates()
  });
  const writes = [];
  const db = {
    ...base,
    async query(sql, params) {
      if (/UPDATE bookings\s+SET meeting_url/.test(sql)) {
        writes.push({ table: "bookings", params });
        return { rows: [{ provider_uid: "74249" }] };
      }
      if (/UPDATE tasks\s+SET meeting_url/.test(sql)) {
        writes.push({ table: "tasks", params });
        return { rows: [{ id: "t-1" }] };
      }
      return base.query(sql, params);
    }
  };
  return { base, db, writes };
}

test("join link: soon after booking, the host calendar's Meet link is kept on the booking and the call task", async () => {
  const { db, writes } = linkDb();
  const asked = [];
  const start = inHours(30);
  const steps = [];
  const step = { ...fakeStep(), run: async (id, fn) => { steps.push(id); return fn(); }, sleep: async (id) => { steps.push(id); } };
  const res = await handle({
    event: ev("booking.created", { startTime: start, email: "lead@acme.com", bookingUid: "form-msg-1" }, { clientId: "cl-1" }),
    db, step,
    findLink: async (q) => { asked.push(q); return { ok: true, url: MEET, source: "GOOGLE_GMAIL_OAUTH_TOKEN_JSON" }; }
  });
  // The wait comes before the read, and both come before the 15-minute plan.
  assert.ok(steps.indexOf("wait-for-host-calendar") < steps.indexOf("keep-meet-link"));
  assert.ok(steps.indexOf("keep-meet-link") < steps.indexOf("plan-handoff"));
  assert.deepEqual(asked[0], { email: "lead@acme.com", startTime: start });
  assert.equal(res.joinLink.ok, true);
  assert.equal(res.joinLink.url, MEET);
  const b = writes.find((w) => w.table === "bookings");
  assert.equal(b.params[1], "form-msg-1");
  assert.equal(b.params[2], "cl-1");
  assert.equal(b.params[3], new Date(start).toISOString());
  assert.equal(b.params[4], MEET);
  // The task is found by every id the booking was saved under: the form id and the call id.
  const t = writes.find((w) => w.table === "tasks");
  assert.deepEqual(t.params[1].sort(), ["74249", "form-msg-1"]);
  assert.equal(t.params[2], MEET);
});

test("join link: the 15-minute text uses the host calendar's Meet link, not the portal sign-in page", async () => {
  const { base, db } = linkDb();
  let calls = 0;
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), email: "lead@acme.com", bookingUid: "74249" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    // The early read missed (calendar slow); the read at T-15 finds it.
    findLink: async () => (++calls === 1 ? { ok: false, reason: "no_matching_event" } : { ok: true, url: MEET })
  });
  assert.equal(res.joinLink.ok, false);
  assert.equal(res.joinLink.reason, "no_matching_event");
  assert.equal(res.link.from, "host_calendar");
  assert.equal(res.link.url, MEET);
  assert.ok(base.messages[0].rendered_body.includes(MEET));
  assert.doesNotMatch(base.messages[0].rendered_body, /portal|login/i);
});

test("join link: when the calendar has no event the text clearly names the portal fallback, and the miss says why", async () => {
  const { base, db, writes } = linkDb();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), email: "lead@acme.com", bookingUid: "74249" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    findLink: async () => ({ ok: false, reason: "GOOGLE_GMAIL_OAUTH_TOKEN_JSON:no_calendar_scope" })
  });
  assert.equal(res.joinLink.reason, "GOOGLE_GMAIL_OAUTH_TOKEN_JSON:no_calendar_scope");
  assert.equal(res.link.from, "portal_sign_in");
  assert.equal(res.link.reason, "GOOGLE_GMAIL_OAUTH_TOKEN_JSON:no_calendar_scope");
  assert.equal(writes.length, 0, "nothing is written when no link was found");
  assert.ok(base.messages[0].rendered_body.includes(res.link.url));
  assert.match(base.messages[0].rendered_body, /portal sign-in fallback/i);
  assert.match(base.messages[0].rendered_body, /not the meeting link/i);
});

test("join link: a lookup that throws never stops the run", async () => {
  const { base, db } = linkDb();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), email: "lead@acme.com" }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    findLink: async () => { throw new Error("socket hang up"); }
  });
  assert.equal(res.done, true);
  assert.match(res.joinLink.reason, /lookup_threw:socket hang up/);
  assert.equal(base.messages.length, 1);
});
