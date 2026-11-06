import { randomUUID } from 'node:crypto';
import { generateLinkRef, resolveLinkContext } from '../payment-links/index.mjs';
import { getWhopBlueprintPlanId, listWhopResource, prepareWhopBlueprintPlan, whopRequest, WHOP_CHECKOUT_TITLE, whopCheckoutHostname } from '../messaging/providers/whop-payments.mjs';
import { assertBlueprintAgreementPrice } from '../contracts/blueprint-price.mjs';
import { getOffer } from '../config/offers.mjs';

export const WHOP_BLUEPRINT_PRODUCT = 'consulting-package';
export const WHOP_BLUEPRINT_TITLE = WHOP_CHECKOUT_TITLE;
export const WHOP_BLUEPRINT_OFFER = 'UWIQ_DELIVERABLES';
export const WHOP_FULL_BLUEPRINT_PRODUCT = 'blueprint-self-funding';
export function isWhopBlueprintProduct(code) {
  return [WHOP_BLUEPRINT_PRODUCT, WHOP_FULL_BLUEPRINT_PRODUCT].includes(code);
}
export function whopBlueprintOfferKey(productCode = WHOP_BLUEPRINT_PRODUCT) {
  if (!isWhopBlueprintProduct(productCode)) throw new TypeError('Choose a Blueprint package');
  return productCode === WHOP_FULL_BLUEPRINT_PRODUCT ? 'BLUEPRINT_SELF_FUNDING' : WHOP_BLUEPRINT_OFFER;
}
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

export function blueprintAmountCents(value, productCode = WHOP_BLUEPRINT_PRODUCT) {
  const offer = getOffer(whopBlueprintOfferKey(productCode));
  if (!offer || !Number.isSafeInteger(value) || value < offer.priceMinCents || value > offer.priceMaxCents) {
    throw new RangeError('Blueprint amount is outside the selected package range');
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

export function matchesWhopMetadata(actual, expected) {
  return !!actual && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
}

export function whopBlueprintMetadata(link) {
  if (link.whop_metadata_version === 2) {
    return { fh_schema: '2', fh_payment_link_id: link.id, fh_org_id: link.org_id, fh_client_id: link.client_id,
      fh_amount_cents: String(link.amount_cents), fh_currency: 'USD' };
  }
  if (link.whop_metadata_version != null && link.whop_metadata_version !== 1) throw new TypeError('Unknown Whop package metadata version');
  return { fh_schema: '1', fh_payment_link_id: link.id, fh_link_ref: link.link_ref,
    fh_org_id: link.org_id, fh_client_id: link.client_id, offer_key: whopBlueprintOfferKey(link.product_code || WHOP_BLUEPRINT_PRODUCT),
    product_code: link.product_code || WHOP_BLUEPRINT_PRODUCT, fh_amount_cents: String(link.amount_cents),
    fh_currency: 'USD' };
}

export function buildWhopBlueprintCheckout(link, cfg) {
  if (link.whop_metadata_version !== 2) throw new TypeError('An existing Whop checkout can only be recovered via GET');
  const amount = blueprintAmountCents(Number(link.amount_cents), link.product_code || WHOP_BLUEPRINT_PRODUCT);
  const checkout = { account_id: cfg.accountId, mode: 'payment', metadata: whopBlueprintMetadata(link) };
  if (link.whop_existing_plan === true) {
    if (!/^plan_[A-Za-z0-9]+$/.test(link.whop_plan_id || '')) throw new TypeError('A configured checkout requires a pinned plan');
    return { ...checkout, plan_id: link.whop_plan_id };
  }
  return { ...checkout, plan: { product_id: cfg.productId, plan_type: 'one_time', release_method: 'buy_now',
    initial_price: amount / 100, currency: 'usd', title: WHOP_BLUEPRINT_TITLE,
    description: WHOP_BLUEPRINT_TITLE, visibility: 'hidden', adaptive_pricing_enabled: false } };
}

export function isWhopCheckoutUrl(value, checkoutId, env) {
  const host = whopCheckoutHostname(env);
  try {
    const url = new URL(value);
    return url.origin === 'https://' + host && !url.username && !url.password && url.pathname === `/checkout/${checkoutId}/`;
  } catch { return false; }
}

export function validateWhopCheckout(out, cfg, link, env = process.env) {
  if (out.account_id !== cfg.accountId || out.mode !== 'payment' || !/^ch_[a-zA-Z0-9]+$/.test(out.id || '')
    || !/^plan_[a-zA-Z0-9]+$/.test(out.plan?.id || '') || !isWhopCheckoutUrl(out.purchase_url, out.id, env)) {
    throw Object.assign(new Error('Whop checkout response does not match the requested checkout'),
      { code: 'whop_checkout_failed', status: 502 });
  }
  if (link) {
    if ((link.whop_checkout_configuration_id && link.whop_checkout_configuration_id !== out.id)
      || (link.whop_plan_id && link.whop_plan_id !== out.plan.id)
      || out.plan.currency !== 'usd' || out.plan.plan_type !== 'one_time'
      || whopMoneyCents({ amount: String(out.plan.initial_price), currency: 'usd', decimals: 2 }) !== Number(link.amount_cents)
      || !matchesWhopMetadata(out.metadata, whopBlueprintMetadata(link))) {
      throw Object.assign(new Error('Whop checkout price, currency or metadata does not match its order'),
        { code: 'whop_checkout_failed', status: 502 });
    }
  }
  return out;
}

export async function verifyWhopCheckout(out, cfg, link, { env = process.env, fetchImpl = fetch, requiredPaymentMethod = null } = {}) {
  validateWhopCheckout(out, cfg, link, env);
  if (requiredPaymentMethod) {
    const selected = out.payment_method_configuration;
    const effective = out.effective_payment_method_configuration;
    const methods = value => value && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray(value.enabled) && value.enabled.every(method => typeof method === 'string')
      && Array.isArray(value.disabled) && value.disabled.every(method => typeof method === 'string');
    if (!methods(selected) || !methods(effective) || !selected.enabled.includes(requiredPaymentMethod)
      || selected.disabled.includes(requiredPaymentMethod) || !effective.enabled.includes(requiredPaymentMethod)
      || effective.disabled.includes(requiredPaymentMethod)) {
      throw Object.assign(new Error('The checkout has not confirmed its required financing method'),
        { code: 'whop_financing_unverified', status: 502 });
    }
  }
  // The checkout response's embedded plan omits product/account identity.
  // Read the documented variant resource before exposing or recovering its URL.
  // https://docs.whop.com/api-reference/beta/variants/retrieve-variant
  // Preserve the pricing mode captured when the order was created. Both the
  // checkout ID and remote variant title can change during its lifetime.
  if (link.whop_existing_plan === true) {
    if (link.whop_metadata_version !== 2) throw new TypeError('Configured checkout prices require v2 metadata');
    await prepareWhopBlueprintPlan({ planId: link.whop_plan_id, accountId: cfg.accountId,
      productId: cfg.productId, amountCents: Number(link.amount_cents), apiKey: cfg.apiKey, env, fetchImpl });
    return out;
  }
  const variant = await whopRequest(`/variants/${out.plan.id}`, { apiKey: cfg.apiKey, env, fetchImpl });
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
  resumeLinkId = null, reservationId = null, requiredPaymentMethod = null,
  env = process.env, fetchImpl = fetch
} = {}) {
  if (requiredPaymentMethod && requiredPaymentMethod !== 'claritypay') throw new TypeError('Unsupported seller financing method');
  if (resumeLinkId && reservationId && resumeLinkId !== reservationId) throw new TypeError('Whop reservation identity mismatch');
  const cfg = whopConfig(env);
  if (!cfg.ok) throw Object.assign(new Error('Whop Blueprint checkout is not configured'),
    { code: 'whop_not_configured', status: 503 });
  if (!UUID.test(orgId || '') || !UUID.test(clientId || '')) throw new TypeError('Whop checkout requires client and org IDs');
  if (currency !== 'USD') throw new TypeError('Whop Blueprint checkout accepts USD only');
  if (saleMotion != null && !['upsell', 'downsell'].includes(saleMotion)) throw new TypeError('Invalid sale motion');
  const client = (await db.query('SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1', [clientId, orgId])).rows[0];
  if (!client) throw new TypeError('Whop checkout client is not in this org');
  const requestedCode = productCode || (!productId && !saleId ? WHOP_BLUEPRINT_PRODUCT : null);
  const context = await resolveLinkContext(db, { orgId, clientId, productId,
    productCode: requestedCode, saleId, saleMotion, createdByStaffId, createdByRole });
  if ((productId && context.productId !== productId) || (requestedCode && context.productCode !== requestedCode)) {
    throw new TypeError('Whop checkout product does not match the selected Blueprint package');
  }
  const offerKey = whopBlueprintOfferKey(context.productCode);
  blueprintAmountCents(amountCents, context.productCode);
  await assertBlueprintAgreementPrice(db, { orgId, clientId, amountCents, offerKey });
  // Reserve the order before POST. An interrupted response can be recovered from
  // Whop metadata without creating a second checkout. An empty URL is never returned.
  const id = resumeLinkId || reservationId || randomUUID();
  if (!UUID.test(id)) throw new TypeError('Invalid Whop reservation identity');
  const readSaved = async () => (await db.query(
    'SELECT * FROM payment_links WHERE id=$1 AND org_id=$2 AND client_id=$3', [id, orgId, clientId])).rows[0];
  let saved = (resumeLinkId || reservationId) ? await readSaved() : null;
  let inserted = false;
  let verifiedPlan = null;
  if (!saved && !resumeLinkId) {
    const planId = getWhopBlueprintPlanId(amountCents, env);
    if (planId) {
      verifiedPlan = await prepareWhopBlueprintPlan({ planId, accountId: cfg.accountId,
        productId: cfg.productId, amountCents, apiKey: cfg.apiKey, env, fetchImpl });
    }
    saved = (await db.query(
      `INSERT INTO payment_links (id, org_id, client_id, purpose, description, amount_cents,
         currency, link_ref, checkout_url, provider, product_id, sale_id, sale_motion,
         created_by_staff_id, closer_staff_id, sales_manager_staff_id, whop_metadata_version, whop_plan_id, whop_existing_plan)
       VALUES ($1,$2,$3,'custom',$4,$5,'USD',$6,'','whop',$7,$8,$9,$10,$11,$12,2,$13,$14)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, orgId, clientId, WHOP_BLUEPRINT_TITLE, amountCents, generateLinkRef(), context.productId,
        context.saleId, saleMotion, createdByStaffId, context.closerStaffId, context.salesManagerStaffId, planId, Boolean(planId)]
    )).rows[0];
    inserted = Boolean(saved);
    if (!inserted && reservationId) saved = await readSaved();
  }
  if (!saved || saved.org_id !== orgId || saved.client_id !== clientId || saved.provider !== 'whop'
    || saved.product_id !== context.productId || Number(saved.amount_cents) !== amountCents || saved.currency !== 'USD'
    || (saved.sale_id || null) !== (context.saleId || null) || (saved.sale_motion || null) !== (saleMotion || null)
    || (saved.created_by_staff_id || null) !== (createdByStaffId || null)
    || !['created', 'sent'].includes(saved.status)) throw new TypeError('Whop reservation does not match the requested order');
  saved.product_code = context.productCode;
  if (saved.checkout_url) {
    const checkout = await verifyWhopCheckout(await whopRequest(`/checkout_configurations/${saved.whop_checkout_configuration_id}`, {
      apiKey: cfg.apiKey, env, fetchImpl }), cfg, saved, { env, fetchImpl, requiredPaymentMethod });
    if (checkout.id !== saved.whop_checkout_configuration_id || checkout.plan.id !== saved.whop_plan_id
      || checkout.purchase_url !== saved.checkout_url) throw Object.assign(new Error('Whop checkout does not match its saved order'),
        { code: 'whop_checkout_failed', status: 502 });
    return saved;
  }
  let checkout;
  if (inserted) {
    const body = buildWhopBlueprintCheckout(saved, cfg);
    if (requiredPaymentMethod) body.payment_method_configuration = {
      enabled: [requiredPaymentMethod], disabled: [], include_platform_defaults: true
    };
    checkout = await whopRequest('/checkout_configurations', { apiKey: cfg.apiKey, method: 'POST', body,
      idempotencyKey: `fh-order:${id}`, verifiedPlan, env, fetchImpl });
  } else {
    // The first POST may have reached Whop before its response was lost.
    // An existing order can recover only its one exact checkout, without reposting.
    const checkouts = await listWhopResource('checkout_configurations', { accountId: cfg.accountId, apiKey: cfg.apiKey, env, fetchImpl });
    const expected = whopBlueprintMetadata(saved);
    const matches = checkouts.filter(candidate => matchesWhopMetadata(candidate.metadata, expected));
    if (matches.length !== 1) throw Object.assign(new Error('This reserved checkout is awaiting exact read-only reconciliation.'),
      { code: 'whop_checkout_failed', status: 502 });
    [checkout] = matches;
  }
  const out = await verifyWhopCheckout(checkout, cfg, saved, { env, fetchImpl, requiredPaymentMethod });
  const result = await db.query(
    `UPDATE payment_links SET checkout_url = $2, whop_checkout_configuration_id = $3,
       whop_plan_id = $4 WHERE id = $1 AND org_id = $5 AND client_id = $6 AND provider = 'whop'
         AND (whop_plan_id IS NULL OR whop_plan_id = $4)
         AND (whop_checkout_configuration_id IS NULL OR whop_checkout_configuration_id = $3)
         AND (checkout_url = '' OR checkout_url = $2) RETURNING *`,
    [id, out.purchase_url, out.id, out.plan.id, orgId, clientId]);
  if (!result.rows[0]) throw new Error('Whop checkout could not be saved; reconciliation is required');
  return result.rows[0];
}
