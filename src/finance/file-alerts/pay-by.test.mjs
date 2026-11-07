// Pay-by date per card — payBy and payByList. Pure. Fictional cards.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { payBy, payByList } from "./pay-by.mjs";

const TODAY = "2026-11-06";
const card = (extra = {}) => ({ account_id: "a1", name: "Sample Card", mask: "0001", kind: "personal", due_on: null, ...extra });

describe("payBy — two days before whichever comes first", () => {
  test("the statement closes first: pay by two days before the close", () => {
    const r = payBy(card({ due_on: "2026-12-10" }), { statement_close_day: 15 }, { today: TODAY });
    assert.equal(r.closes_on, "2026-11-15");
    assert.equal(r.pay_by_close_on, "2026-11-13");
    assert.equal(r.pay_by_due_on, "2026-12-08");
    assert.equal(r.pay_by_on, "2026-11-13");
    assert.equal(r.for, "statement_close");
    assert.equal(r.days_left, 7);
    assert.equal(r.tight, false);
  });

  test("the due date comes first: pay by two days before it is due", () => {
    const r = payBy(card({ due_on: "2026-11-12" }), { statement_close_day: 25 }, { today: TODAY });
    assert.equal(r.pay_by_on, "2026-11-10");
    assert.equal(r.for, "due_date");
  });

  test("both on one day says both", () => {
    const r = payBy(card({ due_on: "2026-11-20" }), { statement_close_day: 20 }, { today: TODAY });
    assert.equal(r.for, "both");
    assert.equal(r.pay_by_on, "2026-11-18");
  });

  test("with less than two days left it is today, and says it is tight — never a day already gone", () => {
    const r = payBy(card(), { statement_close_day: 7 }, { today: TODAY });
    assert.equal(r.pay_by_on, TODAY);
    assert.equal(r.tight, true);
    assert.equal(r.days_left, 0);
  });

  test("a due date already behind us is not the next one", () => {
    const r = payBy(card({ due_on: "2026-11-01" }), { statement_close_day: 20 }, { today: TODAY });
    assert.equal(r.due_on, null);
    assert.equal(r.for, "statement_close");
  });

  test("no close day and no due date: unknown, with the reason", () => {
    const r = payBy(card(), null, { today: TODAY });
    assert.equal(r.pay_by_on, null);
    assert.equal(r.for, null);
    assert.equal(r.unknown_reason, "no_close_or_due_date");
  });

  test("a card with only a due date still gets a day", () => {
    const r = payBy(card({ due_on: "2026-11-30" }), null, { today: TODAY });
    assert.equal(r.pay_by_on, "2026-11-28");
    assert.equal(r.for, "due_date");
  });
});

test("payByList: soonest first, cards with no date last", () => {
  const cards = [card({ account_id: "late", due_on: "2026-11-29" }), card({ account_id: "none" }), card({ account_id: "soon", due_on: "2026-11-09" })];
  const rows = payByList(cards, () => null, { today: TODAY });
  assert.deepEqual(rows.map((r) => r.account_id), ["soon", "late", "none"]);
});
