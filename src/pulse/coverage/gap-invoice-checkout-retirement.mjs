import {
  INVOICE_CHECKOUT_RETIREMENT_SQL,
  retirementProblems
} from "../beats/lib/invoice-checkout-retirement-truth.mjs";

export async function gapChecks(ctx = {}) {
  const id = "payments:invoice-checkout-retirement";
  if (!ctx.db?.query) return [{ id, status: "skip", detail: "No database read available for fee checkout retirement." }];
  try {
    const result = await ctx.db.query(INVOICE_CHECKOUT_RETIREMENT_SQL);
    const verdict = retirementProblems(result.rows[0]);
    return [{ id, status: verdict.healthy ? "PASS" : "FAIL", detail: verdict.detail,
      suggestedFix: verdict.healthy ? null : "Check the fee invoice and its Commas checkout retirement; retry the expired link cleanup." }];
  } catch (err) {
    return [{ id, status: "skip", detail: `Could not read fee checkout retirement: ${String(err?.message || err).slice(0, 120)}` }];
  }
}
