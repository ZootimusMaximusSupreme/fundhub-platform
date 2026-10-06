// Card due reminders — the pure planner. No db, no clock.
import { test, describe } from "node:test";
import assert from "node:assert";

import { planCardDue, dollars, shortDate, cardLabel } from "./card-due-reminders.mjs";

const ROW = {
  bank_account_id: "ba-1",
  name: "Business Amex",
  mask: "4404",
  minimum_payment_cents: 13500,
  last_statement_balance_cents: 540000,
  last_statement_date: "2026-09-26",
  raw: { next_payment_due_date: "2026-10-21", last_payment_date: "2026-09-20" }
};

describe("planCardDue", () => {
  test("3 days out, no payment since the statement → remind, with the owner's wording", () => {
    const p = planCardDue(ROW, { today: "2026-10-18" });
    assert.equal(p.remind, true);
    assert.equal(p.daysAway, 3);
    assert.equal(p.body, "Fundhub reminder: your Business Amex payment of $135.00 is due Oct 21.");
    assert.deepEqual(p.card, { name: "Business Amex", amount_phrase: " of $135.00", due_phrase: "Oct 21" });
    assert.equal(p.eventId, "card-due:ba-1:2026-10-21");
    assert.equal(p.surfaceAt, "2026-10-18T16:00:00.000Z");
  });

  test("on the due day it still reminds, worded 'today', with the SAME keys (one per due date)", () => {
    const early = planCardDue(ROW, { today: "2026-10-18" });
    const late = planCardDue(ROW, { today: "2026-10-21" });
    assert.equal(late.remind, true);
    assert.equal(late.card.due_phrase, "today, Oct 21");
    assert.equal(late.eventId, early.eventId);
    assert.equal(late.surfaceAt, early.surfaceAt);
  });

  test("more than 3 days out → not yet", () => {
    assert.equal(planCardDue(ROW, { today: "2026-10-17" }).reason, "not_yet");
  });

  test("due date passed → no reminder text", () => {
    assert.equal(planCardDue(ROW, { today: "2026-10-22" }).reason, "due_date_passed");
  });

  test("a payment on or after the statement date → no reminder", () => {
    const paid = { ...ROW, raw: { ...ROW.raw, last_payment_date: "2026-10-01" } };
    assert.equal(planCardDue(paid, { today: "2026-10-19" }).reason, "payment_recorded");
  });

  test("Plaid's statement date string wins over the db column", () => {
    const row = { ...ROW, last_statement_date: null, raw: { ...ROW.raw, last_payment_date: "2026-10-01", plaid: { last_statement_issue_date: "2026-09-26" } } };
    assert.equal(planCardDue(row, { today: "2026-10-19" }).reason, "payment_recorded");
  });

  test("minimum of 0 or a paid-off statement → nothing due", () => {
    assert.equal(planCardDue({ ...ROW, minimum_payment_cents: 0 }, { today: "2026-10-19" }).reason, "nothing_due");
    assert.equal(planCardDue({ ...ROW, last_statement_balance_cents: 0 }, { today: "2026-10-19" }).reason, "nothing_due");
  });

  test("unknown minimum → still reminds, with no made-up amount", () => {
    const p = planCardDue({ ...ROW, minimum_payment_cents: null }, { today: "2026-10-19" });
    assert.equal(p.remind, true);
    assert.equal(p.body, "Fundhub reminder: your Business Amex payment is due Oct 21.");
  });

  test("no Plaid due date → no reminder (never guessed from a day of month)", () => {
    assert.equal(planCardDue({ ...ROW, raw: {} }, { today: "2026-10-19" }).reason, "no_due_date");
  });

  test("pg bigint strings are read as numbers", () => {
    const p = planCardDue({ ...ROW, minimum_payment_cents: "135000" }, { today: "2026-10-19" });
    assert.equal(p.card.amount_phrase, " of $1,350.00");
  });
});

describe("helpers", () => {
  test("dollars formats integer cents with commas", () => {
    assert.equal(dollars(13500), "$135.00");
    assert.equal(dollars(123456789), "$1,234,567.89");
    assert.equal(dollars(5), "$0.05");
  });
  test("shortDate", () => {
    assert.equal(shortDate("2026-10-21"), "Oct 21");
    assert.equal(shortDate("2026-01-05"), "Jan 5");
  });
  test("cardLabel falls back to the last four, never a guessed lender", () => {
    assert.equal(cardLabel({ name: " Plaid Credit Card " }), "Plaid Credit Card");
    assert.equal(cardLabel({ name: null, mask: "3333" }), "card ending 3333");
    assert.equal(cardLabel({}), "credit card");
  });
});
