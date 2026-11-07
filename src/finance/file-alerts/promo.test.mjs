// Alert 2 — a card's promo rate is ending. Pure: no database, no clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planPromoEnd, thresholdFor, nextPromoAlert, promoPayoff, paymentsLeft, payoffDetail, payoffAtRate, promoPct,
  readPromoInput, PromoInputError
} from "./promo.mjs";
import { TEMPLATES } from "./common.mjs";

const AMEX = { account_id: "acct-amex", name: "Business Amex", mask: "4404", balance_cents: 540000 };
const promoEnding = (endsOn, extra = {}) => ({ promo_ends_on: endsOn, promo_apr: "0.00000", promo_source: "staff", ...extra });

describe("thresholdFor — 60, 30 and 7, on the day and the two days after, never before", () => {
  test("the windows", () => {
    for (const d of [60, 59, 58]) assert.equal(thresholdFor(d), 60, `${d}`);
    for (const d of [30, 29, 28]) assert.equal(thresholdFor(d), 30, `${d}`);
    for (const d of [7, 6, 5]) assert.equal(thresholdFor(d), 7, `${d}`);
    for (const d of [61, 90, 57, 45, 31, 27, 10, 8, 4, 1, 0, -1]) assert.equal(thresholdFor(d), null, `${d}`);
    assert.equal(thresholdFor(null), null);
    assert.equal(thresholdFor(7.5), null);
  });
});

describe("planPromoEnd", () => {
  test("60 days out: the text, with the balance left and a computed payoff line", () => {
    const p = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-10-07" });
    assert.equal(p.alert, true);
    assert.equal(p.kind, "promo_end");
    assert.equal(p.threshold, 60);
    assert.equal(p.daysLeft, 60);
    assert.equal(p.dueOn, "2026-12-06");
    assert.equal(p.templateKey, TEMPLATES.promo_end);
    assert.equal(
      p.body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). " +
      "You still owe $5,400.00. Pay about $2,700 a month for the next 2 months to clear it in time."
    );
    assert.equal(p.detail.payments_left, 2);
    assert.equal(p.detail.monthly_cents, 270000);
  });

  test("30 days out: one payment left, so it says pay all of it", () => {
    const p = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-11-06" });
    assert.equal(p.threshold, 30);
    assert.equal(p.body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 30 days). " +
      "You still owe $5,400.00. Pay all of it before then to clear it in time.");
  });

  test("7 days out", () => {
    const p = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-11-29" });
    assert.equal(p.threshold, 7);
    assert.match(p.body, /\(in 7 days\)\. You still owe \$5,400\.00\. Pay all of it before then/);
  });

  test("a missed run is caught on the next two days, and the text says the TRUE days left", () => {
    const p = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-10-09" });
    assert.equal(p.threshold, 60);
    assert.equal(p.daysLeft, 58);
    assert.match(p.body, /\(in 58 days\)/);
    assert.equal(p.key, planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-10-07" }).key);
  });

  test("a date typed in with 45 days left skips the 60 alert — it is already past", () => {
    const p = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-10-22" });
    assert.equal(p.alert, false);
    assert.equal(p.reason, "not_in_window");
    assert.equal(p.daysLeft, 45);
  });

  test("one key per card, end date and threshold; a corrected end date starts over", () => {
    const k = (endsOn, today) => planPromoEnd(AMEX, promoEnding(endsOn), { today }).key;
    assert.equal(k("2026-12-06", "2026-10-07"), "fpa:promo:acct-amex:2026-12-06:60");
    assert.equal(k("2026-12-06", "2026-11-06"), "fpa:promo:acct-amex:2026-12-06:30");
    assert.equal(k("2026-12-06", "2026-11-29"), "fpa:promo:acct-amex:2026-12-06:7");
    assert.equal(k("2026-12-20", "2026-10-21"), "fpa:promo:acct-amex:2026-12-20:60");
  });

  test("an ended promo, no promo, a paid-off card, a bad date: nothing, with a reason", () => {
    assert.equal(planPromoEnd(AMEX, promoEnding("2026-10-01"), { today: "2026-10-07" }).reason, "promo_ended");
    assert.equal(planPromoEnd(AMEX, null, { today: "2026-10-07" }).reason, "no_promo");
    assert.equal(planPromoEnd(AMEX, { promo_ends_on: null }, { today: "2026-10-07" }).reason, "no_promo");
    assert.equal(planPromoEnd({ ...AMEX, balance_cents: 0 }, promoEnding("2026-12-06"), { today: "2026-10-07" }).reason, "nothing_owed");
    assert.equal(planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "yesterday" }).reason, "bad_today");
    assert.equal(planPromoEnd(null, promoEnding("2026-12-06"), { today: "2026-10-07" }).reason, "no_card");
  });

  test("a balance we do not know is not made up: the date still goes, and it says where to look", () => {
    const p = planPromoEnd({ ...AMEX, balance_cents: null }, promoEnding("2026-12-06"), { today: "2026-10-07" });
    assert.equal(p.alert, true);
    assert.equal(p.body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). Open your Money page to see what you still owe.");
    assert.equal(p.detail.monthly_cents, null);
  });

  test("a date read from a date column or a full timestamp reads the same", () => {
    const a = planPromoEnd(AMEX, promoEnding("2026-12-06"), { today: "2026-10-07" });
    const b = planPromoEnd(AMEX, promoEnding(new Date("2026-12-06T00:00:00.000Z")), { today: "2026-10-07" });
    assert.equal(a.key, b.key);
  });
});

describe("the payoff line is arithmetic on stored numbers", () => {
  test("payments left is the days left over 30, rounded, never below one", () => {
    assert.deepEqual([60, 58, 45, 44, 30, 28, 7, 1, 0].map(paymentsLeft), [2, 2, 2, 1, 1, 1, 1, 1, 1]);
  });

  test("the monthly amount rounds UP so the plan clears the balance", () => {
    const plan = promoPayoff({ balanceCents: 100001, daysLeft: 60 });
    assert.deepEqual(plan, { payments: 2, monthly_cents: 50001, total_cents: 100001 });
    assert.ok(plan.monthly_cents * plan.payments >= plan.total_cents);
  });

  test("no balance, a zero balance, an overpaid card: no plan", () => {
    for (const b of [null, undefined, 0, -100]) assert.equal(promoPayoff({ balanceCents: b, daysLeft: 60 }), null);
  });

  test("the sentence rounds the amount up to a whole dollar: $500.01 a month reads as about $501", () => {
    assert.match(payoffDetail(100001, 60, 0), /Pay about \$501 a month for the next 2 months to clear it in time\./);
    assert.match(payoffDetail(100001, 60, 0), /You still owe \$1,000\.01\./);
    // two payments of the rounded-up figure always cover the balance
    assert.ok(501 * 2 * 100 >= 100001);
  });
});

/* Codex design review (binding, 2026-11-07): a promo that charges interest, or whose
   rate is not on file, is never told that a no-interest amount clears it. */
describe("the payoff at the promo rate", () => {
  /* What is left after paying `monthly` each month, with APR ÷ 12 added before each payment. */
  const leftAfter = (balance, aprPct, monthly, payments) => {
    let left = balance;
    for (let k = 0; k < payments; k++) left = left * (1 + aprPct / 100 / 12) - monthly;
    return left;
  };

  test("0% is the even split; 9.99% is the level payment that really clears it; a cent less does not", () => {
    assert.deepEqual(payoffAtRate({ balanceCents: 120000, daysLeft: 120, aprPct: 0 }),
      { payments: 4, monthly_cents: 30000, total_cents: 120000, monthly_is_floor: false });
    const at = payoffAtRate({ balanceCents: 120000, daysLeft: 120, aprPct: 9.99 });
    assert.deepEqual(at, { payments: 4, monthly_cents: 30627, total_cents: 122508, monthly_is_floor: false });
    assert.ok(leftAfter(120000, 9.99, at.monthly_cents, 4) <= 0.0001, "it clears by the last payment");
    assert.ok(leftAfter(120000, 9.99, at.monthly_cents - 1, 4) > 0, "a cent less does not");
    assert.ok(leftAfter(120000, 9.99, 30000, 4) > 0, "the no-interest split leaves a balance at 9.99%");
    assert.equal(payoffAtRate({ balanceCents: 120000, daysLeft: 20, aprPct: 9.99 }).monthly_cents, 120999, "one payment: one month's interest, to the cent");
    assert.equal(promoPct("0.09990"), 9.99);
  });

  test("no rate on file: the even split is only the least it can be", () => {
    assert.deepEqual(payoffAtRate({ balanceCents: 120000, daysLeft: 120, aprPct: null }),
      { payments: 4, monthly_cents: 30000, total_cents: 120000, monthly_is_floor: true });
    assert.equal(payoffAtRate({ balanceCents: 0, daysLeft: 120, aprPct: 9.99 }), null, "nothing owed, no plan");
  });

  test("the text: a 9.99% promo says the amount with interest; no rate says at least, and never that it clears", () => {
    const rated = planPromoEnd(AMEX, promoEnding("2026-12-06", { promo_apr: "0.09990" }), { today: "2026-10-07" });
    const plan = payoffAtRate({ balanceCents: 540000, daysLeft: 60, aprPct: 9.99 });
    assert.equal(rated.detail.monthly_cents, plan.monthly_cents);
    assert.ok(plan.monthly_cents > 270000, "more than the no-interest $2,700");
    assert.equal(rated.body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). " +
      `You still owe $5,400.00. Pay about $${Math.ceil(plan.monthly_cents / 100).toLocaleString("en-US")} a month for the next 2 months to clear it in time.`);
    assert.doesNotMatch(rated.body, /\$2,700/);

    const none = planPromoEnd(AMEX, promoEnding("2026-12-06", { promo_apr: null }), { today: "2026-10-07" });
    assert.equal(none.body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). " +
      "You still owe $5,400.00. Pay at least $2,700 a month for the next 2 months. Rate not on file.");
    assert.equal(none.detail.monthly_is_floor, true);
    const last = planPromoEnd(AMEX, promoEnding("2026-12-06", { promo_apr: null }), { today: "2026-11-06" });
    assert.match(last.body, /You still owe \$5,400\.00\. Pay all of it before then\. Rate not on file\.$/);
    for (const p of [none, last]) assert.doesNotMatch(p.body, /to clear/);
    assert.match(payoffDetail(100001, 60), /Pay at least \$501 a month for the next 2 months\. Rate not on file\./, "no rate given means not on file");
  });
});

describe("nextPromoAlert — what the screen shows as 'next text'", () => {
  test("the first threshold whose day has not passed", () => {
    assert.deepEqual(nextPromoAlert("2026-12-06", "2026-10-07"), { threshold: 60, on: "2026-10-07" });
    assert.deepEqual(nextPromoAlert("2026-12-06", "2026-10-08"), { threshold: 30, on: "2026-11-06" });
    assert.deepEqual(nextPromoAlert("2026-12-06", "2026-11-07"), { threshold: 7, on: "2026-11-29" });
    assert.equal(nextPromoAlert("2026-12-06", "2026-11-30"), null);
    assert.equal(nextPromoAlert("2026-12-06", "bad"), null);
  });
});

describe("readPromoInput — a promo typed in by a client or staff", () => {
  const today = "2026-10-07";
  test("a date and a rate", () => {
    assert.deepEqual(readPromoInput({ ends_on: "2026-12-06", apr_pct: 0 }, { today }), { endsOn: "2026-12-06", aprFraction: 0 });
    assert.deepEqual(readPromoInput({ ends_on: " 2026-12-06 ", apr_pct: "2.99%" }, { today }), { endsOn: "2026-12-06", aprFraction: 0.0299 });
  });

  test("the rate is ALWAYS a percent: 0.5 is half a percent, not fifty", () => {
    assert.equal(readPromoInput({ ends_on: "2026-12-06", apr_pct: 0.5 }, { today }).aprFraction, 0.005);
    assert.equal(readPromoInput({ ends_on: "2026-12-06", apr_pct: 100 }, { today }).aprFraction, 1);
  });

  test("the rate is optional", () => {
    assert.equal(readPromoInput({ ends_on: "2026-12-06" }, { today }).aprFraction, null);
    assert.equal(readPromoInput({ ends_on: "2026-12-06", apr_pct: "" }, { today }).aprFraction, null);
  });

  test("an empty or null date clears the promo", () => {
    for (const ends_on of [null, undefined, "", "  "]) {
      assert.deepEqual(readPromoInput({ ends_on, apr_pct: 3 }, { today }), { endsOn: null, aprFraction: null });
    }
  });

  test("today is allowed; the past, a fake date and a five-year typo are refused with the field named", () => {
    assert.equal(readPromoInput({ ends_on: today }, { today }).endsOn, today);
    const refused = (body) => assert.throws(() => readPromoInput(body, { today }), (e) => e instanceof PromoInputError && e.code === "invalid_input");
    refused({ ends_on: "2026-10-06" });
    refused({ ends_on: "2026-02-30" });
    refused({ ends_on: "12/06/2026" });
    refused({ ends_on: "2032-12-06" });
    refused({ ends_on: "2026-12-06", apr_pct: -1 });
    refused({ ends_on: "2026-12-06", apr_pct: 101 });
    refused({ ends_on: "2026-12-06", apr_pct: "abc" });
    try { readPromoInput({ ends_on: "2026-02-30" }, { today }); } catch (e) { assert.equal(e.field, "ends_on"); }
    try { readPromoInput({ ends_on: "2026-12-06", apr_pct: 500 }, { today }); } catch (e) { assert.equal(e.field, "apr_pct"); }
  });
});
