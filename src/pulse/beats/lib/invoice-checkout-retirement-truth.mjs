// Shared read-only judge for the morning lane and hourly beat. An obsolete
// hosted fee checkout is a money break even if the portal hides its URL.
export const INVOICE_CHECKOUT_RETIREMENT_SQL = `
  SELECT
    count(*) FILTER (
      WHERE pl.status IN ('created', 'sent')
        AND (i.status IN ('paid', 'void') OR
             (b.open_balance IS NOT NULL AND
              pl.amount_cents <> round(b.open_balance * 100)::bigint))
        AND pl.updated_at < now() - interval '5 minutes'
    )::int AS stale_active,
    count(*) FILTER (
      WHERE pl.status = 'expired'
        AND (pl.provider_retire_last_error IS NOT NULL OR
             pl.updated_at < now() - interval '95 minutes')
    )::int AS stranded_expired
  FROM payment_links pl
  JOIN invoices i ON i.id = pl.invoice_id
    AND i.org_id = pl.org_id AND i.client_id = pl.client_id
  LEFT JOIN v_invoice_balance b ON b.invoice_id = i.id AND b.org_id = i.org_id
  WHERE pl.provider = 'commas'
    AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
`;

export function retirementProblems(row) {
  const stale = Number(row?.stale_active);
  const stranded = Number(row?.stranded_expired);
  if (!Number.isInteger(stale) || stale < 0 || !Number.isInteger(stranded) || stranded < 0) {
    return { healthy: false, detail: "Invoice checkout check returned no usable counts." };
  }
  if (stale || stranded) {
    return { healthy: false, detail: `${stale} stale payable fee checkout links and ${stranded} expired links still awaiting Commas deactivation.` };
  }
  return { healthy: true, detail: "No stale payable or stranded expired fee checkout links." };
}
