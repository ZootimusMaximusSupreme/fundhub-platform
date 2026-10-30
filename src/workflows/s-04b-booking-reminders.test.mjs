import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H } from "./s-04b-booking-reminders.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const portalStub = async () => ({
  ok: true, outcome: "issued", token: "booking-portal-tok", sent: false
});

/* A booking is in the future or it is not a booking. These fixtures used to be
   a hard-coded August date that quietly slid into the past, which made "the
   reminders fired" prove nothing about a real appointment. */
const inHours = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

/* A step shim with a clock attached. The real Inngest sleeps until the moment
   it is given and the code then reads the wall clock to check it really is that
   moment; fakeStep returns instantly, so without this the check would always
   see "far too early" and refuse every reminder. The clock moves to whatever
   sleepUntil was asked for, which is exactly what a durable sleep does. */
function clockStep() {
  let t = Date.now();
  return {
    now: () => t,
    step: {
      run: (_id, fn) => fn(),
      sleep: async () => {},
      sleepUntil: async (_id, when) => { t = Math.max(t, new Date(when).getTime()); }
    }
  };
}

const sms = () => [
  { org_id: "org-1", template_key: SMS_CONFIRM, channel: "sms", body: "confirm {{appointment.start_time}} {{portal_claim.url}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_24H, channel: "sms", body: "24h {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_2H, channel: "sms", body: "2h {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_CONFIRM, channel: "email", subject: "You're booked", body: "confirmed for {{appointment.start_time}}. Download Fundhub Portal: {{app_download.url}}. Confirm my call: {{call_confirm.url}}. Web portal: {{web_portal.url}}", compliance_passed: true }
];

test("s-04b: confirm + both reminders when startTime present", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(72) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
  });
  assert.equal(db.messages.length, 4);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H]);
  assert.equal(res.stoppedBecause, undefined);
});

test("s-04b: only confirm when no startTime", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
  assert.equal(res.skippedReminders, "no_start_time");
});

test("s-04b: confirm SMS prints a human time, not raw ISO-Z", async () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: iso }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  const confirm = db.messages.find((m) => m.template_key === SMS_CONFIRM);
  assert.ok(confirm);
  assert.doesNotMatch(confirm.rendered_body, /2026-08-23T02:49:58/);
  assert.match(confirm.rendered_body, /Aug/);
});

test("s-04b: stops before 24h reminder if call already held", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms(),
    events: [{ client_id: "cl-1", name: "call.completed" }]
  });
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(72) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
  });
  assert.equal(res.stoppedBecause, "call_held");
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
});

test("s-04b: booked stage sends exactly one text and one email, immediately", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  const immediate = db.messages.slice(0, 2);
  assert.equal(immediate.filter((m) => m.channel === "sms").length, 1);
  assert.equal(immediate.filter((m) => m.channel === "email").length, 1);
});

test("s-04b: booking creates a pending account and sends lasting claim links", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const result = await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z", email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(result.portalAccount.created, true);
  assert.equal(db.accounts.length, 1);
  assert.equal(db.accounts[0].status, "invited");
  assert.ok(!db.messages.some((m) => m.template_key === "EMAIL-PORTAL-MAGIC-LINK"));
  const text = db.messages.find((m) => m.template_key === SMS_CONFIRM);
  assert.match(text.rendered_body, /portal-login\.html\?mode=claim/);
  const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
  assert.ok(email);
  assert.match(email.rendered_body, /portal-login\.html#download/);
  assert.match(email.rendered_body, /portal-login\.html\?mode=claim/);
  assert.doesNotMatch(email.rendered_body, /\?t=/);
  assert.match(email.rendered_body, /Confirm my call/);
  assert.match(email.rendered_body, /Web portal: https:\/\/fundhub\.ai\/portal-login\.html/);
});

test("s-04b: account conflict still leaves a lasting sign-in door", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z", email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    ensurePendingClientAccountImpl: async () => ({ ok: false, reason: "email_belongs_to_another_account" })
  });
  const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
  assert.ok(email);
  assert.doesNotMatch(email.rendered_body, /href=""/);
  assert.match(email.rendered_body, /portal-login\.html#download/);
  assert.match(email.rendered_body, /portal-login\.html\?mode=claim/);
  assert.doesNotMatch(email.rendered_body, /\{\{call_confirm|\{\{app_download|\{\{web_portal/);
});

test("s-04b: a pending-account failure does not create a dead email link", async () => {
  for (const stub of [
    async () => ({ ok: false, reason: "no_email" }),
    async () => ({ ok: false, reason: "email_belongs_to_another_account" })
  ]) {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      templates: sms()
    });
    await handle({
      event: ev("booking.created", {}, { clientId: "cl-1" }),
      db, step: fakeStep(), ensurePendingClientAccountImpl: stub
    });
    const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
    assert.ok(email);
    assert.match(email.rendered_body, /portal-login\.html/);
    assert.doesNotMatch(email.rendered_body, /href=""/);
  }
});

test("s-04b listens to booking.created and booking.rescheduled", async () => {
  const { s04bBookingReminders } = await import("./s-04b-booking-reminders.mjs");
  const names = (s04bBookingReminders.opts.triggers || []).map((t) => t.event).sort();
  assert.deepEqual(names, ["booking.created", "booking.rescheduled"]);
});

function assertCancelsThisBooking(fn) {
  const rows = (fn.opts.cancelOn || []).filter((c) => c.event === "booking.cancelled");
  assert.ok(rows.length >= 1, `${fn.opts.id} must stop on booking.cancelled`);
  assert.ok(
    rows.some((c) => /payload\.bookingUid/.test(c.if) && /async\.data\.payload\.bookingUid/.test(c.if)),
    `${fn.opts.id} must match this booking's id, not every client`
  );
}

test("cancel-cancels-runs: booking.cancelled stops this booking's in-flight jobs only", async () => {
  const { s04bBookingReminders } = await import("./s-04b-booking-reminders.mjs");
  const { bs01PrecallLauncher } = await import("./bs-01-precall-launcher.mjs");
  const { aiSet043WayHandoff } = await import("./ai-set-04-3way-handoff.mjs");
  const { dpc05NoProgressEscalation } = await import("./dpc-05-no-progress-escalation.mjs");
  const { aiSet01JoshSetter } = await import("./ai-set-01-josh-setter.mjs");
  for (const fn of [
    s04bBookingReminders,
    bs01PrecallLauncher,
    aiSet043WayHandoff,
    dpc05NoProgressEscalation,
    aiSet01JoshSetter
  ]) {
    assertCancelsThisBooking(fn);
  }
});


/* ── F47: a reminder means what it says ───────────────────────────────────────
 *
 * Measured 2026-09-03: four customers received "your call is tomorrow at ..."
 * between nought and five minutes after they booked. One of them had booked a
 * call three days out. The "two hours before" text went out sixty-eight minutes
 * before the call. These tests are the shapes the walk-through named.
 */
test("F47: a call three days out gets its reminders at T-24h and T-2h, not at booking", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const start = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const slept = [];
  let t = Date.now();
  const step = {
    run: (_id, fn) => fn(),
    sleep: async () => {},
    sleepUntil: async (id, when) => {
      slept.push([id, new Date(when).getTime()]);
      t = Math.max(t, new Date(when).getTime());
    }
  };
  const res = await handle({
    event: ev("booking.created", { startTime: start.toISOString() }, { clientId: "cl-1" }),
    db, step, now: () => t, requestMagicLinkImpl: portalStub
  });

  // Nothing but the confirmation may exist at booking time.
  assert.deepEqual(db.messages.slice(0, 2).map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);

  // And the two reminders waited for the right moments — to the minute.
  assert.equal(slept.length, 2);
  assert.equal(slept[0][1], start.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(slept[1][1], start.getTime() - 2 * 60 * 60 * 1000);
  assert.ok(res.remind24 && res.remind2);
  assert.equal(db.messages.length, 4);
});

test("F47: a call six hours out gets NO 'tomorrow' text at all", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(6) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
  });
  assert.equal(res.skipped24h, "booked_inside_24h");
  assert.equal(res.remind24, undefined);
  assert.ok(!db.messages.some((m) => m.template_key === SMS_REMIND_24H));
  // The two-hour reminder is still real for this booking, and still waits.
  assert.ok(db.messages.some((m) => m.template_key === SMS_REMIND_2H));
  assert.equal(db.messages.length, 3);
});

test("F47: a call ninety minutes out gets neither reminder", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(1.5) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
  });
  assert.equal(res.skipped24h, "booked_inside_24h");
  assert.equal(res.skipped2h, "booked_inside_2h");
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
});

test("F47: a start time nothing can read sends the confirmation and no reminders", async () => {
  for (const bad of ["not a date", "", "  "]) {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      templates: sms()
    });
    const clock = clockStep();
    const res = await handle({
      event: ev("booking.created", { startTime: bad }, { clientId: "cl-1" }),
      db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
    });
    // "" is no start time at all; the others are values that cannot be placed
    // on a clock. Either way: no reminder about a moment we cannot find.
    assert.ok(
      ["no_start_time", "unreadable_start_time"].includes(res.skippedReminders),
      String(res.skippedReminders)
    );
    assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
  }
});

test("F47: a booking for a time that has already gone sends no reminders", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(-4) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub
  });
  assert.equal(res.skippedReminders, "appointment_already_started");
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
});

test("F47: waking early — a retry or a replay — does not fire the reminder anyway", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  // A sleep that resolves without the clock having moved: exactly the shape of
  // an Invalid Date sleepUntil, and of a step replayed out of order.
  const frozen = Date.now();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(72) }, { clientId: "cl-1" }),
    db,
    step: { run: (_id, fn) => fn(), sleep: async () => {}, sleepUntil: async () => {} },
    now: () => frozen,
    requestMagicLinkImpl: portalStub
  });
  assert.equal(res.skipped24h, "woke_before_the_reminder_was_due");
  assert.equal(res.skipped2h, "woke_before_the_reminder_was_due");
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
});

/* ── F1: the confirmation does not wait for the five-minute sweep ─────────── */
test("F1: the booking text and email are handed to the dispatcher at once, and nothing else is", async () => {
  const inner = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  /* pgFake's messages insert returns no id; give it one, because the id is what
     "send this exact row now" is addressed to. */
  let seq = 0;
  const db = {
    ...inner,
    async query(sql, params) {
      const before = inner.messages.length;
      const r = await inner.query(sql, params);
      if (/INSERT INTO messages/.test(sql) && inner.messages.length > before) {
        const id = "msg-" + ++seq;
        inner.messages[inner.messages.length - 1].id = id;
        return { rows: [{ id, created_at: new Date().toISOString() }] };
      }
      return r;
    }
  };
  const drained = [];
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(72) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub,
    drainNowImpl: async (_db, messageId, opts) => {
      drained.push({ messageId, orgId: opts.orgId });
      return { ran: true, dispatched: 1, sent: 1, results: [] };
    }
  });
  // Exactly the two confirmation rows, and only those two.
  assert.equal(drained.length, 2);
  assert.deepEqual(drained.map((d) => d.messageId), ["msg-1", "msg-2"]);
  assert.ok(drained.every((d) => d.orgId === "org-1"));
  assert.equal(res.confirmDispatch.length, 2);
  // The reminders are NOT rushed — they belong to the sweep like everything else.
  assert.ok(!drained.some((d) => d.messageId === "msg-3"));
});

test("F1: no message id means no immediate dispatch, and the run still finishes", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  let calls = 0;
  const clock = clockStep();
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(72) }, { clientId: "cl-1" }),
    db, step: clock.step, now: clock.now, requestMagicLinkImpl: portalStub,
    drainNowImpl: async () => { calls += 1; return { ran: true }; }
  });
  assert.equal(calls, 0);
  assert.equal(res.done, true);
  assert.deepEqual(res.confirmDispatch, []);
});

/* ── The replay tests ─────────────────────────────────────────────────────────
 *
 * clockStep() above runs the workflow ONCE, straight through, with a virtual
 * clock. Inngest does not do that. It runs the function from the top, performs
 * the first step it has not done yet, records that step's answer, and then
 * starts the whole function again from the top — replaying the recorded answers
 * and re-running everything outside a step against the clock as it is on that
 * later pass. A three-day-out booking is therefore driven a dozen times over
 * three days, not once.
 *
 * Round 2 found a defect that only exists in that world: the reminder plan was
 * computed outside a step, so on the wake at "24 hours before" it was worked out
 * again against that instant, decided the moment had gone, and sent nothing.
 * Both reminders were switched off in production while every test here passed.
 *
 * replayDriver() is the harness that can see it. It records each step by id
 * through JSON (a Date really does come back as a string, which is the other
 * half of the same bug), suspends and re-invokes after every step exactly as
 * Inngest does, and moves the clock forward on each durable sleep.
 */
function replayDriver({ startAt = Date.now(), maxInvocations = 200 } = {}) {
  const SUSPEND = Symbol("inngest-suspend");
  const memo = new Map();
  let t = startAt;
  let invocations = 0;

  const step = {
    run: async (id, fn) => {
      if (memo.has(id)) return memo.get(id);
      const value = await fn();
      // Inngest carries a step's answer as JSON. undefined has no JSON form.
      const stored = value === undefined ? null : JSON.parse(JSON.stringify(value));
      memo.set(id, stored);
      throw SUSPEND;              // one step per invocation, then start again
    },
    sleep: async (id) => {
      if (memo.has(id)) return;
      memo.set(id, null);
      throw SUSPEND;
    },
    sleepUntil: async (id, when) => {
      if (memo.has(id)) return;
      memo.set(id, null);
      const target = new Date(when).getTime();
      if (Number.isFinite(target)) t = Math.max(t, target);
      throw SUSPEND;              // the durable wake is a new invocation
    }
  };

  return {
    step,
    now: () => t,
    clockAt: () => t,
    invocations: () => invocations,
    async drive(run) {
      for (let i = 0; i < maxInvocations; i += 1) {
        invocations += 1;
        try {
          return await run();
        } catch (err) {
          if (err !== SUSPEND) throw err;
        }
      }
      throw new Error("replayDriver: the workflow never finished");
    }
  };
}

test("REPLAY: a call three days out still gets both reminders, once each, at the right moments", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const bookedAt = Date.now();
  const startAtMs = bookedAt + 72 * 60 * 60 * 1000;
  const driver = replayDriver({ startAt: bookedAt });
  const sentAt = [];
  const dbWatched = {
    ...db,
    async query(sql, params) {
      const before = db.messages.length;
      const r = await db.query(sql, params);
      if (db.messages.length > before) {
        sentAt.push({ key: db.messages[db.messages.length - 1].template_key, at: driver.now() });
      }
      return r;
    }
  };

  const res = await driver.drive(() => handle({
    event: ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" }),
    db: dbWatched, step: driver.step, now: driver.now, requestMagicLinkImpl: portalStub
  }));

  // Inngest really did drive it many times, which is the whole point.
  assert.ok(driver.invocations() > 1, `only ${driver.invocations()} invocation(s)`);

  // Exactly one of each message, in order, and no duplicates.
  assert.deepEqual(
    db.messages.map((m) => m.template_key),
    [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H]
  );
  assert.equal(res.skipped24h, undefined);
  assert.equal(res.skipped2h, undefined);

  // And each reminder went out at its own moment, not at booking time.
  const at = (key) => sentAt.find((s) => s.key === key).at;
  assert.equal(at(SMS_REMIND_24H), startAtMs - 24 * 60 * 60 * 1000);
  assert.equal(at(SMS_REMIND_2H), startAtMs - 2 * 60 * 60 * 1000);
  assert.equal(at(SMS_CONFIRM), bookedAt);
});

test("REPLAY: a call six hours out gets the 2-hour text and no tomorrow text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const bookedAt = Date.now();
  const startAtMs = bookedAt + 6 * 60 * 60 * 1000;
  const driver = replayDriver({ startAt: bookedAt });

  const res = await driver.drive(() => handle({
    event: ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" }),
    db, step: driver.step, now: driver.now, requestMagicLinkImpl: portalStub
  }));

  assert.equal(res.skipped24h, "booked_inside_24h");
  assert.equal(res.skipped2h, undefined);
  assert.deepEqual(
    db.messages.map((m) => m.template_key),
    [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_2H]
  );
  assert.equal(driver.clockAt(), startAtMs - 2 * 60 * 60 * 1000);
});

test("REPLAY: driving the finished run again after the call sends nothing twice", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const bookedAt = Date.now();
  const startAtMs = bookedAt + 72 * 60 * 60 * 1000;
  const driver = replayDriver({ startAt: bookedAt });
  const res = await driver.drive(() => handle({
    event: ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" }),
    db, step: driver.step, now: driver.now, requestMagicLinkImpl: portalStub
  }));
  const afterRun = db.messages.map((m) => m.template_key);

  // Inngest drives the same run once more, hours after the call — a retry, or
  // the platform re-checking a run it already has answers for. Every step is
  // already recorded, so nothing may be sent twice and the answer must not move.
  const again = await handle({
    event: ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" }),
    db,
    step: driver.step,
    now: () => startAtMs + 3 * 60 * 60 * 1000,
    requestMagicLinkImpl: portalStub
  });

  assert.deepEqual(db.messages.map((m) => m.template_key), afterRun);
  assert.equal(again.skipped24h, res.skipped24h);
  assert.equal(again.skipped2h, res.skipped2h);
});


test("S-04B: reschedule/cancel cannot cross tenant boundaries on reused email or provider UID", async () => {
  const { s04bBookingReminders } = await import("./s-04b-booking-reminders.mjs");
  for (const type of ["booking.rescheduled", "booking.cancelled"]) {
    const clauses = (s04bBookingReminders.opts.cancelOn || [])
      .filter((c) => c.event === type);
    assert.equal(clauses.length, 2, `${type} must cover exact buyer email and booking UID`);
    for (const condition of clauses) {
      assert.match(condition.if, /event\.data\.orgId != null/,
        `${type} must reject missing organization`);
      assert.match(condition.if, /event\.data\.orgId == async\.data\.orgId/,
        `${type} must never cancel another organization's run`);
      assert.match(condition.if, /event\.data\.payload\.(email|bookingUid)/);
    }
  }
});
