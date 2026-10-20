export const CHECK_IDS = Object.freeze(['payments:whop-inbox-waiting', 'payments:whop-paid-no-access']);
export const WHOP_INBOX_SQL = `SELECT count(*)::integer AS n FROM whop_billing_inbox
  WHERE org_id = $1 AND ((status IN ('pending','failed') AND received_at < $2::timestamptz)
    OR (status = 'processing' AND claimed_at < $3::timestamptz))`;
export const WHOP_ACCESS_SQL = `SELECT count(DISTINCT l.id)::integer AS n
  FROM payment_links l JOIN products p ON p.id = l.product_id AND p.org_id = l.org_id
  LEFT JOIN transactions t ON t.org_id = l.org_id AND t.client_id = l.client_id
    AND t.provider = 'whop' AND t.provider_ref = l.whop_payment_id AND t.status = 'succeeded'
  WHERE l.org_id = $1 AND l.provider = 'whop' AND l.status = 'paid'
    AND p.code = 'consulting-package' AND l.paid_at < $2::timestamptz
    AND (t.id IS NULL OR NOT EXISTS (SELECT 1 FROM product_entitlements pe
       WHERE pe.org_id = l.org_id AND pe.product_code = p.code)
      OR EXISTS (SELECT 1 FROM product_entitlements pe WHERE pe.org_id = l.org_id
        AND pe.product_code = p.code AND NOT EXISTS (SELECT 1 FROM entitlements e
          WHERE e.org_id = l.org_id AND e.client_id = l.client_id
            AND e.source_transaction_id = t.id AND e.entitlement_code = pe.entitlement_code)))`;

export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000).toISOString();
  const staleClaim = new Date(now.getTime() - 15 * 60000).toISOString();
  const definitions = [
    [CHECK_IDS[0], WHOP_INBOX_SQL, [ctx.orgId, fiveMinutesAgo, staleClaim],
      'Whop payment receipts waiting for recovery', 'Run the Whop inbox drain; inspect its failed rows and last heartbeat.'],
    [CHECK_IDS[1], WHOP_ACCESS_SQL, [ctx.orgId, fiveMinutesAgo],
      'paid Whop Blueprint orders missing their payment record or access grant',
      'Replay the stored Whop receipt and inspect the product entitlement mapping. Do not charge the buyer again.']
  ];
  const out = [];
  for (const [id, sql, params, description, suggestedFix] of definitions) {
    if (!ctx.db?.query || !ctx.orgId) {
      out.push({ id, status: 'skip', detail: 'No scoped database; Whop billing was not checked', suggestedFix });
      continue;
    }
    try {
      const row = (await ctx.db.query(sql, params)).rows[0];
      const n = Number(row?.n);
      if (!row || !Number.isSafeInteger(n) || n < 0) throw new Error('Missing or invalid Whop check count');
      out.push({ id, status: n ? 'FAIL' : 'PASS', detail: `${n} ${description}`, suggestedFix: n ? suggestedFix : null });
    } catch (err) {
      out.push({ id, status: 'FAIL', detail: `Whop billing could not be read: ${String(err?.message || err).slice(0, 160)}`, suggestedFix });
    }
  }
  return out;
}
