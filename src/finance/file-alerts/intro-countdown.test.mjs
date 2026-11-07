// Intro rate countdown — introCountdown and introCountdowns. Pure. Fictional cards.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { introCountdown, introCountdowns, promoPct, payoffAtRate } from "./intro-countdown.mjs";
import { promoPayoff } from "./promo.mjs";

/* What is left after paying `monthly` each month for `payments` months, with APR ÷ 12
   added to the balance before each payment — the way a card charges interest. */
function leftAfter(balanceCents, aprPct, monthly, payments) {
  let left = balanceCents;
  for (let k = 0; k < payments; k++) left = left * (1 + aprPct / 100 / 12) - monthly;
  return left;
}

const TODAY = "2026-11-06";
const CARD = { account_id: "c1", name: "Sample Intro Card", mask: "1111", kind: "business", balance_cents: 300000 };
const promo = (ends, apr = 0) => ({ promo_ends_on: ends, promo_apr: apr, promo_source: "client" });

describe("introCountdown", () => {
  test("days left, payments left and the monthly payoff are the promo alert's own numbers", () => {
    const r = introCountdown(CARD, promo("2027-01-05"), { today: TODAY });
    assert.equal(r.days_left, 60);
    const plan = promoPayoff({ balanceCents: 300000, daysLeft: 60 });
    assert.equal(r.payments_left, plan.payments);
    assert.equal(r.monthly_cents, plan.monthly_cents);
    assert.equal(r.payments_left, 2);
    assert.equal(r.monthly_cents, 150000);
    assert.equal(r.zero_rate, true);
    assert.equal(r.ended, false);
    assert.deepEqual(r.next_text, { threshold: 60, on: TODAY });
  });

  test("a rate that is not 0% is not called 0%, and no rate given is unknown", () => {
    assert.equal(introCountdown(CARD, promo("2027-01-05", 0.0299), { today: TODAY }).zero_rate, false);
    assert.equal(introCountdown(CARD, promo("2027-01-05", 0.0299), { today: TODAY }).apr_pct, 2.99);
    const noRate = introCountdown(CARD, { promo_ends_on: "2027-01-05", promo_apr: null }, { today: TODAY });
    assert.equal(noRate.zero_rate, null);
    assert.equal(noRate.apr_pct, null);
  });

  test("a 9.99% promo: the monthly amount carries that rate's interest and really clears the balance; the no-interest split would not", () => {
    // Codex design review (binding): $1,200 at 9.99% with 120 days left was told "$300 a month clears it".
    const r = introCountdown({ ...CARD, balance_cents: 120000 }, promo("2027-03-06", "0.09990"), { today: TODAY });
    assert.deepEqual([r.apr_pct, r.payments_left, r.monthly_cents, r.monthly_is_floor], [9.99, 4, 30627, false]);
    assert.ok(leftAfter(120000, 9.99, r.monthly_cents, 4) <= 0.0001, "the amount shown clears it by the last payment");
    assert.ok(leftAfter(120000, 9.99, r.monthly_cents - 1, 4) > 0, "a cent less does not: it is the least that clears it");
    const plain = promoPayoff({ balanceCents: 120000, daysLeft: 120 }).monthly_cents;
    assert.equal(plain, 30000);
    assert.ok(leftAfter(120000, 9.99, plain, 4) > 0, "the no-interest split leaves a balance at 9.99%");
    // One payment left: the balance plus one month's interest, to the cent.
    assert.equal(payoffAtRate({ balanceCents: 120000, daysLeft: 20, aprPct: 9.99 }).monthly_cents, 120999);
  });

  test("0% is the even split; no rate on file is only the least it can be, never a payoff", () => {
    assert.deepEqual(payoffAtRate({ balanceCents: 120000, daysLeft: 120, aprPct: 0 }), { payments: 4, monthly_cents: 30000, total_cents: 120000, monthly_is_floor: false });
    const none = introCountdown({ ...CARD, balance_cents: 120000 }, { promo_ends_on: "2027-03-06", promo_apr: null }, { today: TODAY });
    assert.deepEqual([none.apr_pct, none.monthly_cents, none.monthly_is_floor], [null, 30000, true]);
    assert.equal(introCountdown(CARD, promo("2027-01-05"), { today: TODAY }).monthly_is_floor, false, "0% is a known rate");
    assert.equal(payoffAtRate({ balanceCents: 0, daysLeft: 120, aprPct: 9.99 }), null, "nothing owed, no plan");
  });

  test("no balance on file means no monthly amount — never $0", () => {
    const r = introCountdown({ ...CARD, balance_cents: null }, promo("2027-01-05"), { today: TODAY });
    assert.equal(r.monthly_cents, null);
    assert.equal(r.balance_cents, null);
  });

  test("an ended promo has no payoff and no next text", () => {
    const r = introCountdown(CARD, promo("2026-10-01"), { today: TODAY });
    assert.equal(r.ended, true);
    assert.equal(r.monthly_cents, null);
    assert.equal(r.next_text, null);
  });

  test("no promo on file is no countdown", () => {
    assert.equal(introCountdown(CARD, { promo_ends_on: null }, { today: TODAY }), null);
    assert.equal(introCountdown(CARD, null, { today: TODAY }), null);
  });

  test("promoPct keeps the stored rate to the thousandth", () => {
    assert.equal(promoPct("0.02990"), 2.99);
    assert.equal(promoPct(null), null);
  });
});

test("introCountdowns: running promos soonest first, ended ones last", () => {
  const cards = [{ ...CARD, account_id: "far" }, { ...CARD, account_id: "ended" }, { ...CARD, account_id: "soon" }, { ...CARD, account_id: "none" }];
  const cycles = { far: promo("2027-06-01"), ended: promo("2026-09-01"), soon: promo("2026-12-01"), none: null };
  const rows = introCountdowns(cards, (c) => cycles[c.account_id], { today: TODAY });
  assert.deepEqual(rows.map((r) => r.account_id), ["soon", "far", "ended"]);
});
