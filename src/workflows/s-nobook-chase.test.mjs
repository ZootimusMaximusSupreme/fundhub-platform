import { test } from "node:test";
import assert from "node:assert";
import { handle as runChase, SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_01, EMAIL_NOBOOK_02, EMAIL_NOBOOK_03 } from "./s-nobook-chase.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

async function handle({ event, db, step }) {
  if (!db.events.some((e) => e.id === event.id)) db.events.push({
    id: event.id, org_id: event.orgId, client_id: event.clientId,
    name: event.name, payload: event.payload, created_at: event.createdAt || "2026-10-30T12:00:00Z"
  });
  return runChase({ event, db, step });
}

const templates = () => [
  { org_id: "org-1", template_key: SMS_NOBOOK_01, channel: "sms", body: "n1", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_02, channel: "sms", body: "n2", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_03, channel: "sms", body: "n3", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_01, channel: "email", body: "e1", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_02, channel: "email", body: "e2", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_NOBOOK_03, channel: "email", body: "e3", compliance_passed: true }
];

test("nobook: full cadence when never booked", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
  assert.deepEqual(db.messages.map((m) => m.template_key), [
    SMS_NOBOOK_01, EMAIL_NOBOOK_01, SMS_NOBOOK_02, EMAIL_NOBOOK_02, SMS_NOBOOK_03, EMAIL_NOBOOK_03
  ]);
});

test("nobook: distinct events for one application share all three send keys", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    events: [
      { id: "evt-first", org_id: "org-1", client_id: "cl-1", name: "survey.submitted", payload: { email: "a@b.com", funnel: "apply-survey" }, created_at: "2026-10-30T12:00:00Z" },
      { id: "evt-second", org_id: "org-1", client_id: "cl-1", name: "survey.submitted", payload: { email: "a@b.com", funnel: "" }, created_at: "2026-10-30T12:00:01Z" }
    ]
  });
  for (const id of ["evt-first", "evt-second"]) {
    await handle({ event: ev("survey.submitted", { email: "a@b.com" }, { id, clientId: "cl-1" }), db, step: fakeStep() });
  }
  assert.equal(db.messages.length, 6);
  assert.ok(db.messages.every((m) => m.provider_ref.includes("evt-first")));
});

test("nobook: a new survey more than six hours later starts a new cadence", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    events: [
      { id: "evt-first", org_id: "org-1", client_id: "cl-1", name: "survey.submitted", payload: { email: "a@b.com" }, created_at: "2026-10-30T04:00:00Z" },
      { id: "evt-new", org_id: "org-1", client_id: "cl-1", name: "survey.submitted", payload: { email: "a@b.com" }, created_at: "2026-10-30T12:00:00Z" }
    ]
  });
  for (const id of ["evt-first", "evt-new"]) {
    await handle({ event: ev("survey.submitted", { email: "a@b.com" }, { id, clientId: "cl-1" }), db, step: fakeStep() });
  }
  assert.equal(db.messages.length, 12);
});

test("nobook: exits immediately if already booked", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    events: [{ client_id: "cl-1", name: "booking.created" }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: stops mid-cadence when they book after msg1", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
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
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
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
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "Booked@Example.com", custom_fields: {} }],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: null, name: "booking.created",
      payload: { email: "booked@example.com", startTime: "2026-09-07T18:00:00Z" }
    }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: exits on a historical booking event matched by phone, however it is written", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1 (555) 000-1111", custom_fields: {} }],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: null, name: "booking.created",
      payload: { email: "different-address@example.com", phone: "5550001111" }
    }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: another company's booking for the same address does NOT stop this chase", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "shared@example.com", custom_fields: {} }],
    templates: templates(),
    events: [{
      org_id: "org-2", client_id: null, name: "booking.created",
      payload: { email: "shared@example.com" }
    }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
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
  const db = pgFake({
    clients: [
      { id: "cl-1", org_id: "org-1", email: "nobook@example.com", phone: "+15550001111", custom_fields: {} },
      { id: "cl-2", org_id: "org-1", email: "housemate@example.com", phone: "+15550001111", custom_fields: {} }
    ],
    templates: templates(),
    events: [{
      org_id: "org-1", client_id: "cl-2", name: "booking.created",
      payload: { email: "housemate@example.com", phone: "+15550001111" }
    }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 6);
});
