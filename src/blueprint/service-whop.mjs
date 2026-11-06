import { whopConfig, whopMoneyCents, WHOP_BLUEPRINT_TITLE } from '../payments/whop-blueprint.mjs';
import { whopRequest } from '../messaging/providers/whop-payments.mjs';
import { withTransaction } from '../db/with-transaction.mjs';
import { checkoutExpiresAt } from '../paid-services/checkout.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;
const originalPaymentId = data => data.payment_id || data.payment?.id;
const SELECT_SERVICE = `SELECT s.*,p.status AS payment_status,p.price_total_cents,p.payment_ref AS ledger_payment_ref,
  p.amount_paid_cents,true AS blueprint_service FROM blueprint_client_services s JOIN paid_service_requests p
  ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id`;

export function blueprintServiceCheckoutProviders(env = process.env) {
  return [{ id: 'commas', label: 'Pay in full' }, ...(whopConfig(env).ok
    ? [{ id: 'whop', label: 'Financing through Whop' }] : [])];
}

export function whopServiceMetadata(service) {
  return { fh_schema: '1', fh_service_request_id: service.id, fh_org_id: service.org_id,
    fh_client_id: service.client_id, fh_engagement_id: service.engagement_id,
    product_code: `blueprint-help-${service.service_kind}`, fh_service_kind: service.service_kind,
    fh_scope_type: service.scope_type, fh_target_id: service.target_id,
    fh_amount_cents: String(service.accepted_price_cents), fh_currency: 'USD' };
}

export function buildWhopServiceCheckout(service, cfg) {
  const amount = Number(service.accepted_price_cents);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000
    || amount !== Number(service.price_total_cents) || !service.authorized_at
    || service.checkout_provider !== 'whop' || service.checkout_currency !== 'USD'
    || service.whop_account_id !== cfg.accountId || service.whop_product_id !== cfg.productId) {
    throw new Error('Whop service requires its exact saved accepted quote');
  }
  return { account_id: cfg.accountId, mode: 'payment', metadata: whopServiceMetadata(service),
    plan: { product_id: cfg.productId, plan_type: 'one_time', release_method: 'buy_now',
      initial_price: amount / 100, currency: 'usd', title: WHOP_BLUEPRINT_TITLE,
      description: WHOP_BLUEPRINT_TITLE, visibility: 'hidden', adaptive_pricing_enabled: false } };
}

export async function mintBlueprintServiceWhopCheckout({ service, env = process.env, fetchImpl = fetch }) {
  const cfg = whopConfig(env);
  if (!cfg.ok) throw new Error('Whop service financing is not configured');
  const body = buildWhopServiceCheckout(service, cfg);
  const out = await whopRequest('/checkout_configurations', { apiKey: cfg.apiKey, method: 'POST', body,
    idempotencyKey: `whop-blueprint-service:${service.id}`, env, fetchImpl });
  await verifyWhopServiceCheckout(out, service, cfg, { env, fetchImpl });
  return { ok: true, checkoutUrl: out.purchase_url, checkoutId: out.id, planId: out.plan.id };
}

export async function verifyWhopServiceCheckout(out, service, cfg, { env = process.env, fetchImpl = fetch } = {}) {
  const body = buildWhopServiceCheckout(service, cfg);
  const url = new URL(out.purchase_url || '', 'https://invalid.local');
  if (out.account_id !== cfg.accountId || out.mode !== 'payment' || !/^ch_[A-Za-z0-9]+$/.test(out.id || '')
    || !/^plan_[A-Za-z0-9]+$/.test(out.plan?.id || '') || url.protocol !== 'https:' || url.hostname !== 'whop.com'
    || url.pathname !== `/checkout/${out.id}/` || out.plan.currency !== 'usd' || out.plan.plan_type !== 'one_time'
    || whopMoneyCents({ amount: String(out.plan.initial_price), currency: 'usd', decimals: 2 }) !== Number(service.accepted_price_cents)
    || Object.entries(body.metadata).some(([key, value]) => out.metadata?.[key] !== value)) {
    throw new Error('Whop service checkout response does not match its accepted quote');
  }
  const variant = await whopRequest(`/variants/${out.plan.id}`, { apiKey: cfg.apiKey, env, fetchImpl });
  if (variant.id !== out.plan.id || variant.account?.id !== service.whop_account_id
    || variant.product?.id !== service.whop_product_id || variant.currency !== 'usd'
    || variant.plan_type !== 'one_time' || variant.title !== WHOP_BLUEPRINT_TITLE
    || whopMoneyCents({ amount: String(variant.initial_price), currency: 'usd', decimals: 2 }) !== Number(service.accepted_price_cents)) {
    throw new Error('Whop service variant does not match its saved checkout');
  }
  return out;
}

export async function findWhopServiceReceipt(db, body) {
  const data = body?.data || {};
  const requestId = data.metadata?.fh_service_request_id;
  const paymentId = body?.type?.startsWith('payment.') ? data.id : originalPaymentId(data);
  if (!UUID.test(requestId || '') && !PAYMENT_ID.test(paymentId || '')) return null;
  return (await db.query(`${SELECT_SERVICE} WHERE s.checkout_provider='whop' AND (($1::uuid IS NOT NULL AND s.id=$1)
    OR ($1::uuid IS NULL AND $2::text IS NOT NULL AND s.whop_payment_id=$2)) LIMIT 1`,
  [UUID.test(requestId || '') ? requestId : null, PAYMENT_ID.test(paymentId || '') ? paymentId : null])).rows[0] || null;
}

export function validateWhopServicePayment(data, service, cfg) {
  if (service.checkout_provider !== 'whop' || service.whop_account_id !== cfg.accountId
    || service.whop_product_id !== cfg.productId || service.checkout_currency !== 'USD'
    || !service.authorized_at || !service.authorized_account_id || !service.whop_checkout_configuration_id || !service.whop_plan_id
    || Number(service.accepted_price_cents) !== Number(service.price_total_cents)
    || !PAYMENT_ID.test(data.id || '') || data.account_id !== service.whop_account_id
    || data.checkout_configuration_id !== service.whop_checkout_configuration_id || data.plan_id !== service.whop_plan_id
    || data.product_id !== service.whop_product_id || data.currency !== 'usd'
    || (service.whop_payment_id && service.whop_payment_id !== data.id)) throw new Error('Whop service payment identity mismatch');
  if (Object.entries(whopServiceMetadata(service)).some(([key, value]) => data.metadata?.[key] !== value)) {
    throw new Error('Whop service payment metadata mismatch');
  }
  const items = data.line_items;
  if (!Array.isArray(items) || items.length !== 1 || items[0].quantity !== 1
    || items[0].plan_id !== service.whop_plan_id || items[0].product_id !== service.whop_product_id
    || whopMoneyCents(data.total) !== Number(service.accepted_price_cents)) throw new Error('Whop service payment amount or line item mismatch');
  return true;
}

export async function readWhopServiceOrders(db, cfg) {
  const rows = (await db.query(`${SELECT_SERVICE} WHERE s.checkout_provider='whop'
    AND s.whop_account_id=$1 AND s.whop_product_id=$2 AND s.authorized_at IS NOT NULL
    AND s.state IN ('checkout_pending','awaiting_payment','paid','in_progress','completed','needs_review','refunded')
    ORDER BY s.created_at LIMIT 1001`, [cfg.accountId, cfg.productId])).rows;
  if (rows.length > 1000) throw new Error('Whop service reconciliation requires a smaller order batch');
  return rows;
}

// The signed receipt supplies a candidate ID only. The configured provider must
// independently confirm the frozen quote, metadata and variant before recovery.
async function recoverWhopServiceCheckout(tx, body, service, cfg, { env, fetchImpl }) {
  if (body.type !== 'payment.succeeded' || body.data?.status !== 'paid'
    || !['checkout_pending','needs_review'].includes(service.state) || service.whop_payment_id
    || service.whop_checkout_configuration_id || service.whop_plan_id || service.payment_status !== 'quoted') return service;
  const candidate = { ...service, whop_checkout_configuration_id: body.data.checkout_configuration_id, whop_plan_id: body.data.plan_id };
  if (!/^ch_[A-Za-z0-9]+$/.test(candidate.whop_checkout_configuration_id || '')
    || !/^plan_[A-Za-z0-9]+$/.test(candidate.whop_plan_id || '')) throw new Error('Invalid Whop service recovery identity');
  validateWhopServicePayment(body.data, candidate, cfg);
  const checkout = await whopRequest(`/checkout_configurations/${candidate.whop_checkout_configuration_id}`, {
    apiKey: cfg.apiKey, env, fetchImpl });
  if (checkout.id !== candidate.whop_checkout_configuration_id || checkout.plan?.id !== candidate.whop_plan_id) {
    throw new Error('Whop service recovery checkout identity mismatch');
  }
  await verifyWhopServiceCheckout(checkout, candidate, cfg, { env, fetchImpl });
  await tx.query(`UPDATE paid_service_requests SET checkout_url=$2,status='awaiting_payment',checkout_expires_at=$3
    WHERE id=$1 AND status='quoted'`, [service.id, checkout.purchase_url, checkoutExpiresAt(new Date())]);
  await tx.query(`UPDATE blueprint_client_services SET whop_checkout_configuration_id=$2,whop_plan_id=$3,
    state='awaiting_payment',updated_at=now() WHERE id=$1 AND whop_payment_id IS NULL`,
  [service.id, checkout.id, checkout.plan.id]);
  return { ...candidate, state: 'awaiting_payment', payment_status: 'awaiting_payment' };
}

export async function processWhopServiceReceipt(db, body, saved, cfg, emitReceipt, { env = process.env, fetchImpl = fetch } = {}) {
  return withTransaction(db, async tx => {
    let service = (await tx.query(`${SELECT_SERVICE} WHERE s.id=$1 AND s.org_id=$2 FOR UPDATE OF s,p`, [saved.id, saved.org_id])).rows[0];
    if (!service) throw new Error('Whop service receipt lost its owned request');
    service = await recoverWhopServiceCheckout(tx, body, service, cfg, { env, fetchImpl });
    const data = body.data || {};
    let name, amountCents, providerRef = data.id, originalProviderRef = null;
    if (body.type.startsWith('payment.')) {
      validateWhopServicePayment(data, service, cfg);
      if (body.type === 'payment.succeeded' && data.status !== 'paid') throw new Error('Whop service payment has not settled');
      const lateSettled = body.type === 'payment.succeeded' && ['cancelled','failed'].includes(service.payment_status);
      if (service.payment_status === 'refunded' || service.state === 'refunded'
        || (['cancelled','failed'].includes(service.payment_status) && !lateSettled)
        || (service.state === 'needs_review' && !lateSettled)) {
        return { ok: true, ignored: true, reason: 'service_receipt_needs_review' };
      }
      if (body.type !== 'payment.succeeded' && ['paid','staged','fulfilled'].includes(service.payment_status)) {
        return { ok: true, ignored: true, reason: 'payment_already_settled' };
      }
      name = body.type === 'payment.succeeded' ? 'payment.received' : body.type;
      amountCents = Number(service.accepted_price_cents);
      if (name === 'payment.received') {
        const claimed = await tx.query(`UPDATE blueprint_client_services SET whop_payment_id=$2,updated_at=now()
          WHERE id=$1 AND checkout_provider='whop' AND (whop_payment_id IS NULL OR whop_payment_id=$2) RETURNING id`, [service.id, data.id]);
        if (!claimed.rows.length) throw new Error('Whop service already belongs to another settled payment');
      } else providerRef = `${data.id}:${body.type}`;
    } else {
      if (service.whop_account_id !== cfg.accountId || service.whop_product_id !== cfg.productId
        || !PAYMENT_ID.test(originalPaymentId(data) || '') || originalPaymentId(data) !== service.whop_payment_id
        || service.ledger_payment_ref !== service.whop_payment_id
        || !['paid','staged','fulfilled','refunded','cancelled','failed'].includes(service.payment_status)
        || Number(service.amount_paid_cents) !== Number(service.accepted_price_cents)) {
        throw new Error('Whop service reversal requires its exact original settled receipt');
      }
      amountCents = whopMoneyCents(body.type === 'dispute.created'
        ? { amount: String(data.amount), currency: data.currency, decimals: 2 } : data.amount);
      if (amountCents > Number(service.accepted_price_cents)) throw new Error('Whop service reversal exceeds the original payment');
      if (body.type.startsWith('refund.') && !/^rf_[A-Za-z0-9]+$/.test(data.id || '')) throw new Error('Invalid Whop service refund');
      if (body.type === 'dispute.created' && !/^dspt_[A-Za-z0-9]+$/.test(data.id || '')) throw new Error('Invalid Whop service dispute');
      name = body.type.startsWith('refund.') ? 'payment.refunded' : 'payment.disputed';
      originalProviderRef = originalPaymentId(data);
      // Reversals freeze the existing work; a late success cannot restart it.
      if (name === 'payment.refunded') await tx.query(`UPDATE paid_service_requests SET status='refunded',resolved_at=COALESCE(resolved_at,now())
        WHERE id=$1 AND payment_ref=$2 AND status IN ('paid','staged','fulfilled','refunded','cancelled','failed')`, [service.id, originalProviderRef]);
      await tx.query(`UPDATE blueprint_client_services SET state=$3,updated_at=now()
        WHERE id=$1 AND whop_payment_id=$2`, [service.id, originalProviderRef, name === 'payment.refunded' ? 'refunded' : 'needs_review']);
    }
    const productCode = `blueprint-help-${service.service_kind}`;
    const payload = { product: 'paid_service', productName: productCode, productCode, productId: null,
      amount: amountCents / 100, amountCents, currency: 'USD', source: 'whop', providerRef,
      paymentId: originalProviderRef || data.id, originalProviderRef, ref: service.id, paidServiceRequestId: service.id,
      paidAt: data.paid_at || data.created_at, dueBy: data.evidence_due_at || null };
    const key = `whop:service:${data.id}:${name}`;
    const emitted = await emitReceipt(tx, name, payload, { orgId: service.org_id, clientId: service.client_id, idempotencyKey: key });
    return { ok: true, name, emitted };
  });
}
