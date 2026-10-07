// Plan source "payoff" — the saved strategy's steps as timeline pins, in the
// wave 5 board's pin contract. Status is measured against the balance on file.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as payoff from "./payoff.mjs";
import { pinsFromPlan } from "./payoff.mjs";

const SAVED = {
  id: "plan-1",
  method: "avalanche",
  monthly_cents: 150000,
  inputs: [
    { id: "visa", name: "Personal Visa", type: "card", kind: "personal", container_id: "me", balance_cents: 132040, limit_cents: 800000 },
    { id: "amex", name: "Business Amex", type: "card", kind: "business", container_id: "biz", balance_cents: 540000, limit_cents: 2500000 },
    { id: "sba", name: "SBA Loan", type: "loan", kind: "business", container_id: "biz", balance_cents: 4800000, limit_cents: null }
  ],
  milestones: [
    { key: "visa:util10", kind: "pay_down", debt_id: "visa", name: "Personal Visa", target_pct: 10, target_cents: 80000, month: 2, date: "2026-12-07", earliest: false },
    { key: "visa:payoff", kind: "pay_down", debt_id: "visa", name: "Personal Visa", target_pct: null, target_cents: 0, month: 5, date: "2027-03-07", earliest: false },
    { key: "amex:util10", kind: "pay_down", debt_id: "amex", name: "Business Amex", target_pct: 10, target_cents: 250000, month: 12, date: "2027-10-07", earliest: false },
    { key: "overall:util10", kind: "checkpoint", debt_id: null, name: null, target_pct: 10, target_cents: null, month: 12, date: "2027-10-07", earliest: true },
    { key: "sba:payoff", kind: "pay_down", debt_id: "sba", name: "SBA Loan", target_pct: null, target_cents: 0, month: 39, date: "2030-01-07", earliest: true },
    { key: "debt_free", kind: "checkpoint", debt_id: null, name: null, target_pct: null, target_cents: 0, month: 39, date: "2030-01-07", earliest: true }
  ]
};

const balances = (o = {}) => new Map(Object.entries({
  visa: { type: "credit", balance_cents: 132040, limit_cents: 800000, closed: false },
  amex: { type: "credit", balance_cents: 540000, limit_cents: 2500000, closed: false },
  sba: { type: "loan", balance_cents: 4800000, limit_cents: null, closed: false },
  ...o
}));

describe("the plan-source contract", () => {
  test("exports a unique name and an async pins()", () => {
    assert.equal(payoff.name, "payoff");
    assert.equal(typeof payoff.pins, "function");
  });

  test("no saved plan → no pins", async () => {
    const db = { query: async () => ({ rows: [] }) };
    assert.deepEqual(await payoff.pins(db, { orgId: "o", clientId: "c", from: "2026-10-01", to: "2030-12-31" }), []);
  });

  test("every pin has the contract's fields, a stable id, and source 'payoff'", () => {
    const pins = pinsFromPlan(SAVED, balances(), { today: "2026-10-07" });
    assert.equal(pins.length, 6);
    for (const p of pins) {
      assert.deepEqual(Object.keys(p).sort(), ["amount_cents", "bank", "container_id", "date", "detail", "earliest", "id", "kind", "source", "status", "title"].sort());
      assert.match(p.id, /^payoff:plan-1:/);
      assert.equal(p.source, "payoff");
      assert.ok(["pay_down", "checkpoint"].includes(p.kind));
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.deepEqual(pins.map((p) => p.id), pinsFromPlan(SAVED, balances(), { today: "2026-10-07" }).map((p) => p.id), "same ids on every call");
  });
});

describe("words and amounts", () => {
  const pins = Object.fromEntries(pinsFromPlan(SAVED, balances(), { today: "2026-10-07" }).map((p) => [p.id.split(":").slice(2).join(":"), p]));

  test("'Pay X down to $Y' carries the target; 'Pay off X' carries no amount", () => {
    assert.equal(pins["visa:util10"].title, "Pay Personal Visa down to $800");
    assert.equal(pins["visa:util10"].amount_cents, 80000);
    assert.equal(pins["visa:util10"].container_id, "me");
    assert.match(pins["visa:util10"].detail, /under 10% of its limit/);
    assert.match(pins["visa:util10"].detail, /Your plan: \$1,500 a month toward debt, highest rate first\./);
    assert.equal(pins["visa:payoff"].title, "Pay off Personal Visa");
    assert.equal(pins["visa:payoff"].amount_cents, null);
    assert.equal(pins["overall:util10"].title, "Card use under 10% overall");
    assert.equal(pins["debt_free"].title, "Debt-free");
  });

  test("a date an unknown APR can move says so", () => {
    assert.match(pins["sba:payoff"].detail, /At the earliest: a rate \(APR\) is missing/);
    assert.doesNotMatch(pins["visa:payoff"].detail, /At the earliest/);
    assert.equal(pins["sba:payoff"].earliest, true);
  });
});

describe("status is measured, never assumed", () => {
  test("planned while the date is ahead and the target is not met", () => {
    const pins = pinsFromPlan(SAVED, balances(), { today: "2026-10-07" });
    assert.ok(pins.every((p) => p.status === "planned"));
  });

  test("done when the balance on file is at or under the target", () => {
    const pins = pinsFromPlan(SAVED, balances({ visa: { type: "credit", balance_cents: 79000, limit_cents: 800000, closed: false } }), { today: "2026-10-07" });
    const by = Object.fromEntries(pins.map((p) => [p.id, p.status]));
    assert.equal(by["payoff:plan-1:visa:util10"], "done");
    assert.equal(by["payoff:plan-1:visa:payoff"], "planned");
  });

  test("missed when the date has passed and the target is not met", () => {
    const pins = pinsFromPlan(SAVED, balances(), { today: "2027-01-01" });
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:visa:util10").status, "missed");
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:visa:payoff").status, "planned");
  });

  test("an unknown balance is never done", () => {
    const pins = pinsFromPlan(SAVED, balances({ visa: { type: "credit", balance_cents: null, limit_cents: 800000, closed: false } }), { today: "2026-10-07" });
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:visa:util10").status, "planned");
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:overall:util10").status, "planned", "card use with a hole in it is unknown");
  });

  test("card use overall and debt-free read every card and debt", () => {
    const low = balances({
      visa: { type: "credit", balance_cents: 0, limit_cents: 800000, closed: false },
      amex: { type: "credit", balance_cents: 100000, limit_cents: 2500000, closed: false }
    });
    const pins = pinsFromPlan(SAVED, low, { today: "2026-10-07" });
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:overall:util10").status, "done");
    assert.equal(pins.find((p) => p.id === "payoff:plan-1:debt_free").status, "planned", "the SBA Loan still owes");
    const none = balances({
      visa: { type: "credit", balance_cents: 0, limit_cents: 800000, closed: false },
      amex: { type: "credit", balance_cents: -500, limit_cents: 2500000, closed: false },
      sba: { type: "loan", balance_cents: 0, limit_cents: null, closed: true }
    });
    assert.equal(pinsFromPlan(SAVED, none, { today: "2026-10-07" }).find((p) => p.id === "payoff:plan-1:debt_free").status, "done");
  });
});

describe("the window", () => {
  test("only pins between from and to", () => {
    const pins = pinsFromPlan(SAVED, balances(), { from: "2027-01-01", to: "2027-12-31", today: "2026-10-07" });
    assert.deepEqual(pins.map((p) => p.id), ["payoff:plan-1:visa:payoff", "payoff:plan-1:amex:util10", "payoff:plan-1:overall:util10"]);
  });

  test("pins() reads the saved plan and the balances for that client and org only", async () => {
    const asked = [];
    const db = {
      query: async (sql, params) => {
        asked.push({ sql, params });
        if (/FROM payment_strategy_plans/.test(sql)) {
          return { rows: [{ ...SAVED, monthly_cents: "150000", goal_kind: null, goal_by: null, as_of: "2026-10-07", debt_free_on: "2030-01-07", cash_check: "safe", saved_by_kind: "client", created_at: new Date("2026-10-07T12:00:00Z"), summary: {} }] };
        }
        if (/FROM bank_accounts/.test(sql)) {
          return { rows: [{ id: "visa", account_type: "credit", current_balance_cents: "50000", credit_limit_cents: "800000", closed_at: null }] };
        }
        return { rows: [] };
      }
    };
    const pins = await payoff.pins(db, { orgId: "org-1", clientId: "client-1", from: "2026-10-01", to: "2026-12-31", today: "2026-10-07" });
    assert.deepEqual(pins.map((p) => [p.id, p.status]), [["payoff:plan-1:visa:util10", "done"]]);
    assert.deepEqual(asked[0].params, ["org-1", "client-1"]);
    assert.deepEqual(asked[1].params, ["client-1", "org-1"]);
    assert.match(asked[0].sql, /superseded_at IS NULL/);
  });
});
