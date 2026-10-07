// FinanceOS tracking over time — the pure rules (no Postgres).
// The endpoint gate is tested in src/http/money-trends.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addDays, dayRange, lastMonths, readRange, cardsUsed, buildSnapshot,
  rebuildBalances, backfillRollups, buildTrends, planBackfill, backfillClient, snapshotClient
} from "./money-trends.mjs";

const ENT_P = { id: "e-p", kind: "personal", name: "Chris" };
const ENT_B = { id: "e-b", kind: "business", name: "Fundhub LLC" };
const ACCOUNTS = [
  { id: "a1", name: "Personal Checking", account_type: "depository", current_balance_cents: "421055",
    available_balance_cents: "421055", entity_id: "e-p", entity_kind: "personal", balance_as_of: "2026-10-06T22:00:00Z" },
  { id: "a2", name: "Business Checking", account_type: "depository", current_balance_cents: "1875000",
    available_balance_cents: "1875000", entity_id: "e-b", entity_kind: "business" },
  { id: "c1", name: "Personal Visa", account_type: "credit", current_balance_cents: "132040",
    credit_limit_cents: "800000", entity_id: "e-p" },
  { id: "c2", name: "Business Amex", account_type: "credit", current_balance_cents: "540000",
    credit_limit_cents: "2500000", entity_id: "e-b" },
  { id: "l1", name: "SBA Loan", account_type: "loan", current_balance_cents: "4800000", entity_id: "e-b" },
  { id: "x1", name: "Old Checking", account_type: "depository", current_balance_cents: "999999",
    entity_id: "e-p", closed_at: "2026-10-06T23:00:00Z" }
];

describe("day helpers", () => {
  test("days and months move in UTC", () => {
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.deepEqual(dayRange("2026-10-04", "2026-10-06"), ["2026-10-04", "2026-10-05", "2026-10-06"]);
    assert.deepEqual(lastMonths("2026-02-10", 3), ["2025-12", "2026-01", "2026-02"]);
  });
  test("range: 30d / 90d / 12m, blank is 90d, anything else is refused", () => {
    assert.equal(readRange("30d"), "30d");
    assert.equal(readRange("12M"), "12m");
    assert.equal(readRange(undefined), "90d");
    assert.equal(readRange("7d"), null);
    assert.equal(readRange("90d; drop"), null);
  });
});

describe("snapshot", () => {
  test("rollup is the overview's own numbers; cash per kind is never added together", () => {
    const s = buildSnapshot({ day: "2026-10-06", accounts: ACCOUNTS, entities: [ENT_P, ENT_B] });
    assert.equal(s.rollup.cash_personal_cents, 421055, "closed Old Checking is left out");
    assert.equal(s.rollup.cash_business_cents, 1875000);
    assert.equal(s.rollup.cash_unknown_cents, null, "no not-sure-yet accounts → null, not 0");
    assert.equal(s.rollup.debt_total_cents, 132040 + 540000 + 4800000);
    assert.equal(s.rollup.debt_personal_cents, 132040);
    assert.equal(s.rollup.debt_business_cents, 540000 + 4800000);
    assert.equal(s.rollup.cards_used_pct, Math.round(((132040 + 540000) / (800000 + 2500000)) * 1000) / 10);
    assert.equal(Object.keys(s.rollup).some((k) => /cash_total|total_cash/.test(k)), false);
    assert.equal(s.accounts.length, 5, "one row per OPEN account");
    const a1 = s.accounts.find((a) => a.bank_account_id === "a1");
    assert.equal(a1.kind, "personal");
    assert.equal(a1.entity_id, "e-p");
    assert.equal(a1.balance_as_of, "2026-10-06T22:00:00Z");
  });

  test("a card with no balance makes cash untouched and debt a floor", () => {
    const rows = [...ACCOUNTS.slice(0, 2), { id: "c9", account_type: "credit", current_balance_cents: null, credit_limit_cents: "100000" }];
    const s = buildSnapshot({ day: "2026-10-06", accounts: rows, entities: [ENT_P, ENT_B] });
    assert.equal(s.rollup.debt_total_cents, null);
    assert.equal(s.rollup.cards_used_pct, null, "no card with both numbers → null, not 0%");
  });

  test("cardsUsed skips a $0 or unknown limit, and an overpaid card owes 0", () => {
    assert.deepEqual(cardsUsed([{ balance_cents: 100, limit_cents: 0 }, { balance_cents: 50, limit_cents: null }]),
      { balance_cents: null, limit_cents: null, pct: null });
    assert.deepEqual(cardsUsed([{ balance_cents: -500, limit_cents: 1000 }, { balance_cents: 250, limit_cents: 1000 }]),
      { balance_cents: 250, limit_cents: 2000, pct: 12.5 });
  });
});

describe("backfill — working backward from today's balance", () => {
  // 085: negative = money out, positive = money in.
  const net = new Map([["2026-10-06", -5000], ["2026-10-04", 20000], ["2026-10-02", -1000]]);

  test("balance(D) = balance(anchor) − what posted after D", () => {
    const pts = rebuildBalances({ currentCents: 100000, anchorDay: "2026-10-06", earliestDay: "2026-10-02",
      fromDay: "2026-09-01", dailyNet: net });
    assert.deepEqual(pts, [
      { day: "2026-10-02", cents: 85000 },
      { day: "2026-10-03", cents: 85000 },
      { day: "2026-10-04", cents: 105000 },
      { day: "2026-10-05", cents: 105000 }
    ]);
  });

  test("nothing before the earliest stored transaction, nothing before fromDay, nothing on the anchor day", () => {
    const pts = rebuildBalances({ currentCents: 100000, anchorDay: "2026-10-06", earliestDay: "2026-10-02",
      fromDay: "2026-10-04", dailyNet: net });
    assert.deepEqual(pts.map((p) => p.day), ["2026-10-04", "2026-10-05"]);
  });

  test("unknown balance or no transactions → no points at all", () => {
    assert.deepEqual(rebuildBalances({ currentCents: null, anchorDay: "2026-10-06", earliestDay: "2026-10-01", fromDay: "2026-09-01", dailyNet: net }), []);
    assert.deepEqual(rebuildBalances({ currentCents: 5, anchorDay: "2026-10-06", earliestDay: null, fromDay: "2026-09-01", dailyNet: net }), []);
  });

  test("rollups: kinds apart; a missing account makes a floor; none makes null; debt is null", () => {
    const accts = [{ id: "p1", kind: "personal" }, { id: "p2", kind: "personal" }, { id: "b1", kind: "business" }];
    const points = new Map([
      ["p1", new Map([["2026-10-01", 1000], ["2026-10-02", 1100]])],
      ["p2", new Map([["2026-10-02", 50]])],
      ["b1", new Map([["2026-10-02", 9000]])]
    ]);
    const rows = backfillRollups(accts, points);
    assert.deepEqual(rows.map((r) => r.day), ["2026-10-01", "2026-10-02"]);
    assert.equal(rows[0].cash_personal_cents, 1000);
    assert.equal(rows[0].cash_personal_floor, true, "p2 has no point that day");
    assert.equal(rows[0].cash_business_cents, null, "no business point → a gap, never 0");
    assert.equal(rows[1].cash_personal_cents, 1150);
    assert.equal(rows[1].cash_personal_floor, false);
    assert.equal(rows[1].cash_business_cents, 9000);
    assert.equal(rows[1].debt_total_cents, null);
    assert.equal(rows[1].cards_used_pct, null);
  });
});

describe("backfill and snapshot against a recording db", () => {
  /* Answers the reads the backfill makes and records every write. */
  function fakeDb({ tx = [], earliest = [] } = {}) {
    const writes = [];
    return {
      writes,
      query: async (sql, params) => {
        if (/^\s*INSERT/.test(sql)) { writes.push({ sql, params }); return { rowCount: 1, rows: [] }; }
        if (/FROM bank_accounts a/.test(sql)) return { rows: ACCOUNTS };
        if (/FROM entities/.test(sql)) return { rows: [ENT_P, ENT_B] };
        if (/MIN\(posted_on\)/.test(sql)) return { rows: earliest };
        if (/FROM bank_transactions/.test(sql)) {
          assert.match(sql, /is_pending = false/, "pending rows are skipped");
          assert.match(sql, /NOT \(raw \? 'fundhub_removed_at'\)/, "removed rows are skipped");
          return { rows: tx };
        }
        return { rows: [] };
      }
    };
  }

  test("planBackfill reads only, rebuilds open checking and savings, never cards or closed accounts", async () => {
    const conn = fakeDb({
      tx: [{ bank_account_id: "a1", day: "2026-10-06", net_cents: "-5000" }],
      earliest: [{ bank_account_id: "a1", earliest: "2026-10-04" }, { bank_account_id: "x1", earliest: "2026-01-01" }]
    });
    const plan = await planBackfill(conn, { orgId: "o", clientId: "c", today: "2026-10-06", days: 30 });
    assert.equal(conn.writes.length, 0, "a plan writes nothing");
    assert.deepEqual(plan.accounts.map((a) => a.id), ["a1", "a2"]);
    const a1 = plan.accounts.find((a) => a.id === "a1");
    assert.deepEqual(a1.points, [{ day: "2026-10-04", cents: 426055 }, { day: "2026-10-05", cents: 426055 }]);
    assert.deepEqual(plan.accounts.find((a) => a.id === "a2").points, [], "no transactions → no estimate");
    assert.equal(plan.rollups[0].cash_personal_cents, 426055);
    assert.equal(plan.rollups[0].cash_business_cents, null);
  });

  test("backfill writes are estimated and never overwrite a real snapshot", async () => {
    const conn = fakeDb({
      tx: [{ bank_account_id: "a1", day: "2026-10-06", net_cents: "-5000" }],
      earliest: [{ bank_account_id: "a1", earliest: "2026-10-04" }]
    });
    await backfillClient(conn, { orgId: "o", clientId: "c", today: "2026-10-06", days: 30 });
    assert.equal(conn.writes.length, 2);
    for (const w of conn.writes) {
      assert.match(w.sql, /'backfill', true/);
      assert.match(w.sql, /WHERE finance_(account|client)_daily\.source = 'backfill'/);
    }
  });

  test("snapshot writes one row per open account and one rollup, keyed per day", async () => {
    const conn = fakeDb();
    const r = await snapshotClient(conn, { orgId: "o", clientId: "c", day: "2026-10-06" });
    assert.equal(r.accounts, 5);
    const acct = conn.writes.filter((w) => /finance_account_daily/.test(w.sql));
    const roll = conn.writes.filter((w) => /finance_client_daily/.test(w.sql));
    assert.equal(acct.length, 5);
    assert.equal(roll.length, 1);
    for (const w of acct) assert.match(w.sql, /ON CONFLICT \(bank_account_id, day\)/);
    assert.match(roll[0].sql, /ON CONFLICT \(client_id, day\)/);
    assert.doesNotMatch(roll[0].sql, /WHERE finance_client_daily\.source/, "a snapshot always wins");
  });
});

describe("the read", () => {
  const ASOF = "2026-10-06T15:00:00Z";
  const roll = (day, extra = {}) => ({
    day, cash_personal_cents: "100000", cash_personal_floor: false, cash_business_cents: "500000",
    cash_business_floor: false, cash_unknown_cents: null, cash_unknown_floor: false,
    debt_total_cents: "700000", debt_total_floor: false, debt_personal_cents: "200000",
    debt_business_cents: "500000", debt_unknown_cents: null, cards_used_pct: "20.4",
    source: "snapshot", estimated: false, ...extra
  });

  test("every day in the window has a slot; a day with no row is null, never 0", () => {
    const t = buildTrends({ asOf: ASOF, range: "30d", rollups: [roll("2026-10-01"), roll("2026-10-06")] });
    assert.equal(t.daily.days.length, 30);
    assert.equal(t.from, "2026-09-07");
    assert.equal(t.to, "2026-10-06");
    const i1 = t.daily.days.indexOf("2026-10-01");
    const gap = t.daily.days.indexOf("2026-10-03");
    assert.equal(t.daily.cash.personal.cents[i1], 100000);
    assert.equal(t.daily.cash.personal.cents[gap], null);
    assert.equal(t.daily.debt.total.cents[gap], null);
    assert.equal(t.daily.cards_used_pct[gap], null);
    assert.equal(t.daily.cards_used_pct[i1], 20.4);
    assert.equal(t.daily.estimated[gap], null);
    assert.equal(t.has_history, true);
  });

  test("cash comes back per kind only — there is no summed cash series", () => {
    const t = buildTrends({ asOf: ASOF, range: "30d", rollups: [roll("2026-10-06")] });
    assert.deepEqual(Object.keys(t.daily.cash).sort(), ["business", "personal", "unknown"]);
    assert.equal(JSON.stringify(t).includes("600000"), false, "personal + business cash appears nowhere");
  });

  test("estimated days say so", () => {
    const t = buildTrends({ asOf: ASOF, range: "30d", rollups: [roll("2026-10-05", { source: "backfill", estimated: true })] });
    assert.equal(t.daily.estimated[t.daily.days.indexOf("2026-10-05")], true);
  });

  test("no rows at all → has_history false and every point null", () => {
    const t = buildTrends({ asOf: ASOF, range: "90d" });
    assert.equal(t.has_history, false);
    assert.equal(t.daily.days.length, 90);
    assert.ok(t.daily.cash.personal.cents.every((v) => v === null));
  });

  test("money in vs out per month: depository only, personal and business apart, empty months null", () => {
    const accounts = [
      { id: "a1", account_type: "depository", kind: "personal" },
      { id: "a2", account_type: "depository", kind: "business" },
      { id: "c1", account_type: "credit", kind: "personal" },
      { id: "x1", account_type: "depository", kind: "personal", closed_at: "2026-10-06" }
    ];
    const txMonths = [
      { bank_account_id: "a1", month: "2026-10", in_cents: "300000", out_cents: "120000" },
      { bank_account_id: "a2", month: "2026-10", in_cents: "900000", out_cents: null },
      { bank_account_id: "c1", month: "2026-10", in_cents: "50000", out_cents: "50000" },
      { bank_account_id: "x1", month: "2026-10", in_cents: "777", out_cents: "777" }
    ];
    const t = buildTrends({ asOf: ASOF, range: "90d", accounts, txMonths });
    assert.deepEqual(t.monthly.months, ["2026-08", "2026-09", "2026-10"]);
    assert.deepEqual(t.monthly.personal.in_cents, [null, null, 300000]);
    assert.deepEqual(t.monthly.personal.out_cents, [null, null, 120000]);
    assert.deepEqual(t.monthly.business.in_cents, [null, null, 900000]);
    assert.deepEqual(t.monthly.business.out_cents, [null, null, null], "no outflow rows → null, not 0");
    assert.equal(t.monthly.has_transactions, true);
  });

  test("sales: null with no connection; months before the first connection are gaps", () => {
    assert.equal(buildTrends({ asOf: ASOF, range: "90d" }).sales, null);
    const sales = {
      currency: "usd", months: ["2026-08", "2026-09", "2026-10"],
      totals: [
        { month: "2026-08", net_cents: 0, sales_cents: 0 },
        { month: "2026-09", net_cents: 0, sales_cents: 0 },
        { month: "2026-10", net_cents: 125000, sales_cents: 150000 }
      ]
    };
    const t = buildTrends({ asOf: ASOF, range: "90d", sales, connections: [{ created_at: "2026-09-12T00:00:00Z" }] });
    assert.deepEqual(t.sales.net_cents, [null, 0, 125000]);
  });

  test("credit history only from two pulls up", () => {
    const one = [{ created_at: "2026-09-01T00:00:00Z", result: {} }];
    assert.deepEqual(buildTrends({ asOf: ASOF, crsRows: one }).credit.history, []);
  });
});
