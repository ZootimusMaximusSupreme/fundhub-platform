// A confirmed ClickFunnels call older than the delivery window must have a Cortana receipt.
// Read only: this judges the buyer's booking result, not merely whether the clock ran.
import { CORTANA_UNDELIVERED_SQL, CORTANA_CHECK_ID, judgeCortanaBooking } from "../beats/lib/cortana-booking-truth.mjs";

export { CORTANA_UNDELIVERED_SQL };

export async function gapChecks(ctx = {}) {
  const id = CORTANA_CHECK_ID;
  const read = typeof ctx.scope === "function"
    ? (sql, params) => ctx.scope((tx) => tx.query(sql, params))
    : ctx.db?.query?.bind(ctx.db);
  if (!read) return [{ id, status: "skip", detail: "No database read for Cortana booking receipts." }];
  try {
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    const result = await read(CORTANA_UNDELIVERED_SQL, [now]);
    return [judgeCortanaBooking(result.rows[0])];
  } catch (err) {
    return [{ id, status: "skip", detail: `Could not read Cortana booking receipts: ${String(err?.message || err).slice(0, 120)}` }];
  }
}
