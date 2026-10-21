import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCortanaPayment, buildPayload, cortanaWebhookUrl, BUCKETS } from "./cortana-webhook.mjs";

const URL_SP = "https://app.directroas.com/api/webhook/5c02fe28-d6a9-4388-aedd-88da1806a236/369ef8f3-96f3-4642-9d6d-a12c2773e1f0";
const URL_FP = "https://app.directroas.com/api/webhook/5c02fe28-d6a9-4388-aedd-88da1806a236/0f90afb2-f93c-4fa6-8bfa-ef606f5f0682";
const URL_ALL = "https://app.directroas.com/api/webhook/5c02fe28-d6a9-4388-aedd-88da1806a236/a243992c-7664-4568-8c89-81b90300c5a2";
const ENV = {
  CORTANA_FEED_ENABLED: "1",
  ADAPTERS_DRY_RUN: "0",
  CORTANA_WEBHOOK_SOFT_PULL_URL: URL_SP,
  CORTANA_WEBHOOK_FIRST_PURCHASE_URL: URL_FP,
  CORTANA_WEBHOOK_ALL_PAYMENTS_URL: URL_ALL
};
const EV = {
  bucket: "soft_pull", eventId: "fh_pay_t1_soft_pull", amountCents: 3200, paidAt: "2026-10-21T15:00:00Z",
  name: "Pat Buyer", email: "pat@buyer.test", phone: "+15555550111", utmSource: "fb", utmMedium: "paid",
  utmCampaign: "slo", utmContent: "43-hook", utmAdId: "43", fbclid: "abc", gclid: null,
  clientId: "c1", offer: "SOFT_PULL", provider: "commas", paymentId: "pay_1"
};

function capture() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("each bucket posts to its own Cortana source and nowhere else", async () => {
  for (const [bucket, url] of [["soft_pull", URL_SP], ["first_purchase", URL_FP], ["all_payments", URL_ALL]]) {
    const { calls, fetchImpl } = capture();
    const res = await sendCortanaPayment({ ...EV, bucket }, { env: ENV, fetchImpl });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, url);
    assert.equal(calls[0].body.event_name, bucket);
  }
  assert.deepEqual(BUCKETS, ["soft_pull", "first_purchase", "all_payments"]);
});

test("the body carries every field mapped in Cortana, money in dollars", () => {
  const body = buildPayload(EV);
  for (const k of ["name", "email", "phone", "value", "currency", "conversion_date", "utm_source", "utm_medium",
    "utm_campaign", "utm_content", "utm_ad_id", "fbclid", "gclid"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(body, k), `missing ${k}`);
  }
  assert.equal(body.value, 32);
  assert.equal(body.currency, "USD");
  assert.equal(body.conversion_date, "2026-10-21T15:00:00.000Z");
  assert.equal(body.test, false);
});

test("off switch, missing URL, foreign URL, no amount and no contact send nothing", async () => {
  const { calls, fetchImpl } = capture();
  assert.equal((await sendCortanaPayment(EV, { env: { ...ENV, CORTANA_FEED_ENABLED: "0" }, fetchImpl })).skipped, "disabled");
  assert.equal((await sendCortanaPayment(EV, { env: { ...ENV, CORTANA_WEBHOOK_SOFT_PULL_URL: "" }, fetchImpl })).skipped, "no_url");
  assert.equal(cortanaWebhookUrl("soft_pull", { CORTANA_WEBHOOK_SOFT_PULL_URL: "https://evil.example/api/webhook/x/y" }), null);
  assert.equal((await sendCortanaPayment({ ...EV, amountCents: 0 }, { env: ENV, fetchImpl })).skipped, "no_amount");
  assert.equal((await sendCortanaPayment({ ...EV, email: null, phone: null }, { env: ENV, fetchImpl })).skipped, "no_contact");
  assert.equal((await sendCortanaPayment({ ...EV, bucket: "purchase" }, { env: ENV, fetchImpl })).skipped, "unknown_bucket");
  assert.equal(calls.length, 0);
});

test("a Cortana refusal comes back as a failure, never a throw", async () => {
  const fetchImpl = async () => new Response("nope", { status: 500 });
  const res = await sendCortanaPayment(EV, { env: ENV, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
});

test("the ADAPTERS fence holds the send when dry run is on", async () => {
  const { calls, fetchImpl } = capture();
  const res = await sendCortanaPayment(EV, { env: { ...ENV, ADAPTERS_DRY_RUN: "1" }, fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.blocked, true);
  assert.equal(calls.length, 0);
});
