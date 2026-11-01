// Commas bills subscriptions; we do not.
//
// A checkout session of type "subscription" hands Commas the schedule, the
// card, the retries and the dunning. They charge every frequency_days and
// tell us afterwards. Everything here is about believing those reports
// correctly — and two of them used to be believed WRONGLY:
//
//   subscription.renewed  matched none of the payment keywords and returned an
//                         EMPTY event list. A real recurring charge landed and
//                         nothing recorded it. Invisible until month two.
//   subscription.canceled contains "cancel", so it fell into the
//                         abandoned-checkout branch and a partner who ended a
//                         paid plan looked like someone who never paid.
//
// Both are pinned below. The ordering in mapToCanonical is what fixes them, so
// these tests fail if anyone moves the subscription block after the generic
// keyword matches.

import { test, describe } from "node:test";
import assert from "node:assert";

import { mapToCanonical } from "./commas.mjs";
import { createCheckoutSession, CHECKOUT_TYPES } from "../payments/commas-api.mjs";

const names = (type) => mapToCanonical({ type }).map((e) => e.name);

describe("subscription webhooks map to the right meaning", () => {
  test("a renewal is money in, and is also reported as a renewal", () => {
    assert.deepEqual(names("subscription.renewed"),
      ["payment.received", "subscription.renewed"]);
  });

  test("a recovery is money in too — a past-due plan that paid", () => {
    assert.deepEqual(names("subscription.recovered"),
      ["payment.received", "subscription.renewed"]);
  });

  test("a cancelled subscription is NOT an abandoned checkout", () => {
    const out = names("subscription.canceled");
    assert.deepEqual(out, ["subscription.canceled"]);
    assert.ok(!out.includes("payment.canceled"),
      "subscription.canceled must never read as an abandoned checkout");
  });

  test("lifecycle events move no money", () => {
    for (const t of ["subscription.created", "subscription.past_due", "subscription.completed"]) {
      assert.ok(!names(t).includes("payment.received"),
        `${t} must not be recorded as money in`);
    }
  });

  test("an unknown subscription event is recorded nowhere, not guessed", () => {
    assert.deepEqual(names("subscription.something_new"), []);
  });

  test("ordinary payment events are untouched by the new block", () => {
    assert.deepEqual(names("payment.succeeded"), ["payment.received"]);
    assert.deepEqual(names("payment.canceled"), ["payment.canceled"]);
    assert.deepEqual(names("payment.expired"), ["payment.expired"]);
    assert.deepEqual(mapToCanonical({ type: "refund.created", refundStatus: "success" }).map((e) => e.name),
      ["payment.refunded"]);
  });
});

describe("minting a subscription checkout", () => {
  const env = { FANBASIS_CHECKOUT_API_KEY: "k", COMMAS_SUCCESS_URL: "https://x.test/ok" };

  test("subscription is an allowed type alongside the two one-time kinds", () => {
    assert.deepEqual([...CHECKOUT_TYPES].sort(),
      ["onetime_non_reusable", "onetime_reusable", "subscription"]);
  });

  test("frequency_days is required — refused before anything is sent", async () => {
    let called = false;
    const r = await createCheckoutSession({
      amountCents: 4700, productTitle: "Board", type: "subscription",
      env, fetchImpl: () => { called = true; }
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /frequency_days/);
    assert.equal(called, false, "must not call the API without a cadence");
  });

  test("a valid subscription sends the subscription block", async () => {
    let sent = null;
    await createCheckoutSession({
      amountCents: 4700, productTitle: "Board", type: "subscription",
      frequencyDays: 30, env,
      fetchImpl: async (_u, opts) => {
        sent = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ payment_link: "https://p" }) };
      }
    });
    assert.equal(sent.type, "subscription");
    assert.deepEqual(sent.subscription, { frequency_days: 30 });
    assert.equal(sent.amount_cents, 4700);
  });

  test("a one-time session never carries a subscription block", async () => {
    let sent = null;
    await createCheckoutSession({
      amountCents: 2700, productTitle: "Autopsy", frequencyDays: 30, env,
      fetchImpl: async (_u, opts) => {
        sent = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ payment_link: "https://p" }) };
      }
    });
    assert.equal(sent.type, "onetime_non_reusable");
    assert.equal(sent.subscription, undefined);
  });

  test("an unknown type is refused rather than sent", async () => {
    const r = await createCheckoutSession({
      amountCents: 100, productTitle: "x", type: "made_up", env,
      fetchImpl: () => { throw new Error("must not be called"); }
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown checkout type/);
  });
});
