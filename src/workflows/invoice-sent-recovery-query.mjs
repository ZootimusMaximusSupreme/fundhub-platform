// The read-only eligibility and stuck-invoice SQL live under beats/lib so the
// hourly check and the morning gap cannot drift from the recovery clock.
import {
  ELIGIBLE_INVOICE_SQL, FROM_INVOICE_SQL, RECOVERY_STUCK_SQL
} from "../pulse/beats/lib/invoice-sent-recovery-truth.mjs";
export { RECOVERY_STUCK_SQL };

export const RECOVERY_CANDIDATE_SQL = `SELECT i.id, i.org_id, i.client_id,
    i.sale_id, i.funding_round_id, i.invoice_type, i.source, i.status,
    i.amount_due, i.currency, i.sent_at,
    e.id AS event_id, e.name AS event_name, e.payload AS event_payload,
    e.client_id AS event_client_id, e.replayed_at AS event_replayed_at
  ${FROM_INVOICE_SQL}
  WHERE ${ELIGIBLE_INVOICE_SQL}
    AND ($2::uuid IS NULL OR i.id = $2::uuid)
    AND (e.id IS NULL OR e.replayed_at IS NULL
      OR e.replayed_at < now() - interval '2 hours')
  ORDER BY i.sent_at ASC, i.id ASC
  LIMIT $1`;

// replayed_at already means "this saved bus event was replayed". Here it is an
// atomic cooldown claim, not proof Inngest or a customer received anything.
// Only one overlapping sweep can advance the previous value. A failed send
// restores it; a process crash becomes retryable after two hours.
export const CLAIM_RECOVERY_SQL = `UPDATE events e
     SET replayed_at = now()
    FROM invoices i
    JOIN v_invoice_balance b ON b.invoice_id = i.id AND b.org_id = i.org_id
    JOIN funding_rounds r ON r.id = i.funding_round_id
   WHERE e.id = $1 AND e.org_id = $2 AND e.name = 'invoice.sent'
     AND e.idempotency_key = 'invoice.sent:' || i.id::text
     AND i.id = $3 AND i.org_id = e.org_id AND i.client_id = e.client_id
     AND e.replayed_at IS NOT DISTINCT FROM $4::timestamptz
     AND (e.replayed_at IS NULL OR e.replayed_at < now() - interval '2 hours')
     AND ${ELIGIBLE_INVOICE_SQL}
  RETURNING e.replayed_at`;

export const RELEASE_RECOVERY_SQL = `UPDATE events
   SET replayed_at = $3::timestamptz
 WHERE id = $1 AND org_id = $2 AND replayed_at = $4::timestamptz`;
