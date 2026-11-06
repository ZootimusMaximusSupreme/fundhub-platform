// Offline, synthetic rehearsal. Run against a newly migrated, empty scratch database.
// All HTTP requests to provider URL shapes terminate in this process, before any socket.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const receiptFile = process.argv[2] || 'result.json';
assert.ok(['result.json','whop-neutral-http.json'].includes(receiptFile),'choose a supported local receipt name');
const connection = new URL(process.env.DATABASE_URL || '');
assert.equal(connection.protocol, 'postgres:');
assert.equal(connection.hostname, '127.0.0.1');
assert.equal(connection.username, 'fundhub_app');
assert.match(connection.pathname, /^\/fundhub_sandbox_webhooks_[a-z0-9_]+_test$/);
for (const key of ['INNGEST_EVENT_KEY','CRS_API_PASSWORD','WHOP_API_KEY','COMMAS_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY']) {
  assert.ok(!process.env[key], 'Start with a clean process environment: ' + key);
}
const id = () => randomUUID().replaceAll('-', '');
const env = Object.assign(process.env, {
  CORTANA_COMMAS_API_KEY:'synthetic-only', FANBASIS_CHECKOUT_API_BASE:'https://checkout-fixture.example.invalid',
  WHOP_ENV:'sandbox', WHOP_API_KEY:'synthetic-only', WHOP_ACCOUNT_ID:'biz_synthetic', WHOP_CONSULTING_PACKAGE_PRODUCT_ID:'prod_synthetic',
  WHOP_WEBHOOK_SECRET:randomBytes(32).toString('hex'), COMMAS_WEBHOOK_SECRET:randomBytes(32).toString('hex'),
  PII_ENC_KEY:randomBytes(32).toString('base64'), DOCUMENT_STORE_PROVIDER:'memory', DOCUMENT_URL_SECRET:randomBytes(32).toString('hex'),
  ADAPTERS_DRY_RUN:'0', MESSAGING_DRY_RUN:'1', CRS_API_HOST:'api-sandbox.stitchcredit.com', CRS_API_USERNAME:'synthetic-only',
  CRS_API_PASSWORD:'synthetic-only', CRS_ACTIVE_BUREAUS:'TU,EX,EQ'
});
const receipt={ startedAt:new Date().toISOString(), databaseRole:'fundhub_app', externalProviderRequests:0, liveCustomerActions:0,
  providerSandboxDelivery:'This HTTP rehearsal used fixture transports. See crs-vendor-three-bureau.json for the separate external TransUnion, Experian and Equifax sandbox run.',
  transport:{http:'real loopback HTTP to production Netlify router', payments:'synthetic signed event bytes and simulated Whop checkout responses', reports:'real CRS sandbox client, published per-bureau identities, synthetic HTTP response bytes; no actual vendor network'}, checks:[], orders:{}, wire:[] };
let origin;
const nativeFetch = globalThis.fetch;
const checkouts = new Map();
globalThis.fetch = async (input, init={}) => {
  const url = new URL(typeof input==='string' || input instanceof URL ? input : input.url);
  if(origin && url.origin===origin) return nativeFetch(input,init);
  const path = url.pathname;
  if(url.origin==='https://checkout-fixture.example.invalid' && path==='/checkout-sessions' && init.method==='POST') {
    const body=JSON.parse(init.body);assert.ok(body.metadata.link_ref);assert.ok(body.metadata.client_id);
    receipt.wire.push({provider:'commasFixture',method:'POST',resource:'checkout-sessions'});
    return Response.json({data:{id:'checkout-'+body.metadata.link_ref,payment_link:'https://checkout.example.invalid/'+body.metadata.link_ref}});
  }
  if(url.origin==='https://sandbox-api.whop.com'  && path.startsWith('/api/v1/')) {
    receipt.wire.push({provider:'whopFixture',method:init.method || 'GET',resource:path.split('/')[3]});
    if(path==='/api/v1/checkout_configurations' && init.method==='POST') {
      const body=JSON.parse(init.body);
      assert.equal(body.metadata.fh_schema,'2');
      assert.equal(body.plan.title,'Consulting Services Package');assert.equal(body.plan.description,body.plan.title);
      assert.equal(init.headers['Idempotency-Key'],'fh-request:'+body.metadata.fh_service_request_id);
      assert.deepEqual(Object.keys(body.metadata).sort(),['fh_schema','fh_service_request_id','fh_org_id','fh_client_id','fh_engagement_id','fh_target_id','fh_amount_cents','fh_currency'].sort());
      receipt.wire.at(-1).outboundSchema=body.metadata.fh_schema;
      receipt.wire.at(-1).metadataKeys=Object.keys(body.metadata).sort();
      assert.equal(body.account_id,env.WHOP_ACCOUNT_ID);assert.equal(body.plan.product_id,env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID);
      const ix=checkouts.size+1;
      const row={id:'ch_synthetic'+ix,account_id:env.WHOP_ACCOUNT_ID,mode:'payment',metadata:body.metadata,
        plan:{id:'plan_synthetic'+ix,initial_price:body.plan.initial_price,currency:'usd',plan_type:'one_time'},
        purchase_url:'https://sandbox.whop.com/checkout/ch_synthetic'+ix+'/'};
      checkouts.set(row.id,row);return Response.json(row);
    }
    for(const row of checkouts.values()) {
      if(path==='/api/v1/checkout_configurations/'+row.id) return Response.json(row);
      if(path==='/api/v1/variants/'+row.plan.id) return Response.json({id:row.plan.id,account:{id:env.WHOP_ACCOUNT_ID},
        product:{id:env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID},initial_price:row.plan.initial_price,currency:'usd',plan_type:'one_time',title:'Consulting Services Package'});
    }
  }
  if(url.origin==='https://api-sandbox.stitchcredit.com' && init.method==='POST') {
    if(path==='/api/users/login') return Response.json({token:'synthetic-bearer',refreshToken:'synthetic-refresh',expires:3600});
    const bureau=path.includes('transunion')?'TU':path.includes('experian')?'EX':path.includes('equifax')?'EQ':null;
    assert.ok(bureau && path.startsWith('/api/') && path.includes('-prequal-fico9'));
    assert.equal(init.headers.Authorization,'Bearer synthetic-bearer');
    const body=JSON.parse(init.body);
    const {identityForBureau, CRS_SANDBOX_HOST}=await import('../../../../src/finance/crs-identities.mjs');
    const identity=identityForBureau({host:CRS_SANDBOX_HOST,bureau,env});
    assert.equal(body.ssn.replace(/\D/g,''),identity.ssn.replace(/\D/g,''));
    assert.equal(body.firstName,identity.firstName);assert.equal(body.lastName,identity.lastName);
    receipt.orders[bureau]=(receipt.orders[bureau] || 0)+1;
    return Response.json({scores:[{score:723,modelName:'FICO9'}],tradelines:[],inquiries:[]},
      {headers:{requestid:'synthetic-'+id()}});
  }
  throw Error('External connection blocked: '+url.origin+' '+path);
};
const [{default:router},{close},auth,staffAuth,{whopBlueprintMetadata},
  {drainWhopBillingInbox},{processWhopBillingInboxRow},{processBlueprintClientServices},
  {createCrsClient},{runCrsPull}]=await Promise.all([
  import('../../../../netlify/functions/api.mjs'),import('../../../../src/db.mjs'),
  import('../../../../src/auth/account-session.mjs'),import('../../../../src/auth/session.mjs'),
  import('../../../../src/payments/whop-blueprint.mjs'),import('../../../../src/payments/whop-billing-inbox.mjs'),
  import('../../../../src/adapters/whop-billing.mjs'),import('../../../../src/blueprint/report-requests.mjs'),
  import('../../../../src/finance/crs-client.mjs'),import('../../../../src/finance/crs-pull.mjs')
]);
const db=new pg.Pool({connectionString:connection.href,max:4});
const server=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req) chunks.push(chunk);
    const data=Buffer.concat(chunks);
    const result=await router(new Request(origin+req.url,{method:req.method,headers:req.headers,...(data.length?{body:data}:{}),
    }),{});
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(500);res.end('local router failed');}
});
async function api(path,{body,token,headers={},status=200}={}) {
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{}),
    ...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  const out=await response.json();assert.equal(response.status,status,JSON.stringify({path,expected:status,actual:response.status,error:out.error || out.reason}));return out;
}
async function webhook(body,{message='msg_'+id(),bad=false,status=200}={}) {
  const raw=JSON.stringify(body), time=String(Math.floor(Date.now()/1000));
  const signature='v1,'+createHmac('sha256',bad?'wrong-synthetic-secret':env.WHOP_WEBHOOK_SECRET).update(message+'.'+time+'.'+raw).digest('base64');
  const result=await api('/api/webhooks/whop-billing',{body:raw,status,headers:{'webhook-id':message,'webhook-timestamp':time,'webhook-signature':signature}});
  return {message,result:result.body};
}
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
const drain=async()=>(await drainWhopBillingInbox(db,{process:processWhopBillingInboxRow})).counts;
function paid(row,metadata,cents) {
  return {account_id:env.WHOP_ACCOUNT_ID,type:'payment.succeeded',data:{id:'pay_'+id(),account_id:env.WHOP_ACCOUNT_ID,
    product_id:env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID,plan_id:row.plan.id,checkout_configuration_id:row.id,status:'paid',currency:'usd',
    total:{amount:(cents/100).toFixed(2),currency:'usd',decimals:2},metadata,
    line_items:[{quantity:1,product_id:env.WHOP_CONSULTING_PACKAGE_PRODUCT_ID,plan_id:row.plan.id}]}};
}
async function paidOnce(body) {
  const {message,result}=await webhook(body);assert.equal(result.queued,true);
  assert.equal((await webhook(body,{message})).result.queued,false);
  const before=await one('SELECT status,raw_body FROM whop_billing_inbox WHERE webhook_id=$1',[message]);
  assert.equal(before.status,'pending');assert.equal(before.raw_body,JSON.stringify(body));
  const done=await drain();assert.equal(done.failed,0,JSON.stringify(done));assert.equal(done.done,1,JSON.stringify(done));
  assert.equal((await one('SELECT status FROM whop_billing_inbox WHERE webhook_id=$1',[message])).status,'done');
  assert.equal((await drain()).done,0);
}
function check(label,fields={}) { receipt.checks.push({label,...fields});console.log('PASS',label); }
try {
  const role=await one('SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert.deepEqual(role,{role:'fundhub_app',rolsuper:false,rolbypassrls:false});
  assert.equal((await one('SELECT count(*)::int AS n FROM clients WHERE is_demo IS NOT TRUE')).n,0,'fresh unused synthetic database required');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const orgId=(await one('SELECT id FROM orgs WHERE is_default')).id;
  const email='sandbox-'+id()+'@example.test';
  const clientId=(await one("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Synthetic',$2) RETURNING id",[orgId,email])).id;
  const accountId=(await one("INSERT INTO accounts(org_id,client_id,kind,email,status,password_hash) VALUES($1,$2,'client',$3,'active','synthetic') RETURNING id",[orgId,clientId,email])).id;
  const token=(await auth.createAccountSession(db,{orgId,accountId})).token;
  const staffId=(await one("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic CSM','csm','active') RETURNING id",[orgId])).id;
  const staffToken=(await staffAuth.createSession(db,{orgId,staffId})).token;
  const link=await one(`INSERT INTO payment_links(org_id,client_id,product_id,purpose,description,amount_cents,currency,provider,link_ref,
    checkout_url,whop_checkout_configuration_id,whop_plan_id,whop_metadata_version)
    SELECT $1,$2,id,'custom','Synthetic full package checkout',3000000,'USD','whop',$3,
    'https://sandbox.whop.com/checkout/ch_syntheticfull/','ch_syntheticfull','plan_syntheticfull',2
    FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING *`,[orgId,clientId,'synthetic-'+id()]);
  link.product_code='blueprint-self-funding';
  const full=paid({id:link.whop_checkout_configuration_id,plan:{id:link.whop_plan_id}},whopBlueprintMetadata(link),3000000);
  assert.equal(full.data.metadata.fh_schema,'2');
  assert.deepEqual(Object.keys(full.data.metadata).sort(),['fh_schema','fh_payment_link_id','fh_org_id','fh_client_id','fh_amount_cents','fh_currency'].sort());
  await webhook(full,{bad:true,status:401});
  assert.equal((await one('SELECT count(*)::int AS n FROM whop_billing_inbox')).n,0);
  const wrong=structuredClone(full);wrong.data.total.amount='29999.99';
  await webhook(wrong);assert.equal((await drain()).failed,1);
  assert.equal((await one('SELECT count(*)::int AS n FROM blueprint_fulfillment_engagements WHERE client_id=$1',[clientId])).n,0);
  check('bad signature refused; signed incorrect amount retained as failed, zero grants');
  await paidOnce(full);
  const view=await api('/api/blueprint/funding',{token});
  assert.equal(view.engagement.clientId,clientId);assert.equal(view.engagement.status,'active');
  check('signed full $30,000 receipt, durable inbox replay, one active workspace',{amountCents:3000000});
  const form='/api/soft-pull-approve?portal=1&blueprint=1';
  const setup=await api(form,{token});assert.equal(setup.reportSetup.required,true);
  const report=await api(form,{token,status:201,body:{first_name:'Synthetic',last_name:'Buyer',ssn:'0'.repeat(9),dob:'1980-01-01',
    address_line1:'1 Test Street',city:'Phoenix',state:'AZ',postal_code:'85001',org:orgId,client:clientId}});
  assert.ok(report.reportRequestId);
  const extra=await api('/api/blueprint/services',{token,body:{action:'request_report',idempotencyKey:randomUUID()}});
  assert.equal(extra.requiresPayment,true);assert.equal(extra.request.serviceKind,'credit_pull');
  const crs=createCrsClient({env,fetchImpl:globalThis.fetch});
  // Only the worker's private, in-memory invocation enables the real processing branch.
  // The CRS client itself is always constrained to the synthetic sandbox fixtures above.
  const worker=()=>processBlueprintClientServices(db,{env:{...env,CRS_ALLOW_LIVE:'1',FINANCE_OS_SYSTEM_PULL_LIVE:'1'},
    runPull:(db,input)=>runCrsPull(db,{...input,env,client:crs,bureaus:['TU','EX','EQ']})});
  const first=await worker();
  const included=await one(`SELECT r.status,r.blueprint_report_kind,c.result->>'environment' AS environment
    FROM soft_pull_requests r JOIN crs_results c ON c.id=r.crs_result_id WHERE r.id=$1`,[report.reportRequestId]);
  assert.equal(included?.status,'fulfilled',JSON.stringify(first));assert.equal(included.environment,'sandbox');assert.equal(first.fulfilled,1);
  check('included report saved through actual CRS sandbox client with three fixture responses',{ledger:included,aftercare:first});
  const service='/api/blueprint/services';
  async function checkout(requestId,cents) {
    const response=await api(service,{token,body:{action:'checkout',requestId,authorization:true,provider:'whop',expectedPriceCents:cents}});
    assert.equal(response.request.checkoutProvider,'whop');
    const row=await one('SELECT whop_checkout_configuration_id FROM blueprint_client_services WHERE id=$1',[requestId]);
    const out=checkouts.get(row.whop_checkout_configuration_id);assert.ok(out);return out;
  }
  const extraPrice=extra.request.priceCents;
  const extraCheckout=await checkout(extra.request.id,extraPrice);
  const extraReceipt=paid(extraCheckout,extraCheckout.metadata,extraPrice);
  await paidOnce(extraReceipt);
  const extraDelivery=await worker();
  const extraRow=await one(`SELECT p.status,p.produced_kind,r.status AS report_status,c.result->>'environment' AS environment
    FROM paid_service_requests p JOIN blueprint_client_services s ON s.id=p.id
    JOIN soft_pull_requests r ON r.id=s.soft_pull_request_id JOIN crs_results c ON c.id=r.crs_result_id WHERE p.id=$1`,[extra.request.id]);
  assert.equal(extraRow?.report_status,'fulfilled',JSON.stringify(extraDelivery));
  assert.equal(extraRow.environment,'sandbox');assert.equal(extraRow.status,'fulfilled');assert.equal(extraRow.produced_kind,'crs_result');assert.equal(extraDelivery.fulfilled,1);
  check('separate paid-extra report receipt and report stored',{amountCents:extraPrice,ledger:extraRow,aftercare:extraDelivery});
  const help=await api(service,{token,body:{action:'request_help',serviceKind:'funding_round',idempotencyKey:randomUUID()}});
  await api(service+'?client_id='+clientId,{token:staffToken,body:{action:'quote',requestId:help.request.id,priceCents:120000}});
  const stale=await api(service,{token,status:409,body:{action:'checkout',requestId:help.request.id,authorization:true,expectedPriceCents:119999,provider:'whop'}});
  assert.equal(stale.error,'quote_changed');
  const hc=await checkout(help.request.id,120000), financed=paid(hc,hc.metadata,120000);await paidOnce(financed);
  const now=await api('/api/blueprint/funding',{token});assert.equal(now.engagement.executionOwner,'fundhub');assert.ok(now.engagement.roundId);
  const services=await api(service,{token});
  assert.equal(services.requests.find(r=>r.id===help.request.id)?.status,'in_progress');
  check('CSM negotiated funding help, stale price refused, exact financed receipt activates one managed round',{amountCents:120000});
  const refund={account_id:env.WHOP_ACCOUNT_ID,type:'refund.created',data:{id:'rf_'+id(),account_id:env.WHOP_ACCOUNT_ID,payment_id:financed.data.id,
    status:'succeeded',amount:{amount:'1200.00',currency:'usd',decimals:2},currency:'usd'}};
  await paidOnce(refund);
  assert.equal((await api(service,{token})).requests.find(r=>r.id===help.request.id)?.status,'refunded');
  assert.equal((await one('SELECT count(*)::int AS n FROM funding_rounds WHERE client_id=$1',[clientId])).n,1);
  assert.equal((await one('SELECT count(*)::int AS n FROM blueprint_fulfillment_engagements WHERE client_id=$1',[clientId])).n,1);
  check('refund replay preserved single engagement and round',{originalReceiptRetained:true});
  // Exercise the other accepted payment rail with a second independently purchased report.
  const secondExtra=await api(service,{token,body:{action:'request_help',serviceKind:'credit_pull',idempotencyKey:randomUUID()}});
  const commasId=secondExtra.request.id;
  const commasCheckout=await api(service,{token,body:{action:'checkout',requestId:commasId,authorization:true,provider:'commas',expectedPriceCents:secondExtra.request.priceCents}});
  assert.equal(commasCheckout.request.checkoutProvider,'commas');
  const paymentId='pay_synthetic'+id();
  const commasRaw=JSON.stringify({id:'evt_'+id(),type:'payment.succeeded',data:{payment_id:paymentId,
    amount_cents:secondExtra.request.priceCents,currency:'USD',product:{title:'Document round'},fan:{email},
    metadata:{org_id:orgId,client_id:clientId,link_ref:commasId}}});
  async function commasPost(secret,status) {
    return api('/api/webhooks/commas',{body:commasRaw,status,headers:{'x-webhook-signature':createHmac('sha256',secret).update(commasRaw).digest('hex')}});
  }
  await commasPost('wrong-synthetic-key',401);await commasPost(env.COMMAS_WEBHOOK_SECRET,200);await commasPost(env.COMMAS_WEBHOOK_SECRET,200);
  const inbox=await one('SELECT count(*)::int AS count FROM commas_inbox WHERE payment_id=$1',[paymentId]);assert.equal(inbox.count,1);
  const {drain:drainCommas}=await import('../../../../src/payments/commas-inbox.mjs');
  const {processCommasInboxRow}=await import('../../../../src/adapters/commas.mjs');
  const commasDrained=await drainCommas(db,{process:processCommasInboxRow});
  assert.equal(commasDrained.counts.done,1,JSON.stringify(commasDrained));
  const commasDelivery=await worker();
  const commasResult=await one(`SELECT p.status,p.produced_kind,c.result->>'environment' AS environment FROM paid_service_requests p
    JOIN crs_results c ON c.id=p.produced_ref AND c.client_id=p.client_id AND c.org_id=p.org_id WHERE p.id=$1`,[commasId]);
  assert.equal(commasResult?.status,'fulfilled',JSON.stringify(commasDelivery));assert.equal(commasResult.environment,'sandbox');
  check('Commas signed paid-extra receipt, duplicate, drain, exact report and stored scoped completion',{ledger:commasResult,amountCents:secondExtra.request.priceCents});
  assert.deepEqual(receipt.orders,{TU:3,EX:3,EQ:3});
  receipt.completedAt=new Date().toISOString();receipt.status='passed';
} catch(error) {
  receipt.status='failed';receipt.failure=error.message;process.exitCode=1;console.error(error.stack);
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.end();await close();
  await writeFile(new URL('./'+receiptFile,import.meta.url),JSON.stringify(receipt,null,2)+'\n');
}
