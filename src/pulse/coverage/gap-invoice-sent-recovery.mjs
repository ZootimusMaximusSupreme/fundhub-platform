import { RECOVERY_STUCK_SQL } from "../../workflows/invoice-sent-recovery-query.mjs";

export async function gapChecks(ctx = {}) {
  const id = "payments:invoice-sent-recovery";
  if (!ctx.db?.query) return [{ id, status: "skip", detail: "No database read available for invoice notice recovery." }];
  try {
    const result = await ctx.db.query(RECOVERY_STUCK_SQL);
    const stuck = Number(result.rows[0]?.stuck || 0);
    return [{
      id,
      status: stuck === 0 ? "PASS" : "FAIL",
      detail: stuck === 0 ? "No aged fee invoices lack checkout or first-notice progress." :
        `${stuck} aged fee invoice${stuck === 1 ? "" : "s"} lack checkout or first-notice progress.`,
      suggestedFix: stuck === 0 ? null : "Check the invoice.sent recovery run and AR-01 failure before resending."
    }];
  } catch (err) {
    return [{ id, status: "skip", detail: `Could not read fee invoice notice recovery: ${String(err?.message || err).slice(0, 120)}` }];
  }
}
