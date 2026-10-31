import { test } from "node:test";
import assert from "node:assert";
import {
  handle as runCadence, aiSet03NoAnswerCadence,
  MSG1_KEY, MSG2_KEY, MSG3_KEY, OPTIN1_KEY, OPTIN2_KEY, OPTIN3_KEY
} from "./ai-set-03-no-answer-cadence.mjs";
import { formatAppointmentStart } from "./messaging.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { withReplyRead } from "./stop-on-reply.test-support.mjs";

const MSG_KEYS = [MSG1_KEY, MSG2_KEY, MSG3_KEY];
const OPTIN_KEYS = [OPTIN1_KEY, OPTIN2_KEY, OPTIN3_KEY];
const QUALIFIED_LINK = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";

// Each body names its set and carries the tag that set can use.
const templates = () => [
  ...MSG_KEYS.map((k) => ({ org_id: "org-1", template_key: k, channel: "sms", body: `${k} call at {{appointment.start_time}}`, compliance_passed: true })),
  ...OPTIN_KEYS.map((k) => ({ org_id: "org-1", template_key: k, channel: "sms", body: `${k} pick a time: {{custom_values.booking_link}}`, compliance_passed: true }))
];

const START = "2026-10-31T16:00:00Z"; // when the trigger event was saved
const minutesAfter = (min) => new Date(Date.parse(START) + min * 60_000).toISOString();
// The bookings read compares with the real clock, so these are relative to now.
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

/* The read AI-SET-03 makes before each text: did the person book or move a call
   after the run began? Answered from the fake's events the way the SQL answers it. */
function withRebookedRead(inner) {
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    if (!/FROM events e, events s/.test(String(sql))) return inner.query(sql, params);
    const [clientId, eventId] = params;
    const start = inner.events.find((e) => e.id === eventId);
    const hit = !!start && inner.events.some((e) => e.client_id === clientId && e.org_id === start.org_id
      && ["booking.created", "booking.rescheduled"].includes(e.name)
      && Date.parse(e.created_at) > Date.parse(start.created_at));
    return { rows: hit ? [{ rebooked: 1 }] : [] };
  };
  return wrapped;
}

const PERSON = { id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15550001111", first_name: "Pat", custom_fields: {} };

function makeDb({ bookings = [], events = [], client = {} } = {}) {
  return withRebookedRead(withReplyRead(pgFake({
    clients: [{ ...PERSON, ...client }], templates: templates(), bookings, events
  })));
}

const NO_ANSWER = { disposition: "no_answer", setter_staff_id: "staff-1", call_attempts: 1 };
const noAnswer = (id = "evt-na-1") => ev("setter.no_answer", NO_ANSWER, { id, clientId: "cl-1" });

/* The event bus saves the trigger event before any workflow runs, and the stop
   reads measure from its created_at. Do the same here, then run the cadence.
   `now` is the clock the plan reads: when the setter pressed "No answer". */
async function run(db, event, step = fakeStep(), now) {
  if (!db.events.some((e) => e.id === event.id)) {
    db.events.push({
      id: event.id, org_id: event.orgId, client_id: event.clientId,
      name: event.name, payload: event.payload, created_at: START
    });
  }
  return runCadence({ event, db, step, ...(now ? { now: () => new Date(now) } : {}) });
}

/* A step fake that records every step in order and lets a test change the event
   table while the run "sleeps". wake(id) runs when the sleep named id ends. */
function recordingStep({ wake } = {}) {
  const calls = [];
  return {
    calls,
    run: async (id, fn) => { calls.push({ kind: "run", id }); return fn(); },
    sleep: async (id, length) => { calls.push({ kind: "sleep", id, length }); if (wake) await wake(id); },
    sleepUntil: async (id, when) => { calls.push({ kind: "sleepUntil", id, at: new Date(when).toISOString() }); if (wake) await wake(id); }
  };
}
const plannedTimes = (step) => Object.fromEntries(step.calls.filter((c) => c.kind === "sleepUntil").map((c) => [c.id, c.at]));
const ids = (step) => step.calls.map((c) => c.id);
const inOrder = (step, ...names) => {
  const seen = ids(step);
  const at = names.map((n) => seen.indexOf(n));
  assert.ok(at.every((i) => i >= 0), `missing step in ${seen.join(", ")}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, `steps out of order: ${names.join(" < ")} in ${seen.join(", ")}`);
};

const booking = (kind, iso) => ({ id: `bk-${kind}-${iso}`, org_id: "org-1", client_id: "cl-1", name: kind, payload: {}, created_at: iso });
const emailReply = (iso) => ({ id: `in-e-${iso}`, org_id: "org-1", client_id: "cl-1", name: "message.inbound", payload: { channel: "email", from: "a@b.com", body: "yes" }, created_at: iso });
// A text reply as the Twilio adapter saves it: no person on the event, the number in payload.from.
const textReply = (iso, from = "+15550001111") => ({ id: `in-t-${iso}`, org_id: "org-1", client_id: null, name: "message.inbound", payload: { channel: "sms", from, body: "who is this" }, created_at: iso });

// Arizona is UTC-7 all year (no daylight saving).
const AT_10_00 = "2026-10-31T17:00:00Z";
const AT_4_50_PM = "2026-10-31T23:50:00Z";
const AT_11_00_PM = "2026-11-01T06:00:00Z";

test("starts on the setter's No answer and on a finished no-answer call", () => {
  assert.deepEqual(aiSet03NoAnswerCadence.opts.triggers, [{ event: "call.completed" }, { event: "setter.no_answer" }]);
});

test("setter No answer, no call booked: the three opt-in texts go out, each with the person's own calendar link", async () => {
  const db = makeDb({ client: { custom_fields: { cf_svy_self_reported_fico_label: "760-850" } } });
  const res = await run(db, noAnswer());
  assert.equal(res.exitedAt, "completed");
  assert.deepEqual(db.messages.map((m) => m.template_key), OPTIN_KEYS);
  for (const m of db.messages) assert.ok(m.rendered_body.includes(QUALIFIED_LINK), m.rendered_body);
});

test("a call still ahead: the three call-booked texts go out, with the time of that call", async () => {
  const startsAt = inDays(3);
  const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: startsAt }] });
  const res = await run(db, noAnswer());
  assert.equal(res.exitedAt, "completed");
  assert.deepEqual(db.messages.map((m) => m.template_key), MSG_KEYS);
  const when = formatAppointmentStart(new Date(startsAt).toISOString(), "America/Phoenix");
  for (const m of db.messages) assert.ok(m.rendered_body.includes(when), m.rendered_body);
});

test("a rescheduled call counts as a call ahead", async () => {
  const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", status: "rescheduled", starts_at: inDays(2) }] });
  await run(db, noAnswer());
  assert.deepEqual(db.messages.map((m) => m.template_key), MSG_KEYS);
});

test("a call that has started, a cancelled call and somebody else's call are not a call ahead", async () => {
  const cases = [
    { status: "booked", starts_at: inDays(-1) },
    { status: "cancelled", starts_at: inDays(3) },
    { status: "booked", starts_at: inDays(3), client_id: "cl-2" }
  ];
  for (const b of cases) {
    const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", ...b }] });
    await run(db, noAnswer());
    assert.deepEqual(db.messages.map((m) => m.template_key), OPTIN_KEYS, JSON.stringify(b));
  }
});

test("a finished call that ended with no answer still starts it", async () => {
  for (const disposition of ["no_answer", "no-answer", "voicemail"]) {
    const db = makeDb();
    const res = await run(db, ev("call.completed", { disposition }, { id: `evt-cc-${disposition}`, clientId: "cl-1" }));
    assert.equal(res.exitedAt, "completed", disposition);
    assert.equal(db.messages.length, 3, disposition);
  }
});

/* ── When each text goes out: the drip window, 9 a.m. to 5 p.m. Arizona ────────
 *
 * The dispatcher holds a text that comes due outside the window until 9 a.m. and
 * never looks at bookings or replies again. So the run plans each moment inside
 * the window, sleeps until it, THEN checks, THEN sends. Text 1 is due now; text 2
 * 30 minutes after text 1's moment; text 3 two hours after text 2's.
 */
test("No answer at 10:00 a.m.: the texts go at 10:00, 10:30 and 12:30", async () => {
  const db = makeDb();
  const step = recordingStep();
  const res = await run(db, noAnswer(), step, AT_10_00);
  assert.equal(res.exitedAt, "completed");
  assert.deepEqual(plannedTimes(step), {
    "wait-until-msg1": "2026-10-31T17:00:00.000Z",
    "wait-until-msg2": "2026-10-31T17:30:00.000Z",
    "wait-until-msg3": "2026-10-31T19:30:00.000Z"
  });
});

test("No answer at 4:50 p.m.: text 1 goes at once; texts 2 and 3 go the next morning at DIFFERENT times, not both at 9:00", async () => {
  const db = makeDb();
  const step = recordingStep();
  const res = await run(db, noAnswer(), step, AT_4_50_PM);
  const planned = plannedTimes(step);
  assert.equal(planned["wait-until-msg1"], "2026-10-31T23:50:00.000Z", "4:50 p.m.: the window is open");
  assert.equal(planned["wait-until-msg2"], "2026-11-01T16:00:00.000Z", "5:20 p.m. is closed: 9:00 a.m.");
  assert.equal(planned["wait-until-msg3"], "2026-11-01T18:00:00.000Z", "two hours after that: 11:00 a.m.");
  assert.notEqual(planned["wait-until-msg2"], planned["wait-until-msg3"]);
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
});

test("No answer at 11:00 p.m.: text 1 waits for 9:00 a.m., then 9:30 and 11:30", async () => {
  const db = makeDb();
  const step = recordingStep();
  await run(db, noAnswer(), step, AT_11_00_PM);
  assert.deepEqual(plannedTimes(step), {
    "wait-until-msg1": "2026-11-01T16:00:00.000Z",
    "wait-until-msg2": "2026-11-01T16:30:00.000Z",
    "wait-until-msg3": "2026-11-01T18:30:00.000Z"
  });
});

test("a reply or a booking at 8 a.m. stops a text that was held overnight for 9 a.m.", async () => {
  for (const [what, arrives, exitedAt] of [
    ["a text back", textReply("2026-11-01T15:00:00Z", "(555) 000-1111"), "replied"],
    ["an email back", emailReply("2026-11-01T15:00:00Z"), "replied"],
    ["a booking", booking("booking.created", "2026-11-01T15:00:00Z"), "before-msg1"]
  ]) {
    const db = makeDb();
    const step = recordingStep({ wake: (id) => { if (id === "wait-until-msg1") db.events.push(arrives); } });
    const res = await run(db, noAnswer(), step, AT_11_00_PM);
    assert.equal(res.exitedAt, exitedAt, what);
    assert.equal(db.messages.length, 0, what);
  }
});

test("at every planned moment the order is sleep, booked check, reply check, send", async () => {
  const db = makeDb();
  const step = recordingStep();
  await run(db, noAnswer(), step, AT_4_50_PM);
  for (const n of [1, 2, 3]) {
    inOrder(step, `plan-msg${n}`, `wait-until-msg${n}`, `check-rebooked-${n}`, `check-replied-${n}`, `send-msg${n}`);
  }
  inOrder(step, "send-msg1", "plan-msg2", "send-msg2", "plan-msg3", "send-msg3");
});

test("a booking made at 9 p.m., after text 1, stops text 2 that was held for 9:00 a.m. (the check runs at 9:00, not at 5:20 p.m.)", async () => {
  const db = makeDb();
  const step = recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.events.push(booking("booking.created", "2026-11-01T04:00:00Z")); } });
  const res = await run(db, noAnswer(), step, AT_4_50_PM);
  assert.equal(res.exitedAt, "after-msg1");
  assert.deepEqual(db.messages.map((m) => m.template_key), [OPTIN1_KEY]);
});

/* The old check asked "has this person ever booked?" With a call booked that is
   always yes, so the call-booked words would have stopped after text 1. */
test("a booking made BEFORE the run began does not stop the call-booked texts", async () => {
  const db = makeDb({
    bookings: [{ org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: inDays(3) }],
    events: [booking("booking.created", minutesAfter(-60 * 24))]
  });
  const res = await run(db, noAnswer());
  assert.equal(res.exitedAt, "completed");
  assert.deepEqual(db.messages.map((m) => m.template_key), MSG_KEYS);
});

/* Independent review of PR #346 (2026-10-31): the call-booked texts ask the person to keep their
   call. Once that call is cancelled, or has already happened, the next text must not go. */
test("a call cancelled after text 1 stops texts 2 and 3", async () => {
  const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: inDays(3) }] });
  const step = recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.bookings[0].status = "cancelled"; } });
  const res = await run(db, noAnswer(), step);
  assert.equal(res.exitedAt, "call-gone-after-msg1");
  assert.deepEqual(db.messages.map((m) => m.template_key), [MSG_KEYS[0]]);
  inOrder(step, "check-replied-2", "check-call-still-on-2");
});

test("a call that has already happened before text 3 stops text 3", async () => {
  const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: inDays(3) }] });
  const step = recordingStep({ wake: (id) => { if (id === "wait-until-msg3") db.bookings[0].starts_at = inDays(-0.05); } });
  const res = await run(db, noAnswer(), step);
  assert.equal(res.exitedAt, "call-gone-after-msg2");
  assert.deepEqual(db.messages.map((m) => m.template_key), MSG_KEYS.slice(0, 2));
});

/* Second read-only review of PR #346 (2026-10-31): the setter desk saves "reached" or "booked on call"
   on the person and emits no event, so a later conversation must still stop "missed you" texts. */
test("a setter who reaches the person after the No answer stops the next text", async () => {
  const db = makeDb();
  const step = recordingStep({ wake: (id) => {
    if (id === "wait-until-msg2") db.clients[0].custom_fields = { setter_handoff: { disposition: "reached" } };
  } });
  const res = await run(db, noAnswer(), step);
  assert.equal(res.exitedAt, "setter-reached");
  assert.deepEqual(db.messages.map((m) => m.template_key), [OPTIN1_KEY]);
  inOrder(step, "check-replied-2", "check-reached-2");
});

test("booked on the setter's call stops the cadence too; a later No answer does not", async () => {
  const booked = makeDb({ client: { custom_fields: { setter_handoff: { disposition: "booked_on_call" } } } });
  assert.equal((await run(booked, noAnswer())).exitedAt, "setter-reached");
  assert.equal(booked.messages.length, 0);
  const again = makeDb({ client: { custom_fields: { setter_handoff: { disposition: "no_answer" } } } });
  assert.equal((await run(again, noAnswer())).exitedAt, "completed");
});

test("no call booked: the opt-in texts never ask about a call, so nothing extra is checked", async () => {
  const db = makeDb();
  const step = recordingStep();
  await run(db, noAnswer(), step);
  assert.ok(!ids(step).some((id) => id.startsWith("check-call-still-on-")), ids(step).join(", "));
});

test("branch: booking after the first text stops the cadence early", async () => {
  const db = makeDb();
  const res = await run(db, noAnswer(), recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.events.push(booking("booking.created", minutesAfter(20))); } }), AT_10_00);
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 1);
});

test("branch: moving the call after the second text stops the third", async () => {
  const db = makeDb({ bookings: [{ org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: inDays(3) }] });
  const res = await run(db, noAnswer(), recordingStep({ wake: (id) => { if (id === "wait-until-msg3") db.events.push(booking("booking.rescheduled", minutesAfter(150))); } }), AT_10_00);
  assert.equal(res.exitedAt, "after-msg2");
  assert.deepEqual(db.messages.map((m) => m.template_key), [MSG1_KEY, MSG2_KEY]);
});

test("a text back from the person stops the cadence (the reply event has no person on it)", async () => {
  const db = makeDb();
  const res = await run(db, noAnswer(), recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.events.push(textReply(minutesAfter(10), "(555) 000-1111")); } }), AT_10_00);
  assert.equal(res.exitedAt, "replied");
  assert.equal(db.messages.length, 1);
});

test("an email back from the person stops the third text", async () => {
  const db = makeDb();
  const res = await run(db, noAnswer(), recordingStep({ wake: (id) => { if (id === "wait-until-msg3") db.events.push(emailReply(minutesAfter(140))); } }), AT_10_00);
  assert.equal(res.exitedAt, "replied");
  assert.deepEqual(db.messages.map((m) => m.template_key), [OPTIN1_KEY, OPTIN2_KEY]);
});

test("a reply from before the run began does not stop it", async () => {
  const db = makeDb({ events: [textReply(minutesAfter(-30)), emailReply(minutesAfter(-5))] });
  const res = await run(db, noAnswer());
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
});

test("somebody else's text does not stop it", async () => {
  const db = makeDb();
  const res = await run(db, noAnswer(), recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.events.push(textReply(minutesAfter(10), "+15559998888")); } }), AT_10_00);
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
});

test("branch: answered calls are ignored", async () => {
  const db = makeDb();
  const res = await run(db, ev("call.completed", { disposition: "transferred" }, { clientId: "cl-1" }));
  assert.equal(res.done, false);
});

test("guard: a closer disposition never starts the no-answer cadence", async () => {
  const db = makeDb();
  const res = await run(db, ev("call.completed", {
    disposition: "closer",
    outcome: "callback",
    repairReferral: false,
    declineReason: null
  }, { clientId: "cl-1" }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_no_answer");
  assert.equal(db.messages.length, 0);
});

test("a person this company does not have is not texted", async () => {
  const db = makeDb();
  const res = await run(db, ev("setter.no_answer", NO_ANSWER, { id: "evt-other-org", orgId: "org-2", clientId: "cl-1" }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = makeDb();
  const event = noAnswer("evt-dup-aiset03");
  await run(db, event);
  await run(db, event);
  assert.equal(db.messages.length, 3);
});

test("a new day's No answer starts a new cadence", async () => {
  const db = makeDb();
  await run(db, noAnswer("evt-day-1"));
  await run(db, noAnswer("evt-day-2"));
  assert.equal(db.messages.length, 6);
});
