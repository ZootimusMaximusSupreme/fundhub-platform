import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCortanaBooking } from "../messaging/providers/cortana-booking-webhook.mjs";
import { sweepCortanaBookingFeed } from "./cortana-booking-feed.mjs";

const URL = "https://app.directroas.com/api/webhook/test-booking-source";
const ENV = { CORTANA_FEED_ENABLED: "1", CORTANA_WEBHOOK_BOOKING_URL: URL, ADAPTERS_DRY_RUN: "0" };
const BOOKING = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  org_id: "123e4567-e89b-12d3-a456-426614174001",
  provider_uid: "75827",
  qualification_bucket: "funding_unqualified",
  has_completed_survey: true,
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

test("existing booking attribution is preserved without financial data for every tier", async () => {
  const expected = {
    schema: "fh-cortana-book-v1", event_name: "funding_call_booked", event_id: `fundhub_booking_${BOOKING.id}`,
    booking_id: BOOKING.provider_uid, name: BOOKING.attendee_name, email: BOOKING.attendee_email,
    phone: BOOKING.phone, conversion_date: "2026-10-29T20:00:00.000Z", value: 0, currency: "USD",
    utm_source: "facebook", utm_medium: "paid", utm_campaign: "funding", utm_content: "42-ad",
    utm_ad_id: null, fbclid: null, gclid: null
  };
  for (const tier of ["funding_qualified", "funding_unqualified", null]) {
    for (const completed of [false, true]) {
      const result = await sendCortanaBooking({ ...BOOKING, qualification_bucket: tier,
        has_completed_survey: completed, custom_fields: { cf_svy_self_reported_fico: "760-850", income: 75000,
        cf_svy_available_capital: "$50k+", setter_survey_edits: { cf_svy_self_reported_fico: "500-619" } },
        offer_financing_screen: "review_620_plus", available_capital_band: "$50k+", credit_score: 780
      }, { env: ENV, fetchImpl: async (url, init) => {
        assert.equal(url, URL); assert.deepEqual(JSON.parse(init.body), expected);
        return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
      } });
      assert.equal(result.ok, true);
    }
  }
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

function fakeDb(row) {
  let receipt = null;
  const queries = [];
  return {
    queries,
    get receipt() { return receipt; },
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM bookings b")) {
        return { rows: receipt?.status === "sent" || receipt?.status === "skipped" ? [] : [row] };
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


test("the feed selects accepted bookings independently of financial information", async () => {
  const conn = fakeDb(BOOKING);
  const out = await sweepCortanaBookingFeed(conn, { env: ENV, send: async (data) => {
    assert.equal(data.id, BOOKING.id); return { ok: true };
  } });
  assert.equal(out.sent, 1);
  const sql = conn.queries.find(({ sql }) => sql.includes("FROM bookings b")).sql;
  const selection = sql.slice(sql.indexOf("   WHERE b.source"));
  assert.match(selection, /b.status IN \('booked', 'rescheduled'\)/);
  assert.doesNotMatch(selection, /qualification|custom_fields|survey|credit|income|capital/i);
});
