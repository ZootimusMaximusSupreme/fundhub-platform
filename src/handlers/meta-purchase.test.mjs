// src/handlers/meta-purchase.test.mjs — the server-only Meta Purchase.
//
// PURE UNIT TEST, NO DATABASE, NO META. The sender is a stand-in passed as
// deps.sendMetaEvents; nothing here can reach the network.
//
// What this proves:
//   - the purchase id rules ("purchase.<order ref>" for the $297 order,
//     "purchase.<payment id>" for an offer) and that each payment fires once
//   - the six offers' prices come from src/config/offers.mjs, and each offer's
//     trigger is an event the Commas adapter really emits for that product
//   - cents → dollars through src/commissions/money.mjs
//   - no raw email or phone ever reaches the sender
//   - demo orders, demo clients and agents are skipped
//   - a failing sender or database never throws out of the handler or the bus
//   - fbc / fbp kept at checkout or on the client are reused

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  OFFER_PURCHASE_TRIGGER,
  SORTING_HAT_OFFER_KEYS,
  SLO_PURCHASE_URL,
  centsToValue,
  offerKeyForPayment,
  offerPurchaseEventId,
  offerValueCents,
  onMoneyEventForMeta,
  purchaseTrigger,
  sloPurchaseEventId
} from "./meta-purchase.mjs";
import { OFFERS } from "../config/offers.mjs";
import { mapToCanonical } from "../adapters/commas.mjs";
import { emit } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const LINK = "33333333-3333-4333-8333-333333333333";
const REF = "slo_0123456789abcdef01234567";
const FBC = "fb.1.1727800000000.IwAR2abcDEF_123-xyz";
const FBP = "fb.1.1727800000000.1234567890";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]";

/* A fake db that answers the handler's four reads and records the write. */
function fakeDb({ link = null, client = null, checkout = null, fail = false } = {}) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (fail) throw new Error("connection refused");
      if (/UPDATE events SET payload = payload \|\|/.test(text)) {
        writes.push({ note: JSON.parse(params[0]).meta, eventId: params[1] });
        return { rows: [] };
      }
      if (/FROM payment_links/.test(text)) return { rows: link ? [link] : [] };
      if (/FROM clients/.test(text)) return { rows: client ? [client] : [] };
      if (/FROM events/.test(text)) return { rows: checkout ? [checkout] : [] };
      return { rows: [] };
    }
  };
}

function fakeSender(result = { ok: true, sent: 1 }) {
  const sent = [];
  const fn = async (events, opts) => {
    sent.push({ events, opts });
    if (result instanceof Error) throw result;
    return result;
  };
  fn.sent = sent;
  return fn;
}

const realClient = (over = {}) => ({
  id: CLIENT,
  email: "Pat.Buyer@Gmail.com",
  phone: "+1 (480) 555-0100",
  is_demo: false,
  custom_fields: {},
  ...over
});

const sloLink = (over = {}) => ({
  id: LINK, org_id: ORG, client_id: CLIENT, link_ref: REF,
  amount_cents: 29700, status: "paid", is_demo: false, ...over
});

const sloCheckout = (match = {}, actor = "person") => ({
  meta_match: { fbc: FBC, fbp: FBP, client_ip_address: "203.0.113.9", client_user_agent: UA, ...match },
  actor
});

const sloPaymentEvent = (over = {}) => ({
  id: "evt-pay-1",
  name: "payment.received",
  orgId: ORG,
  clientId: CLIENT,
  payload: {
    source: "commas", product: "crs", productCode: "diagnostic", purpose: "diagnostic",
    amount: 297, email: "pat.buyer@gmail.com", paymentId: "pay_777", providerRef: "pay_777",
    ref: REF, paymentLinkId: LINK, ...over
  }
});

const offerEvent = (name, payload, over = {}) => ({
  id: "evt-offer-1",
  name,
  orgId: ORG,
  clientId: CLIENT,
  payload: { source: "commas", paymentId: "pay_42", providerRef: "pay_42", email: "pat.buyer@gmail.com", ...payload },
  ...over
});

describe("which event fires which Purchase", () => {
  test("the six sorting-hat offers are the catalogue's six client offers", () => {
    assert.deepEqual([...SORTING_HAT_OFFER_KEYS].sort(), Object.keys(OFFER_PURCHASE_TRIGGER).sort());
    for (const k of SORTING_HAT_OFFER_KEYS) assert.ok(OFFERS[k], `${k} is in src/config/offers.mjs`);
  });

  test("each offer's trigger is an event the Commas adapter really emits for that product, and the only one we use", () => {
    for (const k of SORTING_HAT_OFFER_KEYS) {
      const o = OFFERS[k];
      const names = mapToCanonical({ type: "payment.succeeded", productCode: o.productCode, purpose: o.paymentPurpose, name: "" })
        .map((c) => c.name);
      assert.ok(names.includes(OFFER_PURCHASE_TRIGGER[k]), `${k}: ${names.join(",")}`);
      const semantic = names.filter((n) => n !== "payment.received");
      // A product with a semantic event sends on it; one without sends on payment.received.
      assert.equal(OFFER_PURCHASE_TRIGGER[k], semantic[0] || "payment.received", k);
      // Exactly one of the payment's events is the trigger.
      const fired = names.filter((n) => purchaseTrigger(n, { source: "commas", productCode: o.productCode }));
      assert.deepEqual(fired, [OFFER_PURCHASE_TRIGGER[k]], k);
    }
  });

  test("the $297 order fires on payment.received only — never on its diagnostic.paid", () => {
    const p = { source: "commas", productCode: "diagnostic", ref: REF };
    assert.deepEqual(purchaseTrigger("payment.received", p), { kind: "slo", ref: REF });
    assert.equal(purchaseTrigger("diagnostic.paid", p), null);
  });

  test("the SLO pull form's diagnostic.paid (not a payment) never fires", () => {
    assert.equal(purchaseTrigger("diagnostic.paid", { source: "slo", ref: REF, attempt: 1 }), null);
  });

  test("only Commas payments count; refunds and other events never fire", () => {
    assert.equal(purchaseTrigger("deposit.paid", { productCode: "card-stacking-dfy" }), null);
    assert.equal(purchaseTrigger("deposit.paid", { source: "manual", productCode: "card-stacking-dfy" }), null);
    assert.equal(purchaseTrigger("payment.refunded", { source: "commas", productCode: "repair-bundle" }), null);
    assert.equal(purchaseTrigger("entry.captured", { source: "commas" }), null);
  });

  test("offerKeyForPayment: product code first, the adapter's bucket when there is no code", () => {
    assert.equal(offerKeyForPayment({ productCode: "diagnostic" }), "SOFT_PULL");
    assert.equal(offerKeyForPayment({ productCode: "card-stacking-dfy" }), "FUNDING_DFY");
    assert.equal(offerKeyForPayment({ productCode: "repair-bundle" }), "REPAIR_DFY");
    assert.equal(offerKeyForPayment({ productCode: "repair-trial" }), "REPAIR_TRIAL");
    assert.equal(offerKeyForPayment({ productCode: "consulting-package" }), "UWIQ_DELIVERABLES");
    assert.equal(offerKeyForPayment({ productCode: "funding-mastery" }), "FUNDING_MASTERY");
    assert.equal(offerKeyForPayment({ product: "crs" }), "SOFT_PULL");
    assert.equal(offerKeyForPayment({ product: "deposit" }), "FUNDING_DFY");
    assert.equal(offerKeyForPayment({ product: "diy" }), "UWIQ_DELIVERABLES");
    // Not one of the six: the partner funnel, the DIY letters, a success fee.
    assert.equal(offerKeyForPayment({ productCode: "partner-entry" }), null);
    assert.equal(offerKeyForPayment({ productCode: "diy-letter-pack", product: "diy" }), null);
    assert.equal(offerKeyForPayment({ product: "success_fee" }), null);
    assert.equal(offerKeyForPayment({ product: "unmatched" }), null);
  });
});

describe("purchase ids", () => {
  test("$297 order: purchase.<order ref> — the browser's checkout:success id", () => {
    assert.equal(sloPurchaseEventId(REF), `purchase.${REF}`);
  });
  test("offer: purchase.<payment id>, else the processor ref, else our event id", () => {
    assert.equal(offerPurchaseEventId({ paymentId: "pay_1", providerRef: "evt_x" }, "e1"), "purchase.pay_1");
    assert.equal(offerPurchaseEventId({ providerRef: "evt_x" }, "e1"), "purchase.evt_x");
    assert.equal(offerPurchaseEventId({}, "e1"), "purchase.e1");
    assert.equal(offerPurchaseEventId({}, null), null);
  });
});

describe("value — integer cents, then dollars", () => {
  test("the payment's own amount wins (Commas amounts arrive in dollars)", () => {
    assert.deepEqual(offerValueCents({ amount: 3000 }, "FUNDING_DFY"), { cents: 300000, from: "payment" });
    assert.deepEqual(offerValueCents({ amount: "32.50" }, "SOFT_PULL"), { cents: 3250, from: "payment" });
    assert.deepEqual(offerValueCents({ amount: 0.1 + 0.2 }, "SOFT_PULL"), { cents: 30, from: "payment" });
  });
  test("no amount, zero or junk → the offer's catalogue price, never 0", () => {
    for (const amount of [null, undefined, "", 0, -5, "abc"]) {
      assert.deepEqual(offerValueCents({ amount }, "REPAIR_TRIAL"), { cents: OFFERS.REPAIR_TRIAL.priceCents, from: "offer" });
    }
    assert.equal(offerValueCents({}, "NOPE"), null);
  });
  test("cents → dollars is exact", () => {
    assert.equal(centsToValue(29700), 297);
    assert.equal(centsToValue(3200), 32);
    assert.equal(centsToValue(3250), 32.5);
    assert.equal(centsToValue(500000), 5000);
    assert.equal(centsToValue(1), 0.01);
  });
});

describe("$297 order Purchase", () => {
  test("sends one website Purchase: order ref id, order amount, hashed contact, checkout's fbc/fbp/ip/ua, hashed client id", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    const out = await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send, now: () => 1727900000000 });
    assert.equal(out.sent, true);
    assert.equal(send.sent.length, 1);
    const [ev] = send.sent[0].events;
    assert.equal(send.sent[0].events.length, 1);
    assert.equal(ev.event_name, "Purchase");
    assert.equal(ev.event_id, `purchase.${REF}`);
    assert.equal(ev.event_time, 1727900000);
    assert.equal(ev.event_source_url, SLO_PURCHASE_URL);
    assert.equal(ev.action_source, "website");
    assert.deepEqual(ev.custom_data, { value: 297, currency: "USD" });
    assert.deepEqual(ev.user_data.em, [sha("pat.buyer@gmail.com")]);
    assert.deepEqual(ev.user_data.ph, [sha("14805550100")]);
    assert.deepEqual(ev.user_data.external_id, [sha(CLIENT)]);
    assert.equal(ev.user_data.fbc, FBC);
    assert.equal(ev.user_data.fbp, FBP);
    assert.equal(ev.user_data.client_ip_address, "203.0.113.9");
    assert.equal(ev.user_data.client_user_agent, UA);
    assert.equal(send.sent[0].opts.db, db, "the sender gets the db for its token read");
    // The result is written on the payment event row.
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].eventId, "evt-pay-1");
    assert.equal(db.writes[0].note.ok, true);
    assert.equal(db.writes[0].note.sent, 1);
    assert.equal(db.writes[0].note.event_id, `purchase.${REF}`);
  });

  test("no raw email or phone anywhere in what the sender gets, or in what is recorded", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    // This real CI timestamp contains the phone's area code, but is not PII.
    await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send, now: () => 1792480323000 });
    const [event] = send.sent[0].events;
    assert.equal(event.event_time, 1792480323);
    assert.ok(String(event.event_time).includes("480"));
    assert.deepEqual(event.user_data.em, [sha("pat.buyer@gmail.com")]);
    assert.deepEqual(event.user_data.ph, [sha("14805550100")]);
    const blob = JSON.stringify(send.sent[0].events) + JSON.stringify(db.writes);
    for (const raw of ["pat.buyer", "Pat.Buyer", "gmail", realClient().email, realClient().phone,
      "pat.buyer@gmail.com", "14805550100", "4805550100", "5550100", "555-0100"]) {
      assert.equal(blob.includes(raw), false, `raw "${raw}" leaked`);
    }
  });

  test("value is the order's own amount (extra businesses included), from integer cents", async () => {
    const db = fakeDb({ link: sloLink({ amount_cents: 31200 }), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send });
    assert.deepEqual(send.sent[0].events[0].custom_data, { value: 312, currency: "USD" });
  });

  test("checkout kept no fbc / fbp → the client's stored ones are reused", async () => {
    const db = fakeDb({
      link: sloLink(),
      client: realClient({ custom_fields: { meta_fbc: FBC, meta_fbp: FBP } }),
      checkout: { meta_match: { client_user_agent: UA }, actor: "person" }
    });
    const send = fakeSender();
    await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send });
    const ud = send.sent[0].events[0].user_data;
    assert.equal(ud.fbc, FBC);
    assert.equal(ud.fbp, FBP);
  });

  test("an order from before the checkout kept a user agent is sent as a system event", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: null });
    const send = fakeSender();
    await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send });
    assert.equal(send.sent[0].events[0].action_source, "system_generated");
  });

  test("ref not echoed back: the link found by session still makes it the $297 order, and its diagnostic.paid stays silent", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    const out = await onMoneyEventForMeta(sloPaymentEvent({ ref: null }), db, { sendMetaEvents: send });
    assert.equal(out.event_id, `purchase.${REF}`);
    const dpDb = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const dp = await onMoneyEventForMeta({ ...sloPaymentEvent({ ref: null }), name: "diagnostic.paid" }, dpDb, { sendMetaEvents: send });
    assert.equal(dp.skip, "not_a_trigger");
    assert.equal(send.sent.length, 1, "one Purchase per payment");
    assert.equal(dpDb.writes.length, 0);
  });

  for (const [label, setup, reason] of [
    ["demo order", { link: sloLink({ is_demo: true }) }, "demo_order"],
    ["demo client", { client: realClient({ is_demo: true }) }, "demo_client"],
    ["company email", { client: realClient({ email: "chris@fundhub.ai" }) }, "agent"],
    ["example.com email", { client: realClient({ email: "pat@example.com" }) }, "agent"],
    ["test email", { client: realClient({ email: "pat+test@gmail.com" }) }, "agent"],
    ["bot browser at checkout", { checkout: sloCheckout({ client_user_agent: "Mozilla/5.0 HeadlessChrome/120" }) }, "agent"],
    ["checkout judged an agent", { checkout: sloCheckout({}, "agent") }, "agent"],
    ["order missing", { link: null }, "order_missing"]
  ]) {
    test(`skipped: ${label} — nothing sent, reason recorded`, async () => {
      const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout(), ...setup });
      const send = fakeSender();
      const out = await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: send });
      assert.equal(out.sent, false);
      assert.equal(out.skip, reason);
      assert.equal(send.sent.length, 0);
      assert.equal(db.writes[0]?.note?.skipped, reason);
    });
  }

  test("a replay of an event already sent ok sends nothing", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    const ev = sloPaymentEvent({ meta: { event_name: "Purchase", ok: true, sent: 1 } });
    const out = await onMoneyEventForMeta(ev, db, { sendMetaEvents: send });
    assert.equal(out.skip, "already_sent");
    assert.equal(send.sent.length, 0);
    assert.equal(db.calls.length, 0);
  });

  test("a replay after a disabled / failed send tries again", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const send = fakeSender();
    await onMoneyEventForMeta(sloPaymentEvent({ meta: { ok: true, sent: 0, skipped: "disabled" } }), db, { sendMetaEvents: send });
    assert.equal(send.sent.length, 1);
  });
});

describe("sorting-hat offer Purchase", () => {
  test("FUNDING_DFY on deposit.paid: the payment's amount, system event, payment id, hashed contact", async () => {
    const db = fakeDb({ client: realClient() });
    const send = fakeSender();
    const ev = offerEvent("deposit.paid", { product: "deposit", productCode: "card-stacking-dfy", purpose: "deposit", amount: 3000 });
    const out = await onMoneyEventForMeta(ev, db, { sendMetaEvents: send, now: () => 1727900000000 });
    assert.equal(out.sent, true);
    const [m] = send.sent[0].events;
    assert.equal(m.event_name, "Purchase");
    assert.equal(m.event_id, "purchase.pay_42");
    assert.equal(m.action_source, "system_generated");
    assert.deepEqual(m.custom_data, { value: 3000, currency: "USD" });
    assert.deepEqual(m.user_data.em, [sha("pat.buyer@gmail.com")]);
    assert.deepEqual(m.user_data.ph, [sha("14805550100")]);
    assert.deepEqual(m.user_data.external_id, [sha(CLIENT)]);
    assert.equal(m.user_data.client_ip_address, undefined, "no web session, no IP");
    assert.equal(db.writes[0].note.offer, "FUNDING_DFY");
    assert.equal(db.writes[0].note.value, 3000);
  });

  test("no amount on the payment → the offer's price from src/config/offers.mjs", async () => {
    const cases = [
      ["diagnostic.paid", { product: "crs", productCode: "diagnostic" }, OFFERS.SOFT_PULL.priceCents],
      ["deposit.paid", { product: "deposit", productCode: "card-stacking-dfy" }, OFFERS.FUNDING_DFY.priceCents],
      ["sale.closed", { product: "diy", productCode: "consulting-package" }, OFFERS.UWIQ_DELIVERABLES.priceCents],
      ["payment.received", { product: "unmatched", productCode: "repair-bundle" }, OFFERS.REPAIR_DFY.priceCents],
      ["payment.received", { product: "unmatched", productCode: "repair-trial" }, OFFERS.REPAIR_TRIAL.priceCents],
      ["payment.received", { product: "unmatched", productCode: "funding-mastery" }, OFFERS.FUNDING_MASTERY.priceCents]
    ];
    for (const [name, payload, cents] of cases) {
      const send = fakeSender();
      await onMoneyEventForMeta(offerEvent(name, payload), fakeDb({ client: realClient() }), { sendMetaEvents: send });
      assert.equal(send.sent.length, 1, `${payload.productCode} sends on ${name}`);
      assert.equal(send.sent[0].events[0].custom_data.value, cents / 100, payload.productCode);
    }
  });

  test("the client's stored fbc / fbp ride on an offer Purchase", async () => {
    const db = fakeDb({ client: realClient({ custom_fields: { meta_fbc: FBC, meta_fbp: FBP } }) });
    const send = fakeSender();
    await onMoneyEventForMeta(offerEvent("sale.closed", { product: "diy", productCode: "consulting-package", amount: 5000 }), db, { sendMetaEvents: send });
    assert.equal(send.sent[0].events[0].user_data.fbc, FBC);
    assert.equal(send.sent[0].events[0].user_data.fbp, FBP);
  });

  test("a $32 soft pull fires on diagnostic.paid, not on its payment.received", async () => {
    const send = fakeSender();
    const payload = { product: "crs", productCode: "diagnostic", amount: 32, ref: "pl_abc" };
    const db1 = fakeDb({ client: realClient() });
    const a = await onMoneyEventForMeta(offerEvent("payment.received", payload), db1, { sendMetaEvents: send });
    assert.equal(a.skip, "not_a_trigger");
    assert.equal(db1.calls.length, 0, "decided without a query");
    const b = await onMoneyEventForMeta(offerEvent("diagnostic.paid", payload), fakeDb({ client: realClient() }), { sendMetaEvents: send });
    assert.equal(b.sent, true);
    assert.equal(send.sent.length, 1);
    assert.equal(send.sent[0].events[0].custom_data.value, 32);
  });

  test("demo link, demo client and agent emails are skipped", async () => {
    const send = fakeSender();
    const payload = { product: "deposit", productCode: "card-stacking-dfy", amount: 3000, paymentLinkId: LINK };
    const demoLink = await onMoneyEventForMeta(offerEvent("deposit.paid", payload),
      fakeDb({ link: { id: LINK, org_id: ORG, link_ref: "pl_x", is_demo: true }, client: realClient() }), { sendMetaEvents: send });
    assert.equal(demoLink.skip, "demo_order");
    const demoClient = await onMoneyEventForMeta(offerEvent("deposit.paid", { ...payload, paymentLinkId: null }),
      fakeDb({ client: realClient({ is_demo: true }) }), { sendMetaEvents: send });
    assert.equal(demoClient.skip, "demo_client");
    const agent = await onMoneyEventForMeta(offerEvent("deposit.paid", { ...payload, paymentLinkId: null }),
      fakeDb({ client: realClient({ email: "sim.closer@fundhub.ai" }) }), { sendMetaEvents: send });
    assert.equal(agent.skip, "agent");
    assert.equal(send.sent.length, 0);
  });

  test("an unattributed payment still reports with the payer's hashed email", async () => {
    const send = fakeSender();
    const ev = offerEvent("deposit.paid", { product: "deposit", productCode: "card-stacking-dfy", amount: 3000, email: "Walk.In@Gmail.com" }, { clientId: null });
    await onMoneyEventForMeta(ev, fakeDb({ client: null }), { sendMetaEvents: send });
    assert.deepEqual(send.sent[0].events[0].user_data.em, [sha("walk.in@gmail.com")]);
    assert.equal(send.sent[0].events[0].user_data.external_id, undefined);
  });
});

describe("a sender or database failure never breaks the payment", () => {
  test("sender throws → handler resolves, failure recorded on the event row", async () => {
    const db = fakeDb({ link: sloLink(), client: realClient(), checkout: sloCheckout() });
    const out = await onMoneyEventForMeta(sloPaymentEvent(), db, { sendMetaEvents: fakeSender(new Error("socket hang up")) });
    assert.equal(out.sent, false);
    assert.equal(db.writes[0].note.ok, false);
    assert.match(db.writes[0].note.error, /socket hang up/);
  });

  test("sender says Meta refused → recorded, not thrown", async () => {
    const db = fakeDb({ client: realClient() });
    const out = await onMoneyEventForMeta(
      offerEvent("deposit.paid", { product: "deposit", productCode: "card-stacking-dfy", amount: 3000 }),
      db,
      { sendMetaEvents: fakeSender({ ok: false, sent: 0, error: "400 Invalid parameter" }) }
    );
    assert.equal(out.ok, false);
    assert.equal(db.writes[0].note.error, "400 Invalid parameter");
  });

  test("database down → handler resolves without throwing", async () => {
    const out = await onMoneyEventForMeta(sloPaymentEvent(), fakeDb({ fail: true }), { sendMetaEvents: fakeSender() });
    assert.equal(out.sent, false);
    assert.equal(out.skip, "error");
  });

  test("through the bus: a throwing sender leaves the payment event stored and every other handler run", async () => {
    clearHandlers();
    const seen = [];
    on("payment.received", async () => { seen.push("money-chain"); });
    on("payment.received", (e, d) => onMoneyEventForMeta(e, d, { sendMetaEvents: fakeSender(new Error("meta down")) }));
    on("payment.received", async () => { seen.push("after"); });
    const store = [];
    const db = {
      async query(sql, params) {
        const text = String(sql);
        if (/INSERT INTO events/.test(text)) { store.push(params); return { rows: [{ id: "evt-bus-1" }] }; }
        if (/FROM payment_links/.test(text)) return { rows: [sloLink()] };
        if (/FROM clients/.test(text)) return { rows: [realClient()] };
        if (/FROM events/.test(text)) return { rows: [sloCheckout()] };
        return { rows: [] };
      }
    };
    const res = await emit(db, "payment.received", sloPaymentEvent().payload, { orgId: ORG, clientId: CLIENT, idempotencyKey: "commas:test:payment.received" });
    assert.equal(res.deduped, false);
    assert.equal(res.dispatched.failed, 0);
    assert.deepEqual(seen, ["money-chain", "after"]);
    assert.equal(store.length, 1);
    clearHandlers();
  });
});

test("register() puts the handler on exactly the four money events", async () => {
  const { register, MONEY_EVENTS } = await import("./meta-purchase.mjs");
  const { getHandlers } = await import("../events/registry.mjs");
  clearHandlers();
  register();
  for (const name of MONEY_EVENTS) assert.deepEqual(getHandlers(name), [onMoneyEventForMeta], name);
  assert.deepEqual(getHandlers("payment.refunded"), []);
  clearHandlers();
});
