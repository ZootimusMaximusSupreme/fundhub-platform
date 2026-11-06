// The provider transport is synthetic. PostgreSQL cases use real order rows in a
// rollback-only transaction and refuse every non-local database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { findWhopBillingLink, processWhopBillingInboxRow, validateWhopBlueprintPayment } from '../adapters/whop-billing.mjs';
import { emit } from '../events/bus.mjs';
import { createPaymentLink } from '../payment-links/index.mjs';
import { clearHandlers } from '../events/registry.mjs';
import { register as registerMoney } from '../handlers/money-chain.mjs';
import { register as registerLifecycle } from '../handlers/client-lifecycle.mjs';
import { createWhopBlueprintPaymentLink, verifyWhopCheckout, whopBlueprintMetadata, whopConfig } from './whop-blueprint.mjs';

const PLAN = 'plan_fixedprice';
const PRICE = 3000000;
const TITLE = 'Consulting Services Package';
const ENV = { WHOP_ENV: 'sandbox', WHOP_ACCOUNT_ID: 'biz_fixture', WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_fixture',
  WHOP_API_KEY: 'fixture-only', WHOP_WEBHOOK_SECRET: 'fixture-only', ADAPTERS_DRY_RUN: '0',
  WHOP_BLUEPRINT_PLAN_IDS: JSON.stringify({ [PRICE]: PLAN }) };
const cfg = whopConfig(ENV);

function variant(over = {}) {
  return { id: PLAN, account: { id: cfg.accountId }, product: { id: cfg.productId, title: TITLE }, title: null,
    description: TITLE, visibility: 'hidden', adaptive_pricing_enabled: false, plan_type: 'one_time',
    release_method: 'buy_now', currency: 'usd', initial_price: PRICE / 100, renewal_price: 0,
    initial_price_due: { amount: '30000.00', currency: 'usd', decimals: 2 }, billing_period: null,
    allow_multiple_quantity: false, unlimited_stock: true, trial_period_days: null,
    split_pay_required_payments: null, collect_tax: true, tax_type: 'inclusive', expiration_days: null, ...over };
}

function checkout(metadata, id = 'ch_fixture') {
  return { id, account_id: cfg.accountId, mode: 'payment', metadata,
    purchase_url: `https://sandbox.whop.com/checkout/${id}/`,
    plan: { id: PLAN, plan_type: 'one_time', currency: 'usd', initial_price: PRICE / 100 },
    payment_method_configuration: { enabled: ['claritypay'], disabled: [] },
    effective_payment_method_configuration: { enabled: ['claritypay'], disabled: [] } };
}

test('a pinned order rejects another equally priced variant before fetching it', async () => {
  const link = { id: randomUUID(), org_id: randomUUID(), client_id: randomUUID(), whop_plan_id: PLAN,
    whop_metadata_version: 2, amount_cents: PRICE };
  const out = checkout(whopBlueprintMetadata(link));
  out.plan.id = 'plan_other';
  await assert.rejects(verifyWhopCheckout(out, cfg, link, { env: ENV, fetchImpl: () => assert.fail('wrong variant GET') }),
    { code: 'whop_checkout_failed' });
});

test('GET recovery verifies the original plan even when the current plan map changed', async () => {
  const link = { id: randomUUID(), org_id: randomUUID(), client_id: randomUUID(), whop_plan_id: PLAN,
    whop_metadata_version: 2, whop_existing_plan: true, amount_cents: PRICE, whop_checkout_configuration_id: null };
  const out = checkout(whopBlueprintMetadata(link));
  const env = { ...ENV, WHOP_BLUEPRINT_PLAN_IDS: JSON.stringify({ [PRICE]: 'plan_new' }) };
  const read = response => async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(url, 'https://sandbox-api.whop.com/api/v1/variants/' + PLAN);
    return Response.json(response);
  };
  assert.equal(await verifyWhopCheckout(out, cfg, link, { env, fetchImpl: read(variant()) }), out);
  await assert.rejects(verifyWhopCheckout(out, cfg, link, { env, fetchImpl: read(variant({ description: 'Other price' })) }));
  const saved = { ...link, whop_checkout_configuration_id: out.id, checkout_url: out.purchase_url };
  assert.equal(await verifyWhopCheckout(out, cfg, saved, { env, fetchImpl: read(variant()) }), out);
  await assert.rejects(verifyWhopCheckout(out, cfg, saved, { env, fetchImpl: read(variant({ tax_type: 'exclusive' })) }));
  const old = { ...saved, whop_existing_plan: false, whop_metadata_version: 1, link_ref: 'legacy-reference' };
  const legacy = checkout(whopBlueprintMetadata(old));
  await assert.rejects(verifyWhopCheckout(legacy, cfg, old, { env, fetchImpl: read(variant()) }));
  out.effective_payment_method_configuration = { enabled: [], disabled: ['claritypay'] };
  await assert.rejects(verifyWhopCheckout(out, cfg, link, { env, requiredPaymentMethod: 'claritypay',
    fetchImpl: () => assert.fail('ineffective ClarityPay') }), { code: 'whop_financing_unverified' });
});

const connectionString = process.env.WHOP_TEST_DATABASE_URL || process.env.DATABASE_URL;
function localScratch() {
  try {
    const u = new URL(connectionString);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && /(?:test|scratch|_ci)(?:\b|_)/i.test(u.pathname);
  } catch { return false; }
}
const dbOptions = { skip: localScratch() ? false : 'requires local scratch PostgreSQL' };

async function withOrder(run) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = await pool.connect();
  await db.query('BEGIN');
  try {
    const orgId = (await db.query('SELECT id FROM orgs WHERE is_default')).rows[0].id;
    const clientId = (await db.query("INSERT INTO clients (org_id,first_name,email,is_demo) VALUES ($1,'Fixture',$2,true) RETURNING id",
      [orgId, randomUUID() + '@example.test'])).rows[0].id;
    const staffId = (await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Fixture closer','closer','active') RETURNING id",
      [orgId])).rows[0].id;
    const body = 'Synthetic agreed full-package price: $30,000';
    await db.query(`INSERT INTO contracts (org_id, client_id, template_id, template_key, title, kind, created_by,
      status, sent_by, sent_at, rendered_body, body_sha, merge_values)
      SELECT $1,$2,id,template_key,name,kind,$3,'sent',$3,now(),$4,$5,$6 FROM contract_templates
      WHERE org_id=$1 AND template_key='BLUEPRINT-SELF-FUNDING-AGREEMENT'`,
    [orgId, clientId, staffId, body, 'sha256:' + createHash('sha256').update(body).digest('hex'),
      { package_fee: '$30,000', _blueprint_amount_cents: PRICE }]);
    const order = options => createWhopBlueprintPaymentLink(db, { orgId, clientId, productCode: 'blueprint-self-funding',
      amountCents: PRICE, env: ENV, createdByStaffId: staffId, createdByRole: 'closer', ...options });
    await run(db, order, { orgId, clientId, createdByStaffId: staffId, createdByRole: 'closer' });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
}

test('payment-links entry resolves the full package from its product ID alone or its owned sale alone', dbOptions, () =>
  withOrder(async (db, _order, owner) => {
    const product = (await db.query("SELECT id FROM products WHERE org_id=$1 AND code='blueprint-self-funding'", [owner.orgId])).rows[0];
    const sale = (await db.query(`INSERT INTO sales (org_id,client_id,product_id,agreed_price)
      VALUES ($1,$2,$3,$4) RETURNING id`, [owner.orgId, owner.clientId, product.id, PRICE / 100])).rows[0];
    let posts = 0;
    const fetchImpl = async (url, init) => {
      if (init.method === 'GET') {
        assert.ok(url.endsWith('/variants/' + PLAN));
        return Response.json(variant());
      }
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body);
      assert.equal(body.plan_id, PLAN);
      assert.equal(body.metadata.fh_amount_cents, String(PRICE));
      return Response.json(checkout(body.metadata, 'ch_resolved' + ++posts));
    };
    for (const selection of [{ productId: product.id }, { saleId: sale.id }]) {
      const link = await createPaymentLink(db, { ...owner, ...selection, productCode: null, purpose: 'custom',
        provider: 'whop', amountCents: PRICE, env: ENV, fetchImpl });
      assert.equal(link.product_id, product.id);
      assert.equal(link.whop_existing_plan, true);
      assert.equal(link.sale_id, sale.id);
    }
    assert.equal(posts, 2);
  }));

test('payment-links entry rejects foreign, mismatched, or non-Blueprint products and preserves the prep default', dbOptions, () =>
  withOrder(async (db, _order, owner) => {
    const products = await db.query("SELECT id,code FROM products WHERE org_id=$1", [owner.orgId]);
    const full = products.rows.find(p => p.code === 'blueprint-self-funding');
    const prep = products.rows.find(p => p.code === 'consulting-package');
    const other = products.rows.find(p => p.id !== full.id && p.id !== prep.id);
    const foreignOrg = (await db.query("INSERT INTO orgs(slug,name) VALUES ($1,'Fixture org') RETURNING id",
      ['fixture-' + randomUUID()])).rows[0];
    const foreign = (await db.query(`INSERT INTO products (org_id,code,name,category,default_price,min_price,max_price,price_is_variable)
      SELECT $1,code,name,category,default_price,min_price,max_price,price_is_variable FROM products WHERE id=$2 RETURNING id`,
    [foreignOrg.id, full.id])).rows[0];
    let calls = 0;
    const create = options => createPaymentLink(db, { ...owner, purpose: 'custom', provider: 'whop',
      amountCents: PRICE, env: ENV, fetchImpl: () => { calls++; throw new Error('unexpected provider call'); }, ...options });
    await assert.rejects(create({ productId: prep.id, productCode: full.code }), /do not match|does not match/);
    await assert.rejects(create({ productId: foreign.id, productCode: full.code }), /do not match|does not match/);
    await assert.rejects(create({ productId: other.id }), /Blueprint package/);
    await assert.rejects(create({ productId: prep.id }), /outside the selected package range/);
    await assert.rejects(create({}), /outside the selected package range/);
    await assert.rejects(create({ amountCents: 750000 }), { code: 'blueprint_agreement_required' });
    assert.equal(calls, 0);
    assert.equal((await db.query('SELECT 1 FROM payment_links WHERE org_id=$1 AND client_id=$2',
      [owner.orgId, owner.clientId])).rowCount, 0);
  }));

test('separate package orders can share a verified fixed price and retain distinct checkout identity', dbOptions, () =>
  withOrder(async (db, order) => {
    const posts = [], reads = [];
    const fetchImpl = async (url, init) => {
      if (init.method === 'GET') {
        reads.push(url);
        if (url.endsWith('/variants/' + PLAN)) return Response.json(variant());
        const existing = posts.find(c => url.endsWith('/checkout_configurations/' + c.id));
        assert.ok(existing, 'unexpected provider read');
        return Response.json(existing);
      }
      assert.equal(init.method, 'POST');
      const payload = JSON.parse(init.body);
      assert.equal(payload.plan_id, PLAN);
      assert.equal('plan' in payload, false);
      assert.deepEqual(payload.payment_method_configuration, { enabled: ['claritypay'], disabled: [], include_platform_defaults: true });
      const reserved = (await db.query('SELECT * FROM payment_links WHERE id=$1', [payload.metadata.fh_payment_link_id])).rows[0];
      assert.equal(reserved.whop_plan_id, PLAN);
      assert.equal(reserved.whop_existing_plan, true);
      assert.equal(reserved.whop_checkout_configuration_id, null);
      assert.deepEqual(payload.metadata, whopBlueprintMetadata(reserved));
      assert.equal(init.headers['Idempotency-Key'], 'fh-order:' + reserved.id);
      const result = checkout(payload.metadata, 'ch_fixture' + (posts.length + 1));
      posts.push(result);
      return Response.json(result);
    };
    const first = await order({ fetchImpl, requiredPaymentMethod: 'claritypay' });
    const second = await order({ fetchImpl, requiredPaymentMethod: 'claritypay' });
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.whop_checkout_configuration_id, second.whop_checkout_configuration_id);
    assert.equal(first.whop_plan_id, second.whop_plan_id);
    assert.equal(reads.length, 4, 'each order verified the price before and after POST');
    const repeated = await order({ reservationId: first.id, fetchImpl, requiredPaymentMethod: 'claritypay',
      env: { ...ENV, WHOP_BLUEPRINT_PLAN_IDS: '{invalid-current-map}' } });
    assert.equal(repeated.checkout_url, first.checkout_url);
    assert.equal(posts.length, 2);

    const payment = { id: 'pay_' + randomUUID().replaceAll('-', ''), account_id: cfg.accountId,
      checkout_configuration_id: first.whop_checkout_configuration_id, plan_id: PLAN, product_id: cfg.productId,
      currency: 'usd', status: 'paid', total: { amount: '30000.00', currency: 'usd', decimals: 2 },
      metadata: whopBlueprintMetadata(first), line_items: [{ quantity: 1, plan_id: PLAN, product_id: cfg.productId }] };
    assert.throws(() => validateWhopBlueprintPayment(payment, { ...second, product_code: 'blueprint-self-funding' }, cfg),
      /payment identity mismatch/);
    const event = { type: 'payment.succeeded', account_id: cfg.accountId, data: payment };
    const inbox = { org_id: first.org_id, account_id: cfg.accountId, raw_body: JSON.stringify(event) };
    const deps = { env: ENV, emit: (tx, name, payload, opts) => emit(tx, name, payload, { ...opts, skipInngest: true }) };
    clearHandlers();
    try {
      registerLifecycle(); registerMoney();
      await processWhopBillingInboxRow(inbox, db, deps);
      await processWhopBillingInboxRow(inbox, db, deps);
      assert.equal((await db.query('SELECT id FROM transactions WHERE org_id=$1 AND provider_ref=$2',
        [first.org_id, payment.id])).rowCount, 1);
      assert.equal((await db.query('SELECT status FROM payment_links WHERE id=$1', [second.id])).rows[0].status, 'created');
      const reversal = { type: 'refund.updated', data: { payment_id: payment.id } };
      assert.equal((await findWhopBillingLink(db, reversal)).id, first.id);
    } finally { clearHandlers(); }

    await db.query('SAVEPOINT pin_test');
    await assert.rejects(db.query('UPDATE payment_links SET whop_plan_id=$2 WHERE id=$1', [first.id,'plan_other']), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT pin_test');
    await assert.rejects(db.query('UPDATE payment_links SET whop_existing_plan=false WHERE id=$1', [first.id]), { code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT pin_test');
  }));

test('a saved existing-price checkout always rechecks fixed terms for both allowed variant titles', dbOptions, () =>
  withOrder(async (db, order) => {
    let price = variant();
    let savedCheckout;
    let posts = 0;
    const fetchImpl = async (url, init) => {
      if (init.method === 'POST') {
        posts++;
        savedCheckout = checkout(JSON.parse(init.body).metadata);
        return Response.json(savedCheckout);
      }
      assert.equal(init.method, 'GET');
      if (url.endsWith('/variants/' + PLAN)) return Response.json(price);
      assert.ok(savedCheckout && url.endsWith('/checkout_configurations/' + savedCheckout.id));
      return Response.json(savedCheckout);
    };
    const first = await order({ fetchImpl });
    assert.equal((await db.query('SELECT whop_existing_plan FROM payment_links WHERE id=$1', [first.id])).rows[0].whop_existing_plan, true);
    const reopen = () => order({ resumeLinkId: first.id, fetchImpl, env: { ...ENV, WHOP_BLUEPRINT_PLAN_IDS: '{}' } });
    for (const title of [null, TITLE]) {
      price = variant({ title });
      assert.equal((await reopen()).checkout_url, first.checkout_url);
      for (const override of [{ description: 'Changed terms' }, { adaptive_pricing_enabled: true },
        { tax_type: 'exclusive' }, { initial_price_due: { amount: '30001.00', currency: 'usd', decimals: 2 } }]) {
        price = variant({ title, ...override });
        await assert.rejects(reopen(), { code: 'whop_unsafe_checkout' });
      }
    }
    assert.equal(posts, 1);
  }));

test('ineligible price, merchant, copy, currency or terms create no order and no checkout', dbOptions, () =>
  withOrder(async (db, order) => {
    for (const change of [{ initial_price: 0 }, { account: { id: 'biz_other' } }, { product: { id: 'prod_other' } },
      { description: null }, { title: 'Other title' }, { product: { id: cfg.productId, title: 'Other product' } },
      { currency: 'eur' }, { tax_type: 'exclusive' }, { initial_price_due: { amount: '0.00', currency: 'usd', decimals: 2 } },
      { adaptive_pricing_enabled: true },
      { plan_type: 'renewal' }, { release_method: 'waitlist' }, { allow_multiple_quantity: true }]) {
      const id = randomUUID();
      const calls = [];
      await assert.rejects(order({ reservationId: id, fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method });
        return Response.json(variant(change));
      } }), { code: 'whop_unsafe_checkout' });
      assert.deepEqual(calls, [{ method: 'GET', url: 'https://sandbox-api.whop.com/api/v1/variants/' + PLAN }]);
      assert.equal((await db.query('SELECT 1 FROM payment_links WHERE id=$1', [id])).rowCount, 0);
    }
  }));

test('concurrent retry and lost-response recovery cannot issue a second checkout or repin its price', dbOptions, () =>
  withOrder(async (db, order) => {
    const id = randomUUID();
    let started, release, postCount = 0;
    const firstPost = new Promise(resolve => { started = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const first = order({ reservationId: id, fetchImpl: async (url, init) => {
      if (init.method === 'GET') return Response.json(variant());
      postCount++;
      started();
      await hold;
      return Response.json({ error: 'fixture response loss' }, { status: 503 });
    } });
    const recoveryReads = [];
    const list = results => async (url, init) => {
      recoveryReads.push({ method: init.method, path: new URL(url).pathname });
      assert.equal(init.method, 'GET');
      if (url.includes('/variants/')) return Response.json(variant());
      assert.equal(new URL(url).pathname, '/api/v1/checkout_configurations');
      return Response.json({ data: results, page_info: { has_next_page: false } });
    };
    try {
      await Promise.race([firstPost, first]);
      await assert.rejects(order({ reservationId: id, fetchImpl: list([]) }), /read-only reconciliation/);
      await assert.rejects(order({ reservationId: id, fetchImpl: () => assert.fail('foreign actor'), createdByStaffId: null }), /does not match/);
    } finally { release(); }
    await assert.rejects(first, { code: 'whop_checkout_failed' });
    await assert.rejects(order({ resumeLinkId: id, reservationId: id, fetchImpl: list([]),
      env: { ...ENV, WHOP_BLUEPRINT_PLAN_IDS: '{}' } }), /read-only reconciliation/);
    assert.equal(postCount, 1);
    const row = (await db.query('SELECT * FROM payment_links WHERE id=$1', [id])).rows[0];
    assert.equal(row.whop_plan_id, PLAN);
    assert.equal(row.whop_existing_plan, true);
    assert.equal(row.whop_checkout_configuration_id, null);
    assert.equal(row.checkout_url, '');
    const found = checkout(whopBlueprintMetadata(row));
    await assert.rejects(order({ resumeLinkId: id, fetchImpl: list([found, { ...found, id: 'ch_duplicate' }]) }),
      /read-only reconciliation/);
    const wrongPlan = { ...found, plan: { ...found.plan, id: 'plan_substitute' } };
    await assert.rejects(order({ resumeLinkId: id, fetchImpl: list([wrongPlan]) }), { code: 'whop_checkout_failed' });
    const recovered = await order({ resumeLinkId: id, fetchImpl: list([found]), requiredPaymentMethod: 'claritypay',
      env: { ...ENV, WHOP_BLUEPRINT_PLAN_IDS: '{}' } });
    assert.equal(recovered.id, id);
    assert.equal(recovered.checkout_url, found.purchase_url);
    assert.equal(recovered.whop_plan_id, PLAN);
    assert.ok(recoveryReads.every(read => read.method === 'GET'));
    assert.equal(postCount, 1);
  }));
