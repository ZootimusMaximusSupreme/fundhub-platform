import { verifyWhopSignature } from '../merchant/normalize.mjs';
import { emit, dispatch } from '../events/bus.mjs';
import { whopConfig, whopBlueprintMetadata, whopMoneyCents, blueprintAmountCents,
  WHOP_BLUEPRINT_PRODUCT, WHOP_BLUEPRINT_TITLE } from '../payments/whop-blueprint.mjs';
import { enqueueWhopBilling } from '../payments/whop-billing-inbox.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^pay_[a-zA-Z0-9]+$/;
const ACTIONABLE = new Set(['payment.succeeded', 'payment.failed', 'payment.canceled',
  'refund.created', 'refund.updated', 'dispute.created']);
const originalPaymentId = (data) => data.payment_id || data.payment?.id;

export async function findWhopBillingLink(db, body) {
  const data = body?.data || {};
  const id = data.metadata?.fh_payment_link_id;
  const paymentId = body?.type?.startsWith('payment.') ? data.id : originalPaymentId(data);
  return (await db.query(`SELECT l.*, p.code AS product_code FROM payment_links l
    JOIN products p ON p.id = l.product_id AND p.org_id = l.org_id
    WHERE l.provider = 'whop' AND (($1::uuid IS NOT NULL AND l.id = $1)
      OR ($2::text IS NOT NULL AND l.whop_payment_id = $2)) LIMIT 1`,
  [UUID.test(id || '') ? id : null, PAYMENT_ID.test(paymentId || '') ? paymentId : null])).rows[0] || null;
}

export async function handleWhopBillingWebhook({ db, rawBody, headers = {}, env = process.env,
  now = Date.now(), method = 'POST' } = {}) {
  if (method !== 'POST') return { status: 405, body: { ok: false, error: 'method_not_allowed' } };
  const cfg = whopConfig(env);
  if (!cfg.webhookSecret || !cfg.accountId) return { status: 503, body: { ok: false, error: 'whop_not_configured' } };
  if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody) > 256000) {
    return { status: 413, body: { ok: false, error: 'invalid_body' } };
  }
  const signed = verifyWhopSignature({ rawBody, headers, secret: cfg.webhookSecret, now });
  if (!signed.ok) return { status: 401, body: { ok: false, error: 'invalid_signature' } };
  let body;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, error: 'invalid_json' } }; }
  if (body.account_id !== cfg.accountId || (body.data?.account_id && body.data.account_id !== cfg.accountId)) {
    return { status: 403, body: { ok: false, error: 'account_mismatch' } };
  }
  if (!ACTIONABLE.has(body.type)) return { status: 200, body: { ok: true, ignored: true } };
  const link = await findWhopBillingLink(db, body);
  // Out-of-order reversals are retried by Whop until their original payment
  // identifies an exact order. Never guess a tenant from another buyer's link.
  const orgId = link?.org_id;
  if (!orgId) return { status: 409, body: { ok: false, error: 'order_not_found_retry' } };
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const frozen = Object.fromEntries(['webhook-id', 'webhook-timestamp', 'webhook-signature']
    .map((key) => [key, lower[key]]));
  const queued = await enqueueWhopBilling(db, { orgId, accountId: cfg.accountId,
    webhookId: lower['webhook-id'], eventType: body.type,
    paymentId: body.type.startsWith('payment.') ? body.data?.id : originalPaymentId(body.data || {}),
    rawBody, headers: frozen });
  return { status: 200, body: { ok: true, queued: queued.queued } };
}

export function validateWhopBlueprintPayment(data, link, cfg) {
  if (!link || link.provider !== 'whop' || link.product_code !== WHOP_BLUEPRINT_PRODUCT
    || link.currency !== 'USD') throw new Error('Whop order does not match Capital Blueprint');
  blueprintAmountCents(Number(link.amount_cents));
  if (!PAYMENT_ID.test(data.id || '') || data.account_id !== cfg.accountId
    || data.checkout_configuration_id !== link.whop_checkout_configuration_id
    || data.plan_id !== link.whop_plan_id || data.product_id !== cfg.productId
    || data.currency !== 'usd') throw new Error('Whop payment identity mismatch');
  for (const [key, value] of Object.entries(whopBlueprintMetadata(link))) {
    if (data.metadata?.[key] !== value) throw new Error(`Whop payment metadata mismatch: ${key}`);
  }
  const items = data.line_items;
  if (!Array.isArray(items) || items.length !== 1 || items[0].quantity !== 1
    || items[0].plan_id !== link.whop_plan_id || items[0].product_id !== cfg.productId) {
    throw new Error('Whop payment line item mismatch');
  }
  if (whopMoneyCents(data.total) !== Number(link.amount_cents)) throw new Error('Whop payment amount mismatch');
  if (link.whop_payment_id && link.whop_payment_id !== data.id) throw new Error('Whop checkout already belongs to another payment');
  return true;
}

async function emitRetryable(db, name, payload, opts, deps) {
  const result = await (deps.emit || emit)(db, name, payload, { ...opts, throwOnHandlerError: true });
  if (result.deduped) {
    const row = (await db.query(`SELECT id, name, version, org_id, client_id, payload FROM events
      WHERE org_id = $1 AND idempotency_key = $2 LIMIT 1`, [opts.orgId, opts.idempotencyKey])).rows[0];
    if (!row) throw new Error('Whop canonical receipt is missing');
    await (deps.dispatch || dispatch)(db, { id: row.id, name: row.name, version: row.version,
      orgId: row.org_id, clientId: row.client_id, payload: row.payload }, { throwOnHandlerError: true });
  }
  return result;
}

export async function processWhopBillingInboxRow(row, db, { env = process.env, ...deps } = {}) {
  const cfg = whopConfig(env);
  const body = JSON.parse(row.raw_body);
  const data = body.data || {};
  if (body.account_id !== cfg.accountId || row.account_id !== cfg.accountId
    || data.account_id !== cfg.accountId) throw new Error('Whop billing account mismatch');
  if (!ACTIONABLE.has(body.type)) return { ok: true, ignored: true, reason: 'non_terminal_event' };
  if (body.type.startsWith('refund.') && data.status !== 'succeeded') {
    return { ok: true, ignored: true, reason: 'refund_not_succeeded' };
  }
  const link = await findWhopBillingLink(db, body);
  if (!link || link.org_id !== row.org_id) throw new Error('Whop order not found; retry after reconciliation');
  let name;
  let amountCents;
  let providerRef = data.id;
  let originalProviderRef = null;
  if (body.type.startsWith('payment.')) {
    validateWhopBlueprintPayment(data, link, cfg);
    if (body.type !== 'payment.succeeded' && link.status === 'paid') {
      return { ok: true, ignored: true, reason: 'payment_already_settled' };
    }
    if (body.type === 'payment.succeeded' && data.status !== 'paid') throw new Error('Whop payment has not settled');
    name = body.type === 'payment.succeeded' ? 'payment.received' : body.type;
    amountCents = Number(link.amount_cents);
    // Failure and success can share a provider payment ID. They must not share
    // the transactions.provider_ref, or the failure would swallow a later sale.
    if (body.type !== 'payment.succeeded') providerRef = `${data.id}:${body.type}`;
  } else {
    if (!PAYMENT_ID.test(originalPaymentId(data) || '') || originalPaymentId(data) !== link.whop_payment_id
      || link.status !== 'paid') throw new Error('Whop reversal waits for its original settled payment');
    if (link.product_code !== WHOP_BLUEPRINT_PRODUCT) throw new Error('Whop reversal product mismatch');
    amountCents = whopMoneyCents(body.type === 'dispute.created'
      ? { amount: String(data.amount), currency: data.currency, decimals: 2 } : data.amount);
    if (amountCents > Number(link.amount_cents)) throw new Error('Whop reversal exceeds original payment');
    if (body.type.startsWith('refund.') && !/^rf_[a-zA-Z0-9]+$/.test(data.id || '')) throw new Error('Invalid Whop refund ID');
    if (body.type === 'dispute.created' && !/^dspt_[a-zA-Z0-9]+$/.test(data.id || '')) throw new Error('Invalid Whop dispute ID');
    name = body.type.startsWith('refund.') ? 'payment.refunded' : 'payment.disputed';
    originalProviderRef = originalPaymentId(data);
  }
  const payload = { product: 'diy', productName: WHOP_BLUEPRINT_TITLE,
    productId: link.product_id, productCode: WHOP_BLUEPRINT_PRODUCT,
    amount: amountCents / 100, source: 'whop', providerRef, paymentId: originalPaymentId(data) || data.id,
    originalProviderRef, paymentLinkId: link.id, ref: link.link_ref,
    purpose: link.purpose, saleId: link.sale_id, saleMotion: link.sale_motion,
    closerId: link.closer_staff_id, salesManagerId: link.sales_manager_staff_id,
    paidAt: data.paid_at || data.created_at, dueBy: data.evidence_due_at || null };
  const key = `whop:${body.type.startsWith('payment.') ? 'payment' : body.type.startsWith('refund.') ? 'refund' : 'dispute'}:${data.id}:${name}`;
  if (name === 'payment.received') {
    // Claim the provider payment atomically before emitting. Two distinct paid
    // payment IDs for one reusable checkout cannot both create a local sale.
    const reserved = await db.query(`UPDATE payment_links SET whop_payment_id = $2
      WHERE id = $1 AND provider = 'whop' AND (whop_payment_id IS NULL OR whop_payment_id = $2)
      RETURNING id`, [link.id, data.id]);
    if (!reserved.rows.length) throw new Error('Whop checkout already settled with a different payment');
  }
  const emitted = await emitRetryable(db, name, payload,
    { orgId: link.org_id, clientId: link.client_id, idempotencyKey: key }, deps);
  if (name === 'payment.received') {
    const settled = await db.query(`UPDATE payment_links SET status = 'paid', whop_payment_id = $2,
      paid_amount_cents = $3, paid_at = COALESCE(paid_at, $4::timestamptz, now())
      WHERE id = $1 AND provider = 'whop' AND (whop_payment_id IS NULL OR whop_payment_id = $2)
      RETURNING id`, [link.id, data.id, amountCents, data.paid_at || null]);
    if (!settled.rows.length) throw new Error('Whop payment could not settle its order');
  }
  return { ok: true, name, emitted };
}
