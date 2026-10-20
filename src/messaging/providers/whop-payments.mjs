// Current API, verified 2026-10-20:
// https://docs.whop.com/api-reference/beta/checkout-configurations/create-a-checkout-configuration
// https://docs.whop.com/api-reference/beta/payments/list-payments
import { transmit, ADAPTERS } from '../../lib/outbound-fetch.mjs';

export const WHOP_API_BASE = 'https://api.whop.com/api/v1';
export const WHOP_API_VERSION = '2026-10-15-1';

export async function whopRequest(path, { apiKey, method = 'GET', body, idempotencyKey,
  env = process.env, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error('Whop API key is not configured'), { code: 'whop_not_configured' });
  if (!/^\/(?:checkout_configurations|payments|refunds|disputes|variants)(?:[/?]|$)/.test(path)) {
    throw new TypeError('Unsupported Whop billing resource');
  }
  const response = await transmit(`${WHOP_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Api-Version-Date': WHOP_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
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
