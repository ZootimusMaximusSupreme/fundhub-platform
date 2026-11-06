import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { grant } from '../entitlements/entitlements.mjs';
import { emit } from '../events/bus.mjs';
import { on, clearHandlers } from '../events/registry.mjs';
import { onPaymentReceivedMoney } from '../handlers/money-chain.mjs';
import { onPaidServicePaymentReceived } from '../handlers/paid-service-payment.mjs';
import { onPaymentReceived } from '../handlers/client-lifecycle.mjs';
import { onPaymentRefunded, onPaymentDisputed, knownReversalClient } from '../handlers/commas-disputes.mjs';
import { processCommasInboxRow } from '../adapters/commas.mjs';
import { handleWhopBillingWebhook, processWhopBillingInboxRow } from '../adapters/whop-billing.mjs';
import { whopServiceMetadata, mintBlueprintServiceWhopCheckout } from './service-whop.mjs';
import { reconcileWhopBilling } from '../payments/whop-billing-reconcile.mjs';
import { expireStaleCheckouts } from '../paid-services/expire.mjs';
import { lookupBlueprintServiceReceipt } from './service-payment-identity.mjs';
import { requestBlueprintHelp, quoteBlueprintHelp, checkoutBlueprintHelp, readBlueprintClientServices } from './client-services.mjs';
import { isLocalScratchDatabaseUrl } from '../verification/scratch-guard.mjs';

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const env = { WHOP_API_KEY: 'synthetic', WHOP_ACCOUNT_ID: 'biz_fixture', WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_fixture', WHOP_WEBHOOK_SECRET: 'synthetic', ADAPTERS_DRY_RUN: '0' };
const now = Date.now();
const deps = { env, emit: (db, name, payload, opts) => emit(db, name, payload, { ...opts, skipInngest: true }) };
const skip = !isLocalScratchDatabaseUrl(url);
const loadService = async (db, id) => (await db.query(`SELECT s.*,p.price_total_cents,p.status AS payment_status FROM blueprint_client_services s
  JOIN paid_service_requests p ON p.id=s.id WHERE s.id=$1`, [id])).rows[0];
async function fixture(db, kind = 'funding_round') {
  assert.equal((await db.query('SELECT current_user')).rows[0].current_user, 'fundhub_app');
  const orgId = (await db.query('SELECT id FROM orgs WHERE is_default LIMIT 1')).rows[0].id;
  const clientId = (await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Financing',$2) RETURNING id", [orgId, `financing+${randomUUID()}@example.test`])).rows[0].id;
  const accountId = (await db.query("INSERT INTO accounts(org_id,client_id,kind,email,status,password_hash) VALUES($1,$2,'client',$3,'active','synthetic') RETURNING id", [orgId, clientId, `financing+${randomUUID()}@example.test`])).rows[0].id;
  const staffId = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic CSM','csm','active') RETURNING id", [orgId])).rows[0].id;
  const transactionId = (await db.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) SELECT $1,$2,name,30000,'succeeded' FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING id", [orgId, clientId])).rows[0].id;
  await grant(db, { orgId, clientId, code: 'blueprint-client-fulfillment', sourceTransactionId: transactionId });
  const engagement = (await db.query('SELECT id,status FROM blueprint_fulfillment_engagements WHERE source_transaction_id=$1', [transactionId])).rows[0];
  const roundId = (await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status,product) VALUES($1,$2,1,'started','blueprint_self_funding') RETURNING id", [orgId, clientId])).rows[0].id;
  await db.query('UPDATE blueprint_fulfillment_engagements SET funding_round_id=$2 WHERE id=$1', [engagement.id, roundId]);
  const scope = { orgId, clientId, accountId, engagement: { ...engagement, roundId }, now: new Date() };
  const help = await requestBlueprintHelp(db, scope, { serviceKind: kind, idempotencyKey: `financing_${randomUUID()}` });
  await quoteBlueprintHelp(db, { ...scope, staffId }, { requestId: help.request.id, priceCents: 120000 });
  return { scope, id: help.request.id, roundId };
}
function fakeWhopTransport() {
  const requests = [], checkouts = [], calls = [];
  let index = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/checkout_configurations')) {
      const body = JSON.parse(options.body);
      requests.push(body); index++;
      const checkout = { id: `ch_fixture${index}`, account_id: env.WHOP_ACCOUNT_ID, mode: 'payment', metadata: body.metadata,
        plan: { id: `plan_fixture${index}`, initial_price: body.plan.initial_price, currency: 'usd', plan_type: 'one_time' },
        purchase_url: `https://whop.com/checkout/ch_fixture${index}/` };
      checkouts.push(checkout); return new Response(JSON.stringify(checkout));
    }
    if (url.includes('/checkout_configurations/')) return new Response(JSON.stringify(checkouts.find(c => url.endsWith('/' + c.id))));
    return new Response(JSON.stringify({ id: `plan_fixture${index}`, account: { id: env.WHOP_ACCOUNT_ID }, product: { id: env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID },
      initial_price: requests[index - 1].plan.initial_price, currency: 'usd', plan_type: 'one_time', title: 'Consulting Services Package' }));
  };
  return { requests, checkouts, calls, fetchImpl };
}
function paidBody(service, changes = {}) {
  return { account_id: env.WHOP_ACCOUNT_ID, type: 'payment.succeeded', data: { id: `pay_${service.id.replaceAll('-', '')}`,
    account_id: env.WHOP_ACCOUNT_ID, product_id: env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID, plan_id: service.whop_plan_id,
    checkout_configuration_id: service.whop_checkout_configuration_id, currency: 'usd', status: 'paid',
    total: { amount: '1200.00', currency: 'usd', decimals: 2 }, metadata: whopServiceMetadata(service),
    line_items: [{ quantity: 1, product_id: env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID, plan_id: service.whop_plan_id }], ...changes } };
}
async function signedInbox(db, body) {
  const rawBody = JSON.stringify(body), id = `msg_${randomUUID()}`, timestamp = String(Math.floor(now / 1000));
  const headers = { 'webhook-id': id, 'webhook-timestamp': timestamp,
    'webhook-signature': 'v1,' + createHmac('sha256', env.WHOP_WEBHOOK_SECRET).update(`${id}.${timestamp}.${rawBody}`).digest('base64') };
  const accepted = await handleWhopBillingWebhook({ db, rawBody, headers, env, now });
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  return (await db.query('SELECT * FROM whop_billing_inbox WHERE webhook_id=$1', [id])).rows[0];
}
function registerMoney() {
  clearHandlers();
  on('payment.received', onPaymentReceived);
  on('payment.received', onPaymentReceivedMoney);
  on('payment.received', onPaidServicePaymentReceived);
  on('payment.refunded', onPaymentRefunded);
  on('payment.disputed', onPaymentDisputed);
}
async function counts(db, clientId) {
  return (await db.query(`SELECT (SELECT count(*)::int FROM entitlements WHERE client_id=$1) AS entitlements,
    (SELECT count(*)::int FROM transactions WHERE client_id=$1) AS transactions,
    (SELECT count(*)::int FROM sales WHERE client_id=$1) AS sales,
    (SELECT count(*)::int FROM funding_rounds WHERE client_id=$1) AS rounds`, [clientId])).rows[0];
}

test('signed Whop financing callback activates only the existing exact help/round and replay grants nothing else', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false });
  const db = await pool.connect();
  registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id, roundId } = await fixture(db);
    const transport = fakeWhopTransport();
    const input = { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' };
    await assert.rejects(checkoutBlueprintHelp(db, scope, { ...input, expectedPriceCents: 119999 }, { env, fetchImpl: transport.fetchImpl }), { code: 'quote_changed' });
    assert.equal(transport.requests.length, 0);
    const checkout = await checkoutBlueprintHelp(db, scope, input, { env, fetchImpl: transport.fetchImpl });
    assert.equal(checkout.request.checkoutProvider, 'whop');
    assert.equal((await readBlueprintClientServices(db, scope, { env })).checkoutProviders[1].id, 'whop');
    await checkoutBlueprintHelp(db, scope, input, { env, fetchImpl: transport.fetchImpl });
    assert.equal(transport.requests.length, 1);
    const before = await counts(db, scope.clientId);
    const service = await loadService(db, id);
    // Neither a fabricated direct receipt nor a Commas receipt can settle a reserved Whop checkout.
    const foreign = { orgId: scope.orgId, clientId: scope.clientId, payload: { ref: id, amountCents: 120000, paymentId: 'pay_forged', source: 'commas' } };
    assert.equal((await lookupBlueprintServiceReceipt(db, foreign)).valid, false);
    assert.equal((await onPaidServicePaymentReceived(foreign, db)).done, false);
    assert.equal((await onPaidServicePaymentReceived({ ...foreign, payload: { ...foreign.payload, source: 'whop' } }, db)).done, false);
    assert.equal(service.whop_metadata_version,2);
    await db.query('SAVEPOINT pin_guard');
    await assert.rejects(db.query('UPDATE blueprint_client_services SET whop_metadata_version=1 WHERE id=$1',[id]),{code:'23514'});
    await db.query('ROLLBACK TO SAVEPOINT pin_guard');
    const body = paidBody(service);
    const invalid = [p => { p.data.total.amount = '1199.99'; }, p => { p.data.account_id = 'biz_other'; },
      p => { p.data.metadata.fh_org_id = randomUUID(); }, p => { p.data.metadata.fh_client_id = randomUUID(); },
      p => { p.data.checkout_configuration_id = 'ch_other'; }, p => { p.data.plan_id = 'plan_other'; },
      p => { p.data.product_id = 'prod_other'; }, p => { p.data.status = 'pending'; },
      p => { p.data.metadata.fh_target_id = randomUUID(); }, p => { p.data.currency = 'eur'; }];
    for (const change of invalid) {
      const altered = structuredClone(body); change(altered);
      const row = { org_id: scope.orgId, account_id: env.WHOP_ACCOUNT_ID, raw_body: JSON.stringify(altered) };
      await assert.rejects(processWhopBillingInboxRow(row, db, deps));
      assert.deepEqual(await counts(db, scope.clientId), before);
      assert.equal((await loadService(db, id)).payment_status, 'awaiting_payment');
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM events WHERE client_id=$1 AND name='payment.received'", [scope.clientId])).rows[0].n, 0);
    const inbox = await signedInbox(db, body);
    await processWhopBillingInboxRow(inbox, db, deps);
    await processWhopBillingInboxRow(inbox, db, deps);
    assert.deepEqual(await counts(db, scope.clientId), { ...before, transactions: before.transactions + 1 });
    const after = await loadService(db, id);
    assert.equal(after.state, 'in_progress'); assert.equal(after.payment_status, 'staged');
    assert.equal(after.whop_payment_id, body.data.id);
    const engagement = (await db.query('SELECT funding_round_id,execution_owner FROM blueprint_fulfillment_engagements WHERE id=$1', [scope.engagement.id])).rows[0];
    assert.deepEqual(engagement, { funding_round_id: roundId, execution_owner: 'fundhub' });
    const events = (await db.query("SELECT payload FROM events WHERE client_id=$1 AND name='payment.received'", [scope.clientId])).rows;
    assert.equal(events.length, 1); assert.equal(events[0].payload.productId, null);
    assert.equal(events[0].payload.productName, 'blueprint-help-funding_round');
    assert.equal(events[0].payload.paidServiceRequestId, id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-paid-help'", [scope.clientId])).rows[0].n, 1);
    await assert.rejects(processWhopBillingInboxRow({ ...inbox, raw_body: JSON.stringify(paidBody(after, { id: 'pay_second' })) }, db, deps));
    // A database caller cannot rewrite accepted price, provider or identity.
    for (const sql of ["UPDATE blueprint_client_services SET checkout_provider='commas' WHERE id=$1",
      "UPDATE blueprint_client_services SET whop_plan_id='plan_other' WHERE id=$1",
      "UPDATE blueprint_client_services SET whop_payment_id='pay_other' WHERE id=$1",
      "UPDATE paid_service_requests SET price_total_cents=1,price_components='[{\"code\":\"changed\",\"amount_cents\":1}]' WHERE id=$1"]) {
      await db.query('SAVEPOINT immutable_guard'); await assert.rejects(db.query(sql, [id])); await db.query('ROLLBACK TO SAVEPOINT immutable_guard');
    }
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

test('concurrent provider claims reserve one checkout and an unknown result cannot be retried on another rail', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false, max: 4 });
  try {
    for (const first of ['whop', 'commas']) {
      const { scope, id } = await fixture(pool, 'repair_full');
      let entered, release;
      const started = new Promise(resolve => { entered = resolve; });
      const finish = new Promise(resolve => { release = resolve; });
      let calls = 0;
      const mint = async () => { calls++; entered(); await finish; return { ok: true, checkoutUrl: 'https://whop.com/checkout/ch_race/', checkoutId: first === 'whop' ? 'ch_race' + id.replaceAll('-', '') : undefined, planId: first === 'whop' ? 'plan_race' + id.replaceAll('-', '') : undefined }; };
      const input = { requestId: id, authorization: true, expectedPriceCents: 120000, provider: first };
      const pending = checkoutBlueprintHelp(pool, scope, input, { env, mint, mintWhop: mint });
      await started;
      await assert.rejects(checkoutBlueprintHelp(pool, scope, { ...input, provider: first === 'whop' ? 'commas' : 'whop' }, { env, mint, mintWhop: mint }), { code: 'checkout_provider_locked' });
      const repeated = await checkoutBlueprintHelp(pool, scope, input, { env, mint, mintWhop: mint });
      assert.equal(repeated.request.status, 'checkout_pending'); assert.equal(calls, 1);
      release(); await pending;
      assert.equal((await loadService(pool, id)).checkout_provider, first);
      if (first === 'commas') {
        const event = { orgId: scope.orgId, clientId: scope.clientId, payload: { ref: id, amountCents: 120000, source: 'whop', paymentId: 'pay_wrongrail' } };
        assert.equal((await lookupBlueprintServiceReceipt(pool, event)).reason, 'service_provider_mismatch');
        assert.equal((await onPaidServicePaymentReceived(event, pool)).done, false);
      }
    }
    const { scope, id } = await fixture(pool, 'repair_full');
    let attempts = 0;
    const unknown = async () => { attempts++; throw new Error('transport outcome unknown'); };
    const input = { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' };
    await assert.rejects(checkoutBlueprintHelp(pool, scope, input, { env, mintWhop: unknown }), { code: 'checkout_needs_review' });
    await assert.rejects(checkoutBlueprintHelp(pool, scope, input, { env, mintWhop: unknown }));
    await assert.rejects(checkoutBlueprintHelp(pool, scope, { ...input, provider: 'commas' }, { env, mint: unknown }), { code: 'checkout_provider_locked' });
    assert.equal(attempts, 1); assert.equal((await loadService(pool, id)).state, 'needs_review');
  } finally { await pool.end(); }
});

test('Whop service reversal binds its exact original receipt and never restarts work on a late success replay', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false }); const db = await pool.connect(); registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id } = await fixture(db);
    const transport = fakeWhopTransport();
    await checkoutBlueprintHelp(db, scope, { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' }, { env, fetchImpl: transport.fetchImpl });
    const service = await loadService(db, id), body = paidBody(service);
    const inbox = await signedInbox(db, body); await processWhopBillingInboxRow(inbox, db, deps);
    const before = await counts(db, scope.clientId);
    // A service receipt remains attributable even if its optional transaction
    // consumer has not yet written the general ledger row.
    await db.query('SAVEPOINT missing_transaction_consumer');
    await db.query('DELETE FROM transactions WHERE org_id=$1 AND client_id=$2 AND provider_ref=$3', [scope.orgId, scope.clientId, body.data.id]);
    const ownership = { orgId: scope.orgId, clientId: randomUUID(), payload: { source: 'whop', originalProviderRef: body.data.id, paidServiceRequestId: id } };
    assert.equal(await knownReversalClient(db, ownership), scope.clientId);
    assert.equal(await knownReversalClient(db, { ...ownership, payload: { ...ownership.payload, source: 'commas' } }), null);
    assert.equal(await knownReversalClient(db, { ...ownership, payload: { ...ownership.payload, originalProviderRef: 'pay_foreign' } }), null);
    await db.query('ROLLBACK TO SAVEPOINT missing_transaction_consumer');
    for (const type of ['dispute.created', 'refund.created']) {
      const data = { id: type === 'dispute.created' ? 'dspt_fixture' : 'rf_fixture', account_id: env.WHOP_ACCOUNT_ID,
        payment_id: body.data.id, status: 'succeeded', amount: type === 'dispute.created' ? '1200.00' : { amount: '1200.00', currency: 'usd', decimals: 2 }, currency: 'usd' };
      const reverse = { account_id: env.WHOP_ACCOUNT_ID, type, data };
      const wrong = { ...reverse, data: { ...data, payment_id: 'pay_other', metadata: whopServiceMetadata(service) } };
      await assert.rejects(processWhopBillingInboxRow({ org_id: scope.orgId, account_id: env.WHOP_ACCOUNT_ID, raw_body: JSON.stringify(wrong) }, db, deps));
      const row = await signedInbox(db, reverse);
      await processWhopBillingInboxRow(row, db, deps); await processWhopBillingInboxRow(row, db, deps);
      assert.equal((await loadService(db, id)).state, type === 'dispute.created' ? 'needs_review' : 'refunded');
      assert.equal((await processWhopBillingInboxRow(inbox, db, deps)).ignored, true);
      assert.deepEqual(await counts(db, scope.clientId), before);
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM events WHERE client_id=$1 AND name='payment.received'", [scope.clientId])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-paid-help'", [scope.clientId])).rows[0].n, 1);
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

for (const interrupted of ['checkout_pending', 'needs_review']) test(`signed paid callback recovers ${interrupted} checkout using independently verified GETs only`, { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false }); const db = await pool.connect(); registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id } = await fixture(db);
    const transport = fakeWhopTransport();
    const input = { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' };
    if (interrupted === 'needs_review') {
      await assert.rejects(checkoutBlueprintHelp(db, scope, input, { env, mintWhop: async args => {
        await mintBlueprintServiceWhopCheckout({ ...args, fetchImpl: transport.fetchImpl });
        throw new Error('provider response lost');
      } }), { code: 'checkout_needs_review' });
    } else {
      const originalQuery = db.query.bind(db);
      let fail = true;
      db.query = (sql, params) => {
        if (fail && sql.includes('UPDATE paid_service_requests SET checkout_url')) { fail = false; throw new Error('local result save interrupted'); }
        return originalQuery(sql, params);
      };
      try { await assert.rejects(checkoutBlueprintHelp(db, scope, input, { env, fetchImpl: transport.fetchImpl }), /save interrupted/); }
      finally { db.query = originalQuery; }
    }
    const service = await loadService(db, id);
    assert.equal(service.state, interrupted); assert.equal(service.whop_checkout_configuration_id, null);
    const body = paidBody({ ...service, whop_checkout_configuration_id: 'ch_fixture1', whop_plan_id: 'plan_fixture1' });
    const row = await signedInbox(db, body), before = await counts(db, scope.clientId);
    const callCount = transport.calls.length;
    const forged = structuredClone(body); forged.data.metadata.fh_client_id = randomUUID();
    await assert.rejects(processWhopBillingInboxRow({ ...row, raw_body: JSON.stringify(forged) }, db, { ...deps, fetchImpl: transport.fetchImpl }));
    assert.equal(transport.calls.length, callCount, 'forged metadata cannot even request provider recovery');
    await assert.rejects(processWhopBillingInboxRow(row, db, { ...deps, fetchImpl: async (uri, options) => {
      const out = await transport.fetchImpl(uri, options), data = await out.json();
      if (uri.includes('/variants/')) data.product.id = 'prod_other';
      return new Response(JSON.stringify(data));
    } }), /variant/);
    assert.equal((await loadService(db, id)).whop_checkout_configuration_id, null);
    assert.deepEqual(await counts(db, scope.clientId), before);
    await processWhopBillingInboxRow(row, db, { ...deps, fetchImpl: transport.fetchImpl });
    await processWhopBillingInboxRow(row, db, { ...deps, fetchImpl: transport.fetchImpl });
    const after = await loadService(db, id);
    assert.equal(after.state, 'in_progress'); assert.equal(after.whop_checkout_configuration_id, 'ch_fixture1');
    assert.equal(after.whop_plan_id, 'plan_fixture1'); assert.equal(after.whop_payment_id, body.data.id);
    assert.deepEqual(await counts(db, scope.clientId), { ...before, transactions: before.transactions + 1 });
    assert.equal(transport.requests.length, 1, 'recovery never creates a second provider checkout');
    assert.ok(transport.calls.slice(callCount).every(call => call.method === 'GET'));
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

test('GET reconciliation recovers a dropped help payment and refund through the same durable inbox exactly once', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false }); const db = await pool.connect(); registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id } = await fixture(db), transport = fakeWhopTransport();
    await checkoutBlueprintHelp(db, scope, { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' }, { env, fetchImpl: transport.fetchImpl });
    const service = await loadService(db, id), body = paidBody(service), before = await counts(db, scope.clientId);
    let refunded = false;
    const fetchImpl = async (uri, options) => {
      assert.equal(options.method, 'GET');
      const data = uri.includes('/payments?') ? [body.data] : uri.includes('/refunds?') && refunded
        ? [{ id: 'rf_dropped', account_id: env.WHOP_ACCOUNT_ID, payment_id: body.data.id, status: 'succeeded', amount: { amount: '1200.00', currency: 'usd', decimals: 2 } }] : [];
      return new Response(JSON.stringify({ data, page_info: { has_next_page: false } }));
    };
    assert.equal((await reconcileWhopBilling(db, { env, fetchImpl })).recovered, 1);
    assert.equal((await reconcileWhopBilling(db, { env, fetchImpl })).recovered, 0);
    const paymentRow = (await db.query("SELECT * FROM whop_billing_inbox WHERE payment_id=$1 AND source='reconcile' AND event_type='payment.succeeded'", [body.data.id])).rows[0];
    assert.ok(paymentRow);
    await processWhopBillingInboxRow(paymentRow, db, deps); await processWhopBillingInboxRow(paymentRow, db, deps);
    assert.equal((await loadService(db, id)).state, 'in_progress');
    assert.deepEqual(await counts(db, scope.clientId), { ...before, transactions: before.transactions + 1 });
    refunded = true;
    assert.equal((await reconcileWhopBilling(db, { env, fetchImpl })).recovered, 1);
    const refundRow = (await db.query("SELECT * FROM whop_billing_inbox WHERE payment_id=$1 AND source='reconcile' AND event_type='refund.updated'", [body.data.id])).rows[0];
    await processWhopBillingInboxRow(refundRow, db, deps); await processWhopBillingInboxRow(refundRow, db, deps);
    assert.equal((await loadService(db, id)).state, 'refunded');
    assert.equal((await processWhopBillingInboxRow(paymentRow, db, deps)).ignored, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-paid-help'", [scope.clientId])).rows[0].n, 1);
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

test('normal Commas inbox rejects a Whop-reserved service before any canonical receipt or money write', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false }); const db = await pool.connect(); registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id } = await fixture(db), transport = fakeWhopTransport();
    await checkoutBlueprintHelp(db, scope, { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' }, { env, fetchImpl: transport.fetchImpl });
    const before = await counts(db, scope.clientId);
    const body = { id: 'evt_commas_wrongrail', type: 'payment.succeeded', data: { payment_id: 'commas_wrongrail', amount: 1200,
      product: { title: 'Consulting Services Package' }, metadata: { ref: id, client_id: scope.clientId } } };
    await assert.rejects(processCommasInboxRow({ org_id: scope.orgId, dedupe_key: 'commas_wrongrail', raw_body: JSON.stringify(body) }, db), /does not match/);
    assert.deepEqual(await counts(db, scope.clientId), before);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM events WHERE client_id=$1 AND name='payment.received'", [scope.clientId])).rows[0].n, 0);
    assert.equal((await loadService(db, id)).payment_status, 'awaiting_payment');
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

test('a valid settled Whop payment after local checkout expiry records one receipt and review task without activating help', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, ssl: false }); const db = await pool.connect(); registerMoney();
  try {
    await db.query('BEGIN');
    const { scope, id, roundId } = await fixture(db), transport = fakeWhopTransport();
    await checkoutBlueprintHelp(db, scope, { requestId: id, authorization: true, expectedPriceCents: 120000, provider: 'whop' }, { env, fetchImpl: transport.fetchImpl });
    await db.query("UPDATE paid_service_requests SET checkout_expires_at=now()-interval '1 day' WHERE id=$1", [id]);
    await expireStaleCheckouts(db, { now: new Date() });
    const service = await loadService(db, id); assert.equal(service.payment_status, 'cancelled');
    const before = await counts(db, scope.clientId), body = paidBody(service), row = await signedInbox(db, body);
    await processWhopBillingInboxRow(row, db, deps); await processWhopBillingInboxRow(row, db, deps);
    const after = await loadService(db, id);
    assert.equal(after.state, 'needs_review'); assert.equal(after.payment_status, 'cancelled'); assert.equal(after.payment_ref, body.data.id);
    const payment = (await db.query('SELECT amount_paid_cents,payment_ref,state_reason FROM paid_service_requests WHERE id=$1', [id])).rows[0];
    assert.equal(Number(payment.amount_paid_cents), 120000); assert.equal(payment.payment_ref, body.data.id);
    assert.equal(payment.state_reason, 'late_service_payment_needs_review');
    assert.deepEqual(await counts(db, scope.clientId), { ...before, transactions: before.transactions + 1 });
    const engagement = (await db.query('SELECT execution_owner,funding_round_id FROM blueprint_fulfillment_engagements WHERE id=$1', [scope.engagement.id])).rows[0];
    assert.deepEqual(engagement, { execution_owner: 'client', funding_round_id: roundId });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-paid-help'", [scope.clientId])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-service-payment'", [scope.clientId])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM events WHERE client_id=$1 AND name='payment.received'", [scope.clientId])).rows[0].n, 1);
  } finally { await db.query('ROLLBACK'); db.release(); await pool.end(); clearHandlers(); }
});

test('a reserved v1 service recovers by GET, settles once and refunds the original payment after the metadata upgrade', {skip}, async () => {
  const pool=new pg.Pool({connectionString:url,ssl:false,max:1});
  const db=await pool.connect();registerMoney();
  try {
    await db.query('BEGIN');
    const {scope,id}=await fixture(db);
    await db.query(`UPDATE blueprint_client_services SET state='checkout_pending',checkout_provider='whop',checkout_claimed_at=now(),
      accepted_price_cents=120000,checkout_currency='USD',authorized_at=now(),authorized_account_id=$2,
      whop_account_id=$3,whop_product_id=$4 WHERE id=$1`,[id,scope.accountId,env.WHOP_ACCOUNT_ID,env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID]);
    const old=await loadService(db,id);
    assert.equal(old.whop_metadata_version,1);
    const recovered={...old,whop_checkout_configuration_id:'ch_legacy',whop_plan_id:'plan_legacy'};
    const body=paidBody(recovered);
    assert.equal(body.data.metadata.fh_schema,'1');
    assert.equal(body.data.metadata.product_code,'blueprint-help-funding_round');
    const row=await signedInbox(db,body);
    const reads=[];
    const fetchImpl=async (uri,init)=>{
      assert.equal(init.method,'GET','existing checkout must never be reminted');
      reads.push(uri);
      if(uri.endsWith('/checkout_configurations/ch_legacy')) return Response.json({id:'ch_legacy',account_id:env.WHOP_ACCOUNT_ID,
        mode:'payment',metadata:body.data.metadata,plan:{id:'plan_legacy',initial_price:1200,currency:'usd',plan_type:'one_time'},
        purchase_url:'https://whop.com/checkout/ch_legacy/'});
      assert.ok(uri.endsWith('/variants/plan_legacy'));
      return Response.json({id:'plan_legacy',account:{id:env.WHOP_ACCOUNT_ID},product:{id:env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID},
        currency:'usd',plan_type:'one_time',initial_price:1200,title:'Consulting Services Package'});
    };
    const forged=structuredClone(body);forged.data.metadata=whopServiceMetadata({...recovered,whop_metadata_version:2});
    await assert.rejects(processWhopBillingInboxRow({...row,raw_body:JSON.stringify(forged)},db,{...deps,fetchImpl}),/metadata mismatch/);
    assert.equal(reads.length,0);
    await processWhopBillingInboxRow(row,db,{...deps,fetchImpl});
    await processWhopBillingInboxRow(row,db,{...deps,fetchImpl});
    const settled=await loadService(db,id);
    assert.equal(settled.state,'in_progress');assert.equal(settled.whop_payment_id,body.data.id);
    assert.equal(reads.length,2);
    const refund={account_id:env.WHOP_ACCOUNT_ID,type:'refund.created',data:{id:'rf_legacy',account_id:env.WHOP_ACCOUNT_ID,
      payment_id:body.data.id,status:'succeeded',amount:{amount:'1200.00',currency:'usd',decimals:2},currency:'usd'}};
    const reversal=await signedInbox(db,refund);
    await processWhopBillingInboxRow(reversal,db,deps);await processWhopBillingInboxRow(reversal,db,deps);
    assert.equal((await loadService(db,id)).state,'refunded');
    assert.equal((await processWhopBillingInboxRow(row,db,deps)).ignored,true);
  } finally {await db.query('ROLLBACK');db.release();await pool.end();clearHandlers();}
});
