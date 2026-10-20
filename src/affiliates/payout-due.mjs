/* The affiliate payout due day, on its own with no imports, so the pulse can
 * read it without pulling in any code that sends money.
 *
 * Agent-set 2026-10-20 (Chris: "no preference"): a payout run is due on the
 * 15th of the month after the month the commission was earned. The monthly run
 * (src/affiliates/payouts.mjs) is built on the 1st for the month before, so its
 * period_end is the 1st and the due day is period_end + 14 days. The same rule
 * is in the database: db/migrations/492_affiliate_payout_rail.sql.
 */

export const DUE_DAYS_AFTER_PERIOD = 14;
/** affiliate_payouts.method for a payout sent through Plaid Transfer. */
export const PLAID_METHOD = "plaid_transfer";

/** The due day (YYYY-MM-DD) for a run whose half-open period ends at periodEnd. */
export function dueOnFor(periodEnd) {
  const end = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return null;
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + DUE_DAYS_AFTER_PERIOD));
  return d.toISOString().slice(0, 10);
}
