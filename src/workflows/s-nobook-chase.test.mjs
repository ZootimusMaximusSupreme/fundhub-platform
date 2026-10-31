import { test } from "node:test";
import assert from "node:assert";
import {
  handle as runChase, sNobookChase, SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_01, EMAIL_NOBOOK_02, EMAIL_NOBOOK_03,
  SETTER_TASK_SOURCE, SETTER_TASK_TITLE, SETTER_TASK_DETAIL
} from "./s-nobook-chase.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { withReplyRead } from "./stop-on-reply.test-support.mjs";

/* The event bus saves the trigger event before any workflow runs, and the
   workflow reads its created_at (when the survey was finished) and measures the
   reply check from it. Do the same here, then run the chase. */
async function handle({ event, db, step, now }) {
  if (!db.events.some((e) => e.id === event.id)) db.events.push({
    id: event.id, org_id: event.orgId, client_id: event.clientId,
    name: event.name, payload: event.payload, created_at: event.createdAt || "2026-10-30T12:00:00Z"
  });
  return runChase({ event, db, step, ...(now ? { now } : {}) });
}

/* The read that says when the survey was finished: the trigger event's
   created_at, answered from the fake's own events. Also keeps what the setter
   task was written with, because the fake task row does not hold `detail`. */
function withTriggerTime(inner) {
  const wrapped = Object.create(inner);
  wrapped.taskInserts = [];
  wrapped.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SELECT created_at FROM events WHERE id = \$1 AND org_id = \$2/.test(text)) {
      const row = inner.events.find((e) => e.id === params[0] && e.org_id === params[1]);
      return { rows: row ? [{ created_at: new Date(row.created_at) }] : [] };
    }
    if (/INSERT INTO tasks/.test(text)) wrapped.taskInserts.push(params);
    return inner.query(sql, params);
  };
  return wrapped;
}

/* sentByOtherTrigger, answered from the fake's own rows the way its SQL answers it: the same text to the
   same person, newer than `since`, whose send key names an event of the other trigger. pgFake stamps no
   time on a message it inserts, so a message with no created_at counts as just sent. The SQL itself is read
   against Postgres in nobook-chase-historical.pg.test.mjs. */
function withOtherTriggerRead(inner) {
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    if (!/JOIN events c ON/.test(String(sql)) || !/split_part\(m\.provider_ref/.test(String(sql))) return inner.query(sql, params);
    const [orgId, clientId, templateKey, since, otherTrigger] = params;
    const hit = inner.messages.some((m) => {
      if (m.org_id !== orgId || m.client_id !== clientId || m.template_key !== templateKey) return false;
      if (m.created_at && !(Date.parse(m.created_at) > Date.parse(since))) return false;
      const keyedOn = String(m.provider_ref || "").split(":")[2];
      return inner.events.some((e) => e.id === keyedOn && e.org_id === orgId && e.name === otherTrigger);
    });
    return { rows: hit ? [{ sent: 1 }] : [] };
  };
  return wrapped;
}

function makeDb(seed = {}) {
  return withOtherTriggerRead(withTriggerTime(withReplyRead(pgFake(seed))));
}

const templates = () => [
  { org_id: "org-1", template_key: SMS_NOBOOK_01, channel: "sms", body: "n1", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_02, channel: "sms", body: "n2", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_03, channel: "sms", body: "n3", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_01, channel: "email", body: "e1", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_02, channel: "email", body: "e2", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_03, channel: "email", body: "e3", compliance_passed: true }
];

const PERSON = { id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15550001111", custom_fields: {} };

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

// Arizona is UTC-7 all year (no daylight saving), so 4 p.m. there is 23:00Z.
const FINISHED_4PM = "2026-10-31T23:00:00Z";
const booking = (iso) => ({ id: `bk-${iso}`, org_id: "org-1", client_id: "cl-1", name: "booking.created", payload: {}, created_at: iso });
// An email reply is saved with the person on it.
const emailReply = (iso) => ({ id: `in-e-${iso}`, org_id: "org-1", client_id: "cl-1", name: "message.inbound", payload: { channel: "email", from: "a@b.com", body: "yes" }, created_at: iso });
// A text reply as the Twilio adapter saves it: no person on the event, the number in payload.from.
const textReply = (iso, from = "+15550001111") => ({ id: `in-t-${iso}`, org_id: "org-1", client_id: null, name: "message.inbound", payload: { channel: "sms", from, body: "who is this" }, created_at: iso });

const finishedEvent = (extra = {}) => ev("survey.completed", {}, { clientId: "cl-1", ...extra });

test("starts on a finished survey, not on the first answer", () => {
  assert.deepEqual(sNobookChase.opts.triggers, [{ event: "survey.completed" }]);
});

test("nobook: full cadence when never booked", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates()
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
  assert.deepEqual(db.messages.map((m) => m.template_key), [
    SMS_NOBOOK_01, EMAIL_NOBOOK_01, SMS_NOBOOK_02, EMAIL_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_03
  ]);
});

test("nobook: distinct events for one application share all three send keys", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates(),
    events: [
      { id: "evt-first", org_id: "org-1", client_id: "cl-1", name: "survey.completed", payload: { email: "a@b.com", funnel: "apply-survey" }, created_at: "2026-10-30T12:00:00Z" },
      { id: "evt-second", org_id: "org-1", client_id: "cl-1", name: "survey.completed", payload: { email: "a@b.com", funnel: "" }, created_at: "2026-10-30T12:00:01Z" }
    ]
  });
  for (const id of ["evt-first", "evt-second"]) {
    await handle({ event: ev("survey.completed", { email: "a@b.com" }, { id, clientId: "cl-1" }), db, step: fakeStep() });
  }
  assert.equal(db.messages.length, 6);
  assert.ok(db.messages.every((m) => m.provider_ref.includes("evt-first")));
});

test("nobook: a new survey more than six hours later starts a new cadence", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates(),
    events: [
      { id: "evt-first", org_id: "org-1", client_id: "cl-1", name: "survey.completed", payload: { email: "a@b.com" }, created_at: "2026-10-30T04:00:00Z" },
      { id: "evt-new", org_id: "org-1", client_id: "cl-1", name: "survey.completed", payload: { email: "a@b.com" }, created_at: "2026-10-30T12:00:00Z" }
    ]
  });
  for (const id of ["evt-first", "evt-new"]) {
    await handle({ event: ev("survey.completed", { email: "a@b.com" }, { id, clientId: "cl-1" }), db, step: fakeStep() });
  }
  assert.equal(db.messages.length, 12);
});

test("nobook: exits immediately if already booked", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates(),
    events: [{ client_id: "cl-1", name: "booking.created" }]
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("nobook: stops mid-cadence when they book after msg1", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates()
  });
  let sends = 0;
  const step = {
    run: async (id, fn) => {
      if (id.startsWith("send-")) sends += 1;
      if (sends === 1 && !db.events.some((e) => e.name === "booking.created")) {
        db.events.push({ client_id: "cl-1", name: "booking.created" });
      }
      return fn();
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const res = await handle({
    event: finishedEvent(),
    db, step
  });
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 2);
});

/* ── F39, the half that stops the texts already in flight ─────────────────────
 *
 * Until 2026-09-03 every ClickFunnels booking event was saved with no client on
 * it, so this workflow's "have they booked?" check could only ever answer no.
 * The adapter now stamps the client on new events, but every booking event
 * already in the database still has a null client, and every chase run asleep
 * in production wakes against those old rows. These three tests are that case.
 */
test("nobook: exits on a historical booking event that has no client on it (email match)", async () => {
  const db = makeDb({
    clients: [{ ...PERSON, email: "Booked@Example.com" }],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: null, name: "booking.created",
      payload: { email: "booked@example.com", startTime: "2026-09-07T18:00:00Z" }
    }]
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: exits on a historical booking event matched by phone, however it is written", async () => {
  const db = makeDb({
    clients: [{ ...PERSON, phone: "+1 (555) 000-1111" }],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: null, name: "booking.created",
      payload: { email: "different-address@example.com", phone: "5550001111" }
    }]
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: another company's booking for the same address does NOT stop this chase", async () => {
  const db = makeDb({
    clients: [{ ...PERSON, email: "shared@example.com" }],
    templates: templates(),
    events: [{
      org_id: "org-2", client_id: null, name: "booking.created",
      payload: { email: "shared@example.com" }
    }]
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
});

/* GAP 23, 2026-09-17 live walk. Sim Thirteen-NoBook never booked and never got a
   single chase message: four OTHER clients in the same company shared the test
   phone number, their bookings answered "yes, they booked" on his behalf, and
   the chase exited at already_booked before it ever sent anything. The address
   fallback exists for old rows with nobody on them; a booking stamped with
   somebody else is not this client's booking. */
test("nobook: somebody else's booking on the same phone number does NOT stop this chase", async () => {
  const db = makeDb({
    clients: [
      { ...PERSON, email: "nobook@example.com", phone: "+15550001111" },
      { id: "cl-2", org_id: "org-1", email: "housemate@example.com", phone: "+15550001111", custom_fields: {} }
    ],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: "cl-2", name: "booking.created",
      payload: { email: "housemate@example.com", phone: "+15550001111" }
    }]
  });
  const res = await handle({
    event: finishedEvent(),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
});

/* ── The setter task, 15 minutes after a finished survey with no booking ──── */

test("nobook: 15 minutes after the finish a setter task is made, before any text", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const step = recordingStep();
  const now = () => new Date("2026-10-31T23:15:00Z");
  const res = await handle({ event: finishedEvent({ id: "evt-done-1", createdAt: FINISHED_4PM }), db, step, now });
  assert.deepEqual(step.calls.find((c) => c.id === "wait-15m"), { kind: "sleep", id: "wait-15m", length: "15m" });
  inOrder(step, "wait-15m", "check-booked-15m", "check-replied-15m", "setter-task", "plan-msg1", "wait-until-msg1", "send-nobook-1");
  assert.equal(res.task.created, true);
  assert.equal(db.tasks.length, 1);
  const task = db.tasks[0];
  assert.equal(task.assignee_role, "setter");
  assert.equal(task.source_workflow, SETTER_TASK_SOURCE);
  assert.equal(task.source_workflow, "setter-survey-done");
  assert.equal(task.title, SETTER_TASK_TITLE);
  assert.equal(task.title, "Setter: call — finished the survey, no call booked");
  assert.equal(task.client_id, "cl-1");
  assert.equal(task.body, "evt-done-1", "keyed on the run's event id");
  assert.equal(task.due_at, "2026-10-31T23:15:00.000Z", "due right away");
  assert.equal(db.taskInserts[0][9], SETTER_TASK_DETAIL);
  assert.equal(SETTER_TASK_DETAIL, "They finished the survey but did not pick a time. Call now and book them on their calendar.");
});

test("nobook: nobody is called when they booked or wrote back inside the 15 minutes", async () => {
  const booked = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const resBooked = await handle({
    event: finishedEvent({ id: "evt-b", createdAt: FINISHED_4PM }), db: booked,
    step: recordingStep({ wake: (id) => { if (id === "wait-15m") booked.events.push({ client_id: "cl-1", name: "booking.created" }); } })
  });
  assert.equal(resBooked.exitedAt, "after-wait-15m");
  assert.equal(booked.tasks.length, 0);
  assert.equal(booked.messages.length, 0);

  const replied = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const resReplied = await handle({
    event: finishedEvent({ id: "evt-r", createdAt: FINISHED_4PM }), db: replied,
    step: recordingStep({ wake: (id) => { if (id === "wait-15m") replied.events.push(textReply("2026-10-31T23:10:00Z")); } })
  });
  assert.equal(resReplied.exitedAt, "replied");
  assert.equal(replied.tasks.length, 0);
  assert.equal(replied.messages.length, 0);
});

test("nobook: the same event twice makes one setter task and one set of texts", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const event = finishedEvent({ id: "evt-dup-task", createdAt: FINISHED_4PM });
  await handle({ event, db, step: fakeStep() });
  const again = await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(again.task.created, false);
  assert.equal(db.messages.length, 6);
});

/* ── When each text goes out: the drip window, 9 a.m. to 5 p.m. Arizona ────────
 *
 * The dispatcher holds a drip that comes due outside the window until 9 a.m. but
 * never looks at bookings or replies again. So the run plans each moment inside
 * the window, sleeps until it, THEN checks, THEN sends.
 */
test("nobook: survey finished at 4 p.m. — text 1 is planned for 9 a.m. the next day, and a booking at 8 a.m. stops it", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const step = recordingStep({
    // The booking arrives while the run sleeps: 8:00 a.m. Arizona, an hour before the planned moment.
    wake: (id) => { if (id === "wait-until-msg1") db.events.push(booking("2026-11-01T15:00:00Z")); }
  });
  const res = await handle({
    event: finishedEvent({ id: "evt-4pm", createdAt: FINISHED_4PM }), db, step,
    now: () => new Date("2026-10-31T23:15:00Z")
  });
  assert.equal(plannedTimes(step)["wait-until-msg1"], "2026-11-01T16:00:00.000Z", "9:00 a.m. Arizona the next day");
  assert.equal(res.exitedAt, "after-wait-2h");
  assert.equal(db.messages.length, 0, "nothing was sent");
  assert.equal(res.task.created, true, "the 15-minute setter task had already gone out");
  // The booking is found because the check runs AFTER the sleep, not at 6 p.m. when text 1 first came due.
  inOrder(step, "plan-msg1", "wait-until-msg1", "check-booked-1");
  assert.ok(!ids(step).includes("send-nobook-1"));
});

test("nobook: a reply at 8 a.m. stops text 1 the same way", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const step = recordingStep({
    wake: (id) => { if (id === "wait-until-msg1") db.events.push(textReply("2026-11-01T15:00:00Z", "(555) 000-1111")); }
  });
  const res = await handle({
    event: finishedEvent({ id: "evt-4pm-reply", createdAt: FINISHED_4PM }), db, step,
    now: () => new Date("2026-10-31T23:15:00Z")
  });
  assert.equal(res.exitedAt, "replied");
  assert.equal(db.messages.length, 0);
});

test("nobook: each text is planned from the one before it, always inside the window", async () => {
  // [when the survey was finished (UTC), text 1, text 2, text 3] — Arizona is UTC-7.
  const cases = [
    ["2026-10-31T23:00:00Z", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z", "2026-11-05T16:00:00.000Z"], // 4:00 p.m.: 6 p.m. is closed -> 9 a.m.
    ["2026-10-31T17:00:00Z", "2026-10-31T19:00:00.000Z", "2026-11-01T19:00:00.000Z", "2026-11-04T19:00:00.000Z"], // 10:00 a.m.: noon, and noon each time
    ["2026-10-31T22:00:00Z", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z", "2026-11-05T16:00:00.000Z"], // 3:00 p.m.: 5:00 p.m. exactly is closed
    ["2026-10-31T21:50:00Z", "2026-10-31T23:50:00.000Z", "2026-11-01T23:50:00.000Z", "2026-11-04T23:50:00.000Z"], // 2:50 p.m.: 4:50 p.m. is the last planned minute
    ["2026-10-31T21:51:00Z", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z", "2026-11-05T16:00:00.000Z"], // 2:51 p.m.: 4:51 p.m. is past 4:50 -> 9 a.m.
    ["2026-10-31T21:55:00Z", "2026-11-01T16:00:00.000Z", "2026-11-02T16:00:00.000Z", "2026-11-05T16:00:00.000Z"], // 2:55 p.m.: 4:55 p.m. would miss the 4:55 sweep -> 9 a.m.
    ["2026-10-31T13:00:00Z", "2026-10-31T16:00:00.000Z", "2026-11-01T16:00:00.000Z", "2026-11-04T16:00:00.000Z"]  // 6:00 a.m.: 8 a.m. is not open yet -> 9 a.m. today
  ];
  for (const [finished, t1, t2, t3] of cases) {
    const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
    const step = recordingStep();
    const res = await handle({
      event: finishedEvent({ id: `evt-${finished}`, createdAt: finished }), db, step,
      now: () => new Date(Date.parse(finished) + 15 * 60_000)
    });
    assert.equal(res.exitedAt, "completed", finished);
    assert.deepEqual(plannedTimes(step), {
      "wait-until-msg1": t1, "wait-until-msg2": t2, "wait-until-msg3": t3
    }, `finished ${finished}`);
  }
});

test("nobook: at every planned moment the order is sleep, booked check, reply check, send", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const step = recordingStep();
  await handle({ event: finishedEvent({ id: "evt-order", createdAt: FINISHED_4PM }), db, step, now: () => new Date("2026-10-31T23:15:00Z") });
  for (const n of [1, 2, 3]) {
    inOrder(step, `plan-msg${n}`, `wait-until-msg${n}`, `check-booked-${n}`, `check-replied-${n}`, `send-nobook-${n}`);
  }
  inOrder(step, "send-nobook-1", "plan-msg2", "send-nobook-2", "plan-msg3", "send-nobook-3");
});

test("nobook: a booking after text 1 but before text 2's planned moment stops text 2", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const res = await handle({
    event: finishedEvent({ id: "evt-mid", createdAt: FINISHED_4PM }), db,
    step: recordingStep({ wake: (id) => { if (id === "wait-until-msg2") db.events.push(booking("2026-11-02T14:00:00Z")); } }),
    now: () => new Date("2026-10-31T23:15:00Z")
  });
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 2);
});

test("nobook: a reply stops texts 2 and 3", async () => {
  for (const [wakeId, exitMessages] of [["wait-until-msg2", 2], ["wait-until-msg3", 4]]) {
    const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
    const res = await handle({
      event: finishedEvent({ id: `evt-reply-${wakeId}`, createdAt: FINISHED_4PM }), db,
      step: recordingStep({ wake: (id) => { if (id === wakeId) db.events.push(emailReply("2026-11-02T10:00:00Z")); } }),
      now: () => new Date("2026-10-31T23:15:00Z")
    });
    assert.equal(res.exitedAt, "replied", wakeId);
    assert.equal(db.messages.length, exitMessages, wakeId);
  }
});

test("nobook: a reply from before the survey was finished, or from somebody else, does not stop it", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }],
    templates: templates(),
    events: [textReply("2026-10-31T20:00:00Z"), emailReply("2026-10-31T22:59:00Z")]
  });
  const res = await handle({
    event: finishedEvent({ id: "evt-old-reply", createdAt: FINISHED_4PM }), db,
    step: recordingStep({ wake: (id) => { if (id === "wait-until-msg1") db.events.push(textReply("2026-11-01T10:00:00Z", "+15559998888")); } }),
    now: () => new Date("2026-10-31T23:15:00Z")
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
});

test("nobook: a run that starts late never plans a moment in the past", async () => {
  const finished = "2026-10-31T17:00:00Z"; // 10:00 a.m.; text 1 would be due at noon
  const run = async (nowIso) => {
    const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
    const step = recordingStep();
    await handle({ event: finishedEvent({ id: `evt-late-${nowIso}`, createdAt: finished }), db, step, now: () => new Date(nowIso) });
    return plannedTimes(step)["wait-until-msg1"];
  };
  assert.equal(await run("2026-10-31T22:30:00Z"), "2026-10-31T22:30:00.000Z", "3:30 p.m.: open, so right away");
  assert.equal(await run("2026-11-01T02:00:00Z"), "2026-11-01T16:00:00.000Z", "7 p.m.: closed, so 9 a.m.");
});

/* ── Runs that were already asleep when the trigger moved ─────────────────────
 *
 * Runs started by survey.submitted (the first answer) before this shipped keep
 * going when the engine wakes them. They finish under the name they started
 * with: the same send keys, so nobody is texted twice, no setter task (a first
 * answer is not a finished survey), and their old fixed waits.
 */
test("nobook: a run that started under survey.submitted keeps its old waits, send keys and no setter task", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const step = recordingStep();
  const res = await handle({
    event: ev("survey.submitted", {}, { id: "evt-old-trigger", clientId: "cl-1" }), db, step
  });
  assert.equal(res.exitedAt, "completed");
  assert.deepEqual(step.calls.filter((c) => c.kind === "sleep").map((c) => [c.id, c.length]),
    [["wait-2h", "2h"], ["wait-24h", "24h"], ["wait-72h", "72h"]]);
  assert.equal(db.tasks.length, 0);
  assert.equal(res.task, null);
  assert.equal(db.messages.length, 6);
  assert.ok(db.messages.every((m) => m.provider_ref.includes("evt-old-trigger")));
  // Stop on reply applies to them too.
  const db2 = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const res2 = await handle({
    event: ev("survey.submitted", {}, { id: "evt-old-reply", clientId: "cl-1" }), db: db2,
    step: recordingStep({ wake: (id) => { if (id === "wait-24h") db2.events.push(textReply("2026-11-01T10:00:00Z")); } })
  });
  assert.equal(res2.exitedAt, "replied");
  assert.equal(db2.messages.length, 2);
});

/* The cross-trigger overlap (2026-10-31). Each run keys its sends on its own trigger's cohort, so a
   survey.submitted run asleep at the ship and the survey.completed run started when the person finishes
   wrote different send keys for the same text: every text twice. Now a run skips a text the other
   trigger's run already sent to the person. */
const OLD_START = "2026-10-30T10:00:00Z"; // the first answer, before the ship
const FINISH = "2026-10-30T20:00:00Z";    // the finish, after the ship
const oldTriggerEvent = () => ev("survey.submitted", {}, { id: "evt-first-answer", clientId: "cl-1", createdAt: OLD_START });
const finishEvent = () => ev("survey.completed", {}, { id: "evt-finished", clientId: "cl-1", createdAt: FINISH });

test("nobook: a first-answer chase already sent each text, then they finish: no text goes twice, the setter task still does", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  const old = await handle({ event: oldTriggerEvent(), db, step: fakeStep() });
  const fresh = await handle({ event: finishEvent(), db, step: fakeStep() });
  assert.equal(old.exitedAt, "completed");
  assert.equal(fresh.exitedAt, "completed");
  assert.equal(db.messages.length, 6, "six messages, not twelve");
  assert.ok(db.messages.every((m) => m.provider_ref.includes("evt-first-answer")));
  for (const n of [1, 2, 3]) {
    assert.deepEqual(fresh[`msg${n}`], { sms: { skipped: "sent_by_other_trigger" }, email: { skipped: "sent_by_other_trigger" } }, `text ${n}`);
  }
  assert.equal(db.tasks.length, 1, "a finished survey still gets a setter on the phone");
});

test("nobook: the finished-survey chase sent first, then the first-answer run wakes: it sends nothing again", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  await handle({ event: finishEvent(), db, step: fakeStep() });
  const old = await handle({ event: oldTriggerEvent(), db, step: fakeStep() });
  assert.equal(old.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
  assert.ok(db.messages.every((m) => m.provider_ref.includes("evt-finished")));
});

test("nobook: only the text the other run sent is skipped; the texts it never sent still go", async () => {
  // The first-answer run sent text 1, then stopped on a reply that came before the finish.
  const db = makeDb({ clients: [{ ...PERSON }], templates: templates() });
  await handle({
    event: oldTriggerEvent(), db,
    step: recordingStep({ wake: (id) => { if (id === "wait-24h") db.events.push(textReply("2026-10-30T18:00:00Z")); } })
  });
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_NOBOOK_01, EMAIL_NOBOOK_01]);
  const fresh = await handle({ event: finishEvent(), db, step: fakeStep() });
  assert.equal(fresh.exitedAt, "completed");
  assert.deepEqual(db.messages.map((m) => m.template_key),
    [SMS_NOBOOK_01, EMAIL_NOBOOK_01, SMS_NOBOOK_02, EMAIL_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_03]);
});

test("nobook: a text from the other trigger older than five days before this run does not count", async () => {
  const db = makeDb({
    clients: [{ ...PERSON }], templates: templates(),
    events: [{ id: "evt-long-ago", org_id: "org-1", client_id: "cl-1", name: "survey.submitted", payload: {}, created_at: "2026-10-20T10:00:00Z" }]
  });
  db.messages.push({
    org_id: "org-1", client_id: "cl-1", channel: "sms", template_key: SMS_NOBOOK_01,
    provider_ref: "workflow:SMS-NOBOOK-01:evt-long-ago:1", created_at: "2026-10-20T12:00:00Z"
  });
  await handle({ event: finishEvent(), db, step: fakeStep() });
  assert.equal(db.messages.filter((m) => m.provider_ref.includes("evt-finished")).length, 6);
});

/* ── Every link follows the person's score ────────────────────────────────────
 *
 * The chase's texts and emails carry {{custom_values.booking_link}}. A link opens
 * in a tab that never saw /apply, so the link itself picks the calendar from the
 * saved answer: 700 and up -> the first calendar, everyone else -> the second.
 * Run through the real sendTemplated, all six messages.
 */
const Q = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";
const U = "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u";
const linkTemplates = () => templates().map((t) => ({
  ...t,
  body: t.channel === "email" ? `<p>${t.template_key}</p><a href="{{custom_values.booking_link}}">Pick a time</a>` : `${t.template_key} {{custom_values.booking_link}}`
}));
const LINK_CASES = [
  ["answer 700-759", { cf_svy_self_reported_fico_label: "700-759" }, Q],
  ["answer 760-850", { cf_svy_self_reported_fico_label: "760-850" }, Q],
  ["answer 620-699", { cf_svy_self_reported_fico_label: "620-699" }, U],
  ["answer 500-619", { cf_svy_self_reported_fico_label: "500-619" }, U],
  ["answer Not sure", { cf_svy_self_reported_fico_label: "Not sure" }, U],
  ["saved before 2026-10-31: 700-749", { cf_svy_self_reported_fico_label: "700-749" }, Q],
  ["saved before 2026-10-31: 750+", { cf_svy_self_reported_fico_label: "750+" }, Q],
  ["saved before 2026-10-31: 650-699", { cf_svy_self_reported_fico_label: "650-699" }, U],
  ["saved before 2026-10-31: 580-649", { cf_svy_self_reported_fico_label: "580-649" }, U],
  ["saved before 2026-10-31: 500-579", { cf_svy_self_reported_fico_label: "500-579" }, U],
  ["answer saved without a label", { cf_svy_self_reported_fico: "760-850" }, Q],
  ["setter fixed a low score up", { cf_svy_self_reported_fico_label: "620-699", setter_survey_edits: { cf_svy_self_reported_fico: "700-759" } }, Q],
  ["setter fixed a high score down", { cf_svy_self_reported_fico_label: "760-850", setter_survey_edits: { cf_svy_self_reported_fico: "620-699" } }, U]
];

test("nobook: every text and email carries the calendar link for the person's score", async () => {
  for (const [label, custom_fields, expected] of LINK_CASES) {
    const db = makeDb({ clients: [{ ...PERSON, custom_fields }], templates: linkTemplates() });
    const res = await handle({ event: finishedEvent({ id: `evt-link-${label}` }), db, step: fakeStep() });
    assert.equal(res.exitedAt, "completed", label);
    assert.equal(db.messages.length, 6, label);
    const other = expected === Q ? U : Q;
    for (const m of db.messages) {
      assert.ok(m.rendered_body.includes(expected), `${label}: ${m.template_key} -> ${m.rendered_body}`);
      assert.ok(!m.rendered_body.includes(other), `${label}: ${m.template_key} has the wrong calendar`);
    }
  }
});

test("nobook: a person with no score answer yet gets no tier label on the link", async () => {
  const db = makeDb({ clients: [{ ...PERSON }], templates: linkTemplates() });
  await handle({ event: finishedEvent({ id: "evt-link-none" }), db, step: fakeStep() });
  assert.equal(db.messages.length, 6);
  assert.ok(db.messages.every((m) => m.rendered_body.includes("funding-book-call") && !m.rendered_body.includes("fh_tier")));
});
