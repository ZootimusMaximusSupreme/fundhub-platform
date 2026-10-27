import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eligibleForGenuineM1,
  handleM1,
  handleReply,
  handleCheckoutM1Sms,
  SMS_M1_KEY,
  EMAIL_M1_KEY,
  SMS_FIRST5_KEY,
  EMAIL_FIRST5_KEY,
  SMS_GIFT_KEY,
  EMAIL_GIFT_KEY,
  SMS_COUPON_KEY,
  EMAIL_COUPON_KEY,
  SMS_FIRST5_REPLY_KEY,
  EMAIL_FIRST5_REPLY_KEY,
  LOCK_M1,
  LOCK_M2
} from "./slo-genuine-followup.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

function templates() {
  return [
    { org_id: "org-1", template_key: SMS_M1_KEY, channel: "sms", body: "genuine sms", compliance_passed: true },
    { org_id: "org-1", template_key: EMAIL_M1_KEY, channel: "email", subject: "Concerns?", body: "genuine email", compliance_passed: true },
    { org_id: "org-1", template_key: SMS_FIRST5_KEY, channel: "sms", body: "first5 sms", compliance_passed: true },
    { org_id: "org-1", template_key: EMAIL_FIRST5_KEY, channel: "email", subject: "Free", body: "first5 email", compliance_passed: true },
    { org_id: "org-1", template_key: SMS_GIFT_KEY, channel: "sms", body: "gift sms", compliance_passed: true },
    { org_id: "org-1", template_key: EMAIL_GIFT_KEY, channel: "email", subject: "Gift", body: "gift email", compliance_passed: true },
    { org_id: "org-1", template_key: SMS_COUPON_KEY, channel: "sms", body: "coupon {{pay_url}}", compliance_passed: true },
    { org_id: "org-1", template_key: EMAIL_COUPON_KEY, channel: "email", subject: "33% off", body: "coupon email {{pay_url}}", compliance_passed: true },
    { org_id: "org-1", template_key: SMS_FIRST5_REPLY_KEY, channel: "sms", body: "you're in {{book_url}}", compliance_passed: true },
    { org_id: "org-1", template_key: EMAIL_FIRST5_REPLY_KEY, channel: "email", subject: "You're in", body: "you're in email {{book_url}}", compliance_passed: true }
  ];
}

/** pgFake plus the paid-diagnostic and resolveClient reads this workflow uses. */
function genuineDb(seed = {}) {
  const base = pgFake(seed);
  const paid = seed.paidDiagnostic || false;
  const bookings = seed.bookings || [];
  return {
    ...base,
    bookings,
    async query(sql, params = []) {
      if (/FROM payment_links pl/.test(sql) && /JOIN clients c/.test(sql)) {
        return { rows: paid ? [{ "?column?": 1 }] : [] };
      }
      // Cap = people who agreed (slo_roadmap_free_at) AND booked — not texts sent.
      if (/custom_fields->>\$2 IS NOT NULL/.test(sql) && /FROM bookings b/.test(sql) && /booking\.created/.test(sql)) {
        const orgId = params[0];
        const freeKey = params[1] || "slo_roadmap_free_at";
        const n = base.clients.filter((c) => {
          if (c.org_id !== orgId) return false;
          if (!(c.custom_fields && c.custom_fields[freeKey])) return false;
          const bookedRow = bookings.some((b) => b.client_id === c.id);
          const bookedEvent = (base.events || []).some(
            (e) => e.client_id === c.id && e.name === "booking.created"
          );
          return bookedRow || bookedEvent;
        }).length;
        return { rows: [{ n }] };
      }
      if (/custom_fields->>\$2 AS m1/.test(sql)) {
        const c = base.clients.find((row) => row.id === params[0]);
        if (!c) return { rows: [] };
        const cf = c.custom_fields || {};
        return { rows: [{ m1: cf[params[1]] || null, m2: cf[params[2]] || null }] };
      }
      if (/SELECT id FROM clients WHERE org_id=\$1 AND phone=\$2/.test(sql)) {
        const c = base.clients.find(
          (row) => row.org_id === params[0] && row.phone === params[1]
        );
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id, ghl_contact_id FROM clients WHERE org_id/.test(sql)) {
        const c = base.clients.find(
          (row) => row.org_id === params[0]
            && String(row.email || "").toLowerCase() === String(params[1] || "").toLowerCase()
        );
        return { rows: c ? [{ id: c.id, ghl_contact_id: c.ghl_contact_id || null }] : [] };
      }
      if (/SELECT id, ghl_contact_id, email, phone, first_name, last_name/.test(sql)) {
        const c = base.clients.find((row) => row.id === params[0] && row.org_id === params[1]);
        return {
          rows: c
            ? [{
              id: c.id,
              ghl_contact_id: c.ghl_contact_id || "ghl-test",
              email: c.email || null,
              phone: c.phone || null,
              first_name: c.first_name || null,
              last_name: c.last_name || null
            }]
            : []
        };
      }
      if (/UPDATE clients SET\s+phone = COALESCE/.test(sql)) {
        const c = base.clients.find((row) => row.id === params[0]);
        if (c) {
          if (!c.phone && params[1]) c.phone = params[1];
          if (!c.first_name && params[2]) c.first_name = params[2];
          if (!c.last_name && params[3]) c.last_name = params[3];
        }
        return { rows: [] };
      }
      if (/SELECT phone FROM clients WHERE id = \$1/.test(sql)) {
        const c = base.clients.find((row) => row.id === params[0]);
        return { rows: c ? [{ phone: c.phone || null }] : [] };
      }
      if (/FROM messages/.test(sql) && /template_key = ANY/.test(sql)) {
        const keys = params[1] || [];
        const hit = base.messages.some(
          (m) => m.client_id === params[0] && m.channel === "sms" && keys.includes(m.template_key)
        );
        return { rows: hit ? [{ "?column?": 1 }] : [] };
      }
      return base.query(sql, params);
    }
  };
}

const personPayload = {
  actor: "person",
  email: "pat@gmail.com",
  phone: "+14155550134",
  name: "Pat Lee"
};

test("eligibleForGenuineM1: person with phone and email passes", () => {
  assert.equal(eligibleForGenuineM1(personPayload).ok, true);
});

test("eligibleForGenuineM1: agent is skipped (no real customer text)", () => {
  assert.equal(eligibleForGenuineM1({ ...personPayload, actor: "agent" }).ok, false);
  assert.equal(eligibleForGenuineM1({ ...personPayload, email: "sam@fundhub.ai" }).ok, false);
  assert.equal(eligibleForGenuineM1({ ...personPayload, email: "e2e+sim@gmail.com" }).ok, false);
  assert.equal(eligibleForGenuineM1({ ...personPayload, email: "x@example.com" }).ok, false);
});

test("eligibleForGenuineM1: no phone still passes (email goes; SMS waits)", () => {
  const gate = eligibleForGenuineM1({ ...personPayload, phone: null });
  assert.equal(gate.ok, true);
  assert.equal(gate.phone, null);
  assert.equal(gate.email, "pat@gmail.com");
});

test("handleM1: after the wait, queues dig SMS and email for an unpaid person", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: {}
    }],
    templates: templates()
  });
  const sleeps = [];
  const step = {
    run: (_id, fn) => fn(),
    sleep: async (id) => { sleeps.push(id); }
  };
  const res = await handleM1({
    event: ev("slo.contact_started", personPayload, { id: "evt-m1" }),
    db,
    step
  });
  assert.equal(res.sent, true);
  assert.deepEqual(sleeps, ["wait-15-min"]);
  assert.deepEqual(
    db.messages.map((m) => m.template_key).sort(),
    [EMAIL_M1_KEY, SMS_M1_KEY].sort()
  );
  assert.ok(db.clients[0].custom_fields[LOCK_M1]);
  assert.equal(db.clients[0].custom_fields[LOCK_M2], undefined);
  assert.ok(!db.messages.some((m) =>
    m.template_key === SMS_COUPON_KEY || m.template_key === EMAIL_COUPON_KEY
    || m.template_key === SMS_FIRST5_KEY || m.template_key === EMAIL_FIRST5_KEY
    || m.template_key === SMS_GIFT_KEY || m.template_key === EMAIL_GIFT_KEY));
});

test("handleM1: agent emit is a no-op (prove path without texting a customer)", async () => {
  const db = genuineDb({ clients: [], templates: templates() });
  const res = await handleM1({
    event: ev("slo.contact_started", { ...personPayload, actor: "agent" }, { id: "evt-agent" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, undefined);
  assert.equal(res.reason, "not_person");
  assert.equal(db.messages.length, 0);
});

test("handleM1: paid diagnostic skips the send", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: {}
    }],
    paidDiagnostic: true,
    templates: templates()
  });
  const res = await handleM1({
    event: ev("slo.contact_started", personPayload, { id: "evt-paid" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "already_paid");
  assert.equal(db.messages.length, 0);
});

test("handleM1: email-only opt-in still queues the dig email", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: null,
      custom_fields: {}
    }],
    templates: templates()
  });
  const res = await handleM1({
    event: ev("slo.contact_started", { ...personPayload, phone: null }, { id: "evt-email-only" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, true);
  assert.equal(res.sms, null);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_M1_KEY]);
});

test("handleCheckoutM1Sms: full M1 when phone lands at checkout and nothing was sent", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: {}
    }],
    templates: templates()
  });
  const res = await handleCheckoutM1Sms({
    event: ev("slo.checkout_started", {
      email: "pat@gmail.com",
      client_id: "cl-1"
    }, { id: "evt-checkout-full", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, true);
  assert.equal(res.lane, "full_m1");
  assert.deepEqual(
    db.messages.map((m) => m.template_key).sort(),
    [EMAIL_M1_KEY, SMS_M1_KEY].sort()
  );
  assert.ok(db.clients[0].custom_fields[LOCK_M1]);
});

test("handleCheckoutM1Sms: sends unpaid dig SMS once phone lands after M1 email", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-29T18:00:00.000Z" }
    }],
    templates: templates()
  });
  const res = await handleCheckoutM1Sms({
    event: ev("slo.checkout_started", {
      email: "pat@gmail.com",
      client_id: "cl-1",
      actor: "person"
    }, { id: "evt-checkout-sms", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, true);
  assert.equal(res.lane, "sms_only");
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_M1_KEY]);
});

test("handleReply: does not send message 2 until message 1 was sent", async () => {
  const db = genuineDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "pat@gmail.com", phone: "+14155550134", custom_fields: {} }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", { from: "+14155550134", body: "price felt high", channel: "sms" }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.reason, "not_awaiting_m2");
  assert.equal(db.messages.length, 0);
});

test("handleReply: booked call replies never enter an old SLO reply lane", async () => {
  for (const fields of [
    { call_outcome: "booked", slo_text_slot: "1" },
    { call_confirmed: true, slo_text_slot: "1" }
  ]) {
    const db = genuineDb({
      clients: [{ id: "cl-1", org_id: "org-1", phone: "+14155550134", custom_fields: fields }],
      templates: templates()
    });
    const res = await handleReply({
      event: ev("message.inbound", { from: "+14155550134", body: "CONFIRM", channel: "sms" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.reason, "booked_call_reply");
    assert.equal(db.messages.length, 0);
    assert.equal(db.clients[0].custom_fields.slo_genuine_replied_at, undefined);
  }
});

test("handleReply: after a real answer, the gift becomes the 33% coupon", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z" }
    }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", {
      from: "+14155550134",
      body: "I was worried about getting burned",
      channel: "sms"
    }, { id: "evt-reply", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, true);
  assert.match(res.payUrl, /offer=197/);
  assert.deepEqual(
    db.messages.map((m) => m.template_key).sort(),
    [EMAIL_COUPON_KEY, SMS_COUPON_KEY].sort()
  );
});

test("handleReply: fuck off does not send the coupon", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z" }
    }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", {
      from: "+14155550134",
      body: "fuck off",
      channel: "sms"
    }, { id: "evt-hostile", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "brush_off");
  assert.equal(db.messages.length, 0);
  assert.ok(db.clients[0].custom_fields[LOCK_M2]);
});

test("handleReply: nah go fuck yourself resolves by phone and does not send the coupon", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z" }
    }],
    templates: templates()
  });
  // No clientId on the event — SMS-only inbound, the gap that used to stop at no_client.
  const res = await handleReply({
    event: ev("message.inbound", {
      from: "+14155550134",
      body: "Nah go fuck yourself",
      channel: "sms"
    }, { id: "evt-sms-only" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.clientId, "cl-1");
  assert.equal(res.sent, false);
  assert.equal(res.reason, "brush_off");
  assert.equal(db.messages.length, 0);
  assert.ok(!db.messages.some((m) =>
    m.template_key === SMS_COUPON_KEY || m.template_key === EMAIL_COUPON_KEY));
});

test("handleReply: STOP does not schedule message 2", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z" }
    }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", { from: "+14155550134", body: "STOP", channel: "sms" }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.reason, "opt_out");
  assert.equal(db.messages.length, 0);
});

test("handleReply: the first five who answer get the free Google Meet", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z", slo_text_slot: "1" }
    }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", {
      from: "+14155550134",
      body: "The hardest part is I don't trust anyone",
      channel: "sms"
    }, { id: "evt-yes", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.lane, "free_roadmap");
  assert.deepEqual(
    db.messages.map((m) => m.template_key).sort(),
    [EMAIL_FIRST5_REPLY_KEY, SMS_FIRST5_REPLY_KEY].sort()
  );
  assert.ok(db.messages.every((m) => /https?:\/\//.test(m.rendered_body)));
  assert.ok(!db.messages.some((m) => m.template_key === SMS_COUPON_KEY));
  assert.equal(db.tasks.length, 1);
});

test("handleReply: the first five who say no do not get the free roadmap", async () => {
  const db = genuineDb({
    clients: [{
      id: "cl-1",
      org_id: "org-1",
      email: "pat@gmail.com",
      phone: "+14155550134",
      custom_fields: { [LOCK_M1]: "2026-09-27T18:20:00.000Z", slo_text_slot: "1" }
    }],
    templates: templates()
  });
  const res = await handleReply({
    event: ev("message.inbound", {
      from: "+14155550134",
      body: "No",
      channel: "sms"
    }, { id: "evt-no", clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.reason, "first_five_no_agree");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("handleM1: email first, phone merged during the wait — one email and one text, not zero texts", async () => {
  // api/public/slo-interest.mjs saves the email alone (run A starts with no
  // phone), then merges the phone into the same row and starts run B.
  const ROW_ID = "00000000-0000-4000-8000-000000000001";
  const contactRow = { phone: null, name: null };
  const base = genuineDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "pat@gmail.com", phone: null, custom_fields: {} }],
    templates: templates()
  });
  const reads = [];
  const db = {
    ...base,
    async query(sql, params = []) {
      if (/FROM events/.test(sql) && /payload->>'phone'/.test(sql)) {
        reads.push(params[0]);
        return { rows: params[0] === ROW_ID ? [{ phone: contactRow.phone, contact_name: contactRow.name }] : [] };
      }
      return base.query(sql, params);
    }
  };
  const runA = { ...personPayload, phone: null, name: null };
  const step = {
    run: (_id, fn) => fn(),
    // The phone lands on the row while run A sleeps.
    sleep: async () => { contactRow.phone = "+14155550134"; contactRow.name = "Pat Lee"; }
  };

  const a = await handleM1({ event: ev("slo.contact_started", runA, { id: ROW_ID }), db, step });
  assert.equal(a.sent, true);
  assert.deepEqual(reads, [ROW_ID]);
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_M1_KEY, SMS_M1_KEY].sort());
  assert.equal(db.clients[0].phone, "+14155550134", "the client row gets the phone too");

  const b = await handleM1({
    event: ev("slo.contact_started", { ...personPayload, phone: "+14155550134" }, { id: ROW_ID }),
    db,
    step: fakeStep()
  });
  assert.equal(b.reason, "already_sent_m1");
  assert.equal(db.messages.length, 2, "no second email or text");
});

test("handleM1: email only and still no phone after the wait — email, no text, no crash", async () => {
  const ROW_ID = "00000000-0000-4000-8000-000000000002";
  const base = genuineDb({
    clients: [{ id: "cl-1", org_id: "org-1", email: "pat@gmail.com", phone: null, custom_fields: {} }],
    templates: templates()
  });
  const db = {
    ...base,
    async query(sql, params = []) {
      if (/FROM events/.test(sql) && /payload->>'phone'/.test(sql)) {
        return { rows: [{ phone: null, contact_name: null }] };
      }
      return base.query(sql, params);
    }
  };
  const res = await handleM1({
    event: ev("slo.contact_started", { ...personPayload, phone: null, name: null }, { id: ROW_ID }),
    db,
    step: fakeStep()
  });
  assert.equal(res.sent, true);
  assert.equal(res.sms, null);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_M1_KEY]);
});
