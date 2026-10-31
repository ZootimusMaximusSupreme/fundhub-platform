import { test } from "node:test";
import assert from "node:assert";
import { handle, s05aNoShowRecovery, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, EMAIL_NOSHOW_02, SMS_NOSHOW_02 } from "./s-05a-no-show-recovery.mjs";
import * as S05A from "./s-05a-no-show-recovery.mjs";
import { pgFake, fakeStep as pgStep, ev } from "./test-support.mjs";

function fakeStep() {
  return { run: (_id, fn) => fn(), sleep: async () => {}, sleepUntil: async () => {} };
}

/* The rebook check reads times. The missed call was booked days before; it started at 12:00 p.m. Arizona,
   ran 30 minutes, and DPC-02 saved booking.noshow 5 minutes after it ended. */
const BOOKED_AT = "2026-11-01T17:00:00.000Z";
const MISSED_AT = "2026-11-04T19:00:00.000Z";
const NOSHOW_AT = "2026-11-04T19:35:00.000Z";
const afterNoShow = (min) => new Date(Date.parse(NOSHOW_AT) + min * 60_000).toISOString();

/* rebookedSinceMiss, answered from the fake's rows the way its SQL answers it: a booking.created or
   booking.rescheduled for this person in this company, saved after the earlier of the missed call's start
   and the no-show's own saved time. The SQL itself is read against Postgres in followup-chases.pg.test.mjs. */
function withRebookRead(inner) {
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    if (!/AS rebooked/.test(String(sql)) || !/LEAST\(/.test(String(sql))) return inner.query(sql, params);
    const [orgId, clientId, eventId, missedAt] = params;
    const noShow = inner.events.find((e) => e.id === eventId && e.org_id === orgId);
    const lines = [missedAt, noShow?.created_at].filter(Boolean).map((t) => Date.parse(t));
    if (lines.length === 0) return { rows: [] };
    const line = Math.min(...lines);
    const hit = inner.events.some((e) => e.org_id === orgId && e.client_id === clientId
      && ["booking.created", "booking.rescheduled"].includes(e.name) && Date.parse(e.created_at) > line);
    return { rows: hit ? [{ rebooked: 1 }] : [] };
  };
  return wrapped;
}
/* pgFake with the no-show saved the way the event bus saves it before any workflow runs (id "evt-x", ev's id). */
function noShowDb({ events = [], ...rest } = {}) {
  return withRebookRead(pgFake({
    ...rest,
    events: [{ id: "evt-x", org_id: "org-1", client_id: "cl-1", name: "booking.noshow", payload: {}, created_at: NOSHOW_AT }, ...events]
  }));
}
const missedBooking = (over = {}) => ({ org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: BOOKED_AT, ...over });

function fakeDb({ clientId = "cl-1" } = {}) {
  const tags = [];
  const tasks = [];
  const messages = [];
  return {
    tags, tasks, messages,
    query(sql, params) {
      // The no-show test buyer is scoped to org-1; a foreign tenant must
      // never satisfy the new explicit-ID ownership lookup.
      if (/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2 LIMIT 1/.test(sql)) {
        return { rows: params[0] === clientId && params[1] === "org-1" && clientId ? [{ exists: 1 }] : [] };
      }
      if (/FROM clients/i.test(sql) && /email/i.test(sql)) {
        return { rows: clientId ? [{ id: clientId }] : [] };
      }
      if (/INSERT INTO clients/i.test(sql)) return { rows: [{ id: clientId }] };
      if (/UPDATE clients SET tags/i.test(sql) || /custom_fields/i.test(sql)) {
        if (Array.isArray(params?.[1])) tags.push(...params[1]);
        return { rows: [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const row = { id: `task-${tasks.length + 1}` };
        tasks.push(row);
        return { rows: [row] };
      }
      if (/SELECT id FROM tasks/i.test(sql)) return { rows: [] };
      if (/message_templates|INSERT INTO messages/i.test(sql)) {
        messages.push(params);
        return { rows: [{ id: `msg-${messages.length}` }] };
      }
      return { rows: [] };
    }
  };
}

test("s-05a: no client → done false", async () => {
  const db = fakeDb({ clientId: null });
  db.query = async () => ({ rows: [] });
  const res = await handle({
    event: { id: "e1", orgId: "org-1", payload: { email: "missing@x.com" } },
    db,
    step: fakeStep()
  });
  assert.equal(res.done, false);
});

test("s-05a: tags, templates keys, recovery task", async () => {
  const db = fakeDb();
  const res = await handle({
    event: { id: "e2", orgId: "org-1", clientId: "cl-1", payload: { bookingUid: "b1" } },
    db,
    step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(EMAIL_TEMPLATE_KEY, "EMAIL-S05A-NOSHOW-RECOVERY");
  assert.equal(SMS_TEMPLATE_KEY, "SMS-S05A-NOSHOW-RECOVERY");
  assert.ok(res.task);
});

test("s-05a: four touches when they never rebook", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true },
      { org_id: "org-1", template_key: EMAIL_NOSHOW_02, channel: "email", body: "t2e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_NOSHOW_02, channel: "sms", body: "t2s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-03", channel: "email", body: "t3e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-03", channel: "sms", body: "t3s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-04", channel: "email", body: "t4e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-04", channel: "sms", body: "t4s", compliance_passed: true }
    ]
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step: pgStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 8);
  assert.equal(db.tasks.length, 1);
});

test("s-05a: stops before touch 2 if they rebook", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true }
    ]
  });
  const step = {
    run: async (id, fn) => {
      const out = await fn();
      if (id === "send-touch-1") db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: afterNoShow(60 * 20) });
      return out;
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const res = await handle({
    event: ev("booking.noshow", {}, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(db.messages.length, 2);
});

test("s-05a: original booking.created does not count as a rebook", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [
      missedBooking(),
      missedBooking({ name: "booking.rescheduled", created_at: "2026-11-02T17:00:00.000Z" })
    ],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true },
      { org_id: "org-1", template_key: EMAIL_NOSHOW_02, channel: "email", body: "t2e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_NOSHOW_02, channel: "sms", body: "t2s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-03", channel: "email", body: "t3e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-03", channel: "sms", body: "t3s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-04", channel: "email", body: "t4e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-04", channel: "sms", body: "t4s", compliance_passed: true }
    ]
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step: pgStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.stoppedAt, undefined);
  assert.equal(db.messages.length, 8);
});

/* The reviewer's case (2026-10-31). The run used to count bookings when it started and stop only on a higher
   count later. A rebook saved after the no-show but before the run's first step was inside that starting count,
   so every touch went to a person who had already booked again. cancelOn cannot help: it sees only events
   that arrive after the run starts. */
test("s-05a: a rebook saved after the no-show but before the run starts stops recovery", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking(), { org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: afterNoShow(1) }],
    templates: allTemplates()
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1", startTime: MISSED_AT }, { clientId: "cl-1" }),
    db, step: recordingStep(), now: () => Date.parse(afterNoShow(2))
  });
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(db.messages.length, 0, "nothing goes to a person who already booked again");
  assert.equal(db.tasks.length, 1, "the closer's task is still made at once");
});

test("s-05a: a rebook made during the missed call, before the no-show was saved, stops recovery", async () => {
  // DPC-02 saves the no-show 5 minutes after the call ends. A person who books a new call 10 minutes into the
  // one they missed has booked again after the miss.
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking(), { org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: "2026-11-04T19:10:00.000Z" }],
    templates: allTemplates()
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1", startTime: MISSED_AT }, { clientId: "cl-1" }),
    db, step: recordingStep(), now: () => Date.parse(afterNoShow(2))
  });
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(db.messages.length, 0);
});

test("s-05a: bookings saved before the missed call started do not stop recovery, from another company never", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [
      missedBooking(),
      missedBooking({ name: "booking.rescheduled", created_at: "2026-11-04T18:59:59.000Z" }), // moved to noon, a second before
      { org_id: "org-other", client_id: "cl-1", name: "booking.created", created_at: afterNoShow(1) }
    ],
    templates: allTemplates()
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1", startTime: MISSED_AT }, { clientId: "cl-1" }),
    db, step: recordingStep(), now: () => Date.parse(afterNoShow(2))
  });
  assert.equal(res.stoppedAt, undefined);
  assert.equal(db.messages.length, 8);
});

test("s-05a: rescheduling the missed booking stops later recovery touches", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking()],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true }
    ]
  });
  const step = {
    run: async (id, fn) => {
      const result = await fn();
      if (id === "send-touch-1") {
        db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.rescheduled", created_at: afterNoShow(60 * 20) });
      }
      return result;
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const result = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(result.stoppedAt, "before-touch-2");
  assert.equal(db.messages.length, 2, "only initial email/SMS, not the later recovery touches");

  const cancellations = s05aNoShowRecovery.opts.cancelOn || [];
  assert.deepEqual(cancellations.map((rule) => rule.event).sort(), ["booking.created", "booking.rescheduled"]);
  for (const rule of cancellations) {
    assert.match(rule.if, /payload\.email/);
    assert.match(rule.if, /event\.data\.orgId == async\.data\.orgId/, "cancellation must not cross organization");
  }
});

test("s-05a: a reschedule from another company cannot stop recovery", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true },
      { org_id: "org-1", template_key: EMAIL_NOSHOW_02, channel: "email", body: "t2e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_NOSHOW_02, channel: "sms", body: "t2s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-03", channel: "email", body: "t3e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-03", channel: "sms", body: "t3s", compliance_passed: true },
      { org_id: "org-1", template_key: "EMAIL-S05A-NOSHOW-04", channel: "email", body: "t4e", compliance_passed: true },
      { org_id: "org-1", template_key: "SMS-S05A-NOSHOW-04", channel: "sms", body: "t4s", compliance_passed: true }
    ]
  });
  const step = {
    run: async (id, fn) => {
      const result = await fn();
      if (id === "send-touch-1") {
        db.events.push({ org_id: "org-other", client_id: "cl-1", name: "booking.rescheduled", created_at: afterNoShow(60 * 20) });
      }
      return result;
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const result = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(result.stoppedAt, undefined);
  assert.equal(db.messages.length, 8);
});


/* ── The send window (owner-set 2026-10-31): recovery texts and emails go out
 *    from 9 a.m. to 5 p.m. Arizona time only.
 *
 * The sender holds a drip that comes due outside that window until 9 a.m., and
 * when it wakes it checks the opt-out and nothing else. So a message written to
 * the queue at 6 p.m. would still go at 9 a.m. to a person who booked again at
 * 8 a.m. The workflow therefore does the waiting itself: it works out each
 * touch's real send time once, sleeps until then, checks for a rebook, and only
 * then writes the message. */
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const NOON = Date.parse("2026-11-04T19:00:00Z");   // Wed 12:00 p.m. Arizona
const SIX_PM = Date.parse("2026-11-05T01:00:00Z"); // Wed  6:00 p.m. Arizona
const NINE_AM_THU = Date.parse("2026-11-05T16:00:00Z"); // Thu 9:00 a.m. Arizona

const allTemplates = (bodies = {}) => [
  [EMAIL_TEMPLATE_KEY, "email", bodies.t1e || "t1e"], [SMS_TEMPLATE_KEY, "sms", "t1s"],
  [EMAIL_NOSHOW_02, "email", "t2e"], [SMS_NOSHOW_02, "sms", "t2s"],
  ["EMAIL-S05A-NOSHOW-03", "email", "t3e"], ["SMS-S05A-NOSHOW-03", "sms", "t3s"],
  ["EMAIL-S05A-NOSHOW-04", "email", "t4e"], ["SMS-S05A-NOSHOW-04", "sms", "t4s"]
].map(([template_key, channel, body]) => ({ org_id: "org-1", template_key, channel, body, compliance_passed: true }));

function recordingStep({ onSleepUntil = null } = {}) {
  const log = [];
  return {
    log,
    run: async (id, fn) => { const out = await fn(); log.push(`run:${id}`); return out; },
    sleep: async (id) => { log.push(`sleep:${id}`); },
    sleepUntil: async (id, when) => {
      log.push(`until:${id}:${new Date(when).toISOString()}`);
      if (onSleepUntil) await onSleepUntil(id, new Date(when));
    }
  };
}

test("s-05a: a no-show inside the window is touched now, then 24, 72 and 168 hours later", () => {
  assert.deepEqual(S05A.touchPlan(NOON).map((d) => d.toISOString()),
    [NOON, NOON + 24 * HOUR, NOON + 72 * HOUR, NOON + 168 * HOUR].map(iso));
});

test("s-05a: a no-show at 6 p.m. waits for 9 a.m., and the later touches count from the day it really goes", () => {
  assert.deepEqual(S05A.touchPlan(SIX_PM).map((d) => d.toISOString()), [
    iso(NINE_AM_THU),                    // Thu 9 a.m.
    iso(NINE_AM_THU + 24 * HOUR),        // Fri 9 a.m.
    iso(NINE_AM_THU + 72 * HOUR),        // Sun 9 a.m.
    iso(NINE_AM_THU + 168 * HOUR)        // Thu 9 a.m.
  ]);
  // Before 9 a.m. the same morning, not the next one.
  const SIX_AM = Date.parse("2026-11-05T13:00:00Z");
  assert.equal(S05A.touchPlan(SIX_AM)[0].toISOString(), iso(NINE_AM_THU));
});

test("s-05a: no-show at 6 p.m. Arizona, booked again at 8 a.m. the next day: touch 1 is never sent, and the closer task was made at once", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking()], // the call that was missed
    templates: allTemplates()
  });
  const step = recordingStep({
    onSleepUntil: async (id) => {
      // 8 a.m. Thursday: they book again while the first touch is waiting for 9.
      if (id === "wait-touch-1") db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: "2026-11-05T15:00:00.000Z" });
    }
  });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1", email: "a@b.com" }, { clientId: "cl-1" }),
    db, step, now: () => SIX_PM
  });
  assert.equal(res.done, true);
  assert.equal(res.stoppedAt, "before-touch-1");
  assert.equal(res.touch1, undefined);
  assert.equal(db.messages.length, 0, "nothing was written to the queue for the person who rebooked");
  assert.equal(db.tasks.length, 1, "the closer task does not wait for the window");
  assert.ok(step.log.includes(`until:wait-touch-1:${iso(NINE_AM_THU)}`), "touch 1 waited for 9 a.m. Arizona");
  assert.ok(step.log.indexOf("run:create-recovery-task") < step.log.findIndex((l) => l.startsWith("until:wait-touch-1")),
    "the task was made before the wait");
  assert.ok(!step.log.includes("run:send-touch-1"));
});

test("s-05a: no-show at 6 p.m., nobody rebooks: nothing is queued until 9 a.m., then the four touches go on the planned days", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking()],
    templates: allTemplates()
  });
  const queuedAtWake = {};
  const step = recordingStep({ onSleepUntil: async (id) => { queuedAtWake[id] = db.messages.length; } });
  const res = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step, now: () => SIX_PM
  });
  assert.equal(res.stoppedAt, undefined);
  assert.equal(db.messages.length, 8);
  assert.deepEqual(queuedAtWake, { "wait-touch-1": 0, "wait-touch-2": 2, "wait-touch-3": 4, "wait-touch-4": 6 },
    "each pair is written only after its own wait");
  assert.deepEqual(step.log.filter((l) => l.startsWith("until:")), [
    `until:wait-touch-1:${iso(NINE_AM_THU)}`,
    `until:wait-touch-2:${iso(NINE_AM_THU + 24 * HOUR)}`,
    `until:wait-touch-3:${iso(NINE_AM_THU + 72 * HOUR)}`,
    `until:wait-touch-4:${iso(NINE_AM_THU + 168 * HOUR)}`
  ]);
  // Each wake checks for a rebook before it sends.
  for (const n of [1, 2, 3, 4]) {
    assert.ok(step.log.indexOf(`run:check-booked-${n}`) > step.log.findIndex((l) => l.startsWith(`until:wait-touch-${n}:`)));
    assert.ok(step.log.indexOf(`run:send-touch-${n}`) > step.log.indexOf(`run:check-booked-${n}`));
  }
});

test("s-05a: the first email names the call that was missed (Arizona time), not a blank", async () => {
  const db = noShowDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [missedBooking()],
    templates: allTemplates({ t1e: "We had you down for {{appointment.start_time}} and didn't connect." })
  });
  await handle({
    event: ev("booking.noshow", { bookingUid: "b1", startTime: "2026-11-04T19:00:00Z" }, { clientId: "cl-1" }),
    db, step: recordingStep(), now: () => NOON
  });
  const email = db.messages.find((m) => m.template_key === EMAIL_TEMPLATE_KEY);
  assert.equal(email.rendered_body, "We had you down for Wed, Nov 4, 2026, 12:00 PM MST and didn't connect.");
});
