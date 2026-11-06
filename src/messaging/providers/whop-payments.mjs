// Current API, verified 2026-10-20:
// https://docs.whop.com/api-reference/beta/checkout-configurations/create-a-checkout-configuration
// https://docs.whop.com/api-reference/beta/payments/list-payments
import { transmit, ADAPTERS } from '../../lib/outbound-fetch.mjs';
import { isCommasSafeCopy } from '../../payments/commas-safe-copy.mjs';

export const WHOP_API_BASE = 'https://api.whop.com/api/v1';
export const WHOP_API_VERSION = '2026-10-15-1';
export const WHOP_CHECKOUT_TITLE = 'Consulting Services Package';
const WHOP_SANDBOX_API_BASE = 'https://sandbox-api.whop.com/api/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_KEYS = ['fh_schema', 'fh_payment_link_id', 'fh_org_id', 'fh_client_id', 'fh_amount_cents', 'fh_currency'];
const SERVICE_KEYS = ['fh_schema', 'fh_service_request_id', 'fh_org_id', 'fh_client_id',
  'fh_engagement_id', 'fh_target_id', 'fh_amount_cents', 'fh_currency'];
const BODY_KEYS = ['account_id', 'mode', 'metadata', 'plan'];
const PLAN_KEYS = ['product_id', 'plan_type', 'release_method', 'initial_price', 'currency',
  'title', 'description', 'visibility', 'adaptive_pricing_enabled'];
const RESOURCE = /^\/(?:checkout_configurations|payments|refunds|disputes|variants)(?:[/?]|$)/;

function whopEnvironment(env) {
  const mode = String(env.WHOP_ENV ?? 'production').trim().toLowerCase();
  if (!['production', 'sandbox'].includes(mode)) {
    throw Object.assign(new Error('Whop environment must be production or sandbox'),
      { code: 'whop_invalid_environment' });
  }
  return mode;
}

// Exact documented hosts only. Sandbox selection never changes the live env.
export function whopApiBase(env = process.env) {
  return whopEnvironment(env) === 'sandbox' ? WHOP_SANDBOX_API_BASE : WHOP_API_BASE;
}

export function whopCheckoutHostname(env = process.env) {
  return whopEnvironment(env) === 'sandbox' ? 'sandbox.whop.com' : 'whop.com';
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function unsafeCheckout() {
  return Object.assign(new Error('Whop checkout payload is not permitted'),
    { code: 'whop_unsafe_checkout', status: 400 });
}

// Validate the serialized body, not a hand-picked display field. Service/SKU
// names stay on immutable Fundhub rows; the provider gets exact opaque refs.
function assertWhopCheckoutBody(body, idempotencyKey) {
  const hasMethods = Object.hasOwn(body || {}, 'payment_method_configuration');
  const keys = hasMethods ? [...BODY_KEYS, 'payment_method_configuration'] : BODY_KEYS;
  const methods = body?.payment_method_configuration;
  if ((hasMethods && (!exactKeys(methods, ['enabled', 'disabled', 'include_platform_defaults'])
    || !Array.isArray(methods.enabled) || methods.enabled.length !== 1 || methods.enabled[0] !== 'claritypay'
    || !Array.isArray(methods.disabled) || methods.disabled.length !== 0 || methods.include_platform_defaults !== true))
    || !exactKeys(body, keys) || !exactKeys(body.plan, PLAN_KEYS)
    || !/^biz_[A-Za-z0-9]+$/.test(body.account_id || '') || body.mode !== 'payment'
    || !/^prod_[A-Za-z0-9]+$/.test(body.plan.product_id || '')
    || body.plan.plan_type !== 'one_time' || body.plan.release_method !== 'buy_now'
    || body.plan.currency !== 'usd' || body.plan.visibility !== 'hidden'
    || body.plan.adaptive_pricing_enabled !== false
    || [body.plan.title, body.plan.description].some(value => value !== WHOP_CHECKOUT_TITLE || !isCommasSafeCopy(value))) {
    throw unsafeCheckout();
  }
  const meta = body.metadata;
  const service = Object.hasOwn(meta || {}, 'fh_service_request_id');
  const metadataKeys = service ? SERVICE_KEYS : ORDER_KEYS;
  if (!exactKeys(meta, metadataKeys) || meta.fh_schema !== '2' || meta.fh_currency !== 'USD'
    || !/^[1-9]\d*$/.test(meta.fh_amount_cents || '')) throw unsafeCheckout();
  const amount = Number(meta.fh_amount_cents);
  const referenceKey = service ? 'fh_service_request_id' : 'fh_payment_link_id';
  if (!Number.isSafeInteger(amount) || amount <= 0 || typeof meta.fh_amount_cents !== 'string'
    || body.plan.initial_price !== amount / 100
    || metadataKeys.filter(key => key.endsWith('_id')).some(key => !UUID.test(meta[key] || ''))
    || idempotencyKey !== `${service ? 'fh-request' : 'fh-order'}:${meta[referenceKey]}`) throw unsafeCheckout();
}

export async function whopRequest(path, { apiKey, method = 'GET', body, idempotencyKey,
  env = process.env, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error('Whop API key is not configured'), { code: 'whop_not_configured' });
  if (!RESOURCE.test(path)) {
    throw new TypeError('Unsupported Whop billing resource');
  }
  const url = new URL(whopApiBase(env) + path);
  if (!url.pathname.startsWith('/api/v1/') || !RESOURCE.test(url.pathname.slice('/api/v1'.length)) || url.hash) {
    throw new TypeError('Unsupported Whop billing resource');
  }
  const verb = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(verb)
    || (verb === 'POST' && (url.pathname !== '/api/v1/checkout_configurations' || url.search))
    || (verb === 'GET' && body != null)) throw unsafeCheckout();
  const bodyText = body == null ? undefined : JSON.stringify(body);
  if (verb === 'POST') {
    assertWhopCheckoutBody(bodyText ? JSON.parse(bodyText) : null, idempotencyKey);
  }
  const response = await transmit(url.href, {
    method: verb,
    headers: { Authorization: `Bearer ${apiKey}`, 'Api-Version-Date': WHOP_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(bodyText ? { body: bodyText } : {})
  }, { fence: ADAPTERS, what: 'Whop billing request', env, fetchImpl, timeoutMs: 15000 });
  const data = response.body;
  if (response.blocked) {
    throw Object.assign(new Error('Whop billing request held by adapter fence'),
      { code: 'whop_checkout_failed', status: 502 });
  }
  if (!response.ok || !data || data.error) {
    // Do not echo provider error bodies: they can contain customer data or secrets.
    throw Object.assign(new Error(`Whop billing request failed (${response.status})`),
      { code: 'whop_checkout_failed', status: 502 });
  }
  return data;
}

export async function listWhopResource(resource, { accountId, apiKey, query = {},
  env = process.env, fetchImpl, maxPages = 20 } = {}) {
  const rows = [];
  let after = null;
  const seen = new Set();
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ account_id: accountId, first: '100', ...query });
    if (after) params.set('after', after);
    const out = await whopRequest(`/${resource}?${params}`, { apiKey, env, fetchImpl });
    if (!Array.isArray(out.data) || !out.page_info || typeof out.page_info.has_next_page !== 'boolean') {
      throw new Error('Whop billing list returned an invalid page');
    }
    rows.push(...out.data);
    if (!out.page_info.has_next_page) return rows;
    after = out.page_info.end_cursor;
    if (!after || seen.has(after)) throw new Error('Whop billing list cursor did not advance');
    seen.add(after);
  }
  throw new Error('Whop billing list exceeded the page limit; reconciliation incomplete');
}
