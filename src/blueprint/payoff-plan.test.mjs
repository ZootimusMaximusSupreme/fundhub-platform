import test from "node:test";
import assert from "node:assert/strict";
import { planMonthlyDebtPayments as plan, PayoffPlanError, MAX_PAYOFF_DEBTS } from "./payoff-plan.mjs";

const debt = (id, balanceCents, aprBps = 2000, minimumPaymentCents = 1000) => ({ id, label: `Account ${id}`, balanceCents, aprBps, minimumPaymentCents });
const input = overrides => ({ strategy: "snowball", monthlyBudgetCents: 10_000, debts: [debt("small", 20_000, 500), debt("large", 80_000, 3000)], ...overrides });

test("snowball protects all minimums before directing extra to the smallest balance", () => {
  const result = plan(input());
  assert.equal(result.status, "ready");
  assert.deepEqual(result.priority, ["small", "large"]);
  assert.deepEqual(result.debts.map(row => [row.id, row.minimumAllocationCents, row.extraAllocationCents, row.allocationCents]), [["small", 1000, 8000, 9000], ["large", 1000, 0, 1000]]);
  assert.equal(result.requiredMinimumTotalCents, 2000);
  assert.equal(result.allocatedCents, 10_000);
  assert.equal(result.unallocatedCents, 0);
});

test("avalanche directs extra to the highest actual APR instead of the smallest balance", () => {
  const result = plan(input({ strategy: "avalanche" }));
  assert.deepEqual(result.priority, ["large", "small"]);
  assert.equal(result.debts.find(row => row.id === "large").allocationCents, 9000);
  assert.equal(result.debts.find(row => row.id === "small").allocationCents, 1000);
});

test("extra moves to the next account when this month's allocation reaches the actual balance", () => {
  const result = plan(input({ monthlyBudgetCents: 7000, debts: [debt("small", 2000, 0, 500), debt("large", 8000, 1500, 1000)] }));
  assert.deepEqual(result.debts.map(row => row.allocationCents), [2000, 5000]);
  const overfunded = plan(input({ monthlyBudgetCents: 12_000, debts: [debt("small", 2000), debt("large", 8000)] }));
  assert.equal(overfunded.allocatedCents, 10_000);
  assert.equal(overfunded.unallocatedCents, 2000);
});

test("a minimum greater than the current balance is capped without changing the saved minimum", () => {
  const result = plan(input({ monthlyBudgetCents: 1000, debts: [debt("a", 200, 0, 500)] }));
  assert.equal(result.debts[0].minimumPaymentCents, 500);
  assert.equal(result.debts[0].minimumDueCents, 200);
  assert.equal(result.debts[0].allocationCents, 200);
  assert.equal(result.unallocatedCents, 800);
});

test("missing minimum or budget stays unknown and never creates an invented allocation", () => {
  for (const candidate of [input({ monthlyBudgetCents: null }), input({ debts: [debt("a", 10_000, 2000, null)] })]) {
    const result = plan(candidate);
    assert.equal(result.status, "review_needed");
    assert.equal(result.allocatedCents, null);
    assert.equal(result.unallocatedCents, null);
    assert.ok(result.debts.every(row => row.allocationCents === null && row.minimumAllocationCents === null && row.extraAllocationCents === 0));
  }
  const missing = plan(input({ debts: [debt("a", 10_000, 2000, null)] }));
  assert.equal(missing.requiredMinimumTotalCents, null);
  assert.equal(missing.minimumShortfallCents, null);
  assert.equal(missing.debts[0].minimumPaymentCents, null);
});

test("unknown APR blocks avalanche ordering but not balance-based snowball", () => {
  const candidate = input({ debts: [debt("a", 1000, null), debt("b", 2000, 0)] });
  assert.equal(plan(candidate).status, "ready");
  const result = plan({ ...candidate, strategy: "avalanche" });
  assert.equal(result.status, "review_needed");
  assert.deepEqual(result.priority, []);
  assert.equal(result.debts[0].aprBps, null);
  assert.ok(result.debts.every(row => row.priorityRank === null && row.allocationCents === null));
  assert.deepEqual(result.reviewReasons, [{ code: "apr_missing", debtId: "a" }]);
});

test("known minimum shortfall takes priority, with no proposed extras or partial-payment guesses", () => {
  const result = plan(input({ monthlyBudgetCents: 1500 }));
  assert.equal(result.status, "minimum_shortfall");
  assert.equal(result.minimumShortfallCents, 500);
  assert.equal(result.allocatedCents, null);
  assert.ok(result.debts.every(row => row.extraAllocationCents === 0 && row.allocationCents === null));
  const lowerBound = plan(input({ monthlyBudgetCents: 100, debts: [debt("known", 1000, 2000, 500), debt("unknown", 2000, null, null)] }));
  assert.equal(lowerBound.status, "minimum_shortfall");
  assert.equal(lowerBound.requiredMinimumTotalCents, null);
  assert.equal(lowerBound.knownMinimumTotalCents, 500);
  assert.equal(lowerBound.minimumShortfallCents, 400);
});

test("zero budget, APR, minimum and balance remain real zero values", () => {
  const result = plan(input({ monthlyBudgetCents: 0, strategy: "avalanche", debts: [debt("a", 0, 0, 0), debt("b", 1000, 0, 0)] }));
  assert.equal(result.status, "ready");
  assert.equal(result.allocatedCents, 0);
  assert.equal(result.minimumShortfallCents, 0);
  assert.deepEqual(result.priority, ["b"]);
  assert.ok(result.debts.every(row => row.aprBps === 0 && row.minimumDueCents === 0 && row.allocationCents === 0));
  assert.equal(plan(input({ monthlyBudgetCents: 0 })).status, "minimum_shortfall");
});

test("ties are stable across input order and the caller's records are never mutated", () => {
  const debts = [debt("b", 5000, 2000), debt("a", 5000, 2000)].map(Object.freeze);
  const frozen = Object.freeze(input({ debts: Object.freeze(debts) }));
  assert.deepEqual(plan(frozen), plan(input({ debts: [...debts].reverse() })));
  assert.deepEqual(plan(frozen).priority, ["a", "b"]);
});

test("allocation conserves integer cents across twenty rows and many budget sizes", () => {
  const debts = Array.from({ length: MAX_PAYOFF_DEBTS }, (_, index) => debt(String(index), 100 + index * 127, 1000 + index * 53, index * 5));
  const minimums = debts.reduce((sum, row) => sum + row.minimumPaymentCents, 0);
  const balances = debts.reduce((sum, row) => sum + row.balanceCents, 0);
  for (const strategy of ["snowball", "avalanche"]) for (const extra of [0, 1, 99, 1234, 999_999]) {
    const result = plan({ strategy, monthlyBudgetCents: minimums + extra, debts });
    assert.equal(result.status, "ready");
    assert.equal(result.allocatedCents + result.unallocatedCents, minimums + extra);
    assert.equal(result.allocatedCents, Math.min(minimums + extra, balances));
    for (const row of result.debts) assert.ok(Number.isSafeInteger(row.allocationCents) && row.allocationCents >= row.minimumDueCents && row.allocationCents <= row.balanceCents);
  }
});

test("invalid, duplicate, oversized and unsafe inputs are refused", () => {
  for (const candidate of [null, input({ strategy: "guess" }), input({ monthlyBudgetCents: -1 }), input({ monthlyBudgetCents: undefined }), input({ debts: [debt("a", 1.5)] }), input({ debts: [debt("a", 500), debt("a", 600)] }), input({ debts: Array.from({ length: 21 }, (_, i) => debt(String(i), 100)) }), input({ debts: [debt("a", Number.MAX_SAFE_INTEGER), debt("b", Number.MAX_SAFE_INTEGER)] })]) {
    assert.throws(() => plan(candidate), PayoffPlanError);
  }
});
