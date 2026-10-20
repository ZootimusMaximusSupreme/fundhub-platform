// Read-only invoice notice truth shared by the recovery clock, morning gap,
// and hourly beat. A sent legacy invoice without the sale/funded-round links
// is deliberately not enough to trigger a customer-facing notice.
export const ELIGIBLE_INVOICE_SQL = `i.source = 'funding_success_fee'
  AND i.sale_id IS NOT NULL
  AND i.funding_round_id IS NOT NULL
  AND i.status IN ('sent', 'reminded', 'escalated', 'partially_paid')
  AND i.sent_at < now() - interval '30 minutes'
  AND i.currency = 'USD'
  AND b.open_balance > 0
  AND r.org_id = i.org_id AND r.client_id = i.client_id
  AND r.product = 'card_stacking' AND r.status = 'funded'
  AND (
    NOT EXISTS (
      SELECT 1 FROM payment_links pl
       WHERE pl.invoice_id = i.id AND pl.org_id = i.org_id
         AND pl.client_id = i.client_id AND pl.provider = 'commas'
         AND pl.status IN ('created', 'sent')
         AND NULLIF(BTRIM(pl.checkout_url), '') IS NOT NULL
         AND pl.currency = i.currency
         AND pl.amount_cents = ROUND(b.open_balance * 100)::bigint
    )
    OR e.id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM messages m
       WHERE m.org_id = i.org_id AND m.client_id = i.client_id
         AND m.provider_ref = 'workflow:EMAIL-AR-01-FIRST-NOTICE:' || e.id::text || ':01:EMAIL-AR-01-FIRST-NOTICE'
    )
    OR (
      NOT EXISTS (
        SELECT 1 FROM opt_outs oo
         WHERE oo.client_id = i.client_id AND oo.org_id = i.org_id
           AND oo.channel = 'sms' AND oo.opted_in_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM messages m
         WHERE m.org_id = i.org_id AND m.client_id = i.client_id
           AND m.provider_ref = 'workflow:SMS-AR-01-FIRST-NOTICE:' || e.id::text || ':01:SMS-AR-01-FIRST-NOTICE'
      )
    )
  )`;

export const FROM_INVOICE_SQL = `FROM invoices i
  JOIN v_invoice_balance b ON b.invoice_id = i.id AND b.org_id = i.org_id
  JOIN funding_rounds r ON r.id = i.funding_round_id
  LEFT JOIN events e ON e.org_id = i.org_id
    AND e.idempotency_key = 'invoice.sent:' || i.id::text`;

export const RECOVERY_STUCK_SQL = `SELECT COUNT(*)::integer AS stuck
  ${FROM_INVOICE_SQL}
  WHERE ${ELIGIBLE_INVOICE_SQL}
    AND COALESCE(GREATEST(i.sent_at, e.replayed_at), i.sent_at)
      < now() - interval '2 hours'`;

export function recoveryProblems(row) {
  const stuck = Number(row?.stuck);
  if (!Number.isInteger(stuck) || stuck < 0) {
    return { healthy: false, detail: "Invoice notice recovery check returned no usable count." };
  }
  return stuck === 0
    ? { healthy: true, detail: "No aged fee invoices lack checkout or first-notice progress." }
    : { healthy: false, detail: `${stuck} aged fee invoice${stuck === 1 ? "" : "s"} lack checkout or first-notice progress.` };
}
