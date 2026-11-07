// FinanceOS tracking over time — the pure rules (no Postgres).
// The endpoint gate is tested in src/http/money-trends.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addDays, dayRange, lastMonths, readRange, cardsUsed, buildSnapshot,
  rebuildBalances, backfillRollups, buildTrends, planBackfill, backfillClient, snapshotClient, moneyTrends,
  readDay, addMonths, monthsBetween, readWindow, trendWindow, MAX_SPAN_MONTHS,
  pickerType, accountChoices, pickAccount, buildAccountSeries
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

  test("when the bank's balance is from before today, that day is the stored balance", async () => {
    const conn = fakeDb({
      tx: [{ bank_account_id: "a1", day: "2026-10-06", net_cents: "-5000" }],
      earliest: [{ bank_account_id: "a1", earliest: "2026-10-04" }]
    });
    const plan = await planBackfill(conn, { orgId: "o", clientId: "c", today: "2026-10-07", days: 30 });
    const a1 = plan.accounts.find((a) => a.id === "a1");
    assert.deepEqual(a1.points.map((p) => p.day), ["2026-10-04", "2026-10-05", "2026-10-06"]);
    assert.equal(a1.points[2].cents, 421055);
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

describe("moneyTrends — the read against a stand-in db", () => {
  function readDb({ merchantFails = false, conns = [] } = {}) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push(sql);
        if (/FROM clients/.test(sql)) return { rows: [{ id: "c", first_name: "Sam", last_name: "Lee" }] };
        if (/FROM merchant_connections c/.test(sql) && !/merchant_events/.test(sql)) {
          if (merchantFails) throw Object.assign(new Error("column c.mode does not exist"), { code: "42703" });
          assert.doesNotMatch(sql, /encrypted/, "the trend read never selects secret columns");
          return { rows: conns };
        }
        if (/FROM finance_client_daily/.test(sql)) {
          assert.deepEqual(params.slice(0, 2), ["c", "o"], "every query carries client and org");
          return { rows: [{ day: "2026-10-06", cash_personal_cents: "100", cash_business_cents: "200", estimated: false }] };
        }
        return { rows: [] };
      }
    };
  }

  test("unknown client → null (the endpoint answers 404)", async () => {
    const db = { query: async () => ({ rows: [] }) };
    assert.equal(await moneyTrends(db, { orgId: "o", clientId: "c", range: "30d", asOf: new Date("2026-10-06T12:00:00Z") }), null);
  });

  test("no processor: sales null and not marked unavailable", async () => {
    const t = await moneyTrends(readDb(), { orgId: "o", clientId: "c", range: "30d", asOf: new Date("2026-10-06T12:00:00Z") });
    assert.equal(t.sales, null);
    assert.equal(t.sales_unavailable, false);
    assert.equal(t.daily.cash.personal.cents.at(-1), 100);
  });

  test("a merchant read that fails does not take the cash lines down, and says so", async () => {
    const t = await moneyTrends(readDb({ merchantFails: true }), { orgId: "o", clientId: "c", range: "30d", asOf: new Date("2026-10-06T12:00:00Z") });
    assert.equal(t.ok, true);
    assert.equal(t.sales, null);
    assert.equal(t.sales_unavailable, true);
    assert.equal(t.daily.cash.business.cents.at(-1), 200);
  });
});

/* ------------------------------------------------------------------ *
 * Any dates and one account (Finance OS CFO build, unit A, 2026-11-07)
 * ------------------------------------------------------------------ */

describe("any date range — reading from and to", () => {
  test("a real day passes; a day that does not exist, or another format, is refused", () => {
    assert.equal(readDay("2026-02-28"), "2026-02-28");
    assert.equal(readDay("2024-02-29"), "2024-02-29", "a leap day is a real day");
    assert.equal(readDay(" 2026-11-06 "), "2026-11-06");
    for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "11/06/2026", "2026-11-06T00:00:00Z", "", null, undefined, "today"]) {
      assert.equal(readDay(bad), null, `${bad} is not a day`);
    }
  });

  test("months move by the calendar and a short month keeps its last day", () => {
    assert.equal(addMonths("2026-11-06", -24), "2024-11-06");
    assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
    assert.equal(addMonths("2024-02-29", -24), "2022-02-28");
    assert.equal(addMonths("2026-01-15", 1), "2026-02-15");
    assert.deepEqual(monthsBetween("2025-11-20", "2026-02-03"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(monthsBetween("2026-02-03", "2026-02-27"), ["2026-02"]);
  });

  test("presets still work; from and to come back as a pair", () => {
    assert.deepEqual(readWindow({}), { ok: true, range: "90d", from: null, to: null });
    assert.deepEqual(readWindow({ range: "12m" }), { ok: true, range: "12m", from: null, to: null });
    assert.deepEqual(readWindow({ from: "2026-01-01", to: "2026-03-31" }), { ok: true, range: null, from: "2026-01-01", to: "2026-03-31" });
    assert.equal(readWindow({ from: "2026-05-05", to: "2026-05-05" }).ok, true, "one day is a range");
  });

  test("bad windows are refused with words: bad range, both, one date, a fake day, backwards, too long", () => {
    const refused = (q) => {
      const w = readWindow(q);
      assert.equal(w.ok, false, JSON.stringify(q));
      assert.equal(typeof w.error, "string");
      return w.error;
    };
    assert.match(refused({ range: "7d" }), /30d, 90d or 12m/);
    assert.match(refused({ range: "30d", from: "2026-01-01", to: "2026-02-01" }), /not both/);
    assert.match(refused({ from: "2026-01-01" }), /both/);
    assert.match(refused({ to: "2026-01-01" }), /both/);
    assert.match(refused({ from: "2026-02-30", to: "2026-03-10" }), /real dates/);
    assert.match(refused({ from: "2026-03-10", to: "2026-03-09" }), /on or before/);
    assert.match(refused({ from: "2024-11-05", to: "2026-11-06" }), /24 months/);
  });

  test("exactly 24 months is allowed; one day more is not", () => {
    assert.equal(MAX_SPAN_MONTHS, 24);
    assert.equal(readWindow({ from: "2024-11-06", to: "2026-11-06" }).ok, true);
    assert.equal(readWindow({ from: "2024-11-05", to: "2026-11-06" }).ok, false);
  });

  test("a custom window covers exactly from to to; a preset still ends today", () => {
    const w = trendWindow({ asOf: "2026-11-06T15:00:00Z", from: "2026-10-30", to: "2026-11-02" });
    assert.equal(w.custom, true);
    assert.equal(w.range, null);
    assert.deepEqual(w.days, ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    assert.deepEqual(w.months, ["2026-10", "2026-11"]);
    const p = trendWindow({ asOf: "2026-11-06T15:00:00Z", range: "30d" });
    assert.equal(p.custom, false);
    assert.equal(p.to, "2026-11-06");
    assert.equal(p.days.length, 30);
    assert.deepEqual(p.months, ["2026-10", "2026-11"]);
    const long = trendWindow({ asOf: "2026-11-06T15:00:00Z", from: "2024-11-06", to: "2026-11-06" });
    assert.equal(long.days.length, 731, "two years of days, nothing cut off");
    assert.equal(long.months.length, 25);
  });

  test("buildTrends on any dates: the window is the dates, rows outside it are dropped, gaps stay null", () => {
    const t = buildTrends({
      asOf: "2026-11-06T15:00:00Z", from: "2026-03-01", to: "2026-03-05",
      rollups: [
        { day: "2026-02-28", cash_personal_cents: "999" },
        { day: "2026-03-02", cash_personal_cents: "100000", estimated: true },
        { day: "2026-03-05", cash_personal_cents: "0" }
      ]
    });
    assert.equal(t.custom, true);
    assert.equal(t.range, null);
    assert.equal(t.from, "2026-03-01");
    assert.equal(t.to, "2026-03-05");
    assert.deepEqual(t.daily.days, ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
    assert.deepEqual(t.daily.cash.personal.cents, [null, 100000, null, null, 0], "a real $0 is 0; a missing day is null");
    assert.deepEqual(t.daily.estimated, [null, true, null, null, false]);
    assert.deepEqual(t.monthly.months, ["2026-03"]);
    assert.equal(JSON.stringify(t).includes("999"), false, "a day before from is not shown");
    // A preset read is unchanged: range named, custom false.
    const p = buildTrends({ asOf: "2026-11-06T15:00:00Z", range: "12m" });
    assert.equal(p.range, "12m");
    assert.equal(p.custom, false);
    assert.equal(p.account, null);
    assert.deepEqual(p.accounts, []);
  });
});

describe("one account — the picker list and the ownership check", () => {
  const ENTS = [{ id: "e-p", kind: "personal", name: "Me" }, { id: "e-b", kind: "business", name: "Fundhub LLC" }];
  const ROWS = [
    { id: "b1", name: "Business Checking", mask: "4455", account_type: "depository", account_subtype: "checking", entity_id: "e-b", institution_name: "Chase" },
    { id: "p2", name: "Sapphire Preferred", mask: "1234567812345678", account_type: "credit", account_subtype: "credit card", entity_id: "e-p" },
    { id: "p1", name: null, official_name: "Everyday Checking", mask: "0001", account_type: "depository", account_subtype: "checking", entity_id: "e-p" },
    { id: "p3", name: "Rainy Day", account_type: "depository", account_subtype: "savings", entity_kind: "personal" },
    { id: "u1", name: "Money Market", account_type: "depository", account_subtype: "money market" },
    { id: "b2", name: "SBA Loan", account_type: "loan", entity_id: "e-b" },
    { id: "x1", name: "Old Card", account_type: "credit", entity_id: "e-p", closed_at: "2026-09-01T00:00:00Z" }
  ];

  test("type words: card, checking, savings, loan; anything else is other", () => {
    assert.equal(pickerType("credit", "credit card"), "card");
    assert.equal(pickerType("loan", null), "loan");
    assert.equal(pickerType("depository", "checking"), "checking");
    assert.equal(pickerType("depository", "Savings"), "savings");
    assert.equal(pickerType("depository", "money market"), "other", "a money market is not called checking");
    assert.equal(pickerType("depository", null), "other");
    assert.equal(pickerType("investment", "brokerage"), "other");
  });

  test("open accounts only, named the overview's way, sorted by kind then type", () => {
    const list = accountChoices({ accounts: ROWS, entities: ENTS });
    assert.deepEqual(list.map((a) => a.id), ["p1", "p3", "p2", "b1", "b2", "u1"]);
    assert.equal(list.some((a) => a.id === "x1"), false, "a closed account is not offered");
    const p1 = list.find((a) => a.id === "p1");
    assert.equal(p1.label, "Everyday Checking ••0001", "no name → the official name");
    const p2 = list.find((a) => a.id === "p2");
    assert.equal(p2.mask, "5678", "never more than the last four");
    assert.equal(p2.label, "Sapphire Preferred ••5678");
    assert.equal(p2.kind, "personal", "kind comes from the container");
    assert.equal(p2.type, "card");
    assert.equal(list.find((a) => a.id === "p3").label, "Rainy Day", "no mask stored → no dots");
    assert.equal(list.find((a) => a.id === "b1").institution, "Chase");
    assert.equal(list.find((a) => a.id === "u1").kind, "unknown");
    for (const a of list) assert.deepEqual(Object.keys(a).sort(), ["id", "institution", "kind", "label", "mask", "name", "subtype", "type"]);
  });

  test("the ownership check finds only an account on this list", () => {
    const list = accountChoices({ accounts: ROWS, entities: ENTS });
    assert.equal(pickAccount(list, "p2").id, "p2");
    assert.equal(pickAccount(list, "P2").id, "p2", "a uuid in capitals is the same account");
    assert.equal(pickAccount(list, "someone-elses-card"), null);
    assert.equal(pickAccount(list, "x1"), null, "a closed account is not pickable");
    assert.equal(pickAccount(list, null), null);
    assert.equal(pickAccount([], "p2"), null);
  });
});

describe("one account — its own lines", () => {
  const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
  const CARD = { id: "p2", label: "Sapphire ••5678", kind: "personal", type: "card" };
  const CHECKING = { id: "p1", label: "Everyday ••0001", kind: "personal", type: "checking" };

  test("a card: owed each day, a gap is null, limit used only where the limit is known", () => {
    const s = buildAccountSeries({
      account: CARD, days: DAYS, rows: [
        { day: "2026-11-01", current_balance_cents: "250000", credit_limit_cents: "1000000", estimated: false },
        { day: "2026-11-02", current_balance_cents: "300000", credit_limit_cents: null, estimated: false },
        { day: "2026-11-04", current_balance_cents: "-5000", credit_limit_cents: "1000000", estimated: false },
        { day: "2026-11-05", current_balance_cents: "333333", credit_limit_cents: "0", estimated: false }
      ]
    });
    assert.deepEqual(s.balance_cents, [250000, 300000, null, -5000, 333333]);
    assert.deepEqual(s.limit_cents, [1000000, null, null, 1000000, 0]);
    assert.deepEqual(s.used_pct, [25, null, null, 0, null],
      "25%; no limit → null; no row → null; overpaid → 0%; a $0 limit → null, never Infinity");
    assert.deepEqual(s.estimated, [false, false, null, false, false]);
    assert.equal(s.has_history, true);
    assert.equal(s.label, "Sapphire ••5678");
  });

  test("used is owed over limit, rounded to one place, the Cards used math", () => {
    const s = buildAccountSeries({
      account: CARD, days: ["2026-11-01"],
      rows: [{ day: "2026-11-01", current_balance_cents: "132040", credit_limit_cents: "800000" }]
    });
    assert.equal(s.used_pct[0], cardsUsed([{ balance_cents: 132040, limit_cents: 800000 }]).pct);
    assert.equal(s.used_pct[0], 16.5);
  });

  test("a bank account: balance only, estimated days kept, no limit series", () => {
    const s = buildAccountSeries({
      account: CHECKING, days: DAYS, rows: [
        { day: "2026-11-01", current_balance_cents: "421055", source: "backfill", estimated: true },
        { day: "2026-11-03", current_balance_cents: "0", source: "snapshot", estimated: false },
        { day: "2026-10-20", current_balance_cents: "777", estimated: false }
      ]
    });
    assert.deepEqual(s.balance_cents, [421055, null, 0, null, null], "a day outside the window is dropped; a real $0 stays 0");
    assert.deepEqual(s.estimated, [true, null, false, null, null]);
    assert.equal(s.used_pct, null, "only a card has limit used");
    assert.equal(s.limit_cents, null);
  });

  test("no rows → has_history false, every point null; no account → null", () => {
    const s = buildAccountSeries({ account: CARD, days: DAYS, rows: [] });
    assert.equal(s.has_history, false);
    assert.ok(s.balance_cents.every((v) => v === null));
    assert.ok(s.used_pct.every((v) => v === null));
    assert.equal(buildAccountSeries({ account: null, days: DAYS }), null);
  });
});

describe("moneyTrends — any dates and one account against a stand-in db", () => {
  const ASOF = new Date("2026-11-06T15:00:00Z");
  const MINE = "aaaaaaaa-0000-4000-8000-000000000001";
  const THEIRS = "bbbbbbbb-0000-4000-8000-000000000002";
  function accountDb() {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM clients/.test(sql)) return { rows: [{ id: "c", first_name: "Sam", last_name: "Lee" }] };
        if (/FROM bank_accounts a/.test(sql)) {
          assert.deepEqual(params, ["c", "o"], "the account list is this client's, in this org");
          return { rows: [{ id: MINE, name: "Sapphire", mask: "5678", account_type: "credit", entity_kind: "personal" }] };
        }
        if (/FROM finance_account_daily/.test(sql)) {
          return {
            rows: params[2] === MINE && params[0] === "o" && params[1] === "c"
              ? [{ day: "2026-11-05", current_balance_cents: "200000", credit_limit_cents: "1000000", estimated: false }]
              : [{ day: "2026-11-05", current_balance_cents: "123456789", credit_limit_cents: "1", estimated: false }]
          };
        }
        return { rows: [] };
      }
    };
  }

  test("an own account comes back with its lines, and the day query carries org, client and account", async () => {
    const db = accountDb();
    const t = await moneyTrends(db, { orgId: "o", clientId: "c", range: "30d", accountId: MINE, asOf: ASOF });
    assert.equal(t.account.id, MINE);
    assert.equal(t.account.type, "card");
    assert.equal(t.account.balance_cents.at(-2), 200000);
    assert.equal(t.account.used_pct.at(-2), 20);
    assert.equal(t.account.balance_cents.at(-1), null, "today has no row yet → a gap");
    const q = db.seen.find((s) => /FROM finance_account_daily/.test(s.sql));
    assert.deepEqual(q.params, ["o", "c", MINE, "2026-10-08", "2026-11-06"]);
    assert.match(q.sql, /org_id = \$1 AND client_id = \$2 AND bank_account_id = \$3/);
    assert.deepEqual(t.accounts.map((a) => a.id), [MINE]);
  });

  test("an account that is not one of this client's → null (the endpoint's 404), nothing of it returned", async () => {
    const t = await moneyTrends(accountDb(), { orgId: "o", clientId: "c", range: "30d", accountId: THEIRS, asOf: ASOF });
    assert.equal(t, null);
  });

  test("no account asked → no day query, account null, the picker list still there", async () => {
    const db = accountDb();
    const t = await moneyTrends(db, { orgId: "o", clientId: "c", range: "90d", asOf: ASOF });
    assert.equal(t.account, null);
    assert.equal(t.accounts.length, 1);
    assert.equal(db.seen.some((s) => /FROM finance_account_daily/.test(s.sql)), false);
  });

  test("any dates: rollups and money in/out are read from `from` to `to`", async () => {
    const db = accountDb();
    const t = await moneyTrends(db, { orgId: "o", clientId: "c", range: null, from: "2025-06-10", to: "2025-08-20", asOf: ASOF });
    assert.equal(t.custom, true);
    assert.equal(t.range, null);
    assert.equal(t.daily.days[0], "2025-06-10");
    assert.equal(t.daily.days.at(-1), "2025-08-20");
    assert.deepEqual(t.monthly.months, ["2025-06", "2025-07", "2025-08"]);
    const roll = db.seen.find((s) => /FROM finance_client_daily/.test(s.sql));
    assert.deepEqual(roll.params, ["c", "o", "2025-06-10", "2025-08-20"]);
    const tx = db.seen.find((s) => /to_char\(posted_on/.test(s.sql));
    assert.deepEqual(tx.params, ["c", "o", "2025-06-10", "2025-08-20"], "money in/out counts only the days inside the dates");
    // A preset still starts money in/out on the first of its first month.
    const db2 = accountDb();
    await moneyTrends(db2, { orgId: "o", clientId: "c", range: "90d", asOf: ASOF });
    assert.deepEqual(db2.seen.find((s) => /to_char\(posted_on/.test(s.sql)).params, ["c", "o", "2026-09-01", "2026-11-06"]);
  });
});
