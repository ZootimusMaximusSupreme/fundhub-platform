// src/finance/payment-strategy.mjs — the join behind /api/money/strategy:
// the overview's cards and loans + APR, the cash check through the REAL
// src/banking/cashflow.mjs projector, the read, and the save. Stubbed reads; no
// network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  aprMap, debtsFromOverview, cashByKind, readSettings, strategyPayload, savePlan,
  planSummary, defaultSettings, readSavedPlan, shapeSaved, usd, incomeForPlan,
  paymentStatus, cycleFacts, financingDebts, cleanupForPage
} from "./payment-strategy.mjs";
import { buildPlan } from "../../public/app/money-strategy-math.js";

const TODAY = "2026-10-07";
const NOW = new Date("2026-10-07T12:00:00Z");

/* The real test client's shape (the proof read): two kinds, Plaid sandbox cash. */
const OVERVIEW = {
  ok: true,
  client: { id: "c1", name: "Test Test" },
  sandbox: true,
  tip: null,
  accounts: [
    { id: "chk-b", name: "Business Checking", type: "depository", kind: "business", current_cents: 1875000 },
    { id: "chk-p", name: "Personal Checking", type: "depository", kind: "personal", current_cents: 421055 },
    { id: "amex", name: "Business Amex", type: "credit", kind: "business", current_cents: 540000 },
    { id: "visa", name: "Personal Visa", type: "credit", kind: "personal", current_cents: 132040 }
  ],
  debt: {
    cards: [
      { account_id: "amex", name: "Business Amex", mask: "4404", container_id: "biz", kind: "business", balance_cents: 540000, limit_cents: 2500000, due_on: "2026-10-15", min_due_cents: 13500 },
      { account_id: "visa", name: "Personal Visa", mask: "3303", container_id: "me", kind: "personal", balance_cents: 132040, limit_cents: 800000, due_on: "2026-10-25", min_due_cents: 4000 },
      { account_id: "ink", name: null, mask: "9999", container_id: "biz", kind: "business", balance_cents: 200000, limit_cents: 1000000, due_on: null, min_due_cents: null }
    ],
    loans: [
      { account_id: "sba", name: "SBA Loan", mask: null, container_id: "biz", kind: "business", balance_cents: 4800000, due_on: "2026-11-01", payment_cents: 105000 }
    ]
  }
};

const APR_ROWS = [
  { bank_account_id: "amex", apr: "0.18240", loan_rate: null },
  { bank_account_id: "visa", apr: "0.24990", loan_rate: null }
];

const bill = (id, acct, label, cents, on, confidenceLabel = "medium", pct = 70) => ({
  id, bankAccountId: acct, merchantKey: label.toUpperCase(), merchantDisplay: label, cadence: "monthly",
  typicalAmountCents: -cents, nextExpectedDate: on, anchorDayOfMonth: on ? Number(on.slice(8, 10)) : null,
  confidencePct: pct, confidenceLabel
});
const BILLS = [
  bill("b1", "chk-b", "HubSpot Software Subscription", 30000, "2026-11-04"),
  bill("b2", "chk-p", "Oakwood Apartments Rent", 250000, "2026-11-02"),
  bill("b3", "chk-p", "GEICO", 18000, "2026-10-13"),
  bill("b4", "amex", "AWS", 42000, "2026-11-03"),          // charged to a CARD: not cash out
  bill("b5", "chk-b", "Regus", 180000, null, "low", 40)     // low confidence, no date: not projected
];
const THRESHOLDS = { minBufferCents: 0, confidenceFloor: 0.75, settlementLeadDays: 3 };

describe("debts: the overview's own numbers plus the APR", () => {
  test("APR is read as a fraction from the statement cycle; a loan's Plaid rate is used and named", () => {
    const m = aprMap([...APR_ROWS, { bank_account_id: "sba", apr: null, loan_rate: "6.5" }, { bank_account_id: "x", apr: "7", loan_rate: null }]);
    assert.deepEqual(m.get("amex"), { apr_pct: 18.24, apr_source: "statement" });
    assert.deepEqual(m.get("visa"), { apr_pct: 24.99, apr_source: "statement" });
    assert.deepEqual(m.get("sba"), { apr_pct: 6.5, apr_source: "plaid_loan_rate" });
    assert.equal(m.has("x"), false, "an APR above 100% is not stored as one");
  });

  test("cards and loans keep the overview's balances, limits, kinds, dues and minimums; no APR stays null", () => {
    const debts = debtsFromOverview(OVERVIEW, aprMap(APR_ROWS));
    assert.deepEqual(debts.map((d) => [d.id, d.type, d.kind, d.balance_cents, d.limit_cents, d.apr_pct, d.min_cents]), [
      ["amex", "card", "business", 540000, 2500000, 18.24, 13500],
      ["visa", "card", "personal", 132040, 800000, 24.99, 4000],
      ["ink", "card", "business", 200000, 1000000, null, null],
      ["sba", "loan", "business", 4800000, null, null, 105000]
    ]);
    assert.equal(debts[2].name, "Card ····9999", "no name → the mask, never a made-up name");
  });
});

describe("cash: each kind's own cash, through src/banking/cashflow.mjs", () => {
  const debts = debtsFromOverview(OVERVIEW, aprMap(APR_ROWS));

  test("business and personal are checked apart: opening cash minus that kind's bills inside the month", () => {
    const c = cashByKind({ accounts: OVERVIEW.accounts, bills: BILLS, debts, thresholds: THRESHOLDS, today: TODAY });
    assert.deepEqual(c.window, { from: "2026-10-07", to: "2026-11-06" });
    assert.equal(c.by_kind.business.ok, true);
    assert.equal(c.by_kind.business.safe_cents, 1845000); // 18,750 − HubSpot 300
    assert.equal(c.by_kind.business.bills_cents, 30000);
    assert.equal(c.by_kind.personal.safe_cents, 153055);  // 4,210.55 − rent 2,500 − GEICO 180
    assert.deepEqual(c.by_kind.personal.bills.map((b) => b.name), ["GEICO", "Oakwood Apartments Rent"]);
    assert.ok(!c.by_kind.business.bills.some((b) => b.name === "AWS"), "a bill on a card is not cash out of checking");
    assert.equal(c.by_kind.business.bills_left_out, 1, "the low-confidence Regus is reported, not projected");
    assert.equal(c.by_kind.business.floor_cents, 0);
  });

  test("a kind with debts and no bank account says so in words — no $0 cash", () => {
    const unsorted = [...debts, { id: "u", name: "Mystery Card", type: "card", kind: "unknown", balance_cents: 5000, min_cents: 2500, due_on: "2026-10-20" }];
    const c = cashByKind({ accounts: OVERVIEW.accounts, bills: [], debts: unsorted, thresholds: THRESHOLDS, today: TODAY });
    assert.equal(c.by_kind.unknown.ok, false);
    assert.equal(c.by_kind.unknown.code, "NO_BALANCES");
    assert.match(c.by_kind.unknown.message, /No not-sorted-yet bank account is on file/);
  });

  test("an unknown checking balance refuses that kind's check (the projector's own refusal)", () => {
    const accounts = OVERVIEW.accounts.map((a) => (a.id === "chk-p" ? { ...a, current_cents: null } : a));
    const c = cashByKind({ accounts, bills: BILLS, debts, thresholds: THRESHOLDS, today: TODAY });
    assert.equal(c.by_kind.personal.ok, false);
    assert.equal(c.by_kind.personal.code, "UNKNOWN_BALANCE");
    assert.equal(c.by_kind.business.ok, true);
  });

  test("a debt left out (balance unknown) with no due date is a blind spot: the check refuses, it does not guess", () => {
    const withHole = [...debts, { id: "hole", name: "Card with no balance", type: "card", kind: "business", balance_cents: null, min_cents: null, due_on: null }];
    const c = cashByKind({ accounts: OVERVIEW.accounts, bills: BILLS, debts: withHole, thresholds: THRESHOLDS, today: TODAY });
    assert.equal(c.by_kind.business.ok, false);
    assert.equal(c.by_kind.business.code, "PROJECTION_HAS_BLIND_SPOTS");
  });

  test("bills alone overdraw: nothing is safe, and the shortfall is named", () => {
    const accounts = OVERVIEW.accounts.map((a) => (a.id === "chk-p" ? { ...a, current_cents: 100000 } : a));
    const c = cashByKind({ accounts, bills: BILLS, debts, thresholds: THRESHOLDS, today: TODAY });
    assert.equal(c.by_kind.personal.safe_cents, 0);
    assert.equal(c.by_kind.personal.short_cents, 168000);
  });

  test("a buffer an operator set comes off the safe amount", () => {
    const c = cashByKind({ accounts: OVERVIEW.accounts, bills: BILLS, debts, thresholds: { ...THRESHOLDS, minBufferCents: 50000 }, today: TODAY });
    assert.equal(c.by_kind.personal.safe_cents, 103055);
    assert.equal(c.by_kind.personal.floor_cents, 50000);
  });
});

describe("settings from a request", () => {
  test("method, a whole number of cents, and an optional goal with a real date", () => {
    assert.deepEqual(readSettings({ method: "snowball", monthly_cents: 150000 }), { settings: { method: "snowball", monthly_cents: 150000, goal: null } });
    assert.deepEqual(readSettings({ method: "avalanche", monthly_cents: "150000", goal: { kind: "util10", by: "2027-06-30" } }).settings.goal, { kind: "util10", by: "2027-06-30" });
    assert.match(readSettings({ method: "fastest", monthly_cents: 1 }).error, /method/);
    assert.match(readSettings({ method: "avalanche", monthly_cents: 1500.5 }).error, /whole number/);
    assert.match(readSettings({ method: "avalanche", monthly_cents: 0 }).error, /above zero/);
    assert.match(readSettings({ method: "avalanche", monthly_cents: 100, goal: { kind: "util10", by: "2027-02-30" } }).error, /date/);
    assert.match(readSettings({ method: "avalanche", monthly_cents: 100, goal: { kind: "rich" } }).error, /goal\.kind/);
  });
});

/* A db that answers the APR read and records the save. */
function fakeDb({ saveRow = null, saveError = null, savedRow = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM account_statement_cycles/.test(sql)) return { rows: APR_ROWS };
      if (/FROM payment_strategy_plans/.test(sql) && /SELECT/.test(sql) && !/INSERT/.test(sql)) return { rows: savedRow ? [savedRow] : [] };
      if (/INSERT INTO payment_strategy_plans/.test(sql)) {
        if (saveError) throw saveError;
        return { rows: [saveRow || {
          id: "plan-1", method: params[2], monthly_cents: String(params[3]), goal_kind: params[4], goal_by: params[5],
          as_of: params[6], debt_free_on: params[7], cash_check: params[11], saved_by_kind: params[12],
          created_at: NOW, inputs: JSON.parse(params[8]), milestones: JSON.parse(params[9]), summary: JSON.parse(params[10])
        }] };
      }
      return { rows: [] };
    }
  };
}
const deps = (over = {}) => ({
  moneyOverview: async () => over.overview === undefined ? OVERVIEW : over.overview,
  listRecurringBillsFor: async () => BILLS,
  loadThresholds: async () => THRESHOLDS,
  ...over.extra
});

describe("the read", () => {
  test("inputs, targets with sources, defaults (minimums, rounded up), and the plan without month rows", async () => {
    const p = await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW, deps: deps() });
    assert.equal(p.ok, true);
    assert.equal(p.as_of, TODAY);
    assert.equal(p.sandbox, true);
    assert.equal(p.inputs.debts.length, 4);
    assert.equal(p.inputs.cash.by_kind.business.safe_cents, 1845000);
    assert.deepEqual(p.defaults, { method: "avalanche", monthly_cents: 122500, goal: null });
    assert.equal(p.plan.ok, true);
    assert.equal("months" in p.plan, false, "the page builds the month rows itself");
    assert.ok(p.plan.month_count > 0);
    assert.match(p.sources.cash, /src\/banking\/cashflow\.mjs/);
    assert.equal(p.saved, null);
    assert.equal("projections" in p, false, "server-only projections never cross the wire");
  });

  test("the plan in the read is exactly what the shared math gives for the same inputs", async () => {
    const p = await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW, deps: deps() });
    const again = planSummary(buildPlan(p.inputs, p.defaults));
    assert.deepEqual(JSON.parse(JSON.stringify(p.plan)), JSON.parse(JSON.stringify(again)));
  });

  test("a saved plan sets the defaults", async () => {
    const savedRow = { id: "plan-0", method: "snowball", monthly_cents: "150000", goal_kind: "util10", goal_by: "2027-06-30",
      as_of: "2026-10-01", debt_free_on: "2030-01-01", cash_check: "safe", saved_by_kind: "client", created_at: NOW, inputs: [], milestones: [{}, {}], summary: {} };
    const p = await strategyPayload(fakeDb({ savedRow }), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW, deps: deps() });
    assert.deepEqual(p.defaults, { method: "snowball", monthly_cents: 150000, goal: { kind: "util10", by: "2027-06-30" } });
    assert.equal(p.saved.steps, 2);
  });

  test("a client that is not in the org reads as null (the handler answers 404)", async () => {
    assert.equal(await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", asOf: NOW, deps: deps({ overview: null }) }), null);
  });

  test("before migration 463 is applied, no table reads as no plan — never a broken page", async () => {
    const db = { query: async () => { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; } };
    assert.equal(await readSavedPlan(db, { orgId: "o1", clientId: "c1" }), null);
  });

  test("defaults with no debts leave the amount unset", () => {
    assert.deepEqual(defaultSettings({ as_of: TODAY, debts: [] }, null), { method: "avalanche", monthly_cents: null, goal: null });
  });
});

describe("the save", () => {
  const base = { orgId: "o1", clientId: "c1", env: {}, asOf: NOW, savedByKind: "client" };

  test("recomputed on the server, stored as the one active plan, with its steps and a cash check that is never 'over'", async () => {
    const db = fakeDb();
    const r = await savePlan(db, { ...base, settings: { method: "avalanche", monthly_cents: 150000, goal: null }, deps: deps() });
    assert.equal(r.ok, true);
    const save = db.calls.find((c) => /INSERT INTO payment_strategy_plans/.test(c.sql));
    assert.match(save.sql, /UPDATE payment_strategy_plans SET superseded_at = now\(\)/);
    assert.equal(save.params[0], "o1");
    assert.equal(save.params[1], "c1");
    assert.equal(save.params[2], "avalanche");
    assert.equal(save.params[3], 150000);
    assert.equal(save.params[6], TODAY);
    assert.equal(save.params[7], "2030-01-07");
    assert.equal(save.params[11], "safe");
    assert.equal(save.params[12], "client");
    assert.equal(save.params[13], null);
    const steps = JSON.parse(save.params[9]);
    assert.ok(steps.some((s) => s.key === "debt_free" && s.date === "2030-01-07"));
    assert.ok(steps.every((s) => typeof s.date === "string" && s.key));
    assert.equal(r.saved.steps, steps.length);
    assert.equal(r.saved.monthly_cents, 150000);
  });

  test("more than this month's cash can cover is refused (409) with the most that is safe", async () => {
    /* Personal cash $2,800 − rent $2,500 − GEICO $180 = $120 safe. Highest rate
       first sends the Visa $40 + the $275 extra = $315. The most that fits:
       $1,225 of minimums + $80 more to the Visa = $1,305. */
    const tight = { ...OVERVIEW, accounts: OVERVIEW.accounts.map((a) => (a.id === "chk-p" ? { ...a, current_cents: 280000 } : a)) };
    const db = fakeDb();
    const r = await savePlan(db, { ...base, settings: { method: "avalanche", monthly_cents: 150000, goal: null }, deps: deps({ overview: tight }) });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.equal(r.error, "over_safe_amount");
    assert.equal(r.message, "This month that sends $315 to personal debts, and personal cash can only cover $120 without going below zero. The most you can save as a plan right now is $1,305 a month.");
    assert.equal(r.max_safe_monthly_cents, 130500);
    assert.ok(!db.calls.some((c) => /INSERT INTO payment_strategy_plans/.test(c.sql)), "nothing is written");
  });

  test("when even the minimums overdraw, the refusal says so and offers no amount", async () => {
    const broke = { ...OVERVIEW, accounts: OVERVIEW.accounts.map((a) => (a.id === "chk-p" ? { ...a, current_cents: 270000 } : a)) };
    const r = await savePlan(fakeDb(), { ...base, settings: { method: "avalanche", monthly_cents: 150000, goal: null }, deps: deps({ overview: broke }) });
    assert.equal(r.status, 409);
    assert.match(r.message, /personal cash can only cover \$20 without going below zero\.$/);
    assert.equal(r.max_safe_monthly_cents, null);
  });

  test("less than the minimums is refused (422) in words", async () => {
    const r = await savePlan(fakeDb(), { ...base, settings: { method: "avalanche", monthly_cents: 100000, goal: null }, deps: deps() });
    assert.equal(r.status, 422);
    assert.equal(r.error, "below_minimums");
    assert.match(r.message, /\$1,225 a month/);
  });

  test("two saves at the same moment: the second is a clear 409, not a crash", async () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    const r = await savePlan(fakeDb({ saveError: err }), { ...base, settings: { method: "avalanche", monthly_cents: 150000, goal: null }, deps: deps() });
    assert.equal(r.status, 409);
    assert.equal(r.error, "save_conflict");
  });

  test("staff saving for a client are named on the row", async () => {
    const db = fakeDb();
    await savePlan(db, { ...base, savedByKind: "staff", savedById: "5aff0000-0000-4000-8000-000000000001", settings: { method: "utilization", monthly_cents: 150000, goal: { kind: "util10", by: "2027-12-31" } }, deps: deps() });
    const save = db.calls.find((c) => /INSERT INTO payment_strategy_plans/.test(c.sql));
    assert.equal(save.params[12], "staff");
    assert.equal(save.params[13], "5aff0000-0000-4000-8000-000000000001");
    assert.equal(save.params[4], "util10");
    assert.equal(save.params[5], "2027-12-31");
  });

  test("shapeSaved and usd", () => {
    assert.equal(shapeSaved(null), null);
    assert.equal(usd(122500), "$1,225");
    assert.equal(usd(153055), "$1,530.55");
  });
});

/* ── money coming in (Finance OS CFO build, unit C) ─────────────────────── */

const INCOME = {
  ok: true,
  detected_as_of: TODAY,
  months_judged: ["2026-07", "2026-08", "2026-09"],
  items: [
    { id: "chk-p:ACME PAYROLL", source: "paycheck", name: "ACME PAYROLL", kind: "personal", cadence: "biweekly",
      typical_cents: 210000, monthly_cents: 420000, sure_per_month: 2, next_expected_on: "2026-10-16", last_seen_on: "2026-10-02",
      occurrence_count: 12, account_name: "Personal Checking", account_mask: "3303", evidence_provider_ids: ["p1"], descriptor: "ACME PAYROLL PPD ID: 1" },
    { id: "merchant:mc1", source: "merchant_payout", name: "Commas payouts", kind: "business", cadence: null, typical_cents: null,
      monthly_cents: 250000, container_name: "Fundhub LLC", payouts_per_month: 2,
      months: [{ month: "2026-07", payouts_cents: 300000, payout_count: 2 }, { month: "2026-08", payouts_cents: 250000, payout_count: 1 }, { month: "2026-09", payouts_cents: 400000, payout_count: 2 }] }
  ],
  not_counted: [
    { id: "chk-p:IRS TREAS", source: "deposit", name: "IRS TREAS", kind: "personal", cadence: null, typical_cents: 184000, monthly_cents: null, occurrence_count: 1, reason: "one_off_not_repeating" }
  ],
  by_kind: {
    personal: { monthly_cents: 420000, counted: 1, not_counted: 1, reason: null },
    business: { monthly_cents: 250000, counted: 1, not_counted: 0, reason: null },
    unknown: { monthly_cents: null, counted: 0, not_counted: 0, reason: "nothing_found" }
  },
  excluded: []
};

describe("money coming in: what the extra-for-debt suggestion is built from", () => {
  test("per kind: the sure income, and that kind's sure bills on its own checking at their average month", () => {
    const weekly = { ...bill("b6", "chk-p", "Lawn Care", 5000, "2026-10-14"), cadence: "weekly" };
    const inc = incomeForPlan({ income: INCOME, bills: [...BILLS, weekly], accounts: OVERVIEW.accounts, thresholds: THRESHOLDS });
    assert.equal(inc.ok, true);
    /* Personal: rent $2,500 + GEICO $180 + lawn care $50 × 52 ÷ 12 = $216.67 (rounded up). */
    assert.deepEqual(inc.by_kind.personal, { monthly_cents: 420000, counted: 1, not_counted: 1, bills_cents: 250000 + 18000 + 21667, bill_count: 3, unsure_bill_count: 0 });
    /* Business: HubSpot $300. Regus is low confidence (counted, not added). AWS is on a CARD, not cash out. */
    assert.deepEqual(inc.by_kind.business, { monthly_cents: 250000, counted: 1, not_counted: 0, bills_cents: 30000, bill_count: 1, unsure_bill_count: 1 });
    assert.equal(inc.by_kind.unknown.monthly_cents, null, "nothing found stays unknown");
    assert.equal(inc.by_kind.unknown.bills_cents, 0);
    assert.deepEqual([inc.floor_cents, inc.floor_source], [0, "buffer-supplied"]);
    assert.equal("business" in inc && "total_cents" in inc, false, "no total across kinds");
  });

  test("only what the page needs: no provider ids, no raw descriptors", () => {
    const inc = incomeForPlan({ income: INCOME, bills: [], accounts: OVERVIEW.accounts, thresholds: THRESHOLDS });
    assert.deepEqual(Object.keys(inc.items[0]).sort(), ["account_mask", "account_name", "cadence", "container_name", "id", "kind",
      "last_on", "monthly_cents", "months", "name", "next_on", "payouts_per_month", "reason", "source", "sure_per_month", "times_seen", "typical_cents"]);
    assert.doesNotMatch(JSON.stringify(inc), /evidence_provider_ids|PPD ID/);
    assert.equal(inc.items[1].months[2].payouts_cents, 400000);
    assert.equal(inc.not_counted[0].reason, "one_off_not_repeating");
  });

  test("no buffer set: the floor is $0, named 'spec-zero' — cashflow.mjs's own rule; a failed read says so", () => {
    const inc = incomeForPlan({ income: INCOME, bills: [], accounts: OVERVIEW.accounts, thresholds: {} });
    assert.deepEqual([inc.floor_cents, inc.floor_source], [0, "spec-zero"]);
    assert.deepEqual(incomeForPlan({ income: { ok: false, reason: "read_failed" } }), { ok: false, reason: "read_failed" });
    assert.deepEqual(incomeForPlan({}), { ok: false, reason: "not_read" });
  });

  test("the read carries it, and the plan's suggestion is the shared math's answer for those inputs", async () => {
    const asked = [];
    const p = await strategyPayload(fakeDb(), {
      orgId: "o1", clientId: "c1", env: {}, asOf: NOW,
      deps: deps({ extra: { loadIncome: async (_db, opts) => { asked.push(opts); return INCOME; } } })
    });
    assert.deepEqual(asked.map((o) => [o.orgId, o.clientId]), [["o1", "c1"]]);
    assert.equal(p.inputs.income.ok, true);
    assert.equal(p.inputs.income.by_kind.personal.monthly_cents, 420000);
    assert.match(p.sources.income, /src\/banking\/income\.mjs/);
    const again = buildPlan(p.inputs, p.defaults).suggestion;
    assert.deepEqual(JSON.parse(JSON.stringify(p.plan.suggestion)), JSON.parse(JSON.stringify(again)));
    /* The Sample Chase Ink has no minimum on file, so the business extra is
       unknown and no amount is suggested — said, not guessed. */
    assert.equal(p.plan.suggestion.ok, false);
    assert.equal(p.plan.suggestion.reason.code, "minimum_unknown");
    assert.deepEqual(p.plan.suggestion.reason.names, ["Card ····9999"]);
    assert.deepEqual(p.defaults, { method: "avalanche", monthly_cents: 122500, goal: null }, "a suggestion never changes the default");
  });

  test("with every minimum known, the read suggests an amount the client can use", async () => {
    const known = { ...OVERVIEW, debt: { ...OVERVIEW.debt, cards: OVERVIEW.debt.cards.filter((c) => c.account_id !== "ink") } };
    const p = await strategyPayload(fakeDb(), {
      orgId: "o1", clientId: "c1", env: {}, asOf: NOW,
      deps: deps({ overview: known, extra: { loadIncome: async () => INCOME } })
    });
    const s = p.plan.suggestion;
    assert.equal(s.ok, true);
    /* Personal: $4,200 − $2,680 − $40 = $1,480. Business: $2,500 − $300 − $135 − $1,050 = $1,015. */
    assert.deepEqual(s.by_kind.map((r) => [r.kind, r.extra_cents]), [["personal", 148000], ["business", 101500]]);
    assert.ok(Number.isSafeInteger(s.monthly_cents) && s.monthly_cents >= p.plan.minimums_cents);
  });
});

/* ── financing, paid / late, and bill cleanup (Finance OS wave 3, units K and F) ── */

describe("paid / late per payment, from Plaid's last payment date", () => {
  const facts = (o = {}) => ({ dueOn: "2026-10-25", statementOn: "2026-09-28", lastPaidOn: null, minCents: 4000, statementBalanceCents: 132040, ...o });

  test("a payment on or after the last statement is paid; before it, with the due date gone, is late", () => {
    assert.equal(paymentStatus(facts({ lastPaidOn: "2026-10-20" }), TODAY).status, "paid");
    assert.equal(paymentStatus(facts({ lastPaidOn: "2026-09-28" }), TODAY).status, "paid", "on the statement day counts");
    const late = paymentStatus(facts({ lastPaidOn: "2026-09-02", dueOn: "2026-10-01" }), TODAY);
    assert.deepEqual([late.status, late.days_late, late.last_paid_on], ["late", 6, "2026-09-02"]);
    const due = paymentStatus(facts({ lastPaidOn: "2026-09-02" }), TODAY);
    assert.deepEqual([due.status, due.due_on], ["due", "2026-10-25"]);
  });

  test("no Plaid payment date, or no statement to compare it with, is unknown — never paid and never late", () => {
    assert.deepEqual([paymentStatus(facts(), TODAY).status, paymentStatus(facts(), TODAY).reason], [null, "no_payment_date"]);
    const noStmt = paymentStatus(facts({ lastPaidOn: "2026-10-20", statementOn: null }), TODAY);
    assert.deepEqual([noStmt.status, noStmt.reason], [null, "no_statement_date"]);
    assert.equal(paymentStatus(facts({ lastPaidOn: "2026-09-02", minCents: 0 }), TODAY).status, "nothing_due");
    assert.equal(paymentStatus(facts({ lastPaidOn: "2026-09-02", statementBalanceCents: 0 }), TODAY).status, "nothing_due");
  });

  test("agrees with the card reminder's own 'payment on file' test", async () => {
    const { planCardDue } = await import("../banking/card-due-reminders.mjs");
    const row = (lastPaid) => ({ bank_account_id: "visa", minimum_payment_cents: 4000, last_statement_balance_cents: 132040,
      last_statement_date: "2026-09-28", raw: { next_payment_due_date: "2026-10-09", last_payment_date: lastPaid } });
    for (const lastPaid of ["2026-10-01", "2026-09-28", "2026-09-27", null]) {
      const reminder = planCardDue(row(lastPaid), { today: TODAY });
      const mine = paymentStatus({ dueOn: "2026-10-09", lastPaidOn: lastPaid, statementOn: "2026-09-28", minCents: 4000, statementBalanceCents: 132040 }, TODAY);
      assert.equal(reminder.reason === "payment_recorded", mine.status === "paid", String(lastPaid));
    }
  });

  test("the cycle read attaches it to each card and loan; Plaid's exact due date wins", () => {
    const rows = [
      { bank_account_id: "visa", apr: "0.24990", last_payment_date: "2026-10-01", next_payment_due_date: "2026-10-25",
        plaid_statement_date: "2026-09-28", last_statement_date: null, minimum_payment_cents: "4000", last_statement_balance_cents: "132040" },
      { bank_account_id: "sba", apr: null, last_payment_date: "2026-09-01", next_payment_due_date: null,
        plaid_statement_date: null, last_statement_date: "2026-09-15", minimum_payment_cents: "105000", last_statement_balance_cents: null }
    ];
    const debts = debtsFromOverview(OVERVIEW, aprMap(rows), { facts: cycleFacts(rows), today: TODAY });
    const by = Object.fromEntries(debts.map((d) => [d.id, d.payment]));
    assert.equal(by.visa.status, "paid");
    assert.equal(by.sba.status, "due", "loan: statement Sep 15, paid Sep 1, due Nov 1 is still ahead");
    assert.equal(by.sba.due_on, "2026-11-01");
    assert.equal(by.amex, null, "no cycle row: no status, not a guess");
    assert.equal(debtsFromOverview(OVERVIEW, aprMap(rows))[0].payment, null, "without facts nothing is claimed");
  });
});

describe("financing: Clarity Pay plans in the payoff plan", () => {
  const inst = (seq, due_on, amount, paid = 0, state = "upcoming", paid_at = null) =>
    ({ seq, due_on, amount_cents: amount, paid_cents: paid, left_cents: amount - paid, state, paid_at });
  const PLAN = {
    id: "p1", kind: "clarity", owed_to: "Fundhub LLC", name: "Fundhub payment plan", status: "open",
    original_cents: 300000, left_cents: 200000, is_late: false, days_late: 0,
    next: { seq: 3, due_on: "2026-10-15", left_cents: 50000, state: "upcoming" },
    installments: [inst(1, "2026-08-15", 50000, 50000, "paid", "2026-08-14T16:00:00Z"), inst(2, "2026-09-15", 50000, 50000, "paid", "2026-09-15T16:00:00Z"),
      inst(3, "2026-10-15", 50000), inst(4, "2026-11-15", 50000), inst(5, "2026-12-15", 50000), inst(6, "2027-01-15", 50000)]
  };

  test("an open plan is a debt: what is left, 0% by its schedule, this month's payment, not sorted as personal or business", () => {
    const [d] = financingDebts([PLAN], { today: TODAY });
    assert.deepEqual([d.id, d.type, d.kind, d.balance_cents, d.apr_pct, d.apr_source, d.min_cents, d.due_on, d.owed_to],
      ["clarity:p1", "financing", "unknown", 200000, 0, "schedule", 50000, "2026-10-15", "Fundhub LLC"]);
    assert.deepEqual([d.payment.status, d.payment.source, d.payment.last_paid_on], ["paid", "recorded", "2026-09-15"]);
  });

  test("a late installment makes the plan late, and its amount is due now; a settled plan is not a debt", () => {
    const late = { ...PLAN, is_late: true, days_late: 22, installments: PLAN.installments.map((i) => (i.seq === 2 ? { ...i, paid_cents: 0, left_cents: 50000, state: "late" } : i)) };
    const [d] = financingDebts([late], { today: TODAY });
    assert.deepEqual([d.payment.status, d.payment.days_late, d.payment.due_on], ["late", 22, "2026-09-15"]);
    assert.equal(d.min_cents, 100000, "September's missed $500 plus October's $500");
    assert.deepEqual(financingDebts([{ ...PLAN, status: "settled", left_cents: 0 }], { today: TODAY }), []);
  });

  test("the read puts plans next to the cards, says when it could not read them, and keeps cards apart from plans", async () => {
    const p = await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW,
      deps: deps({ extra: { listClarityPayments: async (_db, o) => { assert.deepEqual([o.orgId, o.clientId, o.today], ["o1", "c1", TODAY]); return [PLAN]; } } }) });
    assert.deepEqual(p.inputs.debts.map((d) => d.id), ["amex", "visa", "ink", "sba", "clarity:p1"]);
    assert.deepEqual(p.inputs.financing, { ok: true, plans: 1 });
    assert.equal(p.plan.has_financing, true);
    assert.match(p.sources.financing, /clarity-payments\.mjs/);
    const missing = await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW,
      deps: deps({ extra: { listClarityPayments: async () => { throw Object.assign(new Error("no table"), { code: "42P01" }); } } }) });
    assert.deepEqual(missing.inputs.financing, { ok: false, reason: "not_set_up" });
    assert.equal(missing.inputs.debts.length, 4, "the cards and loans still plan");
  });
});

describe("'Pay financing first' is saved with the plan", () => {
  test("a request may turn it on; anything but true or false is refused; off stays out of the settings", () => {
    assert.deepEqual(readSettings({ method: "snowball", monthly_cents: 150000, financing_first: true }).settings,
      { method: "snowball", monthly_cents: 150000, goal: null, financing_first: true });
    assert.deepEqual(readSettings({ method: "snowball", monthly_cents: 150000, financing_first: false }).settings,
      { method: "snowball", monthly_cents: 150000, goal: null });
    assert.match(readSettings({ method: "snowball", monthly_cents: 150000, financing_first: "yes" }).error, /financing_first/);
  });

  test("the save keeps it in the plan's summary, and the next read starts from it", async () => {
    const db = fakeDb();
    const r = await savePlan(db, { orgId: "o1", clientId: "c1", env: {}, asOf: NOW, savedByKind: "client",
      settings: { method: "avalanche", monthly_cents: 150000, goal: null, financing_first: true }, deps: deps() });
    assert.equal(r.ok, true);
    const save = db.calls.find((c) => /INSERT INTO payment_strategy_plans/.test(c.sql));
    assert.equal(JSON.parse(save.params[10]).financing_first, true);
    assert.equal(r.saved.financing_first, true);
    const saved = shapeSaved({ id: "x", method: "avalanche", monthly_cents: "150000", goal_kind: null, goal_by: null, created_at: NOW,
      inputs: [], milestones: [], summary: { financing_first: true } });
    assert.deepEqual(defaultSettings({ as_of: TODAY, debts: [] }, saved), { method: "avalanche", monthly_cents: 150000, goal: null, financing_first: true });
    const plain = shapeSaved({ id: "x", method: "avalanche", monthly_cents: "150000", created_at: NOW, inputs: [], milestones: [], summary: {} });
    assert.deepEqual(defaultSettings({ as_of: TODAY, debts: [] }, plain), { method: "avalanche", monthly_cents: 150000, goal: null });
  });
});

describe("bill cleanup on the Strategy read", () => {
  const FLAG = { key: "price_jump:chk-p:STREAMCO:2026-09-05", kind: "price_jump", name: "STREAMCO", money_kind: "personal", cadence: "monthly",
    bank_account_id: "chk-p", account_name: "Personal Checking", account_mask: "3303", on: "2026-09-05",
    from_cents: 1599, to_cents: 1799, change_cents: 200, charges: [{ on: "2026-09-05", amount_cents: 1799 }], merchant_key: "STREAMCO" };

  test("the read carries the flags as the page reads them; a failed check says so", async () => {
    const asked = [];
    const p = await strategyPayload(fakeDb(), { orgId: "o1", clientId: "c1", env: {}, asOf: NOW,
      deps: deps({ extra: { loadBillCleanup: async (_db, o) => { asked.push([o.orgId, o.clientId]); return { ok: true, as_of: TODAY, window_days: 90, checked_bills: 4, flags: [FLAG] }; } } }) });
    assert.deepEqual(asked, [["o1", "c1"]]);
    assert.equal(p.bill_cleanup.ok, true);
    assert.equal(p.bill_cleanup.checked_bills, 4);
    assert.deepEqual(Object.keys(p.bill_cleanup.flags[0]).sort(), ["account_mask", "account_name", "amount_cents", "cadence", "change_cents", "charges",
      "from_cents", "key", "kind", "money_kind", "name", "on", "to_cents"], "no bank account id, no provider ids");
    assert.deepEqual(cleanupForPage({ ok: false, reason: "read_failed" }), { ok: false, reason: "read_failed" });
    assert.deepEqual(cleanupForPage(null), { ok: false, reason: "not_read" });
  });
});
