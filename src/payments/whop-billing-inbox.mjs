export const WHOP_MAX_ATTEMPTS = 10;
export const WHOP_STALE_CLAIM_MINUTES = 15;

export async function enqueueWhopBilling(db, { orgId, accountId, webhookId, eventType,
  paymentId = null, rawBody, headers = {}, source = 'webhook' }) {
  const out = await db.query(
    `INSERT INTO whop_billing_inbox (org_id, account_id, webhook_id, event_type,
       payment_id, raw_body, headers, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (account_id, webhook_id) DO NOTHING RETURNING id`,
    [orgId, accountId, webhookId, eventType, paymentId, rawBody, headers, source]);
  return { queued: out.rows.length === 1, id: out.rows[0]?.id || null };
}

export async function claimWhopBilling(db, { limit = 25 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Whop batch limit must be 1–100');
  return (await db.query(
    `WITH ready AS (
       SELECT id FROM whop_billing_inbox
       WHERE attempts < $2 AND retry_at <= now()
         AND (status IN ('pending','failed')
           OR (status = 'processing' AND claimed_at < now() - interval '15 minutes'))
       ORDER BY received_at, id FOR UPDATE SKIP LOCKED LIMIT $1
     ) UPDATE whop_billing_inbox i SET status = 'processing', claimed_at = now(),
       attempts = attempts + 1 FROM ready WHERE i.id = ready.id RETURNING i.*`,
    [limit, WHOP_MAX_ATTEMPTS])).rows;
}

export async function drainWhopBillingInbox(db, { process, limit = 25, maxBatches = 4 } = {}) {
  if (typeof process !== 'function') throw new TypeError('Whop inbox needs a processor');
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) throw new RangeError('Invalid Whop batch count');
  const counts = { done: 0, ignored: 0, failed: 0 };
  let claimed = 0;
  let batches = 0;
  for (; batches < maxBatches; batches += 1) {
    const rows = await claimWhopBilling(db, { limit });
    if (!rows.length) break;
    claimed += rows.length;
    for (const row of rows) {
      try {
        const out = await process(row, db);
        if (!out?.ok) throw new Error(out?.reason || 'Whop processing did not finish');
        const status = out.ignored ? 'ignored' : 'done';
        await db.query(`UPDATE whop_billing_inbox SET status = $2, processed_at = now(),
          last_error = $3 WHERE id = $1 AND status = 'processing' AND attempts = $4`,
        [row.id, status, out.reason || null, row.attempts]);
        counts[status] += 1;
      } catch (err) {
        await db.query(`UPDATE whop_billing_inbox SET status = 'failed', last_error = $2,
          retry_at = now() + (LEAST(3600, 60 * power(2, LEAST(attempts, 6))) * interval '1 second')
          WHERE id = $1 AND status = 'processing' AND attempts = $3`,
        [row.id, String(err?.message || err).slice(0, 300), row.attempts]);
        counts.failed += 1;
      }
    }
  }
  return { claimed, batches, counts };
}

export async function readWhopBillingHealth(db) {
  const row = (await db.query(`SELECT
    count(*) FILTER (WHERE status IN ('pending','failed')
      AND received_at < now() - interval '5 minutes')::integer AS waiting,
    count(*) FILTER (WHERE status = 'processing'
      AND claimed_at < now() - interval '15 minutes')::integer AS stale,
    count(*) FILTER (WHERE status = 'failed' AND attempts >= $1)::integer AS exhausted
    FROM whop_billing_inbox`, [WHOP_MAX_ATTEMPTS])).rows[0];
  return { ok: Boolean(row) && Number(row.waiting) === 0 && Number(row.stale) === 0
    && Number(row.exhausted) === 0, ...row };
}
