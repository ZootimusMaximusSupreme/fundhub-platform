// Merchant pull providers — Whop and Commas, driven by a stand-in fetch.
// No network: every response below is shaped from the processor's own docs
// (URLs in src/merchant/providers/whop.mjs and commas.mjs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as whop from "./whop.mjs";
import * as commas from "./commas.mjs";
import { PULL_PROVIDERS, pullProviderFor, PULL_PROVIDER_IDS } from "./index.mjs";
import { MerchantPullError } from "./http.mjs";

const OPEN = { ADAPTERS_DRY_RUN: "0" };
const WHOP_KEY = "apik_test_whop_0000000000000001";
const COMMAS_KEY = "commas_test_key_000000000000002";

/* A fetch stand-in: answers by path, records every call. */
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const key = u.pathname + (u.searchParams.get("after") ? `?after=${u.searchParams.get("after")}` : "") +
      (u.searchParams.get("page") ? `?page=${u.searchParams.get("page")}` : "");
    const hit = routes[key] ?? routes[u.pathname];
    if (!hit) return new Response(JSON.stringify({ error: { type: "not_found", message: "no route" } }), { status: 404 });
    const { status = 200, body } = typeof hit === "function" ? hit(u) : hit;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

const money = (amount, currency = "usd") => ({ amount, currency, decimals: 2, display_decimals: 2 });

/* Whop Payment, Refund and Payout rows — field names from
   docs.whop.com/api-reference/beta/{payments/list-payments,
   refunds/list-refunds, payouts/list-payouts}. */
const PAY_PAID = {
  id: "pay_aaaaaaaaaaaaaa", status: "paid", substatus: "succeeded", currency: "usd",
  total: money("100.00"), amount_after_fees: money("94.70"), product_id: "prod_xxxxxxxxxxxxxx",
  paid_at: "2026-10-01T15:00:00.000Z", created_at: "2026-10-01T14:59:00.000Z"
};
const REFUND_OK = {
  id: "rf_bbbbbbbbbbbbbb", payment_id: "pay_aaaaaaaaaaaaaa", status: "succeeded",
  amount: money("25.00"), original_amount: money("25.00"), created_at: "2026-10-02T10:00:00.000Z"
};
const REFUND_PENDING = { ...REFUND_OK, id: "rf_cccccccccccccc", status: "pending" };
const PAYOUT_DONE = { id: "wdrl_dddddddddddd", amount: "500.0", currency: "usd", status: "completed", created_at: "2026-10-03T09:00:00.000Z" };
const PAYOUT_BACK = { id: "wdrl_eeeeeeeeeeee", amount: "40.0", currency: "usd", status: "reversed", created_at: "2026-09-20T09:00:00.000Z", updated_at: "2026-09-25T09:00:00.000Z" };
const pageInfo = (end, more) => ({ end_cursor: end, start_cursor: null, has_next_page: more, has_previous_page: false });

describe("registry", () => {
  test("Whop and Commas are pull providers; nothing else resolves", () => {
    assert.deepEqual([...PULL_PROVIDER_IDS].sort(), ["commas", "whop"]);
    for (const id of PULL_PROVIDER_IDS) {
      const p = PULL_PROVIDERS[id];
      assert.equal(typeof p.listEvents, "function");
      assert.ok(p.label && p.keyHelp, `${id} needs a label and key help`);
    }
    for (const bad of ["api", "constructor", "toString", "__proto__", ""]) assert.equal(pullProviderFor(bad), null, bad);
  });
});

describe("whop listEvents", () => {
  test("walks payments → refunds → payouts with the documented URL, auth and version headers", async () => {
    const f = stubFetch({
      "/api/v1/payments": { body: { data: [PAY_PAID, { ...PAY_PAID, id: "pay_open00000000", status: "open" }], page_info: pageInfo("P1", true) } },
      "/api/v1/payments?after=P1": { body: { data: [], page_info: pageInfo(null, false) } },
      "/api/v1/refunds": { body: { data: [REFUND_OK, REFUND_PENDING], page_info: pageInfo(null, false) } },
      "/api/v1/accounts/me": { body: { id: "biz_ffffffffffffff", title: "Acme Studio", route: "acme-studio", status: "approved" } },
      "/api/v1/payouts": { body: { data: [PAYOUT_DONE, PAYOUT_BACK], page_info: pageInfo(null, false) } }
    });
    const all = [];
    let cursor = null;
    let pages = 0;
    do {
      const out = await whop.listEvents({ apiKey: WHOP_KEY, since: pages ? null : "2026-09-01T00:00:00Z", cursor, env: OPEN, fetchImpl: f });
      all.push(...out.events);
      cursor = out.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    assert.equal(pages, 4, "payments p1, payments p2, refunds, payouts");
    // Every call: https, the documented base, Bearer key, pinned version, GET.
    for (const c of f.calls) {
      assert.equal(c.url.origin, "https://api.whop.com");
      assert.ok(c.url.pathname.startsWith("/api/v1/"));
      assert.equal(c.init.method, "GET");
      assert.equal(c.init.headers.authorization, `Bearer ${WHOP_KEY}`);
      assert.equal(c.init.headers["Api-Version-Date"], whop.WHOP_API_VERSION_DATE);
    }
    const first = f.calls[0].url;
    assert.equal(first.searchParams.get("status"), "paid");
    assert.equal(first.searchParams.get("first"), "100");
    assert.equal(first.searchParams.get("created_after"), "2026-09-01T00:00:00.000Z");
    assert.equal(f.calls[1].url.searchParams.get("after"), "P1");
    assert.equal(f.calls[1].url.searchParams.get("created_after"), "2026-09-01T00:00:00.000Z", "the window rides in the cursor");
    const payouts = f.calls.find((c) => c.url.pathname === "/api/v1/payouts").url;
    assert.equal(payouts.searchParams.get("account_id"), "biz_ffffffffffffff");

    const byId = Object.fromEntries(all.map((e) => [e.provider_event_id, e]));
    assert.deepEqual(Object.keys(byId).sort(), [
      "pay_aaaaaaaaaaaaaa", "pay_aaaaaaaaaaaaaa:fee", "rf_bbbbbbbbbbbbbb",
      "wdrl_dddddddddddd", "wdrl_eeeeeeeeeeee", "wdrl_eeeeeeeeeeee:reversed"
    ].sort());
    assert.equal(byId["pay_aaaaaaaaaaaaaa"].kind, "sale");
    assert.equal(byId["pay_aaaaaaaaaaaaaa"].amount_cents, 10000);
    assert.equal(byId["pay_aaaaaaaaaaaaaa:fee"].amount_cents, -530);
    assert.equal(byId["rf_bbbbbbbbbbbbbb"].amount_cents, -2500);
    assert.equal(byId["wdrl_dddddddddddd"].amount_cents, -50000);
    // A reversed payout was sent and came back: the two rows net to zero.
    assert.equal(byId["wdrl_eeeeeeeeeeee"].amount_cents + byId["wdrl_eeeeeeeeeeee:reversed"].amount_cents, 0);
  });

  test("the same ids as the Whop webhook path, so pushed and pulled rows agree", async () => {
    const { whopEventsFrom } = await import("../normalize.mjs");
    const pushed = whopEventsFrom({ type: "payment.succeeded", data: PAY_PAID }).events.map((e) => e.provider_event_id);
    const f = stubFetch({ "/api/v1/payments": { body: { data: [PAY_PAID], page_info: pageInfo(null, false) } } });
    const out = await whop.listEvents({ apiKey: WHOP_KEY, env: OPEN, fetchImpl: f });
    assert.deepEqual(out.events.map((e) => e.provider_event_id), pushed);
  });

  test("a 401 is auth_failed, and the error never carries the key", async () => {
    const f = stubFetch({ "/api/v1/payments": { status: 401, body: { error: { type: "unauthorized", message: `bad key ${WHOP_KEY}` } } } });
    await assert.rejects(whop.listEvents({ apiKey: WHOP_KEY, env: OPEN, fetchImpl: f }), (err) => {
      assert.ok(err instanceof MerchantPullError);
      assert.equal(err.code, "auth_failed");
      assert.equal(err.status, 401);
      assert.ok(!err.message.includes(WHOP_KEY), "the key leaked into the error");
      return true;
    });
  });

  test("held by the ADAPTERS fence when ADAPTERS_DRY_RUN is not off — nothing is sent", async () => {
    const f = stubFetch({});
    await assert.rejects(whop.listEvents({ apiKey: WHOP_KEY, env: {}, fetchImpl: f }), (err) => err.code === "blocked");
    assert.equal(f.calls.length, 0);
  });

  test("no key → bad_key before any call; a data-less body → bad_response", async () => {
    const f = stubFetch({ "/api/v1/payments": { body: { nope: true } } });
    await assert.rejects(whop.listEvents({ apiKey: "", env: OPEN, fetchImpl: f }), (e) => e.code === "bad_key");
    assert.equal(f.calls.length, 0);
    await assert.rejects(whop.listEvents({ apiKey: WHOP_KEY, env: OPEN, fetchImpl: f }), (e) => e.code === "bad_response");
  });

  test("payouts need the biz_ id; an /accounts/me without one stops with bad_response", async () => {
    const f = stubFetch({ "/api/v1/accounts/me": { body: { id: "user_123" } } });
    const cursor = JSON.stringify({ v: 1, stream: "payouts", after: null, since: null, account: null });
    await assert.rejects(whop.listEvents({ apiKey: WHOP_KEY, cursor, env: OPEN, fetchImpl: f }), (e) => e.code === "bad_response");
  });
});

/* Commas List Transactions row — commasdocs.com "List Transactions" example,
   with a refund using the field names Commas documents for a refund. */
const TXN = {
  id: 919049, transaction_date: "2026-06-30T14:55:09.000000Z",
  fan: { id: "5yWjR", name: "Jane Doe", email: "jane@example.com", phone: "3055550100", country_code: "1" },
  servicePayment: { id: "p9Rwr", payment_type: "auto_renew", fund_release_on: "2026-07-02 09:55:09", fund_released: 1 },
  service: { id: "NLxj6", title: "Pro Monthly Membership", internal_name: null, description: null, price: "29.99" },
  product: { id: "NLxj6", title: "Pro Monthly Membership", internal_name: null, description: null, price: "29.99" },
  refunds: [], fee_amount: 1.20, net_amount: 28.79, amount: 29.99
};
const TXN_REFUNDED = {
  ...TXN, id: 919050,
  refunds: [
    { refund_id: "d8Kw2", amount: 25.00, status: "success", created_at: "2026-07-03T15:41:55+00:00" },
    { something: "undocumented" }
  ]
};
const commasPage = (transactions, has_more) => ({
  status: "success", message: "Transactions retrieved successfully",
  data: { transactions, pagination: { current_page: 1, total_pages: has_more ? 2 : 1, per_page: 100, total_items: transactions.length, has_more } },
  request_id: "req_9f2c4e6a8b0d"
});

describe("commas listEvents", () => {
  test("pages List Transactions with x-api-key until has_more is false", async () => {
    const f = stubFetch({
      "/public-api/checkout-sessions/transactions?page=1": { body: commasPage([TXN], true) },
      "/public-api/checkout-sessions/transactions?page=2": { body: commasPage([TXN_REFUNDED], false) }
    });
    const one = await commas.listEvents({ apiKey: COMMAS_KEY, since: "2026-09-01T00:00:00Z", env: OPEN, fetchImpl: f });
    assert.ok(one.nextCursor);
    const two = await commas.listEvents({ apiKey: COMMAS_KEY, cursor: one.nextCursor, env: OPEN, fetchImpl: f });
    assert.equal(two.nextCursor, null);

    for (const c of f.calls) {
      assert.equal(c.url.origin, "https://www.fanbasis.com");
      assert.equal(c.url.pathname, "/public-api/checkout-sessions/transactions");
      assert.equal(c.url.searchParams.get("per_page"), "100");
      assert.equal(c.url.searchParams.has("created_after"), false, "Commas documents no date filter");
      assert.equal(c.init.method, "GET");
      assert.equal(c.init.headers["x-api-key"], COMMAS_KEY);
      assert.equal(c.init.headers.authorization, undefined);
    }
    assert.deepEqual(f.calls.map((c) => c.url.searchParams.get("page")), ["1", "2"]);

    const byId = Object.fromEntries([...one.events, ...two.events].map((e) => [e.provider_event_id, e]));
    assert.deepEqual(Object.keys(byId).sort(), ["refund:d8Kw2", "txn:919049", "txn:919049:fee", "txn:919050", "txn:919050:fee"]);
    assert.equal(byId["txn:919049"].kind, "sale");
    assert.equal(byId["txn:919049"].amount_cents, 2999);
    assert.equal(byId["txn:919049"].currency, "usd");
    assert.equal(byId["txn:919049"].description, "Pro Monthly Membership");
    assert.equal(byId["txn:919049:fee"].amount_cents, -120);
    assert.equal(byId["refund:d8Kw2"].amount_cents, -2500);
    assert.equal(two.ignored, 1, "the refund with no documented id/amount is counted, not guessed");
  });

  test("a 403 is auth_failed; a body without data.transactions is bad_response", async () => {
    const denied = stubFetch({ "/public-api/checkout-sessions/transactions": { status: 403, body: { status: "error", message: "Invalid API key or unauthorized user context" } } });
    await assert.rejects(commas.listEvents({ apiKey: COMMAS_KEY, env: OPEN, fetchImpl: denied }), (e) => e.code === "auth_failed" && !e.message.includes(COMMAS_KEY));
    const odd = stubFetch({ "/public-api/checkout-sessions/transactions": { body: { status: "success", data: { customers: [] } } } });
    await assert.rejects(commas.listEvents({ apiKey: COMMAS_KEY, env: OPEN, fetchImpl: odd }), (e) => e.code === "bad_response");
  });

  test("a 429 is rate_limited (the next sync resumes)", async () => {
    const f = stubFetch({ "/public-api/checkout-sessions/transactions": { status: 429, body: { success: false, message: "Too many requests. Please try again later." } } });
    await assert.rejects(commas.listEvents({ apiKey: COMMAS_KEY, env: OPEN, fetchImpl: f }), (e) => e.code === "rate_limited");
  });
});
