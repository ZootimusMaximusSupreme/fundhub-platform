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
  assert.equal(body.offer_financing_screen, "score_unconfirmed");
  assert.equal(body.available_capital_band, null);
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
    const result = await sendCortanaBooking({ ...BOOKING, qualification_bucket,
      custom_fields: { cf_svy_self_reported_fico: "620-699", cf_svy_available_capital: "$0" }
    }, { env: ENV, fetchImpl });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(seen.map((body) => body.qualification_bucket),
    ["funding_qualified", "funding_unqualified", null]);
  assert.ok(seen.every((body) => body.offer_financing_screen === "review_620_plus"));
  assert.ok(seen.every((body) => body.available_capital_band === "$0"));
  assert.ok(seen.every((body) => body.event_name === "funding_call_booked"));
  assert.ok(seen.every((body) => body.event_id === `fundhub_booking_${BOOKING.id}`));
});

test("a calendar email without its own completed survey carries no qualified attribution", async () => {
  let body;
  await sendCortanaBooking({ ...BOOKING, has_completed_survey: false,
    qualification_bucket: "funding_qualified",
    custom_fields: { cf_svy_self_reported_fico: "760-850", cf_svy_available_capital: "$50k+" }
  }, { env: ENV, fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
  } });
  assert.equal(body.qualification_bucket, null);
  assert.equal(body.offer_financing_screen, "score_unconfirmed");
  assert.equal(body.available_capital_band, null);
  const conn = fakeDb(BOOKING);
  await sweepCortanaBookingFeed(conn, { env: ENV, send: async () => ({ ok: true }) });
  const sql = conn.queries.find(({ sql }) => sql.includes("FROM bookings b")).sql;
  assert.match(sql, /e\.org_id = b\.org_id AND e\.client_id = b\.client_id/);
  assert.match(sql, /lower\(btrim\(e\.payload->>'email'\)\) = lower\(btrim\(b\.attendee_email\)\)/);
  assert.match(sql, /e\.created_at <= b\.created_at/);
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


test("offer-financing screen reports known score bands without changing business funding", async () => {
  const cases = [
    ["500-619", "below_620"], ["620-699", "review_620_plus"],
    ["700-759", "review_620_plus"], ["760-850", "review_620_plus"],
    ["500-579", "below_620"], ["580-649", "score_unconfirmed"],
    ["650-699", "review_620_plus"], ["700-749", "review_620_plus"],
    ["750+", "review_620_plus"], ["Not sure", "score_unconfirmed"],
    [619, "score_unconfirmed"], [620, "score_unconfirmed"],
    [207975, "score_unconfirmed"], ["207975", "score_unconfirmed"],
    ["610-630", "score_unconfirmed"], [null, "score_unconfirmed"]
  ];
  for (const [score, expected] of cases) {
    let body;
    const result = await sendCortanaBooking({ ...BOOKING, custom_fields: {
      cf_svy_self_reported_fico: score, cf_svy_available_capital: "$0",
      private_note: "must-not-be-transmitted"
    } }, { env: ENV, fetchImpl: async (url, init) => {
      assert.equal(url, URL);
      body = JSON.parse(init.body);
      return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
    } });
    assert.equal(result.ok, true);
    assert.equal(body.offer_financing_screen, expected, String(score));
    assert.equal(body.available_capital_band, "$0");
    assert.equal(body.qualification_bucket, "funding_unqualified");
    assert.equal(body.event_name, "funding_call_booked");
    assert.equal(body.event_id, `fundhub_booking_${BOOKING.id}`);
    assert.equal(body.booking_id, BOOKING.provider_uid);
    assert.equal(body.value, 0);
    assert.equal(JSON.stringify(body).includes("must-not-be-transmitted"), false);
    assert.equal(Object.hasOwn(body, "custom_fields"), false);
  }
});

test("offer-financing screen follows valid setter corrections, labels and legacy fallback", async () => {
  const cases = [
    [{ cf_svy_self_reported_fico: "500-619", setter_survey_edits: { cf_svy_self_reported_fico: "620-699" } }, "review_620_plus"],
    [{ cf_svy_self_reported_fico: "760-850", setter_survey_edits: { cf_svy_self_reported_fico: "500-619" } }, "below_620"],
    [{ cf_svy_self_reported_fico: "760-850", setter_survey_edits: { cf_svy_self_reported_fico: "580-649" } }, "score_unconfirmed"],
    [{ cf_svy_self_reported_fico: "620-699", setter_survey_edits: { cf_svy_self_reported_fico: "not a score" } }, "review_620_plus"],
    [{ cf_svy_self_reported_fico: 207975, cf_svy_self_reported_fico_label: "620-699" }, "review_620_plus"],
    [{ cf_svy_self_reported_fico: "500-619", cf_svy_self_reported_fico_label: "760-850" }, "review_620_plus"],
    [{ svy_self_reported_fico: "650–699" }, "review_620_plus"],
    [{ cf_svy_self_reported_fico: { value: "620-699" } }, "score_unconfirmed"],
    [null, "score_unconfirmed"], [[], "score_unconfirmed"]
  ];
  for (const [custom_fields, expected] of cases) {
    let body;
    await sendCortanaBooking({ ...BOOKING, custom_fields }, { env: ENV, fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
    } });
    assert.equal(body.offer_financing_screen, expected, JSON.stringify(custom_fields));
    assert.equal(body.qualification_bucket, "funding_unqualified");
  }
});

test("capital reporting preserves current and historical bands and safely reads saved labels", async () => {
  const bands = [
    "$0", "$1 - $199", "$200 - $999", "$1k - $4,999", "$5k - $9,999",
    "$10k - $19,999", "$20k - $49,999", "$50k+",
    "Less than $1k", "$1k - $5k", "$5k - $25k", "$25k - $100k", "$100k+"
  ];
  const cases = bands.map(band => [{ cf_svy_available_capital: band }, band]);
  cases.push(
    [{ cf_svy_available_capital: 207975, cf_svy_available_capital_label: "$0" }, "$0"],
    [{ cf_svy_available_capital_labels: JSON.stringify([JSON.stringify(["$50k+"])]) }, "$50k+"],
    [{ cf_svy_available_capital_labels: ["$20k - $49,999"] }, "$20k - $49,999"],
    [{ cf_svy_available_capital: "Less than $1k", setter_survey_edits: { cf_svy_available_capital: "$0" } }, "$0"],
    [{ cf_svy_available_capital: "$50k+", setter_survey_edits: { cf_svy_available_capital: "invalid" } }, "$50k+"],
    [{ cf_svy_available_capital: 207975 }, null],
    [{ cf_svy_available_capital: "207975" }, null],
    [{ cf_svy_available_capital: { value: "$50k+" } }, null],
    [{ cf_svy_available_capital_labels: '[{"private":"do-not-send"}]' }, null],
    [{ cf_svy_available_capital: "x".repeat(1001) }, null]
  );
  for (const [custom_fields, expected] of cases) {
    let body;
    await sendCortanaBooking({ ...BOOKING, custom_fields }, { env: ENV, fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
    } });
    assert.equal(body.available_capital_band, expected, JSON.stringify(custom_fields));
    assert.equal(body.qualification_bucket, "funding_unqualified");
    assert.equal(Object.hasOwn(body, "cf_svy_available_capital"), false);
    assert.ok(body.available_capital_band == null || body.available_capital_band.length <= 1000);
    assert.equal(JSON.stringify(body).includes("do-not-send"), false);
  }
});

test("composed booking feed reports review and capital once through its existing receipt ledger", async () => {
  const conn = fakeDb({ ...BOOKING, custom_fields: {
    cf_svy_self_reported_fico: "500-619", cf_svy_available_capital: "Less than $1k",
    setter_survey_edits: { cf_svy_self_reported_fico: "620-699", cf_svy_available_capital: "$0" }
  } });
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" };
  };
  const first = await sweepCortanaBookingFeed(conn, { env: ENV, fetchImpl });
  assert.deepEqual(first, { scanned: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent[0].url, URL);
  assert.equal(sent[0].body.offer_financing_screen, "review_620_plus");
  assert.equal(sent[0].body.available_capital_band, "$0");
  assert.equal(sent[0].body.qualification_bucket, "funding_unqualified");
  assert.equal(sent[0].body.event_name, "funding_call_booked");
  assert.equal(sent[0].body.event_id, `fundhub_booking_${BOOKING.id}`);
  assert.equal(conn.receipt.status, "sent");
  const second = await sweepCortanaBookingFeed(conn, { env: ENV, fetchImpl });
  assert.deepEqual(second, { scanned: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
});
