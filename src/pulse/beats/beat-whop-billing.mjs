import { isMasked } from './contract.mjs';

export const id = 'whop-billing';
export const title = 'Whop Blueprint payments open the right access';
export const kind = 'infra';
// webhook:whop-billing is the router's provider for these receipts (src/http/router.mjs). The Inngest
// clock job:whop-billing-inbox-drain was retired on 2026-10-20 (the free plan ran out); the Netlify
// whop-billing-inbox-sweeper, read below, is the only clock, every 5 minutes.
export const covers = ['webhook:whop-billing','route:affiliates/blueprint-sale','route:public/blueprint-handoff'];
export const box = false;
export const reads = [];
export const steps = ['configured', 'clock-alive', 'inbox-clear', 'paid-access', 'seller-handoffs'];
export const deadlineMs = 9000;
export const damp = 1;
export const CLOCK_STALE_MS = 3 * 5 * 60000;
export const REQUIRED_ENV = ['WHOP_API_KEY', 'WHOP_ACCOUNT_ID', 'WHOP_CONSULTING_PACKAGE_PRODUCT_ID', 'WHOP_WEBHOOK_SECRET'];
export const CLOCK_SQL = `SELECT max(finished_at) AS last_at,
  (array_agg(outcome ORDER BY finished_at DESC))[1] AS last_outcome
  FROM job_heartbeats WHERE job = 'whop-billing-inbox-sweeper'`;
export const INBOX_SQL = `SELECT count(*)::integer AS n FROM whop_billing_inbox
  WHERE (status IN ('pending','failed') AND received_at < now() - interval '10 minutes')
    OR (status = 'processing' AND claimed_at < now() - interval '15 minutes')`;
export const ACCESS_SQL = `SELECT count(DISTINCT l.id)::integer AS n
  FROM payment_links l JOIN products p ON p.id = l.product_id AND p.org_id = l.org_id
  LEFT JOIN transactions t ON t.org_id = l.org_id AND t.client_id = l.client_id
    AND t.provider = 'whop' AND t.provider_ref = l.whop_payment_id AND t.status = 'succeeded'
  WHERE l.provider = 'whop' AND l.status = 'paid' AND p.code IN ('consulting-package','blueprint-self-funding')
    AND l.paid_at < now() - interval '10 minutes'
    AND (t.id IS NULL OR NOT EXISTS (SELECT 1 FROM product_entitlements pe
       WHERE pe.org_id = l.org_id AND pe.product_code = p.code)
      OR EXISTS (SELECT 1 FROM product_entitlements pe WHERE pe.org_id = l.org_id
        AND pe.product_code = p.code AND NOT EXISTS (SELECT 1 FROM entitlements e
          WHERE e.org_id = l.org_id AND e.client_id = l.client_id
            AND e.source_transaction_id = t.id AND e.entitlement_code = pe.entitlement_code)))`;


// Once a seller agreement is pinned, the actual actor, agreed price and
// provider-verified financing must agree within the preparation window.
export const SELLER_SQL = `SELECT count(*)::integer AS n FROM clients c
  CROSS JOIN LATERAL (SELECT c.custom_fields->'blueprint_seller_sale' AS s) handoff
  LEFT JOIN affiliates a ON a.id=(s->>'affiliate_id')::uuid AND a.org_id=c.org_id
  LEFT JOIN accounts ac ON ac.id=(s->>'account_id')::uuid AND ac.org_id=c.org_id AND ac.affiliate_id=a.id AND ac.kind='affiliate'
  LEFT JOIN affiliate_referrals r ON r.client_id=c.id AND r.org_id=c.org_id AND r.tier='direct' AND r.affiliate_id=a.id
  LEFT JOIN contracts k ON k.id=(s->>'contract_id')::uuid AND k.client_id=c.id AND k.org_id=c.org_id
  LEFT JOIN payment_links l ON l.id=(s->>'payment_link_id')::uuid AND l.client_id=c.id AND l.org_id=c.org_id
  LEFT JOIN products p ON p.id=l.product_id AND p.org_id=l.org_id
  WHERE s IS NOT NULL AND c.is_demo IS NOT TRUE AND (a.id IS NULL OR ac.id IS NULL OR r.id IS NULL
    OR s->>'org_id' IS DISTINCT FROM c.org_id::text OR s->>'client_id' IS DISTINCT FROM c.id::text
    OR (s->>'contract_id' IS NOT NULL AND (COALESCE((s->>'created_at')::timestamptz,c.created_at) < now()-interval '15 minutes')
      AND (k.id IS NULL OR k.template_key IS DISTINCT FROM 'BLUEPRINT-SELF-FUNDING-AGREEMENT'
        OR k.status NOT IN ('sent','viewed','signed')
        OR (k.created_by_account_id IS NOT NULL AND k.created_by_account_id::text IS DISTINCT FROM s->>'account_id')
        OR (k.sent_by_account_id IS NOT NULL AND k.sent_by_account_id::text IS DISTINCT FROM s->>'account_id')
        OR s->>'financing_verified' IS DISTINCT FROM 'true'
        OR s->>'amount_cents' IS NULL OR (s->>'amount_cents')::bigint NOT BETWEEN 2000000 AND 3000000 OR (s->>'amount_cents')::bigint%100<>0
        OR k.merge_values->>'_blueprint_amount_cents' IS DISTINCT FROM s->>'amount_cents'
        OR l.id IS NULL OR l.provider IS DISTINCT FROM 'whop'
        OR l.amount_cents IS DISTINCT FROM (s->>'amount_cents')::bigint OR p.code IS DISTINCT FROM 'blueprint-self-funding'))) `;

export const fixGuide = `A Whop payment clock, receipt or Blueprint access grant needs attention.

Likely causes:
- A Whop billing setting is missing, or the payment clock (Netlify whop-billing-inbox-sweeper, every 5 minutes) stopped running.
- A stored receipt cannot match its exact order, or a paid order lost its access grant.
Steps:
- Run node scripts/pulse/run-beat.mjs whop-billing and read the first red step.
- Inspect the stored Whop receipt and exact payment link, transaction and entitlement rows. Do not charge the buyer again.
- Keep the original receipt bytes and fix the failed writer before retrying the inbox.
Files: src/adapters/whop-billing.mjs, src/payments/whop-billing-inbox.mjs, src/workflows/whop-billing-inbox-drain.mjs, netlify/functions/whop-billing-inbox-sweeper.mjs
`;

export async function run(ctx) {
  if (ctx.live) {
    await ctx.step('configured', async () => {
      const missing = REQUIRED_ENV.filter((name) => isMasked(ctx.env[name]));
      if (missing.length) throw ctx.fail('configured', `Whop billing settings missing: ${missing.join(', ')}`);
    });
  } else ctx.skipStep('configured', 'Settings are masked on a laptop; production configuration was not checked.');
  await ctx.step('clock-alive', async () => {
    const row = (await ctx.read(CLOCK_SQL)).rows[0];
    const last = row?.last_at ? new Date(row.last_at).getTime() : NaN;
    if (!Number.isFinite(last) || ctx.now.getTime() - last > CLOCK_STALE_MS || last > ctx.now.getTime() + 60000) {
      throw ctx.fail('clock-alive', 'The Whop payment clock did not finish within the last 15 minutes.');
    }
    if (row.last_outcome !== 'ok') throw ctx.fail('clock-alive', 'The latest Whop payment clock finished with an error.');
  });
  for (const [step, sql, description] of [
    ['inbox-clear', INBOX_SQL, 'Whop receipts are overdue, abandoned or stuck in recovery'],
    ['paid-access', ACCESS_SQL, 'paid Whop Blueprint orders lack their exact transaction or access grant'],
    ['seller-handoffs', SELLER_SQL, 'seller handoffs have mismatched buyer, first-touch owner, agreement or checkout']
  ]) {
    await ctx.step(step, async () => {
      const row = (await ctx.read(sql)).rows[0];
      const count = Number(row?.n);
      if (!row || !Number.isSafeInteger(count) || count < 0) throw ctx.fail(step, 'Whop billing count could not be read.');
      if (count > 0) throw ctx.fail(step, `${count} ${description}.`);
    });
  }
  return ctx.done('Whop payment clocks and stored access records agree. This does not prove a real financed buyer completed checkout.');
}

const world = () => ({ env: { NETLIFY: 'true', WHOP_API_KEY: 'selftest-key', WHOP_ACCOUNT_ID: 'biz_selftest',
  WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_selftest', WHOP_WEBHOOK_SECRET: 'selftest-signing-secret' },
read: [
  { match: /FROM job_heartbeats/, rows: [{ last_at: new Date('2026-10-09T19:06:30Z'), last_outcome: 'ok' }] },
  { match: /FROM whop_billing_inbox/, rows: [{ n: 0 }] },
  { match: /FROM payment_links/, rows: [{ n: 0 }] },
  { match: /FROM clients c/, rows: [{ n: 0 }] }
] });
export const selfTest = { pass: world, fail: () => ({ ...world(), read: [
  { match: /FROM job_heartbeats/, rows: [{ last_at: null, last_outcome: null }] }
] }) };
