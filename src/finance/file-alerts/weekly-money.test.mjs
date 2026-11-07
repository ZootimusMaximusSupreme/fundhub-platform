// Weekly money text — the week, money in, card use, seasoning and the words.
// Pure. Every account, bank and amount is fictional.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  arizonaDay, weekOf, nextWeeklyDay, moneyInWeek, cardUse, seasoningClock, weeklySummary, planWeeklyMoney, weeklyBody
} from "./weekly-money.mjs";
import { lockScreenSafe } from "./bundle-common.mjs";

describe("the week, in Arizona time", () => {
  test("Monday 9 a.m. Arizona is the week's Monday, and the text tells the seven days before", () => {
    assert.deepEqual(weekOf(new Date("2026-11-09T16:00:00Z")), { monday: "2026-11-09", from: "2026-11-02", to: "2026-11-08" });
  });

  test("late Sunday night in Arizona is still the week before, even when UTC says Monday", () => {
    assert.equal(arizonaDay(new Date("2026-11-09T05:00:00Z")), "2026-11-08");
    assert.equal(weekOf(new Date("2026-11-09T05:00:00Z")).monday, "2026-11-02");
  });

  test("the next send: today before 9 on a Monday, else next Monday", () => {
    assert.equal(nextWeeklyDay(new Date("2026-11-09T15:00:00Z")), "2026-11-09");
    assert.equal(nextWeeklyDay(new Date("2026-11-09T17:00:00Z")), "2026-11-16");
    assert.equal(nextWeeklyDay(new Date("2026-11-06T17:00:00Z")), "2026-11-09");
    assert.equal(nextWeeklyDay(new Date("2026-11-08T17:00:00Z")), "2026-11-09");
  });
});

const ACCOUNTS = [
  { id: "p-chk", type: "depository", kind: "personal" },
  { id: "p-sav", type: "depository", kind: "personal" },
  { id: "b-chk", type: "depository", kind: "business" },
  { id: "u-chk", type: "depository", kind: "unknown" },
  { id: "card", type: "credit", kind: "personal" }
];
const META = [
  { id: "p-chk", plaid_item_id: "item-1" }, { id: "p-sav", plaid_item_id: "item-1" },
  { id: "b-chk", plaid_item_id: "item-2" }, { id: "u-chk", plaid_item_id: "item-3" }
];
const WEEK = { from: "2026-11-02", to: "2026-11-08" };

describe("moneyInWeek — personal and business apart, own moves left out", () => {
  test("deposits are counted per kind; a kind's cents are its own, never added to the other", () => {
    const rows = [
      { bank_account_id: "p-chk", amount_cents: 750000, posted_on: "2026-11-03", category: "INCOME_WAGES" },
      { bank_account_id: "b-chk", amount_cents: 120000, posted_on: "2026-11-05", category: null },
      { bank_account_id: "b-chk", amount_cents: 30000, posted_on: "2026-11-07", category: null },
      { bank_account_id: "p-chk", amount_cents: -5000, posted_on: "2026-11-04", category: "FOOD" }
    ];
    const m = moneyInWeek({ rows, accounts: ACCOUNTS, meta: META, ...WEEK });
    assert.deepEqual(m.personal, { known: true, count: 1, cents: 750000 });
    assert.deepEqual(m.business, { known: true, count: 2, cents: 150000 });
    assert.equal(Object.keys(m).sort().join(","), "business,personal", "no total across kinds");
  });

  test("a move between the client's own accounts is not money in — by Plaid's word or by its twin", () => {
    const rows = [
      { bank_account_id: "p-sav", amount_cents: 20000, posted_on: "2026-11-03", category: "TRANSFER_IN_ACCOUNT_TRANSFER" },
      { bank_account_id: "p-chk", amount_cents: 40000, posted_on: "2026-11-04", category: null },
      { bank_account_id: "b-chk", amount_cents: -40000, posted_on: "2026-11-03", category: null }
    ];
    const m = moneyInWeek({ rows, accounts: ACCOUNTS, meta: META, ...WEEK });
    assert.equal(m.personal.count, 0);
    assert.equal(m.personal.cents, 0);
  });

  test("outside the week does not count", () => {
    const rows = [{ bank_account_id: "p-chk", amount_cents: 10000, posted_on: "2026-11-09", category: null }];
    assert.equal(moneyInWeek({ rows, accounts: ACCOUNTS, meta: META, ...WEEK }).personal.count, 0);
  });

  test("with no linked account of a kind, that kind is unknown — null, never zero", () => {
    const m = moneyInWeek({ rows: [], accounts: ACCOUNTS, meta: [{ id: "p-chk", plaid_item_id: "item-1" }], ...WEEK });
    assert.deepEqual(m.business, { known: false, count: null, cents: null });
    assert.deepEqual(m.personal, { known: true, count: 0, cents: 0 });
  });
});

test("cardUse: over 10% per kind, unknown use and unsorted cards in neither count", () => {
  const u = cardUse([
    { kind: "personal", used_pct: 30 }, { kind: "personal", used_pct: 10 }, { kind: "personal", used_pct: null },
    { kind: "business", used_pct: 4 }, { kind: "unknown", used_pct: 90 }
  ]);
  assert.deepEqual(u.personal, { cards: 3, known: 2, over: 1 });
  assert.deepEqual(u.business, { cards: 1, known: 1, over: 0 });
  assert.equal(u.unsorted, 1);
});

test("seasoningClock: day N of 30, the newest unseasoned first, 60 and 90 marked better", () => {
  const s = seasoningClock([
    { id: "r1", bank_name: "Sample Bank", opened_on: "2026-09-01", state: "done" },
    { id: "r2", bank_name: "Sample Credit Union", opened_on: "2026-10-25", state: "done" },
    { id: "r3", bank_name: "Skipped Bank", opened_on: "2026-10-30", state: "skipped" }
  ], { today: "2026-11-06" });
  assert.equal(s.opened, 2);
  assert.equal(s.seasoned, 1);
  assert.equal(s.newest.id, "r2");
  assert.equal(s.newest.days_open, 12);
  assert.equal(s.newest.seasoned_on, "2026-11-24");
  const old = s.accounts.find((a) => a.id === "r1");
  assert.deepEqual(old.better.map((b) => [b.days, b.reached]), [[60, true], [90, false]]);
});

describe("weeklySummary and planWeeklyMoney — plain words, no amounts", () => {
  const facts = {
    moneyIn: { personal: { known: true, count: 3, cents: 750000 }, business: { known: false, count: null, cents: null } },
    cards: { personal: { cards: 3, known: 3, over: 1 }, business: { cards: 0, known: 0, over: 0 } },
    seasoning: { opened: 2, seasoned: 1, newest: { days_open: 12 } },
    openSteps: 4
  };

  test("each known thing is one sentence; unknown things are left out", () => {
    const s = weeklySummary(facts);
    assert.deepEqual(s.lines, [
      "Money came in 3 times to your personal accounts this week.",
      "1 of your 3 personal cards is over 10%.",
      "Your newest bank account is on day 12 of 30.",
      "You have 4 steps left in your plan."
    ]);
    assert.equal(s.empty, false);
  });

  test("the text is keyed on the client and the Monday, and holds no amount or bank name", () => {
    const week = { monday: "2026-11-09", from: "2026-11-02", to: "2026-11-08" };
    const p = planWeeklyMoney({ clientId: "client-1", week, summary: weeklySummary(facts) });
    assert.equal(p.alert, true);
    assert.equal(p.key, "fpa:week:client-1:2026-11-09");
    assert.equal(p.templateKey, "SMS-FINANCE-WEEKLY-MONEY");
    assert.equal(p.dueOn, "2026-11-09");
    assert.equal(p.body, weeklyBody(weeklySummary(facts).summary));
    assert.ok(lockScreenSafe(p.body));
    assert.doesNotMatch(p.body, /\$|7,500|Sample/);
  });

  test("nothing known means no text at all", () => {
    const empty = weeklySummary({ moneyIn: {}, cards: {}, seasoning: { opened: 0 }, openSteps: 0 });
    assert.equal(empty.empty, true);
    assert.equal(planWeeklyMoney({ clientId: "c", week: { monday: "2026-11-09" }, summary: empty }).reason, "nothing_to_say");
  });

  test("one card is 'your card'; every card over says all of them", () => {
    assert.deepEqual(weeklySummary({ cards: { personal: { known: 1, over: 1 }, business: { known: 1, over: 0 } } }).lines,
      ["Your personal card is over 10%.", "Your business card is under 10%."]);
    assert.deepEqual(weeklySummary({ cards: { personal: { known: 2, over: 2 } } }).lines, ["All 2 of your personal cards are over 10%."]);
  });

  test("a card whose use is unknown is never spoken of as under or over", () => {
    assert.deepEqual(weeklySummary({ cards: { personal: { cards: 2, known: 1, over: 1 } } }).lines, ["1 personal card is over 10%."]);
    assert.deepEqual(weeklySummary({ cards: { personal: { cards: 3, known: 2, over: 0 } } }).lines, ["2 personal cards are under 10%."]);
  });

  test("all cards under, all accounts seasoned, no money in: said plainly", () => {
    const s = weeklySummary({
      moneyIn: { personal: { known: true, count: 0, cents: 0 } },
      cards: { business: { cards: 2, known: 2, over: 0 } },
      seasoning: { opened: 2, seasoned: 2, newest: null },
      openSteps: 0
    });
    assert.deepEqual(s.lines, [
      "No money came in to your personal accounts this week.",
      "Your business cards are all under 10%.",
      "Your bank accounts are all seasoned."
    ]);
  });
});
