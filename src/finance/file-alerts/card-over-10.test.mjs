// Card rule after funding — planCardOver10 and cardRule. Pure: no database, no clock.
// Every number is fictional ("Sample" cards on a made-up file).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cardRule, planCardOver10, overTenBody } from "./card-over-10.mjs";
import { lockScreenSafe } from "./bundle-common.mjs";

const TODAY = "2026-11-06";
const CARD = { account_id: "acct-a", name: "Sample Card A", mask: "4404", kind: "personal", balance_cents: 240000, limit_cents: 800000 };
const CLOSES_16 = { statement_close_day: 16 };
const opts = (extra = {}) => ({ today: TODAY, funded: true, payBeforeCloseDays: 3, payBeforeCloseOn: true, ...extra });

describe("cardRule — where a card stands against 10%", () => {
  test("over 10%: the target is 10% of the limit and the pay-down is the rest", () => {
    const r = cardRule(CARD, CLOSES_16, { today: TODAY });
    assert.equal(r.state, "over");
    assert.equal(r.target_cents, 80000);
    assert.equal(r.pay_to_target_cents, 160000);
    assert.equal(r.used_pct, 30);
    assert.equal(r.closes_on, "2026-11-16");
    assert.equal(r.days_to_close, 10);
  });

  test("exactly 10% is under, not over", () => {
    const r = cardRule({ ...CARD, balance_cents: 80000 }, CLOSES_16, { today: TODAY });
    assert.equal(r.state, "under");
    assert.equal(r.pay_to_target_cents, 0);
  });

  test("no limit or no balance is unknown, never a zero", () => {
    const noLimit = cardRule({ ...CARD, limit_cents: null }, CLOSES_16, { today: TODAY });
    assert.equal(noLimit.state, "unknown");
    assert.equal(noLimit.unknown_reason, "no_limit");
    assert.equal(noLimit.target_cents, null);
    const noBal = cardRule({ ...CARD, balance_cents: null }, CLOSES_16, { today: TODAY });
    assert.equal(noBal.unknown_reason, "no_balance");
    assert.equal(noBal.pay_to_target_cents, null);
  });
});

describe("planCardOver10 — the text", () => {
  test("a funded client with a card over 10% gets one text keyed on the card and the close", () => {
    const p = planCardOver10(CARD, CLOSES_16, opts());
    assert.equal(p.alert, true);
    assert.equal(p.kind, "card_over_10");
    assert.equal(p.key, "fpa:over10:acct-a:2026-11-16");
    assert.equal(p.templateKey, "SMS-FILE-PROTECT-CARD-OVER-10");
    assert.equal(p.dueOn, "2026-11-16");
    assert.equal(p.threshold, 10);
    assert.deepEqual(p.tags, { when: "on Nov 16" });
    assert.equal(p.body, overTenBody("on Nov 16"));
    assert.equal(p.detail.pay_to_target_cents, 160000);
  });

  test("the text never holds an amount, the card name or its digits", () => {
    const p = planCardOver10(CARD, CLOSES_16, opts());
    assert.ok(lockScreenSafe(p.body));
    assert.doesNotMatch(p.body, /Sample|4404|\$|2,400|1,600/);
    // The name is kept for the screen and the logs.
    assert.equal(p.label, "Sample Card A ending 4404");
  });

  test("before funding there is no text", () => {
    assert.equal(planCardOver10(CARD, CLOSES_16, opts({ funded: false })).reason, "not_funded");
  });

  test("under 10% there is no text", () => {
    assert.equal(planCardOver10({ ...CARD, balance_cents: 50000 }, CLOSES_16, opts()).reason, "under_target");
  });

  test("inside the pay-before-close window that older text covers it", () => {
    const p = planCardOver10(CARD, { statement_close_day: 8 }, opts());
    assert.equal(p.alert, false);
    assert.equal(p.reason, "pay_before_close_text_covers_it");
  });

  test("with the pay-before-close text switched off, this one goes even on the close day", () => {
    const p = planCardOver10(CARD, { statement_close_day: 6 }, opts({ payBeforeCloseOn: false }));
    assert.equal(p.alert, true);
    assert.deepEqual(p.tags, { when: "today" });
    assert.equal(p.key, "fpa:over10:acct-a:2026-11-06");
  });

  test("a new card with no statement close day cannot be timed, and says why", () => {
    assert.equal(planCardOver10(CARD, null, opts()).reason, "no_statement_close_day");
  });

  test("a bad day or no card is refused, not guessed", () => {
    assert.equal(planCardOver10(CARD, CLOSES_16, opts({ today: "nope" })).reason, "bad_today");
    assert.equal(planCardOver10({}, CLOSES_16, opts()).reason, "no_card");
  });
});
