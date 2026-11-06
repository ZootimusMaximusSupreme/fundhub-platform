import test from 'node:test';
import assert from 'node:assert/strict';
import { WHOP_API_BASE, WHOP_CHECKOUT_TITLE, whopApiBase, whopCheckoutHostname, whopRequest } from './whop-payments.mjs';

const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005'];
const env = { ADAPTERS_DRY_RUN: 'false' };
const packet = (service = false) => ({ account_id: 'biz_synthetic', mode: 'payment', metadata: {
  fh_schema: '2', [service ? 'fh_service_request_id' : 'fh_payment_link_id']: ids[0],
  fh_org_id: ids[1], fh_client_id: ids[2], ...(service ? { fh_engagement_id: ids[3], fh_target_id: ids[4] } : {}),
  fh_amount_cents: '3200', fh_currency: 'USD'
}, plan: { product_id: 'prod_synthetic', plan_type: 'one_time', release_method: 'buy_now',
  initial_price: 32, currency: 'usd', title: WHOP_CHECKOUT_TITLE, description: WHOP_CHECKOUT_TITLE,
  visibility: 'hidden', adaptive_pricing_enabled: false } });

test('Whop selects only explicit documented production and sandbox hosts', () => {
  assert.equal(whopApiBase({}), WHOP_API_BASE);
  assert.equal(whopCheckoutHostname({ WHOP_ENV: 'production' }), 'whop.com');
  assert.equal(whopApiBase({ WHOP_ENV: 'sandbox' }), 'https://sandbox-api.whop.com/api/v1');
  assert.equal(whopCheckoutHostname({ WHOP_ENV: 'sandbox' }), 'sandbox.whop.com');
  for (const WHOP_ENV of ['', 'sanbox', 'true', 'https://example.invalid']) {
    assert.throws(() => whopApiBase({ WHOP_ENV }), { code: 'whop_invalid_environment' });
  }
});

for (const WHOP_ENV of ['production', 'sandbox']) {
  for (const service of [false, true]) {
    test(`Whop serialized ${service ? 'service' : 'package'} checkout preserves neutral refs on ${WHOP_ENV}`, async () => {
      const calls = [];
      const body = packet(service);
      const key = `${service ? 'fh-request' : 'fh-order'}:${ids[0]}`;
      const result = await whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body,
        idempotencyKey: key, env: { ...env, WHOP_ENV }, fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return new Response(JSON.stringify({ id: 'ch_synthetic' }), { status: 200 });
        } });
      assert.equal(result.id, 'ch_synthetic');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, whopApiBase({ WHOP_ENV }) + '/checkout_configurations');
      assert.equal(calls[0].init.headers['Idempotency-Key'], key);
      assert.deepEqual(JSON.parse(calls[0].init.body), body);
      assert.doesNotMatch(calls[0].init.body, /blueprint|funding|inquiry|repair|credit|underwrite|scope_type|offer_key|product_code/i);
    });
  }
}

test('Whop refuses descriptive copy, metadata additions and mismatched refs before network', async () => {
  const changes = [
    body => { body.plan.title = 'Funding, done-for-you'; },
    body => { body.plan.description = 'Credit repair'; },
    body => { body.plan.description = 'A different harmless title'; },
    body => { body.description = 'Funding'; },
    body => { body.plan.metadata = { service_kind: 'inquiry_removal' }; },
    body => { body.metadata.product_code = 'blueprint-self-funding'; },
    body => { body.metadata.fh_schema = '1'; },
    body => { body.metadata.fh_amount_cents = '03200'; },
    body => { body.metadata.fh_amount_cents = 3200; },
    body => { body.metadata.fh_client_id = 'credit-pull'; },
    body => { body.metadata.fh_currency = 'CAD'; },
    body => { body.plan.initial_price = 33; },
    body => { body.plan.adaptive_pricing_enabled = true; },
    body => { body.plan.product_id = 'unbound'; }
  ];
  let calls = 0;
  for (const change of changes) {
    const body = packet(); change(body);
    await assert.rejects(whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body,
      idempotencyKey: `fh-order:${ids[0]}`, env, fetchImpl: async () => { calls++; } }), { code: 'whop_unsafe_checkout' });
  }
  await assert.rejects(whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body: packet(),
    idempotencyKey: `whop-blueprint:${ids[0]}`, env, fetchImpl: async () => { calls++; } }), { code: 'whop_unsafe_checkout' });
  assert.equal(calls, 0);
});

test('Whop validates serialized values and preserves the existing adapter fence', async () => {
  let calls = 0;
  const body = packet();
  body.plan.toJSON = () => ({ ...packet().plan, description: 'Credit repair' });
  await assert.rejects(whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body,
    idempotencyKey: `fh-order:${ids[0]}`, env, fetchImpl: async () => { calls++; } }), { code: 'whop_unsafe_checkout' });
  await assert.rejects(whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body: packet(),
    idempotencyKey: `fh-order:${ids[0]}`, env: { WHOP_ENV: 'sandbox' }, fetchImpl: async () => { calls++; } }), { code: 'whop_checkout_failed' });
  assert.equal(calls, 0);
});

test('Whop rejects invalid environment and resource traversal before network', async () => {
  let calls = 0;
  for (const args of [
    { path: '/payments', env: { ...env, WHOP_ENV: 'sanbox' }, code: 'whop_invalid_environment' },
    { path: '/payments/../products', env, code: null },
    { path: '/products', env, code: null }
  ]) {
    await assert.rejects(whopRequest(args.path, { apiKey: 'synthetic-key', env: args.env,
      fetchImpl: async () => { calls++; } }), args.code ? { code: args.code } : TypeError);
  }
  assert.equal(calls, 0);
});

test('Whop refuses alternate checkout POST paths and every unsupported mutation before network', async () => {
  let calls = 0;
  const body = packet();
  body.plan.title = 'Funding';
  body.plan.description = 'Credit repair';
  body.metadata.product_code = 'blueprint-self-funding';
  for (const [path, method] of [
    ['/checkout_configurations/', 'POST'],
    ['/checkout_configurations/ch_synthetic', 'POST'],
    ['/checkout_configurations?copy=funding', 'POST'],
    ['/variants', 'POST'],
    ['/payments', 'POST'],
    ['/refunds', 'POST'],
    ['/checkout_configurations', 'PATCH'],
    ['/payments/pay_synthetic', 'DELETE'],
    ['/checkout_configurations', 'GET']
  ]) {
    await assert.rejects(whopRequest(path, { apiKey: 'synthetic-key', method, body,
      idempotencyKey: `fh-order:${ids[0]}`, env, fetchImpl: async () => { calls++; } }), { code: 'whop_unsafe_checkout' });
  }
  assert.equal(calls, 0);
});
