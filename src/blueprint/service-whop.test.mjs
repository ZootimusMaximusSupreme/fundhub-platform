import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { whopConfig } from '../payments/whop-blueprint.mjs';
import { blueprintServiceCheckoutProviders, whopServiceMetadata, buildWhopServiceCheckout,
  mintBlueprintServiceWhopCheckout, validateWhopServicePayment, verifyWhopServiceCheckout } from './service-whop.mjs';

const env = { WHOP_API_KEY: 'synthetic', WHOP_ACCOUNT_ID: 'biz_fixture', WHOP_CONSULTING_PACKAGE_PRODUCT_ID: 'prod_fixture',
  WHOP_WEBHOOK_SECRET: 'synthetic', ADAPTERS_DRY_RUN: '0' };
const cfg = whopConfig(env);
const service = { whop_metadata_version: 2, id: randomUUID(), org_id: randomUUID(), client_id: randomUUID(), engagement_id: randomUUID(),
  service_kind: 'inquiry_removal', scope_type: 'inquiry_case', target_id: randomUUID(), accepted_price_cents: '9700',
  price_total_cents: '9700', authorized_at: new Date(), authorized_account_id: randomUUID(), checkout_provider: 'whop',
  checkout_currency: 'USD', whop_account_id: cfg.accountId, whop_product_id: cfg.productId,
  whop_checkout_configuration_id: 'ch_fixture', whop_plan_id: 'plan_fixture' };
const payment = () => ({ id: 'pay_fixture', account_id: cfg.accountId, product_id: cfg.productId,
  checkout_configuration_id: 'ch_fixture', plan_id: 'plan_fixture', currency: 'usd', status: 'paid',
  metadata: whopServiceMetadata(service), total: { amount: '97.00', currency: 'usd', decimals: 2 },
  line_items: [{ plan_id: 'plan_fixture', product_id: cfg.productId, quantity: 1 }] });

test('service financing availability depends on the existing complete Whop configuration', () => {
  assert.deepEqual(blueprintServiceCheckoutProviders({}), [{ id: 'commas', label: 'Pay in full' }]);
  assert.equal(blueprintServiceCheckoutProviders(env)[1].id, 'whop');
});

test('a quoted help amount uses the configured generic product without a package entitlement SKU', () => {
  const body = buildWhopServiceCheckout(service, cfg);
  assert.equal(body.plan.initial_price, 97);
  assert.equal(body.plan.product_id, cfg.productId);
  assert.equal(body.plan.title, 'Consulting Services Package');
  assert.deepEqual(Object.keys(body.metadata).sort(), ['fh_schema','fh_service_request_id','fh_org_id','fh_client_id','fh_engagement_id','fh_target_id','fh_amount_cents','fh_currency'].sort());
  assert.equal(body.metadata.fh_target_id, service.target_id);
  assert.equal(body.metadata.fh_service_request_id, service.id);
  assert.equal(body.metadata.fh_payment_link_id, undefined);
  assert.throws(() => buildWhopServiceCheckout({ ...service, accepted_price_cents: 9701 }, cfg));
});

test('Whop service creation verifies the exact checkout and retrieved variant before returning its URL', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    if (url.endsWith('/checkout_configurations')) {
      assert.equal(options.headers['Idempotency-Key'], `fh-request:${service.id}`);
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'ch_fixture', account_id: cfg.accountId, mode: 'payment', metadata: body.metadata,
        plan: { id: 'plan_fixture', initial_price: 97, currency: 'usd', plan_type: 'one_time' }, purchase_url: 'https://whop.com/checkout/ch_fixture/' }));
    }
    assert.ok(url.endsWith('/variants/plan_fixture'));
    return new Response(JSON.stringify({ id: 'plan_fixture', account: { id: cfg.accountId }, product: { id: cfg.productId },
      initial_price: 97, currency: 'usd', plan_type: 'one_time', title: 'Consulting Services Package' }));
  };
  const result = await mintBlueprintServiceWhopCheckout({ service, env, fetchImpl });
  assert.equal(result.checkoutId, 'ch_fixture');
  assert.equal(calls, 2);
  await assert.rejects(mintBlueprintServiceWhopCheckout({ service, env, fetchImpl: async (url, opts) => {
    const out = await fetchImpl(url, opts);
    const data = await out.json();
    if (url.includes('/variants/')) data.product.id = 'prod_other';
    return new Response(JSON.stringify(data));
  } }), /variant/);
});

test('Whop service payment refuses every altered identity, amount, item, metadata, currency and second payment ID', () => {
  assert.equal(validateWhopServicePayment(payment(), service, cfg), true);
  const changes = [p => { p.account_id = 'biz_other'; }, p => { p.product_id = 'prod_other'; },
    p => { p.plan_id = 'plan_other'; }, p => { p.checkout_configuration_id = 'ch_other'; },
    p => { p.total.amount = '96.99'; }, p => { p.total.currency = 'eur'; }, p => { p.currency = 'eur'; },
    p => { p.line_items[0].quantity = 2; }, p => { p.metadata.fh_client_id = randomUUID(); },
    p => { p.metadata.fh_org_id = randomUUID(); }, p => { p.metadata.fh_service_request_id = randomUUID(); },
    p => { p.metadata.fh_target_id = randomUUID(); }, p => { p.metadata.product_code = 'blueprint-self-funding'; }];
  for (const change of changes) { const p = payment(); change(p); assert.throws(() => validateWhopServicePayment(p, service, cfg)); }
  assert.throws(() => validateWhopServicePayment(payment(), { ...service, whop_payment_id: 'pay_other' }, cfg));
});

test('every help kind sends only opaque order metadata; legacy receipts cannot mint or change versions', () => {
  for (const kind of ['inquiry_removal','repair_round','repair_full','funding_round','credit_pull']) {
    const row={...service,service_kind:kind};
    assert.ok(!JSON.stringify(buildWhopServiceCheckout(row,cfg)).includes(kind));
  }
  const legacy={...service,whop_metadata_version:1};
  const v1=whopServiceMetadata(legacy);
  assert.equal(v1.product_code,'blueprint-help-inquiry_removal');
  assert.equal(validateWhopServicePayment({...payment(),metadata:v1},legacy,cfg),true);
  assert.throws(()=>buildWhopServiceCheckout(legacy,cfg),/only be recovered via GET/);
  assert.throws(()=>validateWhopServicePayment({...payment(),metadata:v1},service,cfg),/metadata mismatch/);
  assert.throws(()=>validateWhopServicePayment(payment(),legacy,cfg),/metadata mismatch/);
  assert.throws(()=>validateWhopServicePayment({...payment(),metadata:{...v1,extra:'unexpected'}},legacy,cfg),/metadata mismatch/);
});

test('sandbox service checkout requires its exact sandbox URL and verifies the variant on the sandbox API', async () => {
  const sandbox={...env,WHOP_ENV:'sandbox'};
  const out={id:'ch_fixture',account_id:cfg.accountId,mode:'payment',metadata:whopServiceMetadata(service),
    plan:{id:'plan_fixture',initial_price:97,currency:'usd',plan_type:'one_time'},purchase_url:'https://sandbox.whop.com/checkout/ch_fixture/'};
  let reads=0;
  const fetchImpl=async url=>{
    assert.equal(url,'https://sandbox-api.whop.com/api/v1/variants/plan_fixture');reads++;
    return Response.json({id:'plan_fixture',account:{id:cfg.accountId},product:{id:cfg.productId},
      initial_price:97,currency:'usd',plan_type:'one_time',title:'Consulting Services Package'});
  };
  await verifyWhopServiceCheckout(out,service,cfg,{env:sandbox,fetchImpl});
  for (const purchase_url of ['https://whop.com/checkout/ch_fixture/','https://sandbox.whop.com:8443/checkout/ch_fixture/',
    'https://user@sandbox.whop.com/checkout/ch_fixture/']) {
    await assert.rejects(verifyWhopServiceCheckout({...out,purchase_url},service,cfg,{env:sandbox,fetchImpl}));
  }
  assert.equal(reads,1);
});
