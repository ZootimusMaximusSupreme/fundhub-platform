import { test } from "node:test";
import assert from "node:assert";
import { handle, s05aNoShowRecovery, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, EMAIL_NOSHOW_02, SMS_NOSHOW_02 } from "./s-05a-no-show-recovery.mjs";
import { pgFake, fakeStep as pgStep, ev } from "./test-support.mjs";

function fakeStep() {
  return { run: (_id, fn) => fn(), sleep: async () => {}, sleepUntil: async () => {} };
}

function fakeDb({ clientId = "cl-1" } = {}) {
  const tags = [];
  const tasks = [];
  const messages = [];
  return {
    tags, tasks, messages,
    query(sql, params) {
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
  const db = pgFake({
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
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true }
    ]
  });
  const step = {
    run: async (id, fn) => {
      const out = await fn();
      if (id === "send-touch-1") db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.created" });
      return out;
    },
    sleep: async () => {}
  };
  const res = await handle({
    event: ev("booking.noshow", {}, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(res.stoppedAt, "before-touch-2");
  assert.equal(db.messages.length, 2);
});

test("s-05a: original booking.created does not count as a rebook", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [
      { org_id: "org-1", client_id: "cl-1", name: "booking.created" },
      { org_id: "org-1", client_id: "cl-1", name: "booking.rescheduled" }
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



test("s-05a: rescheduling the missed booking stops later recovery touches", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [{ org_id: "org-1", client_id: "cl-1", name: "booking.created" }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "t1e", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "t1s", compliance_passed: true }
    ]
  });
  const step = {
    run: async (id, fn) => {
      const result = await fn();
      if (id === "send-touch-1") {
        db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.rescheduled" });
      }
      return result;
    },
    sleep: async () => {}
  };
  const result = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(result.stoppedAt, "before-touch-2");
  assert.equal(db.messages.length, 2, "only initial email/SMS, not the later recovery touches");

  const cancellations = s05aNoShowRecovery.opts.cancelOn || [];
  assert.deepEqual(cancellations.map((rule) => rule.event).sort(), ["booking.created", "booking.rescheduled"]);
  for (const rule of cancellations) assert.match(rule.if, /payload\.email/);
});

test("s-05a: a reschedule from another company cannot stop recovery", async () => {
  const db = pgFake({
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
        db.events.push({ org_id: "org-other", client_id: "cl-1", name: "booking.rescheduled" });
      }
      return result;
    },
    sleep: async () => {}
  };
  const result = await handle({
    event: ev("booking.noshow", { bookingUid: "b1" }, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(result.stoppedAt, undefined);
  assert.equal(db.messages.length, 8);
});
