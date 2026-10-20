import { randomUUID } from 'node:crypto';
import { generateLinkRef, resolveLinkContext } from '../payment-links/index.mjs';
import { whopRequest } from '../messaging/providers/whop-payments.mjs';
import { assertBlueprintAgreementPrice } from '../contracts/blueprint-price.mjs';

export const WHOP_BLUEPRINT_PRODUCT = 'consulting-package';
export const WHOP_BLUEPRINT_TITLE = 'Consulting Services Package';
export const WHOP_BLUEPRINT_OFFER = 'UWIQ_DELIVERABLES';
export const WHOP_REQUIRED_ENV = Object.freeze([
  'WHOP_API_KEY', 'WHOP_ACCOUNT_ID', 'WHOP_CONSULTING_PACKAGE_PRODUCT_ID', 'WHOP_WEBHOOK_SECRET'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function whopConfig(env = process.env) {
  const apiKey = String(env.WHOP_API_KEY || '').trim();
  const accountId = String(env.WHOP_ACCOUNT_ID || '').trim();
  const productId = String(env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID || '').trim();
  const webhookSecret = String(env.WHOP_WEBHOOK_SECRET || '').trim();
  return { ok: Boolean(apiKey && /^biz_[a-zA-Z0-9]+$/.test(accountId)
    && /^prod_[a-zA-Z0-9]+$/.test(productId) && webhookSecret),
  apiKey, accountId, productId, webhookSecret };
}

export function blueprintAmountCents(value) {
  if (!Number.isSafeInteger(value) || value < 500000 || value > 1000000) {
    throw new RangeError('Capital Blueprint amount must be $5,000–$10,000 in whole cents');
  }
  return value;
}

export function whopMoneyCents(money) {
  if (!money || String(money.currency).toLowerCase() !== 'usd' || money.decimals !== 2
    || typeof money.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(money.amount)) {
    throw new TypeError('Whop payment must carry an exact positive USD Money amount');
  }
  const [whole, cents = ''] = money.amount.split('.');
  const out = Number(whole) * 100 + Number(cents.padEnd(2, '0'));
  if (!Number.isSafeInteger(out) || out <= 0) throw new RangeError('Invalid Whop payment amount');
  return out;
}

export function whopBlueprintMetadata(link) {
  return { fh_schema: '1', fh_payment_link_id: link.id, fh_link_ref: link.link_ref,
    fh_org_id: link.org_id, fh_client_id: link.client_id, offer_key: WHOP_BLUEPRINT_OFFER,
    product_code: WHOP_BLUEPRINT_PRODUCT, fh_amount_cents: String(link.amount_cents),
    fh_currency: 'USD' };
}

export function buildWhopBlueprintCheckout(link, cfg) {
  const amount = blueprintAmountCents(Number(link.amount_cents));
  return { account_id: cfg.accountId, mode: 'payment', metadata: whopBlueprintMetadata(link),
    plan: { product_id: cfg.productId, plan_type: 'one_time', release_method: 'buy_now',
      initial_price: amount / 100, currency: 'usd', title: WHOP_BLUEPRINT_TITLE,
      description: WHOP_BLUEPRINT_TITLE, visibility: 'hidden', adaptive_pricing_enabled: false } };
}

export function validateWhopCheckout(out, cfg, link) {
  const url = new URL(out.purchase_url || 'invalid', 'https://invalid.local');
  if (out.account_id !== cfg.accountId || out.mode !== 'payment' || !/^ch_[a-zA-Z0-9]+$/.test(out.id || '')
    || !/^plan_[a-zA-Z0-9]+$/.test(out.plan?.id || '') || url.protocol !== 'https:'
    || url.hostname !== 'whop.com' || url.pathname !== `/checkout/${out.id}/`) {
    throw Object.assign(new Error('Whop checkout response does not match the requested checkout'),
      { code: 'whop_checkout_failed', status: 502 });
  }
  if (link) {
    if (out.plan.currency !== 'usd' || out.plan.plan_type !== 'one_time'
      || whopMoneyCents({ amount: String(out.plan.initial_price), currency: 'usd', decimals: 2 }) !== Number(link.amount_cents)
      || Object.entries(whopBlueprintMetadata(link)).some(([key, value]) => out.metadata?.[key] !== value)) {
      throw Object.assign(new Error('Whop checkout price, currency or metadata does not match its order'),
        { code: 'whop_checkout_failed', status: 502 });
    }
  }
  return out;
}

export async function verifyWhopCheckout(out, cfg, link, { fetchImpl = fetch } = {}) {
  validateWhopCheckout(out, cfg, link);
  // The checkout response's embedded plan omits product/account identity.
  // Read the documented variant resource before exposing or recovering its URL.
  // https://docs.whop.com/api-reference/beta/variants/retrieve-variant
  const variant = await whopRequest(`/variants/${out.plan.id}`, { apiKey: cfg.apiKey, fetchImpl });
  if (variant.id !== out.plan.id || variant.account?.id !== cfg.accountId
    || variant.product?.id !== cfg.productId || variant.currency !== 'usd'
    || variant.plan_type !== 'one_time' || variant.title !== WHOP_BLUEPRINT_TITLE
    || whopMoneyCents({ amount: String(variant.initial_price), currency: 'usd', decimals: 2 }) !== Number(link.amount_cents)) {
    throw Object.assign(new Error('Whop checkout variant does not match the Blueprint order'),
      { code: 'whop_checkout_failed', status: 502 });
  }
  return out;
}

export async function createWhopBlueprintPaymentLink(db, {
  orgId, clientId, amountCents, currency = 'USD', productId, productCode = null,
  saleId = null, saleMotion = null, createdByStaffId = null, createdByRole = null,
  env = process.env, fetchImpl = fetch
} = {}) {
  const cfg = whopConfig(env);
  if (!cfg.ok) throw Object.assign(new Error('Whop Blueprint checkout is not configured'),
    { code: 'whop_not_configured', status: 503 });
  if (!UUID.test(orgId || '') || !UUID.test(clientId || '')) throw new TypeError('Whop checkout requires client and org IDs');
  blueprintAmountCents(amountCents);
  if (currency !== 'USD') throw new TypeError('Whop Blueprint checkout accepts USD only');
  if (productCode && productCode !== WHOP_BLUEPRINT_PRODUCT) throw new TypeError('Whop financing is only for Capital Blueprint');
  if (saleMotion != null && !['upsell', 'downsell'].includes(saleMotion)) throw new TypeError('Invalid sale motion');
  const client = (await db.query('SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1', [clientId, orgId])).rows[0];
  if (!client) throw new TypeError('Whop checkout client is not in this org');
  const context = await resolveLinkContext(db, { orgId, clientId, productId,
    productCode: WHOP_BLUEPRINT_PRODUCT, saleId, saleMotion, createdByStaffId, createdByRole });
  if (context.productCode !== WHOP_BLUEPRINT_PRODUCT) throw new TypeError('Whop financing is only for Capital Blueprint');
  await assertBlueprintAgreementPrice(db, { orgId, clientId, amountCents });
  // Reserve the order before POST. An interrupted response can be recovered from
  // Whop metadata without creating a second checkout. An empty URL is never returned.
  const id = randomUUID();
  const linkRef = generateLinkRef();
  const saved = (await db.query(
    `INSERT INTO payment_links (id, org_id, client_id, purpose, description, amount_cents,
       currency, link_ref, checkout_url, provider, product_id, sale_id, sale_motion,
       created_by_staff_id, closer_staff_id, sales_manager_staff_id)
     VALUES ($1,$2,$3,'custom',$4,$5,'USD',$6,'','whop',$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id, orgId, clientId, WHOP_BLUEPRINT_TITLE, amountCents, linkRef, context.productId,
      context.saleId, saleMotion, createdByStaffId, context.closerStaffId, context.salesManagerStaffId]
  )).rows[0];
  const out = await verifyWhopCheckout(await whopRequest('/checkout_configurations', {
    apiKey: cfg.apiKey, method: 'POST', body: buildWhopBlueprintCheckout(saved, cfg),
    idempotencyKey: `whop-blueprint:${id}`, fetchImpl
  }), cfg, saved, { fetchImpl });
  const result = await db.query(
    `UPDATE payment_links SET checkout_url = $2, whop_checkout_configuration_id = $3,
       whop_plan_id = $4 WHERE id = $1 AND provider = 'whop' RETURNING *`,
    [id, out.purchase_url, out.id, out.plan.id]);
  if (!result.rows[0]) throw new Error('Whop checkout could not be saved; reconciliation is required');
  return result.rows[0];
}
