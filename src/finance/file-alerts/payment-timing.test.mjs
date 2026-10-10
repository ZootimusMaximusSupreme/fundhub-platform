// Alert 1 — pay a card down before its statement closes. Pure: no database, no clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planPaymentTiming, balanceDetail } from "./payment-timing.mjs";
import { readPayBeforeCloseDays, PAY_BEFORE_CLOSE_DAYS_DEFAULT, TEMPLATES } from "./common.mjs";

const AMEX = { account_id: "acct-amex", name: "Business Amex", mask: "4404", balance_cents: 540000, limit_cents: 2500000 };
const closesOn15 = { statement_close_day: 15 };

describe("planPaymentTiming — the window", () => {
  test("three days out: the text is due, in the owner's words, with the day it reports", () => {
    const p = planPaymentTiming(AMEX, closesOn15, { today: "2026-10-12" });
    assert.equal(p.alert, true);
    assert.equal(p.kind, "payment_timing");
    assert.equal(p.dueOn, "2026-10-15");
    assert.equal(p.daysAway, 3);
    assert.equal(p.threshold, 3);
    assert.equal(p.templateKey, TEMPLATES.payment_timing);
    assert.equal(
      p.body,
      "Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15. That is the day it reports to the bureaus. " +
      "Balance now $5,400.00 (22% of your limit). Pay about $2,900 to get under 10%."
    );
  });

  test("four days out is too early; and the day after the close waits a whole cycle", () => {
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "2026-10-11" }).reason, "not_yet");
    const after = planPaymentTiming(AMEX, closesOn15, { today: "2026-10-16" });
    assert.equal(after.alert, false);
    assert.equal(after.reason, "not_yet");
    assert.equal(after.closesOn, "2026-11-15");
  });

  test("on the close day itself it still goes, worded 'today'", () => {
    const p = planPaymentTiming(AMEX, closesOn15, { today: "2026-10-15" });
    assert.equal(p.alert, true);
    assert.equal(p.daysAway, 0);
    assert.match(p.body, /pay your Business Amex ending 4404 down today \(Oct 15\)\. That is the day it reports/);
  });

  test("the key is the card and the close date — the same on every day of the window", () => {
    const keys = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]
      .map((d) => planPaymentTiming(AMEX, closesOn15, { today: d }).key);
    assert.deepEqual(new Set(keys), new Set(["fpa:pay:acct-amex:2026-10-15"]));
    // and the next cycle is a new key
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "2026-11-13" }).key, "fpa:pay:acct-amex:2026-11-15");
  });

  test("a close day of 31 lands on the last day of a short month (the one month-end rule)", () => {
    const p = planPaymentTiming(AMEX, { statement_close_day: 31 }, { today: "2027-02-27" });
    assert.equal(p.alert, true);
    assert.equal(p.dueOn, "2027-02-28");
    assert.equal(p.daysAway, 1);
  });

  test("the lead time is a setting, not a fact: 5 days ahead when asked", () => {
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "2026-10-10", daysBefore: 5 }).alert, true);
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "2026-10-09", daysBefore: 5 }).alert, false);
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "2026-10-10", daysBefore: 5 }).threshold, 5);
  });
});

describe("planPaymentTiming — what is not known stays unknown", () => {
  test("no close day on file: nothing goes, and the reason says why", () => {
    for (const cycle of [null, {}, { statement_close_day: null }]) {
      const p = planPaymentTiming(AMEX, cycle, { today: "2026-10-12" });
      assert.equal(p.alert, false);
      assert.equal(p.reason, "no_statement_close_day");
    }
  });

  test("a known zero balance has nothing to pay down; an unknown balance still gets the day", () => {
    assert.equal(planPaymentTiming({ ...AMEX, balance_cents: 0 }, closesOn15, { today: "2026-10-12" }).reason, "no_balance");
    assert.equal(planPaymentTiming({ ...AMEX, balance_cents: -500 }, closesOn15, { today: "2026-10-12" }).reason, "no_balance");
    const unknown = planPaymentTiming({ ...AMEX, balance_cents: null }, closesOn15, { today: "2026-10-12" });
    assert.equal(unknown.alert, true);
    assert.equal(unknown.body, "Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15. That is the day it reports to the bureaus.");
    assert.equal(unknown.detail.balance_cents, null);
  });

  test("a bad date or no card is refused, never guessed", () => {
    assert.equal(planPaymentTiming(AMEX, closesOn15, { today: "soon" }).reason, "bad_today");
    assert.equal(planPaymentTiming(null, closesOn15, { today: "2026-10-12" }).reason, "no_card");
  });

  test("two cards with one name are told apart by their last four", () => {
    const a = planPaymentTiming({ ...AMEX, account_id: "a", mask: "1111" }, closesOn15, { today: "2026-10-12" });
    const b = planPaymentTiming({ ...AMEX, account_id: "b", mask: "2222" }, closesOn15, { today: "2026-10-12" });
    assert.notEqual(a.tags.card, b.tags.card);
    assert.notEqual(a.key, b.key);
  });
});

describe("balanceDetail — the balance sentence is arithmetic on stored numbers", () => {
  test("above 10% of the limit: says how much brings it under", () => {
    const d = balanceDetail(540000, 2500000);
    assert.equal(d.pct, 22);
    assert.equal(d.targetCents, 250000);
    assert.equal(d.payToTargetCents, 290000);
    assert.equal(d.text, " Balance now $5,400.00 (22% of your limit). Pay about $2,900 to get under 10%.");
  });

  test("the 'pay about' figure rounds UP to the dollar, never down", () => {
    // 1,320.40 on an $8,000 limit: target 800.00, pay 520.40 -> "about $521"
    assert.match(balanceDetail(132040, 800000).text, /Pay about \$521 to get under 10%\./);
  });

  test("already under 10% says so instead of asking for money", () => {
    assert.equal(balanceDetail(150000, 2500000).text, " Balance now $1,500.00 (6% of your limit), already under 10%.");
  });

  test("no limit on file: the balance and nothing more; no balance: nothing at all", () => {
    assert.equal(balanceDetail(540000, null).text, " Balance now $5,400.00.");
    assert.equal(balanceDetail(540000, 0).text, " Balance now $5,400.00.");
    assert.equal(balanceDetail(null, 2500000).text, "");
  });
});

describe("readPayBeforeCloseDays — the lead time setting", () => {
  test("defaults to 3; a whole number from 1 to 10 is honoured; anything else falls back, never crashes", () => {
    assert.equal(PAY_BEFORE_CLOSE_DAYS_DEFAULT, 3);
    assert.equal(readPayBeforeCloseDays({}), 3);
    assert.equal(readPayBeforeCloseDays(undefined), 3);
    assert.equal(readPayBeforeCloseDays({ FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: "5" }), 5);
    for (const bad of ["0", "11", "-2", "2.5", "soon", ""]) {
      assert.equal(readPayBeforeCloseDays({ FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: bad }), 3, bad);
    }
  });
});
