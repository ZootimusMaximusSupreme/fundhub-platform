// Important bills — the read the Alerts screen and the daily pass share, and the
// one write the client makes: "this repeat bill matters to me".
//
// THE READ IS THE BILL STORE'S OWN. listRecurringBills (src/banking/store.mjs)
// with presentableOnly: medium and high confidence only. A low-confidence guess
// is not a bill (src/banking/recurring.mjs section 2), so it is never listed and
// can never be marked.
//
// THE WRITE TOUCHES THREE COLUMNS: important, important_set_at, important_set_by
// (db/migrations/573_finance_phone_alerts.sql). The detector's re-run never names
// them, so a bill found again keeps its mark. Every write is filtered on org_id
// AND client_id; a bill that is not this client's is a 404, never a hint the id
// is real. Nothing here sends.

import { listRecurringBills } from "../../banking/store.mjs";
import { FileAlertInputError } from "./store.mjs";
import { billDay, billLabel } from "./phone-alerts.mjs";

/** The client's repeat bills, raw rows, the way the store reads them. */
export async function listAlertBills(conn, { orgId, clientId }) {
  return listRecurringBills(conn, { orgId, clientId, presentableOnly: true, limit: 200 });
}

/** One bill as the screen shows it. Money is integer cents, shown as an outflow's size. */
export function billView(row) {
  const typical = row.typical_amount_cents === null || row.typical_amount_cents === undefined
    ? null : Number(row.typical_amount_cents);
  return {
    id: String(row.id),
    name: billLabel(row),
    cadence: row.cadence ?? null,
    // A bill is stored negative (money out). The screen shows how big the charge is.
    typical_cents: Number.isFinite(typical) ? Math.abs(typical) : null,
    next_expected_on: billDay(row.next_expected_on),
    next_unknown_reason: row.next_expected_unknown_reason ?? null,
    important: row.important === true,
    bank_account_id: row.bank_account_id ? String(row.bank_account_id) : null
  };
}

/**
 * setBillImportant(conn, { orgId, clientId, billId, important, by }) → { bill_id, important }
 */
export async function setBillImportant(conn, { orgId, clientId, billId, important, by }) {
  if (typeof important !== "boolean") throw new FileAlertInputError("important", "important must be true or false");
  const setBy = by === "staff" ? "staff" : "client";
  const r = await conn.query(
    `UPDATE recurring_bills
        SET important = $4, important_set_at = now(), important_set_by = $5, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND confidence_label IN ('medium', 'high')
      RETURNING id, important`,
    [billId, orgId, clientId, important, setBy]
  );
  const row = r.rows[0];
  if (!row) throw new FileAlertInputError("bill_id", "no such bill", 404);
  return { bill_id: String(row.id), important: row.important === true };
}

export default { listAlertBills, setBillImportant, billView };
