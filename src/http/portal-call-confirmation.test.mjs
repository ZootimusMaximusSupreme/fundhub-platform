import { test } from "node:test";
import assert from "node:assert/strict";

import bookings from "../../api/bookings.mjs";
import portalSummary from "../../api/read/portal-summary.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { req, accountSession, staffSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const BOOKING = "b1000000-0000-4000-8000-000000000001";
const signedIn = () => accountSession({ kind: "client", clientId: CLIENT });

test("portal summary reads the next call from this session's client and company", async () => {
  const { res, fake } = await callShared(portalSummary, req("GET", {
    query: { client_id: "c2000000-0000-4000-8000-000000000002" }
  }), [
    ...signedIn(),
    [/SELECT id, custom_fields FROM clients/, [{ id: CLIENT, custom_fields: { call_confirmed: false } }]],
    [/SELECT id, starts_at FROM bookings/, [{ id: BOOKING, starts_at: "2026-11-18T20:00:00.000Z" }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.upcoming_call, {
    id: BOOKING, when: "2026-11-18T20:00:00.000Z", confirmed: false
  });
  const [read] = fake.find(/SELECT id, starts_at FROM bookings/);
  assert.deepEqual(read.params, [ORG_ID, CLIENT]);
  assert.match(read.sql, /status IN \('booked', 'rescheduled'\)/);
});

test("client confirms only the next upcoming call on their own file", async () => {
  const { res, fake } = await callShared(bookings, req("POST", {
    body: { booking_id: BOOKING, client_id: "c2000000-0000-4000-8000-000000000002" }
  }), [
    ...signedIn(),
    [/UPDATE clients c/, [{ id: CLIENT }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, confirmed: true });
  const [write] = fake.find(/UPDATE clients c/);
  assert.deepEqual(write.params, [ORG_ID, CLIENT, BOOKING]);
  assert.match(write.sql, /c\.id = \$2 AND c\.org_id = \$1/);
  assert.match(write.sql, /b\.org_id = \$1 AND b\.client_id = \$2/);
  assert.match(write.sql, /b\.starts_at > now\(\)/);
  assert.match(write.sql, /b\.status IN \('booked', 'rescheduled'\)/);
  assert.match(write.sql, /ORDER BY b\.starts_at ASC LIMIT 1/);
  assert.match(write.sql, /'call_confirmed', true/);
});

test("a changed, cancelled, past, or other client's booking confirms nothing", async () => {
  const { res, fake } = await callShared(bookings, req("POST", { body: { booking_id: BOOKING } }), [
    ...signedIn(),
    [/UPDATE clients c/, []]
  ]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "call_changed");
  assert.equal(fake.find(/UPDATE clients c/).length, 1);
});

test("a repeated click returns the same confirmed answer", async () => {
  const rules = [...signedIn(), [/UPDATE clients c/, [{ id: CLIENT }]]];
  for (let i = 0; i < 2; i += 1) {
    const { res } = await callShared(bookings, req("POST", { body: { booking_id: BOOKING } }), rules);
    assert.deepEqual(res.body, { ok: true, confirmed: true });
  }
});

test("invalid booking id, staff, and partner cannot confirm a client's call", async () => {
  const invalid = await callShared(bookings, req("POST", { body: { booking_id: "bad" } }), signedIn());
  assert.equal(invalid.res.statusCode, 400);
  assert.equal(invalid.fake.find(/UPDATE clients c/).length, 0);

  const staff = await callShared(bookings, req("POST", { body: { booking_id: BOOKING } }), [staffSession()]);
  assert.equal(staff.res.statusCode, 405);
  assert.equal(staff.fake.find(/UPDATE clients c/).length, 0);

  const partner = await callShared(bookings, req("POST", { body: { booking_id: BOOKING } }), accountSession({ kind: "partner" }));
  assert.equal(partner.res.statusCode, 403);
  assert.equal(partner.fake.find(/UPDATE clients c/).length, 0);
});
