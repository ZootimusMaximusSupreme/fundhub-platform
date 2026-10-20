import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { whopConfig, WHOP_REQUIRED_ENV, blueprintAmountCents, whopMoneyCents,
  whopBlueprintMetadata, buildWhopBlueprintCheckout, createWhopBlueprintPaymentLink } from './whop-blueprint.mjs';
import { verifyWhopCheckout, validateWhopCheckout } from './whop-blueprint.mjs';
import { whopRequest, listWhopResource, WHOP_API_VERSION } from '../messaging/providers/whop-payments.mjs';
import { handleWhopBillingWebhook, processWhopBillingInboxRow,
  validateWhopBlueprintPayment } from '../adapters/whop-billing.mjs';
import { reconcileWhopBilling } from './whop-billing-reconcile.mjs';
import { claimWhopBilling, drainWhopBillingInbox } from './whop-billing-inbox.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const ENV = { WHOP_API_KEY: 'test-only-key', WHOP_ACCOUNT_ID: 'biz_test',
  WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_test', WHOP_WEBHOOK_SECRET: 'ws_test' };
const cfg = whopConfig(ENV);
const NOW = Date.parse('2026-10-20T17:00:00Z');
const linkOf = (over = {}) => ({ id: LINK, org_id: ORG, client_id: CLIENT, product_id: PRODUCT,
  product_code: 'consulting-package', amount_cents: '750000', currency: 'USD', provider: 'whop',
  link_ref: 'opaque-test-ref', status: 'created', purpose: 'custom',
  whop_checkout_configuration_id: 'ch_test', whop_plan_id: 'plan_test', ...over });
const paymentOf = (link = linkOf(), over = {}) => ({ id: 'pay_test', account_id: 'biz_test',
  checkout_configuration_id: 'ch_test', plan_id: 'plan_test', product_id: 'prod_test',
  status: 'paid', currency: 'usd', total: { amount: '7500.00', currency: 'usd', decimals: 2 },
  metadata: whopBlueprintMetadata(link), line_items: [{ quantity: 1, plan_id: 'plan_test', product_id: 'prod_test' }],
  paid_at: '2026-10-20T17:00:00Z', ...over });
const envelope = (type = 'payment.succeeded', data = paymentOf()) => ({ account_id: 'biz_test', type, data });
const rowOf = (body = envelope()) => ({ id: 'inbox_1', org_id: ORG, account_id: 'biz_test', raw_body: JSON.stringify(body) });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const variantOf = (over = {}) => ({ id: 'plan_test', account: { id: 'biz_test' },
  product: { id: 'prod_test' }, currency: 'usd', plan_type: 'one_time', initial_price: 7500,
  title: 'Consulting Services Package', ...over });
const checkoutOf = (link = linkOf(), over = {}) => ({ id: 'ch_test', account_id: 'biz_test', mode: 'payment',
  metadata: whopBlueprintMetadata(link), plan: { id: 'plan_test', initial_price: 7500, currency: 'usd', plan_type: 'one_time' },
  purchase_url: 'https://whop.com/checkout/ch_test/', ...over });

function headersFor(raw, { id = 'msg_test', timestamp = NOW / 1000, secret = ENV.WHOP_WEBHOOK_SECRET } = {}) {
  const signed = createHmac('sha256', secret).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signed}` };
}

function billingDb(initial = linkOf()) {
  let link = initial;
  const inbox = new Map();
  const events = new Map();
  const writes = [];
  return { inbox, events, writes, get link() { return link; }, async query(sql, params = []) {
    if (/SELECT l\.\*, p\.code/.test(sql)) return { rows: link ? [{ ...link }] : [] };
    if (/SELECT org_id FROM payment_links/.test(sql)) return { rows: [{ org_id: ORG }] };
    if (/INSERT INTO whop_billing_inbox/.test(sql)) {
      const key = params[2];
      if (inbox.has(key)) return { rows: [] };
      inbox.set(key, { org_id: params[0], account_id: params[1], webhook_id: key,
        event_type: params[3], payment_id: params[4], raw_body: params[5], headers: params[6], source: params[7] });
      return { rows: [{ id: key }] };
    }
    if (/SELECT id, name, version/.test(sql)) return { rows: events.has(params[1]) ? [events.get(params[1])] : [] };
    if (/UPDATE payment_links/.test(sql)) {
      writes.push({ sql, params });
      if (/SET checkout_url/.test(sql)) {
        link = { ...link, checkout_url: params[1], whop_checkout_configuration_id: params[2], whop_plan_id: params[3] };
      } else {
        if (link.whop_payment_id && link.whop_payment_id !== params[1]) return { rows: [] };
        link = { ...link, whop_payment_id: params[1], ...(/status = 'paid'/.test(sql) ? { status: 'paid' } : {}) };
      }
      return { rows: [{ ...link }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}

test('Whop configuration requires each exact Fundhub billing variable; merchant keys do not count', () => {
  assert.equal(cfg.ok, true);
  assert.deepEqual(WHOP_REQUIRED_ENV, ['WHOP_API_KEY', 'WHOP_ACCOUNT_ID', 'WHOP_CONSULTING_PACKAGE_PRODUCT_ID', 'WHOP_WEBHOOK_SECRET']);
  for (const key of WHOP_REQUIRED_ENV) assert.equal(whopConfig({ ...ENV, [key]: '' }).ok, false);
  assert.equal(whopConfig({ MERCHANT_ENCRYPTION_KEY: 'test' }).ok, false);
});

test('exact price range and Money parsing preserve cents without rounding', () => {
  for (const n of [500000, 750001, 1000000]) assert.equal(blueprintAmountCents(n), n);
  for (const n of [499999, 1000001, 750000.5, '750000', NaN]) assert.throws(() => blueprintAmountCents(n));
  assert.equal(whopMoneyCents({ amount: '7500.01', currency: 'usd', decimals: 2 }), 750001);
  for (const money of [{ amount: '7500.001', currency: 'usd', decimals: 2 },
    { amount: 7500, currency: 'usd', decimals: 2 }, { amount: '7500', currency: 'eur', decimals: 2 }]) {
    assert.throws(() => whopMoneyCents(money));
  }
});

test('checkout uses only the canonical product/title, exact amount and server order metadata', () => {
  const out = buildWhopBlueprintCheckout(linkOf(), cfg);
  assert.equal(out.plan.initial_price, 7500);
  assert.equal(out.plan.title, 'Consulting Services Package');
  assert.equal(out.plan.product_id, 'prod_test');
  assert.equal(out.metadata.offer_key, 'UWIQ_DELIVERABLES');
  assert.equal(out.metadata.fh_client_id, CLIENT);
  assert.equal(out.mode, 'payment');
  assert.equal(out.plan.plan_type, 'one_time');
  assert.equal('payment_method_configuration' in out, false);
  assert.equal('split_pay_required_payments' in out.plan, false);
  assert.equal(Object.keys(out.metadata).length, 9);
});

test('checkout reserves local identity and validates agreement before posting to provider', async () => {
  const calls = [];
  let saved;
  const body = 'Capital Blueprint package price $7,500';
  const contract = { id: 'contract', status: 'sent', merge_values: { package_fee: '$7,500', _blueprint_amount_cents: 750000 },
    rendered_body: body, body_sha: `sha256:${createHash('sha256').update(body).digest('hex')}` };
  const db = { async query(sql, params = []) {
    calls.push(sql);
    if (/SELECT id FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
    if (/FROM products/.test(sql)) return { rows: [{ id: PRODUCT, code: 'consulting-package' }] };
    if (/FROM sales|FROM call_outcomes/.test(sql)) return { rows: [] };
    if (/FROM contracts/.test(sql)) return { rows: [contract] };
    if (/INSERT INTO payment_links/.test(sql)) {
      saved = linkOf({ id: params[0], link_ref: params[5], checkout_url: '', whop_checkout_configuration_id: null, whop_plan_id: null });
      return { rows: [saved] };
    }
    if (/UPDATE payment_links/.test(sql)) return { rows: [{ ...saved, checkout_url: params[1], whop_checkout_configuration_id: params[2], whop_plan_id: params[3] }] };
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  let posted;
  const out = await createWhopBlueprintPaymentLink(db, { orgId: ORG, clientId: CLIENT,
    productId: PRODUCT, amountCents: 750000, env: ENV, fetchImpl: async (url, init) => {
      assert.ok(saved, 'local order must exist before provider side effect');
      if (url.endsWith('/variants/plan_test')) return response(variantOf());
      posted = JSON.parse(init.body);
      assert.equal(url, 'https://api.whop.com/api/v1/checkout_configurations');
      assert.equal(init.headers['Api-Version-Date'], WHOP_API_VERSION);
      assert.equal(init.headers['Idempotency-Key'], `whop-blueprint:${saved.id}`);
      return response(checkoutOf(saved));
    } });
  assert.equal(out.checkout_url, 'https://whop.com/checkout/ch_test/');
  assert.equal(posted.metadata.fh_payment_link_id, saved.id);
  assert.ok(calls.findIndex((sql) => /FROM contracts/.test(sql)) < calls.findIndex((sql) => /INSERT INTO payment_links/.test(sql)));
  contract.merge_values.package_fee = '$5,000';
  let providerCalls = 0;
  await assert.rejects(createWhopBlueprintPaymentLink(db, { orgId: ORG, clientId: CLIENT,
    productId: PRODUCT, amountCents: 750000, env: ENV, fetchImpl: async () => { providerCalls += 1; } }),
  (err) => err.code === 'blueprint_agreement_price_mismatch');
  assert.equal(providerCalls, 0);
});

test('provider checkout response and variant must match exact amount, product and currency before URL is returned', async () => {
  const link = linkOf();
  for (const over of [{ plan: { ...checkoutOf().plan, initial_price: 5000 } },
    { plan: { ...checkoutOf().plan, currency: 'eur' } }, { metadata: {} }]) {
    assert.throws(() => validateWhopCheckout(checkoutOf(link, over), cfg, link));
  }
  for (const over of [{ product: { id: 'prod_wrong' } }, { account: { id: 'biz_other' } },
    { initial_price: 5000 }, { currency: 'eur' }, { plan_type: 'renewal' }]) {
    await assert.rejects(verifyWhopCheckout(checkoutOf(link), cfg, link, {
      fetchImpl: async () => response(variantOf(over)) }), /does not match/);
  }
});

test('signed receiver stores raw receipt once and never emits/grants in HTTP request', async () => {
  const db = billingDb();
  const rawBody = JSON.stringify(envelope());
  const opts = { db, rawBody, headers: headersFor(rawBody), now: NOW, env: ENV };
  assert.equal((await handleWhopBillingWebhook(opts)).body.queued, true);
  assert.equal((await handleWhopBillingWebhook(opts)).body.queued, false);
  assert.equal(db.inbox.size, 1);
  assert.equal(db.inbox.get('msg_test').raw_body, rawBody);
  assert.equal(db.events.size, 0);
  assert.equal(db.writes.length, 0);
});

test('receiver rejects unsigned, altered, stale/future, wrong-account and GET requests', async () => {
  const rawBody = JSON.stringify(envelope());
  const db = billingDb();
  for (const over of [{ headers: {} }, { rawBody: rawBody + ' ' },
    { headers: headersFor(rawBody, { timestamp: NOW / 1000 - 301 }) },
    { headers: headersFor(rawBody, { timestamp: NOW / 1000 + 301 }) }]) {
    assert.equal((await handleWhopBillingWebhook({ db, rawBody, headers: headersFor(rawBody), now: NOW, env: ENV, ...over })).status, 401);
  }
  const wrong = JSON.stringify({ ...envelope(), account_id: 'biz_other' });
  assert.equal((await handleWhopBillingWebhook({ db, rawBody: wrong, headers: headersFor(wrong), now: NOW, env: ENV })).status, 403);
  assert.equal((await handleWhopBillingWebhook({ db, method: 'GET', env: ENV })).status, 405);
  assert.equal(db.inbox.size, 0);
});

test('unknown-order reversal asks Whop to retry without assigning another tenant', async () => {
  const db = billingDb(null);
  const rawBody = JSON.stringify(envelope('refund.updated', { id: 'rf_test', account_id: 'biz_test', payment_id: 'pay_unknown', status: 'succeeded' }));
  const out = await handleWhopBillingWebhook({ db, rawBody, headers: headersFor(rawBody), now: NOW, env: ENV });
  assert.equal(out.status, 409);
  assert.equal(db.inbox.size, 0);
});

test('strict receipt validation rejects every identity/amount/quantity/metadata mismatch', () => {
  const link = linkOf();
  assert.equal(validateWhopBlueprintPayment(paymentOf(link), link, cfg), true);
  for (const over of [{ account_id: 'biz_other' }, { checkout_configuration_id: 'ch_other' },
    { plan_id: 'plan_other' }, { product_id: 'prod_other' }, { currency: 'eur' },
    { total: { amount: '5000.00', currency: 'usd', decimals: 2 } },
    { line_items: [{ quantity: 2, plan_id: 'plan_test', product_id: 'prod_test' }] }]) {
    assert.throws(() => validateWhopBlueprintPayment(paymentOf(link, over), link, cfg));
  }
  for (const key of Object.keys(whopBlueprintMetadata(link))) {
    assert.throws(() => validateWhopBlueprintPayment(paymentOf(link, { metadata: { ...whopBlueprintMetadata(link), [key]: 'wrong' } }), link, cfg));
  }
});

test('settled receipt emits ordinary money-chain event once and stores Whop ID only', async () => {
  const db = billingDb();
  const calls = [];
  const deps = { env: ENV, emit: async (...args) => { calls.push(args); return { id: 'event', deduped: false }; } };
  const out = await processWhopBillingInboxRow(rowOf(), db, deps);
  assert.equal(out.name, 'payment.received');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].amount, 7500);
  assert.equal(calls[0][2].productId, PRODUCT);
  assert.equal(calls[0][2].providerRef, 'pay_test');
  assert.equal(calls[0][3].idempotencyKey, 'whop:payment:pay_test:payment.received');
  assert.equal(db.link.whop_payment_id, 'pay_test');
  assert.equal(db.link.status, 'paid');
  assert.equal(db.writes.some(({ sql }) => /commas_session_id/.test(sql)), false);
});

test('a duplicate event retries failed handlers against its stored canonical event', async () => {
  const db = billingDb();
  const key = 'whop:payment:pay_test:payment.received';
  db.events.set(key, { id: 'event', name: 'payment.received', version: 1, org_id: ORG, client_id: CLIENT, payload: { providerRef: 'pay_test' } });
  let dispatched = 0;
  await processWhopBillingInboxRow(rowOf(), db, { env: ENV,
    emit: async () => ({ deduped: true }), dispatch: async (_db, event, opts) => {
      assert.equal(event.id, 'event'); assert.equal(opts.throwOnHandlerError, true); dispatched += 1;
    } });
  assert.equal(dispatched, 1);
  assert.equal(db.link.status, 'paid');
});

test('failed and canceled payments never mark paid; later success has its own transaction ref', async () => {
  for (const type of ['payment.failed', 'payment.canceled']) {
    const db = billingDb();
    let payload;
    await processWhopBillingInboxRow(rowOf(envelope(type, paymentOf(linkOf(), { status: 'open' }))), db,
      { env: ENV, emit: async (_db, name, p) => { assert.equal(name, type); payload = p; return {}; } });
    assert.equal(db.link.status, 'created');
    assert.equal(db.writes.length, 0);
    assert.equal(payload.providerRef, `pay_test:${type}`);
  }
});

test('a delayed failure cannot chase a buyer whose exact payment is already settled', async () => {
  const db = billingDb(linkOf({ status: 'paid', whop_payment_id: 'pay_test' }));
  let emitted = 0;
  const result = await processWhopBillingInboxRow(rowOf(envelope('payment.failed', paymentOf())), db,
    { env: ENV, emit: async () => { emitted += 1; } });
  assert.equal(result.reason, 'payment_already_settled');
  assert.equal(emitted, 0);
  assert.equal(db.link.status, 'paid');
});

test('unpaid or mismatched receipts and a second payment ID cannot emit a purchase', async () => {
  for (const [link, data] of [[linkOf(), paymentOf(linkOf(), { status: 'pending' })],
    [linkOf(), paymentOf(linkOf(), { product_id: 'prod_wrong' })],
    [linkOf({ whop_payment_id: 'pay_other' }), paymentOf()]]) {
    let emitted = 0;
    await assert.rejects(processWhopBillingInboxRow(rowOf(envelope('payment.succeeded', data)), billingDb(link),
      { env: ENV, emit: async () => { emitted += 1; } }));
    assert.equal(emitted, 0);
  }
});

test('refund and current-API dispute shapes preserve original reference and wait for original sale', async () => {
  const link = linkOf({ status: 'paid', whop_payment_id: 'pay_test' });
  for (const [type, data, expected] of [
    ['refund.updated', { id: 'rf_test', account_id: 'biz_test', payment_id: 'pay_test', status: 'succeeded', amount: { amount: '500.00', currency: 'usd', decimals: 2 } }, 'payment.refunded'],
    ['dispute.created', { id: 'dspt_test', account_id: 'biz_test', payment: { id: 'pay_test' }, amount: 7500, currency: 'usd', evidence_due_at: '2026-11-01T00:00:00Z' }, 'payment.disputed']
  ]) {
    let payload;
    await processWhopBillingInboxRow(rowOf(envelope(type, data)), billingDb(link), { env: ENV,
      emit: async (_db, name, p) => { assert.equal(name, expected); payload = p; return {}; } });
    assert.equal(payload.originalProviderRef, 'pay_test');
    assert.equal(payload.providerRef, data.id);
    await assert.rejects(processWhopBillingInboxRow(rowOf(envelope(type, data)), billingDb(linkOf()), { env: ENV }));
  }
});

test('reconciliation recovers a missing callback via GET only and the shared durable inbox', async () => {
  const db = billingDb();
  const calls = [];
  const result = await reconcileWhopBilling(db, { env: ENV, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return response({ data: url.includes('/payments?') ? [paymentOf()] : [], page_info: { has_next_page: false, end_cursor: null } });
  } });
  assert.equal(result.recovered, 1);
  assert.equal(db.inbox.size, 1);
  assert.equal([...db.inbox.values()][0].source, 'reconcile');
  assert.equal(JSON.parse([...db.inbox.values()][0].raw_body).type, 'payment.succeeded');
  assert.ok(calls.every(({ init }) => init.method === 'GET'));
  assert.equal(db.writes.length, 0);
});

test('reconciliation heals provider-created checkout after interrupted local response save', async () => {
  const link = linkOf({ whop_checkout_configuration_id: null, whop_plan_id: null, checkout_url: '' });
  const db = billingDb(link);
  await reconcileWhopBilling(db, { env: ENV, fetchImpl: async (url) => url.endsWith('/variants/plan_test')
    ? response(variantOf()) : response({ data: url.includes('/checkout_configurations?') ? [checkoutOf(link)]
      : url.includes('/payments?') ? [paymentOf()] : [], page_info: { has_next_page: false } }) });
  assert.equal(db.link.whop_checkout_configuration_id, 'ch_test');
  assert.equal(db.inbox.size, 1);
});

test('provider errors are redacted and repeated pagination cursor fails visibly', async () => {
  await assert.rejects(whopRequest('/payments', { apiKey: 'test', fetchImpl: async () => response({ error: { message: 'SECRET_CUSTOMER_DATA' } }, 401) }),
    (err) => err.code === 'whop_checkout_failed' && !err.message.includes('SECRET'));
  await assert.rejects(listWhopResource('payments', { accountId: 'biz_test', apiKey: 'test',
    fetchImpl: async () => response({ data: [], page_info: { has_next_page: true, end_cursor: 'same' } }) }), /did not advance/);
});

test('inbox claims use atomic skip-locked recovery and bounded attempts', async () => {
  let seen;
  await claimWhopBilling({ query: async (sql, params) => { seen = { sql, params }; return { rows: [] }; } });
  assert.match(seen.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(seen.sql, /claimed_at < now\(\) - interval '15 minutes'/);
  assert.equal(seen.params[1], 10);
  let claimed = false;
  const updates = [];
  const db = { query: async (sql, params) => {
    if (/WITH ready/.test(sql)) { if (claimed) return { rows: [] }; claimed = true; return { rows: [{ id: 'inbox', attempts: 1 }] }; }
    updates.push({ sql, params }); return { rows: [] };
  } };
  const out = await drainWhopBillingInbox(db, { process: async () => { throw new Error('provider mismatch'); } });
  assert.equal(out.counts.failed, 1);
  assert.match(updates[0].sql, /retry_at = now\(\)/);
  assert.equal(updates[0].params[2], 1, 'claim token prevents stale worker marking a reclaimed receipt');
});
