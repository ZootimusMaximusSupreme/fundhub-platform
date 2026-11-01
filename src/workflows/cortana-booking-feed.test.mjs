import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCortanaBooking } from "../messaging/providers/cortana-booking-webhook.mjs";
import { sweepCortanaBookingFeed } from "./cortana-booking-feed.mjs";

const URL = "https://app.directroas.com/api/webhook/test-booking-source";
const ENV = { CORTANA_FEED_ENABLED: "1", CORTANA_WEBHOOK_BOOKING_URL: URL, ADAPTERS_DRY_RUN: "0" };
const BOOKING = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  org_id: "123e4567-e89b-12d3-a456-426614174001",
  client_id: null,
  provider_uid: "75827",
  qualification_bucket: "funding_unqualified",
  starts_at: new Date(Date.now() + 86400000).toISOString(),
  ends_at: null,
  created_at: "2026-10-29T20:00:00Z",
  attendee_name: "Buyer Person",
  attendee_email: "buyer@otherdomain.com",
  phone: "+14805550123",
  is_demo: false,
  custom_fields: {},
  utm_source: "facebook",
  utm_campaign: "funding",
  utm_medium: "paid",
  utm_content: "42-ad",
  ad_id: "42"
};

test("provider posts one confirmed booking with attribution through the adapter fence", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
  };
  const result = await sendCortanaBooking(BOOKING, { env: ENV, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(seen.url, URL);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.event_id, `fundhub_booking_${BOOKING.id}`);
  assert.equal(body.email, BOOKING.attendee_email);
  assert.equal(body.qualification_bucket, "funding_unqualified");
  assert.equal(body.event_name, "funding_call_booked");
  assert.equal(body.utm_source, "facebook");
  assert.equal(body.utm_ad_id, null);
  assert.equal(body.value, 0);
  assert.equal(body.conversion_date, "2026-10-29T20:00:00.000Z");
});

test("Cortana receives the saved booking bucket without changing its conversion", async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
  };
  for (const qualification_bucket of ["funding_qualified", "funding_unqualified", null]) {
    const result = await sendCortanaBooking({ ...BOOKING, qualification_bucket }, { env: ENV, fetchImpl });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(seen.map((body) => body.qualification_bucket),
    ["funding_qualified", "funding_unqualified", null]);
  assert.ok(seen.every((body) => body.event_name === "funding_call_booked"));
  assert.ok(seen.every((body) => body.event_id === `fundhub_booking_${BOOKING.id}`));
});

test("provider refuses a different destination and an unopened adapter fence", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw Error("should not send"); };
  const wrong = await sendCortanaBooking(BOOKING, {
    env: { ...ENV, CORTANA_WEBHOOK_BOOKING_URL: "https://example.com/api/webhook/x" }, fetchImpl
  });
  assert.equal(wrong.transmitted, false);
  const held = await sendCortanaBooking(BOOKING, { env: { ...ENV, ADAPTERS_DRY_RUN: "1" }, fetchImpl });
  assert.equal(held.transmitted, false);
  assert.equal(calls, 0);
});

function fakeDb(row, { failStampOnce = false, leaveBookingNull = false, staleCandidateFields = null } = {}) {
  let receipt = null;
  let shouldFailStamp = failStampOnce;
  const queries = [];
  return {
    queries,
    get receipt() { return receipt; },
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM bookings b") && sql.includes("WHERE b.id = $1 AND b.org_id = $2")) {
        return { rows: params[0] === row.id && params[1] === row.org_id
          ? [{ qualification_bucket: row.qualification_bucket,
            client_qualification_bucket: row.client_qualification_bucket || null,
            custom_fields: row.custom_fields }] : [] };
      }
      if (sql.includes("FROM bookings b")) {
        assert.match(sql, /b\.starts_at IS NOT NULL/);
        return { rows: !row.starts_at || receipt?.status === "sent" || receipt?.status === "skipped"
          ? [] : [{ ...row, custom_fields: staleCandidateFields ?? row.custom_fields }] };
      }
      if (sql.includes("SELECT custom_fields FROM clients")) {
        return { rows: row.client_id && row.matched_client_id === row.client_id
          ? [{ custom_fields: row.custom_fields }] : [] };
      }
      if (sql.includes("UPDATE clients SET qualification_bucket")) {
        if (shouldFailStamp) { shouldFailStamp = false; throw Error("bucket write failed"); }
        return { rows: [] };
      }
      if (sql.includes("UPDATE bookings b SET qualification_bucket")) {
        if (!leaveBookingNull) row.qualification_bucket = params[2];
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO cortana_booking_sends")) {
        if (receipt?.status === "sending") return { rows: [] };
        receipt = { status: "sending", attempts: (receipt?.attempts || 0) + 1 };
        return { rows: [{ booking_id: row.id }] };
      }
      if (sql.includes("UPDATE cortana_booking_sends")) {
        receipt.status = params[1];
        receipt.error = params[2];
        return { rows: [] };
      }
      throw Error("unexpected query");
    }
  };
}

test("failed booking send retries; a receipt stops duplicates", async () => {
  const conn = fakeDb(BOOKING);
  let calls = 0;
  const send = async () => { calls += 1; return calls === 1 ? { ok: false, status: 503 } : { ok: true }; };
  const first = await sweepCortanaBookingFeed(conn, { env: ENV, send });
  assert.equal(first.failed, 1);
  assert.equal(conn.receipt.status, "failed");
  const second = await sweepCortanaBookingFeed(conn, { env: ENV, send });
  assert.equal(second.sent, 1);
  assert.equal(conn.receipt.status, "sent");
  const third = await sweepCortanaBookingFeed(conn, { env: ENV, send });
  assert.equal(third.scanned, 0);
  assert.equal(calls, 2);
});

test("simulated buyer is not sent as a conversion", async () => {
  const conn = fakeDb({ ...BOOKING, attendee_name: "Simulated Buyer" });
  const result = await sweepCortanaBookingFeed(conn, {
    env: ENV, send: async () => { throw Error("should not send"); }
  });
  assert.equal(result.skipped, 1);
  assert.equal(conn.receipt.status, "skipped");
});

test("known score with a missing booking bucket retries a failed stamp, then sends once", async () => {
  const row = { ...BOOKING, client_id: "client-1", matched_client_id: "client-1",
    qualification_bucket: null, custom_fields: { cf_svy_self_reported_fico: "760-850" } };
  const conn = fakeDb(row, { failStampOnce: true });
  let sends = 0;
  const send = async (booking) => {
    sends += 1;
    assert.equal(booking.qualification_bucket, "funding_qualified");
    return { ok: true };
  };
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).failed, 1);
  assert.equal(conn.receipt.status, "failed");
  assert.equal(sends, 0);
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).sent, 1);
  assert.equal(conn.receipt.status, "sent");
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).scanned, 0);
  assert.equal(sends, 1);
  assert.ok(conn.queries.some(({ sql, params }) =>
    sql.includes("WHERE b.id = $1 AND b.org_id = $2") &&
    params[0] === row.id && params[1] === row.org_id));
});

test("a score saved after candidate lookup is still stamped before send", async () => {
  const row = { ...BOOKING, client_id: "client-1", matched_client_id: "client-1",
    qualification_bucket: null, custom_fields: { cf_svy_self_reported_fico: "700-759" } };
  const conn = fakeDb(row, { staleCandidateFields: {} });
  const sent = [];
  const out = await sweepCortanaBookingFeed(conn, { env: ENV,
    send: async (booking) => { sent.push(booking); return { ok: true }; } });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].qualification_bucket, "funding_qualified");
});

test("known score still missing after a stamp stays failed and retryable", async () => {
  const row = { ...BOOKING, client_id: "client-1", matched_client_id: "client-1",
    qualification_bucket: null, custom_fields: { cf_svy_self_reported_fico: "620-699" } };
  const conn = fakeDb(row, { leaveBookingNull: true });
  const out = await sweepCortanaBookingFeed(conn, { env: ENV,
    send: async () => { throw Error("must not send a known score as null"); } });
  assert.equal(out.failed, 1);
  assert.equal(conn.receipt.status, "failed");
  assert.match(conn.receipt.error, /known client score/);
});

test("a failed stamp stays retryable after the call; only a reconciled snapshot sends once", async () => {
  const row = { ...BOOKING, client_id: "client-1", matched_client_id: "client-1",
    qualification_bucket: null, custom_fields: { cf_svy_self_reported_fico: "760-850" } };
  const conn = fakeDb(row, { failStampOnce: true });
  const sent = [];
  const send = async (booking) => { sent.push(booking); return { ok: true }; };
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).failed, 1);
  row.starts_at = new Date(Date.now() - 86400000).toISOString();
  row.ends_at = new Date(Date.now() - 82800000).toISOString();
  const stamps = conn.queries.filter(({ sql }) => sql.includes("UPDATE clients SET qualification_bucket")).length;
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).failed, 1);
  assert.equal(conn.receipt.status, "failed");
  assert.equal(sent.length, 0, "a later score cannot label a past call");
  assert.equal(conn.queries.filter(({ sql }) => sql.includes("UPDATE clients SET qualification_bucket")).length,
    stamps, "post-call retry cannot stamp from today's score");
  row.qualification_bucket = "funding_qualified"; // explicit at-booking reconciliation
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).sent, 1);
  assert.equal(sent[0].qualification_bucket, "funding_qualified");
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).scanned, 0);
  assert.equal(sent.length, 1);
});

test("a past call with no readable score or saved bucket can send unknown", async () => {
  const row = { ...BOOKING, client_id: "client-1", matched_client_id: "client-1",
    qualification_bucket: null, starts_at: new Date(Date.now() - 86400000).toISOString(),
    custom_fields: {} };
  const conn = fakeDb(row);
  const sent = [];
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV,
    send: async (booking) => { sent.push(booking); return { ok: true }; } })).sent, 1);
  assert.equal(sent[0].qualification_bucket, null);
});

test("a no-time booking waits, then a time makes it a feed candidate", async () => {
  const row = { ...BOOKING, starts_at: null, qualification_bucket: null };
  const conn = fakeDb(row);
  let sends = 0;
  const send = async () => { sends += 1; return { ok: true }; };
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).scanned, 0);
  row.starts_at = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await sweepCortanaBookingFeed(conn, { env: ENV, send })).sent, 1);
  assert.equal(sends, 1);
});

test("a booking linked to another org's client fails rather than sending", async () => {
  const row = { ...BOOKING, client_id: "other-client", matched_client_id: null, qualification_bucket: null };
  const conn = fakeDb(row);
  const out = await sweepCortanaBookingFeed(conn, { env: ENV,
    send: async () => { throw Error("must not send an org mismatch"); } });
  assert.equal(out.failed, 1);
  assert.equal(conn.receipt.status, "failed");
});
