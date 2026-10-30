// GET /api/read/invoices — invoices with balance_due and days overdue COMPUTED
// by the 031 views, never stored
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { invoiceStatusFilter } from "../../src/invoices/ar-filter.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

/* ?status=open IS ANSWERED BY A BALANCE, NOT BY A STATUS (walk fix 2026-09-06).
   'open' is not one of the eight values invoices_status_check permits, so
   `v.status = 'open'` matched nothing and the AR table on ops-admin.html read
   "No unpaid invoices" while a real, sent, unpaid $5,000 invoice sat in the
   table. The vocabulary and the reasoning live in src/invoices/ar-filter.mjs;
   here it is one extra bound parameter. An unrecognised status is a 400 rather
   than an empty list, so the next screen that invents one hears about it.

   READS v_invoice_aging, NOT v_invoice_balance. The aging view is
   `SELECT b.* FROM v_invoice_balance b` plus days_overdue, is_overdue,
   aging_bucket and status_reconciled — a strict superset, no new migration, and
   the overdue arithmetic stays in the one place 031 put it instead of being
   re-derived in browser JavaScript from a due_at that is very often NULL.

   THE CLIENT'S NAME comes back because the AR table was printing a raw UUID in
   a column headed "Client". COALESCE falls back to the client code and then to
   NULL — never to a dash or a placeholder name. A screen that cannot name
   somebody has to say so itself; this endpoint will not invent one. */
/* 031's v_invoice_balance builds client_code from a client join by ID alone.
   A legacy invoice can have org=A and client=B (the original FK is not
   org-scoped); a LEFT JOIN here would still return B's client_code and ID to
   company A even when the separate name join returns NULL. This owned-client
   INNER JOIN deliberately refuses that inconsistent row on all finance reads.
   Export the exact production query for rollback-only real-Postgres checks. */
export const AR_INVOICE_LIST_SQL = `SELECT v.invoice_id AS id, v.client_id, v.client_code,
           NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS client_name,
           NULLIF(BTRIM(s.name), '') AS owner_name,
           pay.payment_method,
           v.source, v.status, v.currency,
           v.amount_due, v.amount_paid, v.balance_due, v.open_balance, v.settlement_state,
           v.payment_count, v.last_payment_at, v.due_at, v.sent_at, v.paid_at,
           v.reminder_count, v.escalated_at, v.written_off_at, v.voided_at, v.created_at,
           v.days_overdue, v.is_overdue, v.aging_bucket
      FROM v_invoice_aging v
      JOIN invoices i ON i.id = v.invoice_id
      JOIN clients c ON c.id = v.client_id AND c.org_id = v.org_id
      LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
      LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(p.method), '') AS payment_method
          FROM invoice_payments p
         WHERE p.invoice_id = v.invoice_id AND p.org_id = v.org_id
         ORDER BY p.paid_at DESC, p.created_at DESC
         LIMIT 1
      ) pay ON true
     WHERE v.org_id = $5::uuid
       AND c.custom_fields->>'crm_archived_at' IS NULL
       AND ($3::uuid IS NULL OR v.client_id = $3)
       AND ($4::text IS NULL OR v.status = $4)
       AND ($6::boolean IS NOT TRUE OR v.open_balance > 0)
       AND COALESCE(i.is_demo, false) = false
     -- "Oldest Unpaid First" is the heading on the screen that asks for this, so
     -- the OPEN filter is ordered that way at the server too. LIMIT applies
     -- before the browser can sort, and created_at DESC would hand back the
     -- fifty NEWEST unpaid bills — dropping exactly the old ones AR exists to
     -- chase. The two CASE keys collapse to NULL for every other caller, which
     -- leaves the original newest-first ordering untouched.
     ORDER BY CASE WHEN $6::boolean IS TRUE THEN v.due_at END ASC NULLS LAST,
              CASE WHEN $6::boolean IS TRUE THEN v.created_at END ASC,
              v.created_at DESC
     LIMIT $1 OFFSET $2`;

const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  fetch: (db, { limit, offset, query, staff }) => {
    const filter = invoiceStatusFilter(query.status);
    if (!filter.valid) {
      const err = new Error(filter.message);
      err.code = "BAD_REQUEST";
      throw err;
    }
    return db.query(AR_INVOICE_LIST_SQL, [
      limit + 1,
      offset,
      query.client_id || null,
      filter.status,
      orgOf(staff),
      filter.openOnly
    ]).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth });
