import test from 'node:test';
import assert from 'node:assert/strict';
import { WHOP_API_BASE, WHOP_CHECKOUT_TITLE, whopApiBase, whopCheckoutHostname, whopRequest,
  getWhopBlueprintPlanId, prepareWhopBlueprintPlan } from './whop-payments.mjs';

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

test('Whop permits only the exact financing override on a bound neutral checkout', async () => {
  const methods = { enabled: ['claritypay'], disabled: [], include_platform_defaults: true };
  let calls = 0;
  const options = (body) => ({ apiKey: 'synthetic-key', method: 'POST', body,
    idempotencyKey: `fh-order:${ids[0]}`, env, fetchImpl: async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(init.body).payment_method_configuration, methods);
      return new Response(JSON.stringify({ id: 'ch_synthetic' }), { status: 200 });
    } });
  await whopRequest('/checkout_configurations', options({ ...packet(), payment_method_configuration: methods }));
  assert.equal(calls, 1);
  for (const malformed of [null, {}, { ...methods, enabled: 'claritypay' },
    { ...methods, enabled: ['claritypay', 7] }, { ...methods, enabled: ['card'] },
    { ...methods, disabled: 'card' }, { ...methods, disabled: ['claritypay'] },
    { ...methods, include_platform_defaults: false }, { ...methods, note: 'funding' }]) {
    await assert.rejects(whopRequest('/checkout_configurations', options({ ...packet(),
      payment_method_configuration: malformed })), { code: 'whop_unsafe_checkout' });
  }
  const forged = { ...methods, toJSON: () => ({ ...methods, disabled: ['claritypay'] }) };
  await assert.rejects(whopRequest('/checkout_configurations', options({ ...packet(),
    payment_method_configuration: forged })), { code: 'whop_unsafe_checkout' });
  assert.equal(calls, 1, 'malformed or serialized overrides never reach the provider');
});

const fixedVariant = (over = {}) => ({ id: 'plan_fixed', account: { id: 'biz_synthetic' },
  product: { id: 'prod_synthetic', title: WHOP_CHECKOUT_TITLE }, currency: 'usd', plan_type: 'one_time', release_method: 'buy_now',
  initial_price_due: { currency: 'usd', amount: '32.00', decimals: 2 },
  initial_price: 32, renewal_price: 0, title: WHOP_CHECKOUT_TITLE, description: WHOP_CHECKOUT_TITLE,
  visibility: 'hidden', adaptive_pricing_enabled: false, allow_multiple_quantity: false,
  unlimited_stock: true, trial_period_days: null, split_pay_required_payments: null,
  collect_tax: false, expiration_days: null, ...over });
const prepareOptions = (fetchImpl, extra = {}) => ({ planId: 'plan_fixed', accountId: 'biz_synthetic',
  productId: 'prod_synthetic', amountCents: 3200, apiKey: 'synthetic-key', env, fetchImpl, ...extra });
const existingPacket = () => { const body = packet(); delete body.plan; return { ...body, plan_id: 'plan_fixed' }; };

test('existing Whop prices require a complete trusted exact-cent mapping', () => {
  assert.equal(getWhopBlueprintPlanId(3200, {}), null);
  assert.equal(getWhopBlueprintPlanId(3200, { WHOP_BLUEPRINT_PLAN_IDS: '{"3200":"plan_fixed"}' }), 'plan_fixed');
  for (const raw of ['no', 'null', '[]', '{}', '{"03200":"plan_fixed"}', '{"0":"plan_fixed"}',
    '{"3200":"prod_wrong"}', '{"3200":32}', '{"3200":"plan_fixed","bad":"plan_other"}',
    '{"9007199254740992":"plan_fixed"}', '{"3300":"plan_other"}']) {
    assert.throws(() => getWhopBlueprintPlanId(3200, { WHOP_BLUEPRINT_PLAN_IDS: raw }), { code: 'whop_unsafe_checkout' });
  }
});

test('an existing-price checkout uses the pinned API, exact neutral metadata and a verified read', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(init.method === 'GET' ? fixedVariant() : { id: 'ch_fixed' }), { status: 200 });
  };
  const verifiedPlan = await prepareWhopBlueprintPlan(prepareOptions(fetchImpl));
  const body = existingPacket();
  await whopRequest('/checkout_configurations', { apiKey: 'synthetic-key', method: 'POST', body,
    idempotencyKey: `fh-order:${ids[0]}`, verifiedPlan, env, fetchImpl });
  assert.deepEqual(calls.map(call => call.init.method), ['GET', 'POST']);
  assert.match(calls[0].url, /\/variants\/plan_fixed$/);
  assert.equal(calls[1].init.headers['Api-Version-Date'], '2026-10-15-1');
  assert.deepEqual(JSON.parse(calls[1].init.body), body);
  assert.doesNotMatch(calls[1].init.body, /funding|blueprint|repair|product_code|offer_key|variant_id/i);
});

test('wrong or mutable existing prices never authorize checkout', async () => {
  for (const over of [{ id: 'plan_other' }, { account: { id: 'biz_other' } }, { product: { id: 'prod_other' } },
    { currency: 'eur' }, { initial_price: 0 }, { initial_price: 31 }, { initial_price: '32' },
    { plan_type: 'renewal' }, { release_method: 'waitlist' }, { renewal_price: 1 },
    { title: 'Funding' }, { description: 'Credit repair' }, { title: undefined }, { description: null },
    { product: { id: 'prod_synthetic', title: 'Funding' } }, { product: { id: 'prod_synthetic' } },
    { initial_price_due: null }, { initial_price_due: { currency: 'usd', amount: '31.00', decimals: 2 } },
    { initial_price_due: { currency: 'cad', amount: '32.00', decimals: 2 } },
    { visibility: 'visible' }, { adaptive_pricing_enabled: true }, { allow_multiple_quantity: true },
    { unlimited_stock: false }, { trial_period_days: 1 }, { split_pay_required_payments: 2 },
    { collect_tax: true }, { collect_tax: true, tax_type: 'exclusive' }, { expiration_days: 30 }]) {
    const calls = [];
    await assert.rejects(prepareWhopBlueprintPlan(prepareOptions(async (_url, init) => {
      calls.push(init.method); return new Response(JSON.stringify(fixedVariant(over)), { status: 200 });
    })), { code: 'whop_unsafe_checkout' });
    assert.deepEqual(calls, ['GET']);
  }
});

test('the normal merchant editor nullable title and inclusive tax preserve the neutral fixed total', async () => {
  const fetchImpl = async () => Response.json(fixedVariant({ title: null, collect_tax: true, tax_type: 'inclusive' }));
  await prepareWhopBlueprintPlan(prepareOptions(fetchImpl));
});

test('a bare ID, forged proof, changed account/amount/host/credential or service order cannot POST', async () => {
  let posts = 0;
  const fetchImpl = async (_url, init) => {
    if (init.method === 'POST') posts++;
    return new Response(JSON.stringify(fixedVariant()), { status: 200 });
  };
  const verifiedPlan = await prepareWhopBlueprintPlan(prepareOptions(fetchImpl));
  const base = { apiKey: 'synthetic-key', method: 'POST', body: existingPacket(),
    idempotencyKey: `fh-order:${ids[0]}`, verifiedPlan, env, fetchImpl };
  const service = packet(true); delete service.plan; service.plan_id = 'plan_fixed';
  for (const extra of [{ verifiedPlan: null }, { verifiedPlan: {} }, { apiKey: 'other-key' },
    { env: { ...env, WHOP_ENV: 'sandbox' } }, { fetchImpl: async () => { posts++; } },
    { body: { ...existingPacket(), account_id: 'biz_other' } },
    { body: { ...existingPacket(), plan_id: 'plan_other' } },
    { body: { ...existingPacket(), metadata: { ...packet().metadata, fh_amount_cents: '3300' } } },
    { body: { ...existingPacket(), plan: packet().plan } },
    { body: service, idempotencyKey: `fh-request:${ids[0]}` }]) {
    await assert.rejects(whopRequest('/checkout_configurations', { ...base, ...extra }), { code: 'whop_unsafe_checkout' });
  }
  assert.equal(posts, 0);
});
