// Card and loan due dates as plan pins. Pure: buildDuePins() gets rows shaped
// like the FinanceOS test client's real ones (read only, 2026-10-07): two Plaid
// cards with a reported next due date, a manual SBA loan due the 1st, and the
// closed copies of the cards a re-link left behind.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildDuePins, monthsBetween, ordinal, EXACT_WINS_DAYS, name } from "./dues.mjs";

const AMEX = {
  id: "amex", name: "Business Amex", mask: "4404", account_type: "credit",
  current_balance_cents: "540000", credit_limit_cents: "2500000",
  entity_id: "biz", closed_at: null, institution_name: "First Platypus Bank"
};
const AMEX_CYCLE = {
  bank_account_id: "amex", payment_due_day: 15, minimum_payment_cents: 13500,
  last_statement_balance_cents: 481700, raw: { next_payment_due_date: "2026-10-15" }
};
const VISA = { ...AMEX, id: "visa", name: "Personal Visa", mask: "3303", entity_id: "me" };
const VISA_CYCLE = {
  bank_account_id: "visa", payment_due_day: 25, minimum_payment_cents: 4000,
  last_statement_balance_cents: 113420, raw: { next_payment_due_date: "2026-10-25" }
};
const LOAN = {
  id: "sba", name: "SBA Loan", mask: null, account_type: "loan",
  current_balance_cents: "4800000", entity_id: "biz", closed_at: null, institution_name: null
};
const LOAN_CYCLE = { bank_account_id: "sba", payment_due_day: 1, minimum_payment_cents: 105000, raw: {} };
const CLOSED = { ...AMEX, id: "old-amex", closed_at: "2026-10-06T23:06:52.822Z" };
const CLOSED_CYCLE = { ...AMEX_CYCLE, bank_account_id: "old-amex", payment_due_day: 6, raw: { next_payment_due_date: "2026-11-06" } };
const CHECKING = { id: "chk", name: "Business Checking", account_type: "depository", closed_at: null };

const ROWS = {
  accounts: [CHECKING, AMEX, VISA, LOAN, CLOSED],
  cycles: [AMEX_CYCLE, VISA_CYCLE, LOAN_CYCLE, CLOSED_CYCLE],
  liabilities: []
};
const pick = (pins) => pins.map((p) => `${p.date} ${p.title} ${p.amount_cents}`);

describe("buildDuePins — the test client's months", () => {
  test("October: the reported card dates with their minimums, the loan from its due day", () => {
    const pins = buildDuePins({ ...ROWS, from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(pick(pins).sort(), [
      "2026-10-01 Pay SBA Loan 105000",
      "2026-10-15 Pay Business Amex 13500",
      "2026-10-25 Pay Personal Visa 4000"
    ]);
    const amex = pins.find((p) => p.title === "Pay Business Amex");
    assert.equal(amex.detail, "The due date on your latest statement.");
    assert.equal(amex.bank, "First Platypus Bank");
    assert.equal(amex.container_id, "biz");
    assert.equal(amex.id, "due:amex:2026-10-15");
    const loan = pins.find((p) => p.title === "Pay SBA Loan");
    assert.equal(loan.detail, "Worked out from the due day on file (the 1st).");
    assert.equal(loan.bank, null);
  });

  test("November: card dates worked out from the due day have no amount yet; the loan keeps its payment", () => {
    const pins = buildDuePins({ ...ROWS, from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(pick(pins).sort(), [
      "2026-11-01 Pay SBA Loan 105000",
      "2026-11-15 Pay Business Amex null",
      "2026-11-25 Pay Personal Visa null"
    ]);
    assert.equal(pins.find((p) => p.title === "Pay Business Amex").detail,
      "Worked out from the due day on file (the 15th). The amount shows once that statement is out.");
  });

  test("closed accounts and bank accounts are never pinned", () => {
    const pins = buildDuePins({ ...ROWS, from: "2026-10-01", to: "2026-12-31" });
    assert.ok(!pins.some((p) => p.id.includes("old-amex")), "a closed card is left out, as on the Overview");
    assert.ok(!pins.some((p) => p.id.includes("chk")));
  });

  test("every due pin is planned, kind due, from this source, and cannot be marked", () => {
    for (const p of buildDuePins({ ...ROWS, from: "2026-09-01", to: "2026-12-31" })) {
      assert.equal(p.status, "planned", "a due date never claims paid or missed");
      assert.equal(p.kind, "due");
      assert.equal(p.source, name);
      assert.deepEqual(p.can_mark, []);
      assert.match(p.id, /^due:[a-z-]+:\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("buildDuePins — where a date comes from", () => {
  test("a worked-out date close to the reported one is the same payment", () => {
    /* A bank moved the Sept 30 due date to Oct 1. Sept 30 is not a second payment. */
    const cycle = { bank_account_id: "amex", payment_due_day: 30, minimum_payment_cents: 5000, raw: { next_payment_due_date: "2026-10-01" } };
    const pins = buildDuePins({ accounts: [AMEX], cycles: [cycle], from: "2026-09-01", to: "2026-10-31" });
    assert.deepEqual(pick(pins).sort(), ["2026-10-01 Pay Business Amex 5000", "2026-10-30 Pay Business Amex null"]);
    assert.equal(EXACT_WINS_DAYS, 10);
  });

  test("a card_liabilities due date and minimum beat the cycle row's", () => {
    const liab = { bank_account_id: "amex", payment_due_date: "2026-10-14", minimum_payment_cents: "15000" };
    const pins = buildDuePins({ accounts: [AMEX], cycles: [AMEX_CYCLE], liabilities: [liab], from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(pick(pins), ["2026-10-14 Pay Business Amex 15000"]);
  });

  test("no reported date and no due day: no pin — a date is never guessed", () => {
    const sample = { ...AMEX, id: "ink", name: "Sample Chase Ink" };
    assert.deepEqual(buildDuePins({ accounts: [sample], cycles: [], from: "2026-10-01", to: "2026-10-31" }), []);
    const noDay = { bank_account_id: "ink", payment_due_day: null, raw: {} };
    assert.deepEqual(buildDuePins({ accounts: [sample], cycles: [noDay], from: "2026-10-01", to: "2026-10-31" }), []);
  });

  test("nothing due on the current statement: no pin on that date", () => {
    const zeroMin = { ...AMEX_CYCLE, minimum_payment_cents: 0 };
    assert.deepEqual(buildDuePins({ accounts: [AMEX], cycles: [zeroMin], from: "2026-10-01", to: "2026-10-31" }), []);
    const paidStatement = { ...AMEX_CYCLE, last_statement_balance_cents: 0 };
    assert.deepEqual(buildDuePins({ accounts: [AMEX], cycles: [paidStatement], from: "2026-10-01", to: "2026-10-31" }), []);
  });

  test("a paid-off loan has no dates; an unknown loan balance still does", () => {
    const paidOff = { ...LOAN, current_balance_cents: "0" };
    assert.deepEqual(buildDuePins({ accounts: [paidOff], cycles: [LOAN_CYCLE], from: "2026-10-01", to: "2026-10-31" }), []);
    const unknown = { ...LOAN, current_balance_cents: null };
    assert.equal(buildDuePins({ accounts: [unknown], cycles: [LOAN_CYCLE], from: "2026-10-01", to: "2026-10-31" }).length, 1);
  });

  test("a loan's unknown monthly payment stays null, never 0", () => {
    const cycle = { ...LOAN_CYCLE, minimum_payment_cents: null };
    const [p] = buildDuePins({ accounts: [LOAN], cycles: [cycle], from: "2026-10-01", to: "2026-10-31" });
    assert.equal(p.amount_cents, null);
  });

  test("the month-end rule: a due day of 31 falls on the last day of February", () => {
    const cycle = { bank_account_id: "sba", payment_due_day: 31, minimum_payment_cents: 1000, raw: {} };
    const feb27 = buildDuePins({ accounts: [LOAN], cycles: [cycle], from: "2027-02-01", to: "2027-02-28" });
    const feb28 = buildDuePins({ accounts: [LOAN], cycles: [cycle], from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(feb27.map((p) => p.date), ["2027-02-28"]);
    assert.deepEqual(feb28.map((p) => p.date), ["2028-02-29"]);
  });

  test("a card with no name is called by its last four", () => {
    const [p] = buildDuePins({ accounts: [{ ...AMEX, name: "" }], cycles: [AMEX_CYCLE], from: "2026-10-01", to: "2026-10-31" });
    assert.equal(p.title, "Pay card ending 4404");
  });

  test("a bad window gives nothing rather than a guess", () => {
    assert.deepEqual(buildDuePins({ ...ROWS, from: "2026-10", to: "2026-10-31" }), []);
  });
});

describe("helpers", () => {
  test("ordinal", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal),
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });

  test("monthsBetween crosses a year", () => {
    assert.deepEqual(monthsBetween("2026-11-20", "2027-01-05"), [
      { year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }
    ]);
  });
});
