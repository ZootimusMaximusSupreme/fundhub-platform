// Merchant event normalizers — open API, Whop, client-owned Commas. Pure.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  decimalToMinor, normalizeOpenApiEvents, verifyWhopSignature, whopEventsFrom,
  verifyClientCommasSignature, commasEventsFrom, MAX_EVENTS_PER_CALL
} from "./normalize.mjs";

describe("decimalToMinor", () => {
  test("exact string math", () => {
    assert.equal(decimalToMinor("10.00"), 1000);
    assert.equal(decimalToMinor("1234.56"), 123456);
    assert.equal(decimalToMinor("500.0"), 50000);
    assert.equal(decimalToMinor("0.1"), 10);
    assert.equal(decimalToMinor("-1234.56"), -123456);
    assert.equal(decimalToMinor("19.999"), 2000);
    assert.equal(decimalToMinor(297), 29700);
    assert.equal(decimalToMinor("1000", 0), 1000);
  });
  test("junk is null, never 0", () => {
    for (const v of [null, undefined, "", "abc", "1,000.00", "$5", NaN, Infinity]) assert.equal(decimalToMinor(v), null);
  });
});

describe("open API", () => {
  const good = { id: "ch_1", kind: "sale", amount_cents: 49700, occurred_at: "2026-10-03T15:04:00Z" };

  test("one event object or an events array", () => {
    assert.equal(normalizeOpenApiEvents(good).events.length, 1);
    assert.equal(normalizeOpenApiEvents({ events: [good] }).events.length, 1);
  });

  test("sign follows kind: refunds and fees go out, sales come in", () => {
    const r = normalizeOpenApiEvents({ events: [
      good,
      { id: "r1", kind: "refund", amount_cents: 9700, occurred_at: "2026-10-04T00:00:00Z" },
      { id: "f1", kind: "fee", amount_cents: -300, occurred_at: "2026-10-04T00:00:00Z" },
      { id: "p1", kind: "payout", amount_cents: 120000, occurred_at: "2026-10-05T00:00:00Z" },
      { id: "p2", kind: "payout", amount_cents: 5000, reversed: true, occurred_at: "2026-10-06T00:00:00Z" }
    ] });
    assert.deepEqual(r.events.map((e) => e.amount_cents), [49700, -9700, -300, -120000, 5000]);
    assert.equal(r.events[0].currency, "usd");
    assert.equal(r.events[0].occurred_at, "2026-10-03T15:04:00.000Z");
  });

  test("bad events are listed by index and the good ones still go through", () => {
    const r = normalizeOpenApiEvents({ events: [
      good,
      { kind: "sale", amount_cents: 1, occurred_at: "2026-10-03T00:00:00Z" },
      { id: "x", kind: "tip", amount_cents: 1, occurred_at: "2026-10-03T00:00:00Z" },
      { id: "y", kind: "sale", amount_cents: 1.5, occurred_at: "2026-10-03T00:00:00Z" },
      { id: "z", kind: "sale", amount_cents: -1, occurred_at: "2026-10-03T00:00:00Z" },
      { id: "w", kind: "sale", amount_cents: 1, occurred_at: "yesterday-ish" },
      { id: "ch_1", kind: "sale", amount_cents: 1, occurred_at: "2026-10-03T00:00:00Z" },
      { id: "c", kind: "sale", amount_cents: 1, currency: "dollars", occurred_at: "2026-10-03T00:00:00Z" }
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.events.length, 1);
    assert.deepEqual(r.errors.map((e) => e.index), [1, 2, 3, 4, 5, 6, 7]);
  });

  test("empty, too many, or not an object is refused whole", () => {
    assert.equal(normalizeOpenApiEvents(null).ok, false);
    assert.equal(normalizeOpenApiEvents({ events: [] }).ok, false);
    assert.equal(normalizeOpenApiEvents({ foo: 1 }).ok, false);
    const many = Array.from({ length: MAX_EVENTS_PER_CALL + 1 }, (_, i) => ({ ...good, id: `e${i}` }));
    assert.equal(normalizeOpenApiEvents({ events: many }).ok, false);
  });
});

describe("Whop — Standard Webhooks signature (docs.whop.com/developer/guides/webhooks)", () => {
  const secret = "ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const body = JSON.stringify({ id: "msg_1", type: "payment.succeeded", data: { id: "pay_1" } });
  const now = Date.parse("2026-10-06T12:00:00Z");
  const ts = String(Math.floor(now / 1000));
  const sign = (s = secret, t = ts, id = "msg_1", b = body) =>
    "v1," + crypto.createHmac("sha256", Buffer.from(s, "utf8")).update(`${id}.${t}.${b}`).digest("base64");

  test("a correct signature over id.timestamp.body with the ws_ secret as given passes", () => {
    const r = verifyWhopSignature({ rawBody: body, now, secret,
      headers: { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": sign() } });
    assert.equal(r.ok, true);
  });

  test("any of several space-separated signatures may match", () => {
    const r = verifyWhopSignature({ rawBody: body, now, secret,
      headers: { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": `v1,AAAA ${sign()}` } });
    assert.equal(r.ok, true);
  });

  test("wrong secret, changed body, missing headers, old timestamp all fail", () => {
    const h = { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": sign() };
    assert.equal(verifyWhopSignature({ rawBody: body, now, secret: secret + "x", headers: h }).ok, false);
    assert.equal(verifyWhopSignature({ rawBody: body + " ", now, secret, headers: h }).ok, false);
    assert.equal(verifyWhopSignature({ rawBody: body, now, secret, headers: { "webhook-id": "msg_1" } }).ok, false);
    assert.equal(verifyWhopSignature({ rawBody: body, now, secret, headers: h }).ok, true);
    const old = String(Number(ts) - 301);
    assert.equal(verifyWhopSignature({ rawBody: body, now, secret,
      headers: { ...h, "webhook-timestamp": old, "webhook-signature": sign(secret, old) } }).reason, "stale_timestamp");
    assert.equal(verifyWhopSignature({ rawBody: body, now, secret: "", headers: h }).ok, false);
  });
});

describe("Whop — payloads to events", () => {
  const money = (amount) => ({ amount, currency: "usd", decimals: 2, display_decimals: 2 });

  test("payment.succeeded → a sale of `total` plus Whop's fee", () => {
    const r = whopEventsFrom({ id: "msg_1", type: "payment.succeeded", timestamp: "2026-10-01T10:00:00Z",
      data: { id: "pay_1", currency: "usd", total: money("100.00"), amount_after_fees: money("96.70"), paid_at: "2026-10-01T09:59:00Z" } });
    assert.deepEqual(r.events.map((e) => [e.provider_event_id, e.kind, e.amount_cents]), [["pay_1", "sale", 10000], ["pay_1:fee", "fee", -330]]);
    assert.equal(r.events[0].occurred_at, "2026-10-01T09:59:00.000Z");
  });

  test("refund counts only once it succeeded", () => {
    const base = { type: "refund.updated", data: { id: "rf_1", payment_id: "pay_1", amount: money("25.00"), created_at: "2026-10-02T00:00:00Z" } };
    assert.equal(whopEventsFrom({ ...base, data: { ...base.data, status: "pending" } }).events.length, 0);
    const ok = whopEventsFrom({ ...base, data: { ...base.data, status: "succeeded" } });
    assert.deepEqual(ok.events.map((e) => [e.kind, e.amount_cents]), [["refund", -2500]]);
  });

  test("payout counts once completed; a reversal comes back positive", () => {
    const d = { id: "wdrl_1", amount: "500.0", currency: "usd", created_at: "2026-10-03T00:00:00Z" };
    assert.equal(whopEventsFrom({ type: "payout.created", data: { ...d, status: "in_review" } }).events.length, 0);
    assert.deepEqual(whopEventsFrom({ type: "payout.updated", data: { ...d, status: "completed" } }).events.map((e) => [e.provider_event_id, e.amount_cents]),
      [["wdrl_1", -50000]]);
    assert.deepEqual(whopEventsFrom({ type: "payout.reversed", data: { ...d, status: "reversed" } }).events.map((e) => [e.provider_event_id, e.amount_cents]),
      [["wdrl_1:reversed", 50000]]);
  });

  test("other types and broken payloads are ignored, never guessed", () => {
    assert.ok(whopEventsFrom({ type: "membership.activated", data: { id: "mem_1", created_at: "2026-10-01T00:00:00Z" } }).ignored);
    assert.ok(whopEventsFrom({ type: "payment.succeeded", data: { id: "pay_2", created_at: "2026-10-01T00:00:00Z" } }).ignored);
    assert.ok(whopEventsFrom({ type: "payment.succeeded" }).ignored);
  });
});

describe("Commas — a client's own account, Fundhub's adapter helpers", () => {
  const secret = "client-commas-secret";
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", data: { payment_id: "p_9", amount: 297, created_at: "2026-10-02T00:00:00Z" } });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");

  test("x-webhook-signature HMAC of the raw body", () => {
    assert.equal(verifyClientCommasSignature({ rawBody: body, secret, headers: { "x-webhook-signature": sig } }).ok, true);
    assert.equal(verifyClientCommasSignature({ rawBody: body, secret: "other", headers: { "x-webhook-signature": sig } }).ok, false);
    assert.equal(verifyClientCommasSignature({ rawBody: body, secret, headers: {} }).ok, false);
  });

  test("succeeded → sale keyed on payment_id; a refund of the same payment is its own row", () => {
    const sale = commasEventsFrom(JSON.parse(body));
    assert.deepEqual(sale.events.map((e) => [e.provider_event_id, e.kind, e.amount_cents]), [["sale:p_9", "sale", 29700]]);
    const refund = commasEventsFrom({ id: "evt_2", type: "payment.refunded", data: { payment_id: "p_9", amount: 297 } });
    assert.deepEqual(refund.events.map((e) => [e.provider_event_id, e.kind, e.amount_cents]), [["refund:p_9", "refund", -29700]]);
  });

  test("a failed or canceled payment is not money", () => {
    assert.equal(commasEventsFrom({ type: "payment.failed", data: { payment_id: "p_1", amount: 5 } }).events.length, 0);
    assert.equal(commasEventsFrom({ type: "subscription.canceled", data: { payment_id: "p_1", amount: 5 } }).events.length, 0);
  });
});
