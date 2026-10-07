// The payment strategy math — public/app/money-strategy-math.js, the ONE file
// the browser runs for the live slider and the server runs for the read and the
// save. Pure: no database, no clock. The worked examples below are done by hand
// in the comments, cent by cent, so a change in the rounding or the order shows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addMonths, monthsUntil, parseDay, normalizeDebts, targetCents, monthlyInterest,
  priorityList, simulate, minimumOnly, requiredMonthly, maxSafeMonthly, month1Payments,
  cashCheck, buildPlan, milestones, minimumsCents, payoffAllCents, TARGETS, METHODS, MAX_MONTHS
} from "../../public/app/money-strategy-math.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "../http/fixtures/money-strategy.sample.json"), "utf8"));

const card = (id, o = {}) => ({ id, name: o.name || id, type: "card", kind: o.kind || "business", balance_cents: "bal" in o ? o.bal : 0,
  limit_cents: o.limit === undefined ? null : o.limit, apr_pct: o.apr === undefined ? null : o.apr, min_cents: o.min === undefined ? null : o.min });
const loan = (id, o = {}) => ({ id, name: o.name || id, type: "loan", kind: o.kind || "business", balance_cents: "bal" in o ? o.bal : 0,
  apr_pct: o.apr === undefined ? null : o.apr, min_cents: o.min === undefined ? null : o.min });
const debtsOf = (raw) => normalizeDebts(raw).debts;

describe("dates", () => {
  test("a plan month ends on the same day, k months later; past the month's end it uses the last day", () => {
    assert.equal(addMonths("2026-10-07", 1), "2026-11-07");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addMonths("2026-02-30", 1), null, "not a real date");
  });

  test("months until a goal date: whole plan months only", () => {
    assert.equal(monthsUntil("2026-10-07", "2026-11-06"), 0);
    assert.equal(monthsUntil("2026-10-07", "2026-11-07"), 1);
    assert.equal(monthsUntil("2026-10-07", "2027-10-06"), 11);
    assert.equal(monthsUntil("2026-10-07", "2027-10-07"), 12);
    assert.equal(monthsUntil("2026-10-07", "nope"), null);
    assert.equal(parseDay("2026-13-01"), null);
  });
});

describe("the debts, and what is not known", () => {
  test("an unknown balance takes the debt out of the plan, named — never $0", () => {
    const { debts, excluded } = normalizeDebts([card("a", { bal: 1000 }), card("b", { bal: null })]);
    assert.deepEqual(debts.map((d) => d.id), ["a"]);
    assert.deepEqual(excluded, [{ id: "b", name: "b", type: "card", kind: "business", reason: "balance_unknown" }]);
  });

  test("an overpaid card owes nothing and stays in, so its limit still counts", () => {
    const [d] = debtsOf([card("a", { bal: -500, limit: 100000 })]);
    assert.equal(d.balance_cents, 0);
    assert.equal(d.limit_state, "known");
  });

  test("a $0 or unknown limit has NO card-use target — never 'pay this card down to $0'", () => {
    const [zero, none, known] = debtsOf([card("z", { bal: 900, limit: 0 }), card("n", { bal: 900 }), card("k", { bal: 900, limit: 10000 })]);
    assert.equal(zero.limit_state, "zero");
    assert.equal(none.limit_state, "unknown");
    assert.equal(targetCents(zero, 10), null);
    assert.equal(targetCents(none, 10), null);
    assert.equal(targetCents(known, 10), 1000);
    assert.equal(targetCents(known, 30), 3000);
  });

  test("an APR outside 0–100% is not an APR", () => {
    const [a, b] = debtsOf([card("a", { bal: 1, apr: 250 }), card("b", { bal: 1, apr: 24.99 })]);
    assert.equal(a.apr_pct, null);
    assert.equal(b.apr_bps, 2499);
  });

  test("monthly interest is balance × APR ÷ 12, rounded to the cent", () => {
    assert.equal(monthlyInterest(100000, 1200), 1000);
    assert.equal(monthlyInterest(132040, 2499), 2750); // 2749.73 → 2750
    assert.equal(monthlyInterest(100000, null), 0);
  });
});

describe("the three orders", () => {
  const raw = [
    card("small-low", { bal: 30000, limit: 100000, apr: 10, min: 2500 }),
    card("big-high", { bal: 50000, limit: 60000, apr: 24, min: 2500 }),
    card("no-apr", { bal: 20000, limit: 400000, min: 2500 }),
    loan("loan", { bal: 900000, apr: 6, min: 20000 })
  ];

  test("avalanche: highest APR first; a debt with no APR goes after every debt with one", () => {
    assert.deepEqual(priorityList(debtsOf(raw), "avalanche").map((b) => b.id), ["big-high", "small-low", "loan", "no-apr"]);
  });

  test("snowball: smallest balance first", () => {
    assert.deepEqual(priorityList(debtsOf(raw), "snowball").map((b) => b.id), ["no-apr", "small-low", "big-high", "loan"]);
  });

  test("utilization: each card to 10% of its limit, highest card use first, then avalanche", () => {
    const list = priorityList(debtsOf(raw), "utilization");
    // big-high 83%, small-low 30%; no-apr is 5% — already under its 10% target.
    assert.deepEqual(list.slice(0, 2), [
      { id: "big-high", floor_cents: 6000, phase: "card_use" },
      { id: "small-low", floor_cents: 10000, phase: "card_use" }
    ]);
    assert.deepEqual(list.slice(2).map((b) => b.id), ["big-high", "small-low", "loan", "no-apr"]);
  });

  test("utilization never targets a card with a $0 or unknown limit", () => {
    const list = priorityList(debtsOf([card("zero", { bal: 5000, limit: 0, apr: 20 }), card("none", { bal: 5000, apr: 20 })]), "utilization");
    assert.ok(list.every((b) => b.phase !== "card_use"));
    assert.ok(list.every((b) => b.floor_cents === 0));
  });
});

describe("one card, worked by hand", () => {
  /* $1,000.00 at 12% APR, $100 a month. Interest, then the payment:
       m1  100000 + 1000 − 10000 = 91000      m7  44632 + 446 − 10000 = 35078
       m2   91000 +  910 − 10000 = 81910      m8  35078 + 351 − 10000 = 25429
       m3   81910 +  819 − 10000 = 72729      m9  25429 + 254 − 10000 = 15683
       m4   72729 +  727 − 10000 = 63456      m10 15683 + 157 − 10000 =  5840
       m5   63456 +  635 − 10000 = 54091      m11  5840 +  58 −  5898 =     0
       m6   54091 +  541 − 10000 = 44632
     Paid off in month 11. Interest 5,898 cents. Month 11 leaves $41.02 unused. */
  const debts = debtsOf([card("c", { bal: 100000, limit: 500000, apr: 12, min: 10000 })]);

  test("payoff month, total interest, and the last month's unused money", () => {
    const sim = simulate(debts, { method: "avalanche", monthlyCents: 10000, asOf: "2026-10-07" });
    assert.equal(sim.ok, true);
    assert.equal(sim.debt_free_month, 11);
    assert.equal(sim.payoff.c, 11);
    assert.equal(sim.interest_cents, 5898);
    assert.deepEqual(sim.rows.map((r) => r.owed_cents).slice(0, 3), [91000, 81910, 72729]);
    assert.equal(sim.rows[10].paid_cents, 5898);
    assert.equal(sim.rows[10].unused_cents, 4102);
    assert.equal(sim.rows[10].end_on, "2027-09-07");
  });

  test("less than the minimum is refused, with the minimum named", () => {
    const sim = simulate(debts, { method: "avalanche", monthlyCents: 9999, asOf: "2026-10-07" });
    assert.equal(sim.ok, false);
    assert.equal(sim.reason.code, "below_minimums");
    assert.equal(sim.reason.minimums_cents, 10000);
  });

  test("when the payment cannot beat the interest, it is never paid off (not a fake date)", () => {
    const tiny = debtsOf([card("c", { bal: 1000000, apr: 24, min: 100 })]);
    const p = buildPlan({ as_of: "2026-10-07", debts: tiny }, { method: "avalanche", monthly_cents: 100 });
    assert.equal(p.ok, true);
    assert.equal(p.debt_free, null);
    assert.equal(p.never_paid_off, true);
    assert.equal(p.months.length, MAX_MONTHS);
  });
});

describe("two cards, worked by hand: minimums first, then the rest down the list", () => {
  /* X $500 at 24% (min $25), Y $300 at 10% (min $25), $200 a month, avalanche.
       m1 X 50000+1000−2500−15000 = 33500   Y 30000+250−2500 = 27750
       m2 X 33500+ 670−2500−15000 = 16670   Y 27750+231−2500 = 25481
       m3 X 16670+ 333−2500−14503 =     0   Y 25481+212−2500−497 = 22696   (X's leftover rolls to Y)
       m4                                   Y 22696+189−2500−17500 = 2885
       m5                                   Y  2885+ 24−2500−409   =    0
     X paid off month 3, Y month 5. Interest: X 2003 + Y 906 = 2909. */
  const raw = [card("X", { bal: 50000, limit: 100000, apr: 24, min: 2500 }), card("Y", { bal: 30000, limit: 100000, apr: 10, min: 2500 })];

  test("avalanche", () => {
    const sim = simulate(debtsOf(raw), { method: "avalanche", monthlyCents: 20000, asOf: "2026-10-07" });
    assert.deepEqual(sim.payoff, { X: 3, Y: 5 });
    assert.equal(sim.interest_cents, 2909);
    assert.deepEqual(sim.interest_by, { X: 2003, Y: 906 });
    assert.equal(sim.rows[0].focus_id, "X");
    assert.equal(sim.rows[3].focus_id, "Y");
  });

  test("snowball pays the smaller one first and costs more interest here", () => {
    const sim = simulate(debtsOf(raw), { method: "snowball", monthlyCents: 20000, asOf: "2026-10-07" });
    assert.ok(sim.payoff.Y < sim.payoff.X);
    assert.ok(sim.interest_cents > 2909);
  });

  test("minimum payments only: each pays its own minimum; nothing moves over", () => {
    const base = minimumOnly(debtsOf(raw));
    assert.equal(base.ok, true);
    assert.ok(base.debt_free_month > 5);
    assert.ok(base.interest_cents > 2909);
    const p = buildPlan({ as_of: "2026-10-07", debts: raw }, { method: "avalanche", monthly_cents: 20000 });
    assert.equal(p.interest_saved_cents, base.interest_cents - 2909);
    assert.equal(p.months_saved, base.debt_free_month - 5);
  });
});

describe("unknown APR, minimum and limit", () => {
  const raw = [
    card("known", { bal: 100000, limit: 500000, apr: 20, min: 3000 }),
    card("no-apr", { bal: 100000, limit: 500000, min: 3000 }),
    card("no-min", { bal: 50000, limit: 0, apr: 18 })
  ];

  test("total interest is null and the reason is named; dates an unknown APR can move are 'at the earliest'", () => {
    const p = buildPlan({ as_of: "2026-10-07", debts: raw }, { method: "avalanche", monthly_cents: 20000 });
    assert.equal(p.ok, true);
    assert.equal(p.interest_cents, null);
    assert.ok(p.interest_known_cents > 0);
    assert.equal(p.interest_saved_cents, null);
    assert.equal(p.interest_saved_reason.code, "apr_unknown");
    assert.deepEqual(p.apr_unknown_ids, ["no-apr"]);
    assert.equal(p.debt_free.earliest, true);
    const per = Object.fromEntries(p.per_debt.map((d) => [d.id, d]));
    assert.equal(per.known.earliest, false, "paid before the unknown-APR card, nothing ahead of it is unknown");
    assert.equal(per["no-apr"].earliest, true);
    assert.equal(per["no-apr"].interest_cents, null);
  });

  test("each missing thing is said, and a $0-limit card gets no card-use step", () => {
    const p = buildPlan({ as_of: "2026-10-07", debts: raw }, { method: "utilization", monthly_cents: 20000 });
    const codes = p.warnings.map((w) => w.code);
    assert.deepEqual(codes, ["apr_unknown", "minimum_unknown", "limit_unknown"]);
    assert.ok(!p.milestones.some((m) => m.debt_id === "no-min" && m.target_pct !== null));
    assert.ok(p.milestones.some((m) => m.key === "no-min:payoff"));
    const per = Object.fromEntries(p.per_debt.map((d) => [d.id, d]));
    assert.equal(per["no-min"].cross.util10, null);
  });

  test("a $0-limit card is left out of card use entirely (no 0% from a $0 limit)", () => {
    const only = buildPlan({ as_of: "2026-10-07", debts: [card("z", { bal: 50000, limit: 0, apr: 18, min: 2500 })] }, { method: "avalanche", monthly_cents: 10000 });
    assert.equal(only.util_start_pct, null);
    assert.ok(only.crossings.every((c) => c.month === null));
  });

  test("a minimum-only comparison needs every minimum, and a $0 minimum is said as such", () => {
    assert.equal(minimumOnly(debtsOf(raw)).reason.code, "minimum_unknown");
    assert.equal(minimumOnly(debtsOf([card("a", { bal: 100, min: 0, apr: 5 })])).reason.code, "minimum_zero");
  });
});

describe("goals: the least money a month that gets there", () => {
  const raw = [card("a", { bal: 300000, limit: 1000000, apr: 22, min: 9000 }), loan("l", { bal: 600000, apr: 7, min: 15000 })];
  const debts = debtsOf(raw);

  test("debt-free by a date: the amount works, and a dollar less does not", () => {
    const r = requiredMonthly(debts, { method: "avalanche", goal: { kind: "debt_free", by: "2028-10-07" }, asOf: "2026-10-07" });
    assert.equal(r.ok, true);
    assert.equal(r.months_available, 24);
    assert.equal(r.monthly_cents % 100, 0, "whole dollars");
    const at = simulate(debts, { method: "avalanche", monthlyCents: r.monthly_cents, asOf: "2026-10-07" });
    assert.ok(at.debt_free_month <= 24);
    const less = simulate(debts, { method: "avalanche", monthlyCents: r.monthly_cents - 100, asOf: "2026-10-07" });
    assert.ok(less.debt_free_month > 24);
  });

  test("card use under 10% by a date depends on the method — card use first needs no more than highest rate first", () => {
    const goal = { kind: "util10", by: "2027-10-07" };
    const util = requiredMonthly(debts, { method: "utilization", goal, asOf: "2026-10-07" });
    const aval = requiredMonthly(debts, { method: "avalanche", goal, asOf: "2026-10-07" });
    assert.equal(util.ok, true);
    assert.ok(util.monthly_cents <= aval.monthly_cents);
    const at = simulate(debts, { method: "utilization", monthlyCents: util.monthly_cents, asOf: "2026-10-07" });
    assert.ok(at.overall_cross[10] <= 12);
  });

  test("already under the target: the answer is the minimums, said as already met", () => {
    const r = requiredMonthly(debts, { method: "avalanche", goal: { kind: "util30", by: "2027-10-07" }, asOf: "2026-10-07" });
    assert.equal(r.already_met, true);
    assert.equal(r.monthly_cents, minimumsCents(debts));
  });

  test("a date less than a month away, or cards with no limit, are refused in words", () => {
    assert.equal(requiredMonthly(debts, { method: "avalanche", goal: { kind: "debt_free", by: "2026-10-20" }, asOf: "2026-10-07" }).reason.code, "goal_too_soon");
    const noLimits = debtsOf([card("x", { bal: 1000, apr: 10, min: 100 })]);
    assert.equal(requiredMonthly(noLimits, { method: "avalanche", goal: { kind: "util10", by: "2027-10-07" }, asOf: "2026-10-07" }).reason.code, "no_limits");
  });
});

describe("cash safety: never past what this month's cash can cover", () => {
  const raw = [
    card("p", { kind: "personal", bal: 200000, limit: 500000, apr: 25, min: 5000 }),
    card("b", { kind: "business", bal: 400000, limit: 1000000, apr: 18, min: 12000 })
  ];
  const debts = debtsOf(raw);

  test("the biggest safe amount fits every kind, and one cent more does not", () => {
    const safeByKind = { personal: 60000, business: 1000000 };
    const max = maxSafeMonthly(debts, { method: "avalanche", safeByKind });
    assert.equal(max.unlimited, false);
    assert.equal(max.binding_kind, "personal");
    assert.ok(month1Payments(debts, "avalanche", max.monthly_cents).by_kind.personal <= 60000);
    assert.ok(month1Payments(debts, "avalanche", max.monthly_cents + 1).by_kind.personal > 60000);
  });

  test("over the safe amount is 'over', with the kind and how much; personal cash never pays business debts", () => {
    const c = cashCheck(debts, { method: "avalanche", monthlyCents: 100000, cash: { by_kind: { personal: { ok: true, safe_cents: 60000 }, business: { ok: true, safe_cents: 1000000 } } } });
    assert.equal(c.status, "over");
    const p = c.by_kind.find((r) => r.kind === "personal");
    assert.equal(p.status, "over");
    assert.equal(p.over_by_cents, p.planned_cents - 60000);
    assert.equal(c.by_kind.find((r) => r.kind === "business").status, "safe");
  });

  test("a kind the server could not check is 'unknown', with the projector's own words, and does not cap", () => {
    const c = cashCheck(debts, { method: "avalanche", monthlyCents: 100000, cash: { by_kind: { personal: { ok: false, code: "UNKNOWN_BALANCE", message: "The balance of account \"Checking\" is unknown." } } } });
    assert.equal(c.status, "unknown");
    assert.equal(c.by_kind[0].reason.code, "UNKNOWN_BALANCE");
    assert.equal(c.max_safe.unlimited, true);
  });

  test("when even the minimums are more than the cash, there is no safe amount", () => {
    const max = maxSafeMonthly(debts, { method: "avalanche", safeByKind: { personal: 1000 } });
    assert.equal(max.monthly_cents, null);
    assert.equal(max.reason.code, "minimums_not_safe");
  });

  test("goal amounts say whether this month's cash can cover them", () => {
    const p = buildPlan({ as_of: "2026-10-07", debts: raw, cash: { by_kind: { personal: { ok: true, safe_cents: 60000 }, business: { ok: true, safe_cents: 1000000 } } } },
      { method: "avalanche", monthly_cents: 20000, goal: { kind: "debt_free", by: "2027-04-07" } });
    assert.equal(p.goal.ok, true);
    assert.equal(p.goal.fits_cash, p.goal.monthly_cents <= p.cash.max_safe.monthly_cents);
  });
});

describe("milestones (the timeline pins)", () => {
  test("under 30%, under 10%, paid off, overall, debt-free — a step in the same month as a bigger one is left out", () => {
    const debts = debtsOf([card("a", { bal: 900000, limit: 1000000, apr: 20, min: 20000 })]);
    const sim = simulate(debts, { method: "utilization", monthlyCents: 100000, asOf: "2026-10-07" });
    const ms = milestones(debts, sim, "2026-10-07", "utilization");
    const keys = ms.map((m) => m.key);
    assert.ok(keys.includes("a:util30") && keys.includes("a:util10") && keys.includes("a:payoff") && keys.includes("debt_free"));
    for (const m of ms) assert.equal(m.date, addMonths("2026-10-07", m.month));
    const big = simulate(debts, { method: "utilization", monthlyCents: 2000000, asOf: "2026-10-07" });
    const once = milestones(debts, big, "2026-10-07", "utilization").map((m) => m.key);
    assert.deepEqual(once, ["a:payoff", "overall:util10", "debt_free"], "all in month 1: the payoff covers the card's own steps; 10% covers 30%");
  });

  test("a card already under a target gets no step for it", () => {
    const debts = debtsOf([card("a", { bal: 50000, limit: 1000000, apr: 20, min: 2500 })]);
    const p = buildPlan({ as_of: "2026-10-07", debts }, { method: "avalanche", monthly_cents: 10000 });
    assert.ok(!p.milestones.some((m) => m.target_pct !== null && m.debt_id === "a"));
    assert.equal(p.crossings.find((c) => c.pct === 10).already, true);
  });
});

describe("the real read of the test client (Plaid sandbox + Sample Chase Ink + SBA Loan), $1,500 a month", () => {
  /* src/http/fixtures/money-strategy.sample.json is GET /api/money/strategy for
     client f1cb9c27… read inside BEGIN READ ONLY on 2026-10-07 (UTC). One file:
     Business Amex $5,400 / $25,000 at 18.24%, Personal Visa $1,320.40 / $8,000
     at 24.99%, Sample Chase Ink $2,000 / $10,000 with no APR or minimum, SBA Loan
     $48,000 at $1,050 a month with no rate. These dates are the proof run. */
  const run = (method) => buildPlan(FIXTURE.inputs, { method, monthly_cents: 150000 });

  test("minimums are $1,225 and this month's cash covers the plan", () => {
    const p = run("avalanche");
    assert.equal(p.minimums_cents, 122500);
    assert.equal(p.cash.status, "safe");
    assert.equal(p.cash.max_safe.monthly_cents, 1979790);
  });

  test("payoff dates for all three methods", () => {
    const dates = Object.fromEntries(METHODS.map((m) => {
      const p = run(m);
      return [m, { debtFree: p.debt_free.on, per: Object.fromEntries(p.per_debt.map((d) => [p.debts.find((x) => x.id === d.id).name, d.payoff_on])) }];
    }));
    assert.deepEqual(dates.avalanche, { debtFree: "2030-01-07", per: { "Business Amex": "2028-04-07", "Personal Visa": "2027-03-07", "Sample Chase Ink": "2028-08-07", "SBA Loan": "2030-01-07" } });
    assert.deepEqual(dates.utilization, { debtFree: "2030-01-07", per: { "Business Amex": "2028-06-07", "Personal Visa": "2028-02-07", "Sample Chase Ink": "2028-09-07", "SBA Loan": "2030-01-07" } });
    assert.deepEqual(dates.snowball, { debtFree: "2030-01-07", per: { "Business Amex": "2028-09-07", "Personal Visa": "2027-03-07", "Sample Chase Ink": "2027-09-07", "SBA Loan": "2030-01-07" } });
  });

  test("card use is 20.3% now — already under 30% — and gets under 10% at the earliest by Oct 2027", () => {
    const p = run("avalanche");
    assert.equal(p.util_start_pct, 20.3);
    assert.deepEqual(p.crossings.map((c) => [c.pct, c.already, c.on, c.earliest]), [[30, true, "2026-10-07", false], [10, false, "2027-10-07", true]]);
  });

  test("TARGETS cite the engine files they were read from", () => {
    assert.match(TARGETS[0].source, /src\/underwrite\/vendor\/underwriter\.cjs/);
    assert.match(TARGETS[1].source, /optimization-findings\.js/);
    assert.equal(payoffAllCents(debtsOf(FIXTURE.inputs.debts)) > 0, true);
  });
});
