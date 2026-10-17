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
    [/starts_at > now\(\) AND status IN/, [{ id: BOOKING, starts_at: "2026-11-18T20:00:00.000Z" }]],
    [/starts_at <= now\(\)/, []]
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.upcoming_call, {
    id: BOOKING, when: "2026-11-18T20:00:00.000Z", confirmed: false, join: null
  });
  const [read] = fake.find(/starts_at > now\(\) AND status IN/);
  assert.deepEqual(read.params, [ORG_ID, CLIENT]);
  assert.match(read.sql, /status IN \('booked', 'rescheduled'\)/);
  assert.match(read.sql, /ORDER BY starts_at ASC LIMIT 1/);
  assert.equal(res.body.current_call, null);
});

test("portal exposes only this client's currently joinable HTTPS room", async () => {
  const when = new Date(Date.now() + 5 * 60_000).toISOString();
  const { res } = await callShared(portalSummary, req("GET"), [
    ...signedIn(),
    [/SELECT id, custom_fields FROM clients/, [{ id: CLIENT, custom_fields: { call_confirmed: true } }]],
    [/starts_at > now\(\) AND status IN/, [{
      id: BOOKING, starts_at: when, ends_at: new Date(Date.now() + 35 * 60_000).toISOString(),
      meeting_url: "https://meet.google.com/abc-defg-hij"
    }]],
    [/starts_at <= now\(\)/, []]
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.upcoming_call.join, {
    url: "https://meet.google.com/abc-defg-hij", host: "meet.google.com"
  });
});

test("portal leaves the Join Call door closed for a fallback or expired call", async () => {
  for (const [when, link] of [
    [new Date(Date.now() + 5 * 60_000).toISOString(), "https://fundhub.ai/portal-login.html"],
    [new Date(Date.now() + 5 * 60_000).toISOString(), "https://calendly.com/advisor/book-a-call"],
    [new Date(Date.now() + 5 * 60_000).toISOString(), "https://zoom.us/signin"],
    [new Date(Date.now() - 40 * 60_000).toISOString(), "https://meet.google.com/old-room"]
  ]) {
    const { res } = await callShared(portalSummary, req("GET"), [
      ...signedIn(),
      [/SELECT id, custom_fields FROM clients/, [{ id: CLIENT, custom_fields: {} }]],
      [/starts_at > now\(\) AND status IN/, [{
        id: BOOKING, starts_at: when, meeting_url: link
      }]],
      [/starts_at <= now\(\)/, []]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.upcoming_call.join, null);
  }
});

test("a call already under way has a Join door without changing upcoming-call confirmation", async () => {
  const when = new Date(Date.now() - 5 * 60_000).toISOString();
  const { res } = await callShared(portalSummary, req("GET"), [
    ...signedIn(),
    [/SELECT id, custom_fields FROM clients/, [{ id: CLIENT, custom_fields: { call_confirmed: true } }]],
    [/starts_at > now\(\) AND status IN/, []],
    [/starts_at <= now\(\)/, [{
      id: BOOKING, starts_at: when, ends_at: new Date(Date.now() + 25 * 60_000).toISOString(),
      meeting_url: "https://zoom.us/j/9920117744"
    }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.upcoming_call, null);
  assert.deepEqual(res.body.current_call.join, {
    url: "https://zoom.us/j/9920117744", host: "zoom.us"
  });
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
