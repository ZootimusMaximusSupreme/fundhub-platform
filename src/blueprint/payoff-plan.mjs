// A current-month planning calculation, never a payment or payoff forecast.
// CFPB: smallest balance (snowball) or highest rate, then redirect payments.
export const PAYOFF_SOURCE_URL = "https://www.consumerfinance.gov/documents/5782/cfpb_ymyg-toolkit_reducing-debt-worksheet.pdf";
export const MAX_PAYOFF_DEBTS = 20;
export const PAYOFF_STRATEGIES = Object.freeze(["snowball", "avalanche"]);

export class PayoffPlanError extends Error {
  constructor(code, field) {
    super(`Check ${field || "the payment plan"}.`);
    this.name = "PayoffPlanError";
    this.code = code;
    this.field = field || null;
  }
}
const fail = (code, field) => { throw new PayoffPlanError(code, field); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function integer(value, field, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail("payoff_invalid_number", field);
  return value;
}
function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("payoff_invalid_text", field);
  return value.trim();
}
function total(rows, value) {
  return rows.reduce((sum, row) => {
    const next = sum + value(row);
    if (!Number.isSafeInteger(next)) fail("payoff_total_out_of_range", "debt totals");
    return next;
  }, 0);
}
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Input: {strategy, monthlyBudgetCents: number|null, debts: [{id,label,
 * balanceCents, aprBps:number|null, minimumPaymentCents:number|null}]}.
 * The monthly budget must already exclude bills, buffer and bank reserves.
 * Unknown inputs and minimum shortfalls produce no speculative allocations.
 * A known shortfall is a lower bound if other minimums are still unknown.
 */
export function planMonthlyDebtPayments(input) {
  if (!object(input)) fail("payoff_invalid_input");
  if (!PAYOFF_STRATEGIES.includes(input.strategy)) fail("payoff_invalid_strategy", "strategy");
  const strategy = input.strategy;
  const monthlyBudgetCents = integer(input.monthlyBudgetCents, "monthly budget", true);
  if (!Array.isArray(input.debts) || input.debts.length > MAX_PAYOFF_DEBTS) fail("payoff_invalid_debts", "debts (up to 20)");
  const rows = input.debts.map((row, index) => {
    if (!object(row)) fail("payoff_invalid_debt", `debt ${index + 1}`);
    const balanceCents = integer(row.balanceCents, "balance");
    const minimumPaymentCents = integer(row.minimumPaymentCents, "minimum payment", true);
    return { id: text(row.id, "debt ID", 100), label: text(row.label, "debt label", 150),
      balanceCents, aprBps: integer(row.aprBps, "APR in basis points", true), minimumPaymentCents,
      minimumDueCents: minimumPaymentCents === null ? null : Math.min(balanceCents, minimumPaymentCents) };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) fail("payoff_duplicate_debt", "debt IDs");

  const reviewReasons = [];
  if (monthlyBudgetCents === null) reviewReasons.push({ code: "monthly_budget_missing" });
  for (const row of [...rows].sort(byId)) {
    if (row.minimumPaymentCents === null) reviewReasons.push({ code: "minimum_payment_missing", debtId: row.id });
    if (strategy === "avalanche" && row.aprBps === null) reviewReasons.push({ code: "apr_missing", debtId: row.id });
  }
  const missingMinimum = rows.some(row => row.minimumDueCents === null);
  const missingRate = strategy === "avalanche" && rows.some(row => row.aprBps === null);
  const totalBalanceCents = total(rows, row => row.balanceCents);
  const knownMinimumTotalCents = total(rows, row => row.minimumDueCents ?? 0);
  const requiredMinimumTotalCents = missingMinimum ? null : knownMinimumTotalCents;
  const knownShortfall = monthlyBudgetCents === null ? null : Math.max(0, knownMinimumTotalCents - monthlyBudgetCents);
  const minimumShortfallCents = knownShortfall > 0 ? knownShortfall : missingMinimum || monthlyBudgetCents === null ? null : 0;
  const status = knownShortfall > 0 ? "minimum_shortfall" : reviewReasons.length ? "review_needed" : "ready";
  if (status === "minimum_shortfall") reviewReasons.push({ code: "minimum_budget_shortfall" });

  const ordered = [...rows].sort((a, b) => {
    if (a.balanceCents === 0 || b.balanceCents === 0) return (a.balanceCents === 0 ? 1 : 0) - (b.balanceCents === 0 ? 1 : 0) || byId(a, b);
    if (missingRate) return byId(a, b);
    if (strategy === "avalanche" && a.aprBps !== b.aprBps) return a.aprBps > b.aprBps ? -1 : 1;
    return a.balanceCents === b.balanceCents ? byId(a, b) : a.balanceCents < b.balanceCents ? -1 : 1;
  });
  const priority = missingRate ? [] : ordered.filter(row => row.balanceCents > 0).map(row => row.id);
  let extraRemaining = status === "ready" ? monthlyBudgetCents - knownMinimumTotalCents : 0;
  const debts = ordered.map(row => {
    const priorityIndex = priority.indexOf(row.id);
    if (status !== "ready") return { ...row, priorityRank: priorityIndex < 0 ? null : priorityIndex + 1,
      minimumAllocationCents: null, extraAllocationCents: 0, allocationCents: null };
    const minimumAllocationCents = row.minimumDueCents;
    const extraAllocationCents = Math.min(extraRemaining, row.balanceCents - minimumAllocationCents);
    extraRemaining -= extraAllocationCents;
    return { ...row, priorityRank: priorityIndex < 0 ? null : priorityIndex + 1,
      minimumAllocationCents, extraAllocationCents, allocationCents: minimumAllocationCents + extraAllocationCents };
  });
  const allocatedCents = status === "ready" ? total(debts, row => row.allocationCents) : null;
  return { status, strategy, monthlyBudgetCents, totalBalanceCents, knownMinimumTotalCents,
    requiredMinimumTotalCents, minimumShortfallCents, allocatedCents,
    unallocatedCents: allocatedCents === null ? null : monthlyBudgetCents - allocatedCents,
    priority, debts, reviewReasons };
}
