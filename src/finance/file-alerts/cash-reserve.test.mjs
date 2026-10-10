// Alert 3 — the cash cushion. Pure: no database, no clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { evaluateReserve, planCashReserve, CASH_KINDS } from "./cash-reserve.mjs";
import { RESERVE_MONTHS, CLARITY_CASH_KIND, TEMPLATES } from "./common.mjs";

const cash = (cents, accounts = 1, is_floor = false) => ({ cents, is_floor, accounts });
const debt = (kind, min, balance = 100000, id = `${kind}-${min}`) => ({ id, kind, type: "card", balance_cents: balance, min_cents: min });

describe("evaluateReserve — six months of minimums", () => {
  test("the rule is six", () => {
    assert.equal(RESERVE_MONTHS, 6);
    assert.deepEqual([...CASH_KINDS], ["personal", "business"]);
  });

  test("below: cash under 6 x the minimums, with the shortfall", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(400000), debts: [debt("personal", 50000), debt("personal", 20000)] });
    assert.equal(v.state, "below");
    assert.equal(v.minimums_cents, 70000);
    assert.equal(v.need_cents, 420000);
    assert.equal(v.short_cents, 20000);
    assert.equal(v.months, 6);
  });

  test("exactly the need is covered, not below", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(420000), debts: [debt("personal", 70000)] });
    assert.equal(v.state, "ok");
    assert.equal(v.short_cents, null);
  });

  test("a loan's monthly payment counts the same as a card's minimum (the overview maps both to min_cents)", () => {
    const loan = { id: "l", kind: "business", type: "loan", balance_cents: 4800000, min_cents: 105000 };
    const v = evaluateReserve({ kind: "business", cash: cash(500000), debts: [loan] });
    assert.equal(v.minimums_cents, 105000);
    assert.equal(v.state, "below");
  });

  test("a card with nothing owed counts as zero; one with an unknown balance still counts its minimum", () => {
    const v = evaluateReserve({
      kind: "personal", cash: cash(10_000_000),
      debts: [debt("personal", 9999, 0, "paid"), debt("personal", 30000, null, "unknown-balance")]
    });
    assert.equal(v.minimums_cents, 30000);
  });
});

describe("evaluateReserve — personal and business are never added together", () => {
  const debts = [debt("personal", 50000), debt("business", 120000)];

  test("plenty of business cash does not rescue short personal cash, and the reverse", () => {
    const personal = evaluateReserve({ kind: "personal", cash: cash(100000), debts });
    const business = evaluateReserve({ kind: "business", cash: cash(9_000_000), debts });
    assert.equal(personal.state, "below");
    assert.equal(business.state, "ok");
    assert.equal(personal.cash_cents, 100000, "personal is judged on personal cash only");
    assert.equal(business.cash_cents, 9_000_000);
    assert.equal(personal.minimums_cents, 50000, "and only personal minimums");
    assert.equal(business.minimums_cents, 120000);
  });

  test("a card or loan whose kind is not sorted is in NEITHER check", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(1_000_000), debts: [debt("unknown", 500000), debt("personal", 10000)] });
    assert.equal(v.minimums_cents, 10000);
    const none = evaluateReserve({ kind: "business", cash: cash(1), debts: [debt("unknown", 500000)] });
    assert.equal(none.state, "unknown");
    assert.equal(none.reason, "no_minimums");
  });

  test("no verdict carries a combined total", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(1), debts });
    assert.equal(Object.keys(v).some((k) => /total|combined/i.test(k)), false);
  });
});

describe("evaluateReserve — Fundhub payment plans (Clarity) count against ONE kind", () => {
  test("they are in the personal need and never in the business need", () => {
    assert.equal(CLARITY_CASH_KIND, "personal");
    const debts = [debt("personal", 6602), debt("business", 27000)];
    const personal = evaluateReserve({ kind: "personal", cash: cash(421055), debts, clarityMonthlyCents: 65000 });
    const business = evaluateReserve({ kind: "business", cash: cash(1875000), debts, clarityMonthlyCents: 65000 });
    assert.equal(personal.minimums_cents, 71602);
    assert.equal(personal.clarity_cents, 65000);
    assert.equal(personal.need_cents, 429612);
    assert.equal(personal.state, "below");
    assert.equal(personal.short_cents, 8557);
    assert.equal(business.minimums_cents, 27000);
    assert.equal(business.clarity_cents, null);
  });

  test("a plan alone is enough to have a need", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(100000), debts: [], clarityMonthlyCents: 65000 });
    assert.equal(v.state, "below");
    assert.equal(v.need_cents, 390000);
  });
});

describe("evaluateReserve — what is not known is not guessed", () => {
  test("an unknown minimum is NOT counted as zero: the need becomes a floor, and a shortfall against it is still real", () => {
    const v = evaluateReserve({ kind: "business", cash: cash(500000), debts: [debt("business", 100000), debt("business", null, 200000, "no-min")] });
    assert.equal(v.minimums_is_floor, true);
    assert.equal(v.unknown_minimums, 1);
    assert.equal(v.need_cents, 600000);
    assert.equal(v.state, "below");
  });

  test("every minimum unknown: nothing to judge", () => {
    const v = evaluateReserve({ kind: "business", cash: cash(0), debts: [debt("business", null, 200000, "a")] });
    assert.equal(v.state, "unknown");
    assert.equal(v.reason, "minimums_unknown");
  });

  test("no debts at all: nothing to judge", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(0), debts: [] });
    assert.equal(v.state, "unknown");
    assert.equal(v.reason, "no_minimums");
  });

  test("no cash accounts is unknown, not $0 — an empty pile is not a drop", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(null, 0), debts: [debt("personal", 50000)] });
    assert.equal(v.state, "unknown");
    assert.equal(v.reason, "no_cash_accounts");
  });

  test("accounts whose balances are all missing: unknown, with its own reason", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(null, 2, true), debts: [debt("personal", 50000)] });
    assert.equal(v.state, "unknown");
    assert.equal(v.reason, "cash_unknown");
  });

  test("a stale balance is not today's cash", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(1), debts: [debt("personal", 50000)], staleBalance: true });
    assert.equal(v.state, "unknown");
    assert.equal(v.reason, "balance_stale");
  });

  test("a cash total with a hole in it is a floor: covering the need is ok, falling short proves nothing", () => {
    const covers = evaluateReserve({ kind: "personal", cash: cash(400000, 2, true), debts: [debt("personal", 50000)] });
    assert.equal(covers.state, "ok");
    const short = evaluateReserve({ kind: "personal", cash: cash(100000, 2, true), debts: [debt("personal", 50000)] });
    assert.equal(short.state, "unknown");
    assert.equal(short.reason, "cash_is_a_floor");
  });

  test("an overdrawn account is a real number, and below", () => {
    const v = evaluateReserve({ kind: "personal", cash: cash(-2500), debts: [debt("personal", 50000)] });
    assert.equal(v.state, "below");
    assert.equal(v.short_cents, 302500);
  });
});

describe("planCashReserve", () => {
  const verdict = evaluateReserve({
    kind: "personal", cash: cash(421055),
    debts: [debt("personal", 6602)], clarityMonthlyCents: 65000
  });

  test("the text names the kind of cash and the two numbers, and says 'next funding sequence'", () => {
    const p = planCashReserve(verdict, { clientId: "client-1", episode: 1 });
    assert.equal(p.alert, true);
    assert.equal(p.templateKey, TEMPLATES.cash_reserve);
    assert.equal(p.cashKind, "personal");
    assert.equal(p.threshold, 6);
    assert.equal(
      p.body,
      "Fundhub alert: your personal cash is $4,210.55. 6 months of your personal minimum payments is $4,296.12. " +
      "A missed payment can hurt your file before your next funding sequence."
    );
    assert.doesNotMatch(p.body, /round two|round 2/i);
  });

  test("the key is the client, the kind of cash and which drop it is", () => {
    assert.equal(planCashReserve(verdict, { clientId: "client-1", episode: 1 }).key, "fpa:cash:client-1:personal:1");
    assert.equal(planCashReserve(verdict, { clientId: "client-1", episode: 2 }).key, "fpa:cash:client-1:personal:2");
  });

  test("a floor on the minimums reads 'at least'", () => {
    const v = evaluateReserve({ kind: "business", cash: cash(1), debts: [debt("business", 100000), debt("business", null, 5, "x")] });
    assert.match(planCashReserve(v, { clientId: "c", episode: 1 }).body, /is at least \$6,000\.00\./);
  });

  test("only a 'below' verdict makes an alert", () => {
    for (const state of ["ok", "unknown"]) assert.equal(planCashReserve({ ...verdict, state }, { clientId: "c" }), null);
    assert.equal(planCashReserve(null, { clientId: "c" }), null);
  });
});
