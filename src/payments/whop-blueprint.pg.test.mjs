// Real Postgres proof. Refuses non-local databases even when DATABASE_URL exists.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { processWhopBillingInboxRow } from '../adapters/whop-billing.mjs';
import { enqueueWhopBilling, claimWhopBilling } from './whop-billing-inbox.mjs';
import { whopBlueprintMetadata } from './whop-blueprint.mjs';
import { emit } from '../events/bus.mjs';
import { clearHandlers } from '../events/registry.mjs';
import { register as registerLifecycle } from '../handlers/client-lifecycle.mjs';
import { register as registerMoney } from '../handlers/money-chain.mjs';
import { WHOP_ACCESS_SQL } from '../pulse/coverage/gap-whop-billing.mjs';

const connectionString = process.env.WHOP_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no scratch database configured */ }
const options = { skip: safe ? false : 'no local test/scratch DATABASE_URL; live databases are refused' };
const ENV = { WHOP_API_KEY: 'pg-test-only', WHOP_ACCOUNT_ID: 'biz_pgtest',
  WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_pgtest', WHOP_WEBHOOK_SECRET: 'ws_pgtest' };
const pool = safe ? new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 }) : null;
after(async () => { clearHandlers(); if (pool) await pool.end(); });

test('Whop receipt reaches real canonical transaction, sale payment and entitlement exactly once', options, async () => {
  const db = await pool.connect();
  await db.query('BEGIN');
  try {
    clearHandlers(); registerLifecycle(); registerMoney();
    const org = (await db.query('SELECT id FROM orgs ORDER BY id LIMIT 1')).rows[0]?.id;
    assert.ok(org, 'scratch migrations must seed an org');
    const product = (await db.query(`SELECT id FROM products WHERE org_id = $1 AND code = 'consulting-package'`, [org])).rows[0];
    assert.ok(product, 'real Blueprint product mapping must be migrated');
    const client = (await db.query(`INSERT INTO clients (org_id, email, first_name, last_name)
      VALUES ($1,$2,'Whop','Scratch') RETURNING id`, [org, `e2e+aff-whop-${randomUUID()}@example.com`])).rows[0].id;
    const id = randomUUID();
    const paymentId = `pay_${randomUUID().replaceAll('-', '')}`;
    const link = (await db.query(`INSERT INTO payment_links (id, org_id, client_id, purpose,
      description, amount_cents, currency, link_ref, checkout_url, provider, product_id,
      whop_checkout_configuration_id, whop_plan_id)
      VALUES ($1,$2,$3,'custom','Consulting Services Package',750000,'USD',$4,
        'https://whop.com/checkout/ch_pgtest/','whop',$5,'ch_pgtest','plan_pgtest') RETURNING *`,
    [id, org, client, `whop-pg-${randomUUID()}`, product.id])).rows[0];
    const body = { account_id: 'biz_pgtest', type: 'payment.succeeded', data: {
      id: paymentId, account_id: 'biz_pgtest', checkout_configuration_id: 'ch_pgtest',
      plan_id: 'plan_pgtest', product_id: 'prod_pgtest', status: 'paid', currency: 'usd',
      total: { amount: '7500.00', currency: 'usd', decimals: 2 }, metadata: whopBlueprintMetadata(link),
      line_items: [{ quantity: 1, plan_id: 'plan_pgtest', product_id: 'prod_pgtest' }], paid_at: new Date().toISOString()
    } };
    const row = { org_id: org, account_id: 'biz_pgtest', raw_body: JSON.stringify(body) };
    const deps = { env: ENV, emit: (db, name, payload, opts) => emit(db, name, payload, { ...opts, skipInngest: true }) };
    await processWhopBillingInboxRow(row, db, deps);
    await processWhopBillingInboxRow(row, db, deps);
    const transaction = (await db.query(`SELECT id, amount_paid, provider FROM transactions
      WHERE org_id = $1 AND provider_ref = $2`, [org, paymentId])).rows;
    assert.equal(transaction.length, 1);
    assert.equal(Number(transaction[0].amount_paid), 7500);
    assert.equal(transaction[0].provider, 'whop');
    assert.equal(Number((await db.query(`SELECT count(*) AS n FROM sale_payments
      WHERE org_id = $1 AND transaction_id = $2`, [org, transaction[0].id])).rows[0].n), 1);
    const expected = (await db.query(`SELECT entitlement_code FROM product_entitlements
      WHERE org_id = $1 AND product_code = 'consulting-package'`, [org])).rows;
    assert.ok(expected.length > 0);
    for (const { entitlement_code } of expected) {
      assert.equal(Number((await db.query(`SELECT count(*) AS n FROM entitlements
        WHERE org_id = $1 AND client_id = $2 AND source_transaction_id = $3 AND entitlement_code = $4`,
      [org, client, transaction[0].id, entitlement_code])).rows[0].n), 1);
    }
    const settled = (await db.query(`SELECT * FROM payment_links WHERE id = $1`, [id])).rows[0];
    assert.equal(settled.status, 'paid');
    assert.equal(settled.whop_payment_id, paymentId);
    assert.equal(settled.commas_session_id, null);
    assert.equal((await db.query(WHOP_ACCESS_SQL, [org, new Date(Date.now() + 600000)])).rows[0].n, 0);
  } finally { await db.query('ROLLBACK'); db.release(); clearHandlers(); }
});

test('real Whop inbox unique constraint absorbs redelivery and claims never repeat the active row', options, async () => {
  const db = await pool.connect();
  await db.query('BEGIN');
  try {
    const org = (await db.query('SELECT id FROM orgs ORDER BY id LIMIT 1')).rows[0].id;
    // Shadow only our queue inside this rollback, leaving parallel CI files alone.
    await db.query('CREATE TEMP TABLE whop_billing_inbox (LIKE public.whop_billing_inbox INCLUDING ALL) ON COMMIT DROP');
    const input = { orgId: org, accountId: 'biz_pgtest', webhookId: 'msg_pgtest',
      eventType: 'payment.succeeded', paymentId: 'pay_pgtest', rawBody: '{}' };
    assert.equal((await enqueueWhopBilling(db, input)).queued, true);
    assert.equal((await enqueueWhopBilling(db, input)).queued, false);
    const first = await claimWhopBilling(db, { limit: 1 });
    assert.equal(first.length, 1);
    assert.equal(first[0].attempts, 1);
    assert.equal((await claimWhopBilling(db, { limit: 1 })).length, 0);
    await db.query(`UPDATE whop_billing_inbox SET claimed_at = now() - interval '16 minutes'`);
    const recovered = await claimWhopBilling(db, { limit: 1 });
    assert.equal(recovered[0].id, first[0].id);
    assert.equal(recovered[0].attempts, 2);
    await db.query(`UPDATE whop_billing_inbox SET status = 'failed', attempts = 10`);
    assert.equal((await claimWhopBilling(db, { limit: 1 })).length, 0);
  } finally { await db.query('ROLLBACK'); db.release(); }
});
