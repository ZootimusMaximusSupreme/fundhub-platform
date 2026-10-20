import { listWhopResource } from '../messaging/providers/whop-payments.mjs';
import { whopConfig, whopBlueprintMetadata, verifyWhopCheckout } from './whop-blueprint.mjs';
import { enqueueWhopBilling } from './whop-billing-inbox.mjs';

// Read-only at Whop. Recovered receipts use precisely the signed-webhook inbox
// and processor; no checkout, application, charge, or refund is created here.
export async function reconcileWhopBilling(db, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = whopConfig(env);
  if (!cfg.ok) return { ok: true, skipped: true, reason: 'whop_not_configured', recovered: 0 };
  const links = (await db.query(`SELECT l.*, p.code AS product_code FROM payment_links l
    JOIN products p ON p.id = l.product_id AND p.org_id = l.org_id
    WHERE l.provider = 'whop' AND p.code = 'consulting-package'
      AND l.status IN ('created','sent','paid') ORDER BY l.created_at`)).rows;
  if (!links.length) return { ok: true, recovered: 0, checked: 0 };
  if (links.some((link) => !link.whop_checkout_configuration_id)) {
    const checkouts = await listWhopResource('checkout_configurations', {
      accountId: cfg.accountId, apiKey: cfg.apiKey, fetchImpl });
    for (const link of links.filter((item) => !item.whop_checkout_configuration_id)) {
      const expected = whopBlueprintMetadata(link);
      const out = checkouts.find((item) => Object.entries(expected)
        .every(([key, value]) => item.metadata?.[key] === value));
      if (!out) continue;
      await verifyWhopCheckout(out, cfg, link, { fetchImpl });
      await db.query(`UPDATE payment_links SET checkout_url = $2,
        whop_checkout_configuration_id = $3, whop_plan_id = $4
        WHERE id = $1 AND provider = 'whop' AND whop_checkout_configuration_id IS NULL`,
      [link.id, out.purchase_url, out.id, out.plan.id]);
      link.whop_checkout_configuration_id = out.id;
      link.whop_plan_id = out.plan.id;
    }
  }
  const payments = await listWhopResource('payments', { accountId: cfg.accountId,
    apiKey: cfg.apiKey, query: { product_id: cfg.productId }, fetchImpl });
  let recovered = 0;
  const matchedPayments = new Map();
  for (const payment of payments) {
    const link = links.find((item) => payment.metadata?.fh_payment_link_id === item.id
      && payment.checkout_configuration_id === item.whop_checkout_configuration_id);
    if (!link || payment.account_id !== cfg.accountId) continue;
    matchedPayments.set(payment.id, link);
    const type = payment.status === 'paid' ? 'payment.succeeded'
      : payment.substatus === 'failed' ? 'payment.failed'
        : payment.status === 'void' ? 'payment.canceled' : null;
    if (!type) continue;
    const out = await enqueueWhopBilling(db, { orgId: link.org_id, accountId: cfg.accountId,
      webhookId: `reconcile:${payment.id}:${type}`, eventType: type, paymentId: payment.id,
      rawBody: JSON.stringify({ account_id: cfg.accountId, type, data: payment }), source: 'reconcile' });
    if (out.queued) recovered += 1;
  }
  // Refunds and disputes can be the first delivery to go missing too. Keep the
  // original payment lookup above so out-of-order reversals can wait safely.
  for (const [resource, type] of [['refunds', 'refund.updated'], ['disputes', 'dispute.created']]) {
    const reversals = await listWhopResource(resource, { accountId: cfg.accountId, apiKey: cfg.apiKey, fetchImpl });
    for (const reversal of reversals) {
      const paymentId = reversal.payment_id || reversal.payment?.id;
      const link = matchedPayments.get(paymentId)
        || links.find((item) => item.whop_payment_id === paymentId);
      if (!link || reversal.account_id !== cfg.accountId) continue;
      if (resource === 'refunds' && reversal.status !== 'succeeded') continue;
      const out = await enqueueWhopBilling(db, { orgId: link.org_id, accountId: cfg.accountId,
        webhookId: `reconcile:${reversal.id}:${type}`, eventType: type, paymentId,
        rawBody: JSON.stringify({ account_id: cfg.accountId, type, data: reversal }), source: 'reconcile' });
      if (out.queued) recovered += 1;
    }
  }
  return { ok: true, recovered, checked: links.length };
}
