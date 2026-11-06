// Real PostgreSQL semantics, isolated temporary tables. The normal app database
// URL is ignored locally; CI accepts only its guarded loopback scratch URL.
// An explicit scratch URL or PGlite module also works. No real buyer/provider is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { convert } from './economics.mjs';
import { WHOP_SELLER_SQL, WHOP_ACCESS_SQL, gapChecks } from '../pulse/coverage/gap-whop-billing.mjs';
import { SELLER_SQL } from '../pulse/beats/beat-whop-billing.mjs';
import { createSellerSale, resolveSellerHandoff, handoffUrl, parseSellerBuyer, sellerCapability } from './blueprint-sale.mjs';
import sellerHandler from '../../api/affiliates/blueprint-sale.mjs';
import buyerHandler from '../../api/public/blueprint-handoff.mjs';
import { validateWhopBlueprintPayment } from '../adapters/whop-billing.mjs';
import { whopConfig, whopBlueprintMetadata } from '../payments/whop-blueprint.mjs';
const PG_MODULE = process.env.BLUEPRINT_SELLER_PGLITE_MODULE;
const SCRATCH = process.env.BLUEPRINT_SELLER_TEST_DATABASE_URL || (process.env.CI === 'true' ? process.env.DATABASE_URL : null);
let safeScratch = false;
try {
 const url = new URL(SCRATCH);
 safeScratch = ['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname) && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* An unavailable or production database is never used by this suite. */ }
const OPTIONS = { skip: !PG_MODULE && !safeScratch ? 'explicit local scratch PostgreSQL/PGlite not configured; production refused' : false };
const ORG=randomUUID(), AFF=randomUUID(), ACCOUNT=randomUUID(), STAFF=randomUUID(), PRODUCT=randomUUID();
const principal={kind:'affiliate',orgId:ORG,affiliateId:AFF,accountId:ACCOUNT};
const env={BLUEPRINT_AFFILIATE_SELLER_IDS:AFF,CONTRACT_URL_SECRET:'synthetic-seller-handoff-secret-32bytes-plus',WHOP_API_KEY:'synthetic-key',WHOP_ACCOUNT_ID:'biz_synthetic',WHOP_CONSULTING_PACKAGE_PRODUCT_ID:'prod_synthetic',WHOP_WEBHOOK_SECRET:'synthetic-secret',ADAPTERS_DRY_RUN:'0'};
const buyer=()=>({first_name:'Synthetic',last_name:'Buyer',email:randomUUID()+'@example.test',phone:'+12025550123',request_id:randomUUID()});
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){return this;}};}
async function world({sandbox=false,migratedSchema=false}={}){
 const testEnv=sandbox?{...env,WHOP_ENV:'sandbox'}:env;
 const db=PG_MODULE?new (await import(PG_MODULE)).PGlite():new pg.Client({connectionString:SCRATCH});
 if(!PG_MODULE)await db.connect();
 const actorMigration=await readFile(new URL('../../db/migrations/566_contract_affiliate_actors.sql',import.meta.url),'utf8');
 if(migratedSchema&&PG_MODULE){
  // CI already has the migrated public contracts table. Reproduce that exact
  // named-constraint collision in the otherwise-empty embedded PostgreSQL.
  await db.exec(`CREATE TABLE public.accounts(id uuid PRIMARY KEY,org_id uuid,kind text);
   CREATE TABLE public.contracts(id uuid PRIMARY KEY,org_id uuid,status text,created_by uuid NOT NULL,sent_by uuid,sent_at timestamptz);`);
  await db.exec(actorMigration);
 }
 await (PG_MODULE ? db.exec.bind(db) : db.query.bind(db))(`CREATE TEMP TABLE clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid,email text,first_name text,last_name text,phone text,ghl_contact_id text,channel_source text,is_demo boolean DEFAULT false,custom_fields jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX ON clients(org_id,lower(email)) WHERE email IS NOT NULL;
 CREATE TEMP TABLE affiliates(id uuid PRIMARY KEY,org_id uuid,name text,status text,tracking_id text,recruited_by uuid);
 CREATE TEMP TABLE accounts(id uuid PRIMARY KEY,org_id uuid,email text,kind text,status text,affiliate_id uuid,client_id uuid);
 CREATE TEMP TABLE staff(id uuid PRIMARY KEY,org_id uuid,email text,role text,status text,is_demo boolean DEFAULT false);
 CREATE TEMP TABLE affiliate_referrals(id uuid DEFAULT gen_random_uuid(),org_id uuid,affiliate_id uuid,client_id uuid,tier text,tracking_id_used text,attributed_at timestamptz,source text,source_event text,detail jsonb,status text,commission_due numeric,converted_at timestamptz,converting_sale_id uuid,basis_amount numeric,rule_id uuid,rule_snapshot jsonb,updated_at timestamptz,UNIQUE(client_id,tier));
 CREATE TEMP TABLE contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid,client_id uuid,template_key text,status text,created_by uuid NOT NULL REFERENCES staff(id),sent_by uuid REFERENCES staff(id),sent_at timestamptz,created_at timestamptz DEFAULT now(),merge_values jsonb,rendered_body text,body_sha text);
 CREATE TEMP TABLE products(id uuid PRIMARY KEY,org_id uuid,code text);
 CREATE TEMP TABLE sales(id uuid,org_id uuid,client_id uuid,product_id uuid,status text,sale_motion text,sold_at timestamptz);
 CREATE TEMP TABLE sale_attributions(sale_id uuid,staff_id uuid,role text,attributed_at timestamptz);
 CREATE TEMP TABLE call_outcomes(org_id uuid,client_id uuid,staff_id uuid,logged_at timestamptz);
 CREATE TEMP TABLE payment_links(id uuid PRIMARY KEY,org_id uuid,client_id uuid,purpose text,description text,amount_cents bigint,currency text,link_ref text,checkout_url text,provider text,product_id uuid,sale_id uuid,sale_motion text,created_by_staff_id uuid,closer_staff_id uuid,sales_manager_staff_id uuid,status text DEFAULT 'created',paid_at timestamptz,created_at timestamptz DEFAULT now(),whop_checkout_configuration_id text,whop_plan_id text,whop_payment_id text,whop_metadata_version integer NOT NULL DEFAULT 2 CHECK(whop_metadata_version IN(1,2)));
 CREATE TEMP TABLE transactions(id uuid DEFAULT gen_random_uuid(),org_id uuid,client_id uuid,provider text,provider_ref text,status text,amount_paid numeric);
 CREATE TEMP TABLE affiliate_commission_rules(id uuid,org_id uuid,tier text,affiliate_id uuid,product_id uuid,active boolean,effective_from timestamptz,effective_to timestamptz,created_at timestamptz);
 CREATE TEMP TABLE whop_billing_inbox(org_id uuid,status text,received_at timestamptz,claimed_at timestamptz);
 CREATE TEMP TABLE product_entitlements(org_id uuid,product_code text,entitlement_code text);
 CREATE TEMP TABLE entitlements(source_transaction_id uuid,org_id uuid,client_id uuid,entitlement_code text);`);
 await (PG_MODULE ? db.exec.bind(db) : db.query.bind(db))(actorMigration);
 await db.query(`INSERT INTO staff VALUES($1,$2,'staff-fixture@example.test','closer','active',false)`,[STAFF,ORG]);
 await db.query(`INSERT INTO affiliates VALUES ($1,$2,'Synthetic seller','active','AFF-SYNTHETIC',NULL)`,[AFF,ORG]);
 await db.query(`INSERT INTO accounts VALUES ($1,$2,'seller@example.test','affiliate','active',$3,NULL)`,[ACCOUNT,ORG,AFF]);
 await db.query(`INSERT INTO products VALUES ($1,$2,'blueprint-self-funding')`,[PRODUCT,ORG]);
 const cache=new Map(); let posts=0,creates=0,failAfterCreate=false,financing=true,configuration=null;
 const send=async(url,init={})=>{
  let out;
  if(init.method==='POST'){
   posts++; const key=init.headers['Idempotency-Key']; const body=JSON.parse(init.body);
   assert.equal(body.metadata.fh_schema,'2');assert.ok(!('fh_link_ref' in body.metadata));assert.ok(!('offer_key' in body.metadata));assert.ok(!('product_code' in body.metadata));
   assert.deepEqual(body.payment_method_configuration,{enabled:['claritypay'],disabled:[],include_platform_defaults:true});
   if(!cache.has(key)){
    creates++; out={id:'ch_synthetic'+creates,account_id:'biz_synthetic',mode:'payment',metadata:body.metadata,plan:{id:'plan_synthetic'+creates,...body.plan},purchase_url:`https://${sandbox?'sandbox.whop.com':'whop.com'}/checkout/ch_synthetic${creates}/`,payment_method_configuration:configuration?configuration.selected:body.payment_method_configuration,effective_payment_method_configuration:configuration?configuration.effective:{enabled:financing?['claritypay']:[],disabled:[]}};
    cache.set(key,out);
   }else out=cache.get(key);
   if(failAfterCreate){failAfterCreate=false;throw Error('synthetic lost provider response');}
  }else if(String(url).includes('/variants/')){
   const checkout=[...cache.values()].find(c=>String(url).endsWith(c.plan.id));
   out={id:checkout.plan.id,account:{id:'biz_synthetic'},product:{id:'prod_synthetic'},currency:'usd',plan_type:'one_time',title:'Consulting Services Package',initial_price:checkout.plan.initial_price};
  }else out=[...cache.values()].find(c=>String(url).endsWith(c.id));
  return new Response(JSON.stringify(out),{headers:{'content-type':'application/json'}});
 };
 const deps={getTemplate:async()=>({id:randomUUID(),active:true}),createDraft:async(db,args)=>{
  const rendered=`Full Blueprint service agreement: $${(args.amountCents/100).toLocaleString('en-US')}.`;
  return (await db.query(`INSERT INTO contracts(org_id,client_id,template_key,status,created_by_account_id,merge_values,rendered_body,body_sha) VALUES($1,$2,'BLUEPRINT-SELF-FUNDING-AGREEMENT','draft',$3,$4,$5,$6) RETURNING *`,[args.orgId,args.clientId,args.accountId,JSON.stringify({package_fee:`$${(args.amountCents/100).toLocaleString('en-US')}`,_blueprint_amount_cents:args.amountCents}),rendered,'sha256:'+createHash('sha256').update(rendered).digest('hex')])).rows[0];
 },sendContract:async(db,args)=>({contract:(await db.query(`UPDATE contracts SET status='sent',sent_at=COALESCE(sent_at,now()),sent_by_account_id=$3 WHERE id=$1 AND org_id=$2 RETURNING *`,[args.id,args.orgId,args.accountId])).rows[0]}),getContract:async(db,{orgId,id})=>(await db.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2',[id,orgId])).rows[0],fetchImpl:send};
 const run=(body,over={})=>createSellerSale(db,{principal,body,env:testEnv,deps,...over});
 const seedBuyer=async(b)=>{await db.query(`INSERT INTO clients(org_id,first_name,last_name,email,phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[ORG,b.first_name,b.last_name,b.email,b.phone]);};
 const localCheckout=async(db,args)=>(await db.query(`INSERT INTO payment_links(id,org_id,client_id,product_id,provider,amount_cents,currency,checkout_url,status) VALUES($1,$2,$3,$4,'whop',$5,'USD','https://whop.com/checkout/ch_local/','created') ON CONFLICT(id) DO UPDATE SET checkout_url=EXCLUDED.checkout_url RETURNING *`,[args.reservationId,ORG,args.clientId,PRODUCT,args.amountCents])).rows[0];
 const agreement=async(email,{status='sent',amount=3000000}={})=>{
  const client=(await db.query('SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2',[ORG,email])).rows[0];
  const rendered=`Full Blueprint service agreement: $${(amount/100).toLocaleString('en-US')}.`;
  return (await db.query(`INSERT INTO contracts(org_id,client_id,template_key,status,created_by,sent_by,merge_values,rendered_body,body_sha) VALUES($1,$2,'BLUEPRINT-SELF-FUNDING-AGREEMENT',$3,$4,$4,$5,$6,$7) RETURNING id`,[ORG,client.id,status,STAFF,JSON.stringify({package_fee:`$${(amount/100).toLocaleString('en-US')}`,_blueprint_amount_cents:amount}),rendered,'sha256:'+createHash('sha256').update(rendered).digest('hex')])).rows[0].id;
 };
 return {db,run,agreement,seedBuyer,localCheckout,deps,cache,get posts(){return posts;},get creates(){return creates;},loseResponse(){failAfterCreate=true;},denyFinancing(){financing=false;},malformedConfig(value){configuration=value;},close:()=>PG_MODULE?db.close():db.end()};
}
async function scenario(run){const w=await world();try{await run(w);}finally{await w.close();}}
const record=async(w,email)=>(await w.db.query('SELECT id,custom_fields FROM clients WHERE lower(email)=$1',[email])).rows[0];
test('capability is restricted to explicit affiliate account and valid allowlist',()=>{
 const a={id:AFF,status:'active'};assert.equal(sellerCapability(principal,a,env).enabled,true);
 for(const p of [{...principal,kind:'staff'},{...principal,kind:'client'},{...principal,affiliateId:randomUUID()}])assert.equal(sellerCapability(p,a,env).enabled,false);
 assert.equal(sellerCapability(principal,a,{...env,BLUEPRINT_AFFILIATE_SELLER_IDS:AFF+',bad'}).enabled,false);
 assert.throws(()=>parseSellerBuyer({...buyer(),client_id:randomUUID()}),/Send only/);
});
test('seller automatically issues one actual-affiliate agreement with native buyer and sticky referral',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b=buyer(); const a=await w.run(b),again=await w.run(b);
 assert.equal(a.stage,'awaiting_signature');assert.ok(a.handoff_url);assert.ok(a.contract_id);assert.deepEqual(again,a);assert.equal(w.posts,0);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM affiliate_referrals WHERE commission_due IS NULL')).rows[0].n,1);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM contracts')).rows[0].n,1);
 const issued=(await w.db.query('SELECT * FROM contracts')).rows[0];assert.equal(issued.created_by,null);assert.equal(issued.created_by_account_id,ACCOUNT);assert.equal(issued.sent_by_account_id,ACCOUNT);
}));
test('wrong role, disabled seller and foreign org cannot create a buyer',OPTIONS,()=>scenario(async w=>{
 for(const p of [{...principal,kind:'client'},{...principal,orgId:randomUUID()}])await assert.rejects(w.run(buyer(),{principal:p}),{code:'seller_disabled'});
 await assert.rejects(w.run(buyer(),{env:{...env,BLUEPRINT_AFFILIATE_SELLER_IDS:''}}),{code:'seller_disabled'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,0);
}));
test('incompatible account and employee emails are refused before intake',OPTIONS,()=>scenario(async w=>{
 for(const email of ['seller@example.test','staff@example.test']){
  if(email.startsWith('staff'))await w.db.query(`INSERT INTO staff VALUES($1,$2,$3,'closer','active',false)`,[randomUUID(),ORG,email]);
  await assert.rejects(w.run({...buyer(),email}),{code:'buyer_login_conflict'});
 }
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,0);
}));
test('existing another-affiliate first touch is never overwritten',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b=buyer();await w.run(b);const c=await record(w,b.email);const other=randomUUID();
 await w.db.query('UPDATE affiliate_referrals SET affiliate_id=$1 WHERE client_id=$2',[other,c.id]);
 await assert.rejects(w.run(b),{code:'buyer_already_attributed'});assert.equal(w.posts,0);
 assert.equal((await w.db.query('SELECT affiliate_id FROM affiliate_referrals')).rows[0].affiliate_id,other);
}));
test('exact staff-issued agreement enables one explicit ClarityPay checkout and stable permanent handoff',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);const id=await w.agreement(b.email);const one=await w.run(b),two=await w.run({...b,request_id:randomUUID()});
 assert.equal(one.contract_id,id);assert.equal(one.stage,'awaiting_signature');assert.equal(one.handoff_url,two.handoff_url);assert.equal(w.creates,1);assert.equal(w.posts,1);
 const url=new URL(one.handoff_url);assert.equal(url.pathname,'/api/public/blueprint-handoff');assert.equal(url.searchParams.get('id'),id);assert.match(url.searchParams.get('sig'),/^[0-9a-f]{64}$/);
 const later=await resolveSellerHandoff(w.db,{id,sig:url.searchParams.get('sig'),env,now:()=>Date.parse('2040-01-01')});
 assert.equal(new URL(later).pathname,'/contract.html');assert.equal(new URL(later).searchParams.get('return_to'),url.pathname+url.search);
 await assert.rejects(resolveSellerHandoff(w.db,{id,sig:'0'.repeat(64),env}),{code:'not_found'});
 const calls=w.posts;await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[id]);
 assert.match(await resolveSellerHandoff(w.db,{id,sig:url.searchParams.get('sig'),env}),/^https:\/\/whop.com\/checkout\//);assert.equal(w.posts,calls);
}));
test('lost provider response resumes the exact saved order and original provider idempotency key',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);await w.agreement(b.email);w.loseResponse();await assert.rejects(w.run(b));
 const reserved=(await record(w,b.email)).custom_fields.blueprint_seller_sale.payment_link_id;
 const done=await w.run(b);assert.ok(done.handoff_url);assert.equal(w.creates,1);assert.equal(w.posts,2);
 const links=(await w.db.query('SELECT id FROM payment_links')).rows;assert.deepEqual(links.map(x=>x.id),[reserved]);
}));
test('unrelated same-buyer order is never adopted by the pinned sale',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);const c=await record(w,b.email);await w.agreement(b.email);const unrelated=randomUUID();
 await w.db.query(`INSERT INTO payment_links(id,org_id,client_id,product_id,provider,amount_cents,currency,checkout_url,status) VALUES($1,$2,$3,$4,'whop',3000000,'USD','https://whop.com/checkout/ch_unrelated/','paid')`,[unrelated,ORG,c.id,PRODUCT]);
 const done=await w.run(b);assert.equal(done.stage,'awaiting_signature');assert.equal(w.creates,1);
 assert.notEqual((await record(w,b.email)).custom_fields.blueprint_seller_sale.payment_link_id,unrelated);
}));
test('missing effective financing confirmation fails closed without exposing a buyer handoff',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);await w.agreement(b.email);w.denyFinancing();await assert.rejects(w.run(b),/required financing method/);
 const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;assert.notEqual(saved.financing_verified,true);
 const args={id:saved.contract_id,sig:new URL(handoffUrl(saved,env)).searchParams.get('sig'),env};
 assert.equal(new URL(await resolveSellerHandoff(w.db,args)).pathname,'/contract.html','already-sent permanent agreement stays readable while financing is unavailable');
 await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[saved.contract_id]);await assert.rejects(resolveSellerHandoff(w.db,args),{code:'checkout_preparing'});
}));
test('wrong price and a newer agreement cannot authorize another pinned checkout',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);await w.agreement(b.email,{amount:2500000});await assert.rejects(w.run(b),{code:'blueprint_agreement_price_mismatch'});assert.equal(w.posts,0);
 const id=await w.agreement(b.email);const done=await w.run(b);await w.agreement(b.email,{status:'draft'});
 await assert.rejects(w.run(b));await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[id]);
 await assert.rejects(resolveSellerHandoff(w.db,{id,sig:new URL(done.handoff_url).searchParams.get('sig'),env}));
 assert.equal(w.creates,1);
}));
test('paid flag alone grants no portal redirect; exact matched payment and full entitlement are required',OPTIONS,()=>scenario(async w=>{
 const b={...buyer(),amount_cents:2900000};await w.seedBuyer(b);await w.agreement(b.email,{amount:2900000});const done=await w.run(b);const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 await w.db.query(`UPDATE payment_links SET status='paid',whop_payment_id='pay_synthetic' WHERE id=$1`,[saved.payment_link_id]);
 await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[saved.contract_id]);
 const args={id:saved.contract_id,sig:new URL(done.handoff_url).searchParams.get('sig'),env};
 await assert.rejects(resolveSellerHandoff(w.db,args),{code:'payment_processing'});
 const tx=(await w.db.query(`INSERT INTO transactions(org_id,client_id,provider,provider_ref,status,amount_paid) VALUES($1,$2,'whop','pay_synthetic','succeeded',30000) RETURNING id`,[ORG,saved.client_id])).rows[0].id;
 await w.db.query(`INSERT INTO entitlements VALUES($1,$2,$3,'blueprint-client-fulfillment')`,[tx,ORG,saved.client_id]);
 await assert.rejects(resolveSellerHandoff(w.db,args),{code:'payment_processing'},'a30K transaction cannot provision a29K pinned deal');
 await w.db.query('UPDATE transactions SET amount_paid=29000 WHERE id=$1',[tx]);
 assert.equal(await resolveSellerHandoff(w.db,args),'https://fundhub.ai/portal-login.html');
 const order=(await w.db.query(`SELECT l.*,p.code AS product_code FROM payment_links l JOIN products p ON p.id=l.product_id WHERE l.id=$1`,[saved.payment_link_id])).rows[0];
 const payment={id:'pay_synthetic',account_id:'biz_synthetic',checkout_configuration_id:order.whop_checkout_configuration_id,plan_id:order.whop_plan_id,product_id:'prod_synthetic',currency:'usd',metadata:whopBlueprintMetadata(order),line_items:[{quantity:1,plan_id:order.whop_plan_id,product_id:'prod_synthetic'}],total:{amount:'29000.00',currency:'usd',decimals:2}};
 assert.equal(validateWhopBlueprintPayment(payment,order,whopConfig(env)),true);
 assert.throws(()=>validateWhopBlueprintPayment({...payment,total:{...payment.total,amount:'1.00'}},order,whopConfig(env)),/amount mismatch/);
 assert.equal((await w.db.query('SELECT commission_due FROM affiliate_referrals')).rows[0].commission_due,null);
}));
test('seller HTTP roles/methods and public method/query scope are enforced',OPTIONS,()=>scenario(async w=>{
 const res=response();await sellerHandler({method:'GET'},res);assert.equal(res.statusCode,405);
 const authDb=(kind)=>({query:async(sql,params)=>{
  if(sql.includes('WITH live AS'))return {rows:[]};
  if(sql.includes('UPDATE account_sessions'))return {rows:[{id:randomUUID(),account_id:ACCOUNT,org_id:ORG,expires_at:new Date(Date.now()+60000)}]};
  if(sql.includes('FROM accounts WHERE id = $1'))return {rows:[{id:ACCOUNT,org_id:ORG,kind,email:'seller@example.test',status:'active',affiliate_id:AFF}]};
  return w.db.query(sql,params);
 }});
 const headers={authorization:'Bearer synthetic-fixture-token'};
 const denied=response();await sellerHandler({method:'POST',body:buyer(),headers},denied,{db:authDb('client')});assert.equal(denied.statusCode,403);
 const bad=response();await buyerHandler({method:'POST',url:'/api/public/blueprint-handoff'},bad);assert.equal(bad.statusCode,405);
 const spoof=response();await buyerHandler({method:'GET',url:'/api/public/blueprint-handoff?id='+randomUUID()+'&sig='+'0'.repeat(64)+'&client_id='+randomUUID()},spoof,{db:w.db,env});assert.equal(spoof.statusCode,404);
 w.deps.createCheckout=w.localCheckout;const made=response();await sellerHandler({method:'POST',body:buyer(),headers},made,{db:authDb('affiliate'),connect:async()=>({...w.db,query:(...a)=>w.db.query(...a),release(){}}),env,services:w.deps});assert.equal(made.statusCode,200);assert.equal(made.body.sale.stage,'awaiting_signature');
}));

test('request UUID and canonical buyer details cannot be reused for a different buyer',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const a=buyer();await w.run(a);
 await assert.rejects(w.run({...buyer(),request_id:a.request_id}),{code:'request_conflict'});
 await assert.rejects(w.run({...a,phone:'+12025550124'}),{code:'request_conflict'});
 await assert.rejects(w.run({...a,first_name:'Different',request_id:randomUUID()}),{code:'request_conflict'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);
 assert.equal(w.posts,0);
}));

test('accepted request aliases stay bound to their original buyer',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const a=buyer();await w.run(a);const alias=randomUUID();await w.run({...a,request_id:alias});
 await assert.rejects(w.run({...buyer(),request_id:alias}),{code:'request_conflict'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);assert.equal(w.posts,0);
}));
test('malformed or missing effective financing method lists cannot make a handoff ready',OPTIONS,()=>scenario(async w=>{
 const valid={enabled:['claritypay'],disabled:[]};
 for(const configuration of [
  {selected:{enabled:'claritypay',disabled:[]},effective:valid},
  {selected:valid,effective:{enabled:'claritypay',disabled:[]}},
  {selected:valid,effective:undefined},
  {selected:{enabled:['claritypay'],disabled:'card'},effective:valid},
  {selected:valid,effective:{enabled:['claritypay'],disabled:'card'}},
  {selected:{enabled:['claritypay',7],disabled:[]},effective:valid}
 ]){
  const b=buyer();await w.seedBuyer(b);await w.agreement(b.email);w.malformedConfig(configuration);
  await assert.rejects(w.run(b),/required financing method/);
  assert.notEqual((await record(w,b.email)).custom_fields.blueprint_seller_sale.financing_verified,true);
 }
}));


test('provider completion preserves aliases committed by another retry while it waited',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);await w.agreement(b.email);
 let started,release;const entered=new Promise(resolve=>{started=resolve;});const held=new Promise(resolve=>{release=resolve;});let first=true;
 // Only the already-verified provider boundary is held. Intake, transaction
 // locks, request aliases, order state and completion all use real PostgreSQL.
 w.deps.createCheckout=async(db,args)=>{
  if(first){first=false;started();await held;}
  return (await db.query(`INSERT INTO payment_links(id,org_id,client_id,product_id,provider,amount_cents,currency,checkout_url,status)
    VALUES($1,$2,$3,$4,'whop',3000000,'USD','https://whop.com/checkout/ch_interleave/','created')
    ON CONFLICT(id) DO UPDATE SET checkout_url=EXCLUDED.checkout_url RETURNING *`,
   [args.reservationId,ORG,args.clientId,PRODUCT])).rows[0];
 };
 const pending=w.run(b);await entered;const alias=randomUUID();
 try{
  await w.run({...b,request_id:alias});
  const before=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
  assert.ok(before.request_ids.includes(alias));
  release();await pending;
  const after=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
  assert.deepEqual(after.request_ids,before.request_ids);
  assert.equal(after.financing_verified,true);
  await assert.rejects(w.run({...buyer(),request_id:alias}),{code:'request_conflict'});
  assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);
  assert.equal((await w.db.query('SELECT count(*)::int n FROM payment_links')).rows[0].n,1);
  assert.equal(w.posts,0,'no real or fixture network provider request is needed for this state race');
 }finally{release();await pending;}
}));

test('provider completion cannot mark a replaced pinned order as financing verified',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.seedBuyer(b);await w.agreement(b.email);const replacement=randomUUID();
 w.deps.createCheckout=async(db,args)=>{
  await db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,payment_link_id}',to_jsonb($1::text)) WHERE org_id=$2 AND id=$3`,
   [replacement,ORG,args.clientId]);
  return {id:args.reservationId};
 };
 await assert.rejects(w.run(b),{code:'sale_changed'});
 const after=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 assert.equal(after.payment_link_id,replacement);assert.notEqual(after.financing_verified,true);
}));


test('negotiated29K, bounds and default30K stay pinned to buyer, agreement and exact order',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;
 const cap=sellerCapability(principal,{id:AFF,status:'active'},env);
 assert.deepEqual([cap.amountCents,cap.minAmountCents,cap.maxAmountCents,cap.amountStepCents],[3000000,2000000,3000000,100]);
 for(const amount of [2000000,2900000,3000000,undefined]){
  const b={...buyer(),...(amount===undefined?{}:{amount_cents:amount})};const out=await w.run(b),expected=amount??3000000;
  assert.equal(out.amount_cents,expected);
  const row=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
  const contract=(await w.db.query('SELECT * FROM contracts WHERE id=$1',[out.contract_id])).rows[0];
  const order=(await w.db.query('SELECT * FROM payment_links WHERE id=$1',[row.payment_link_id])).rows[0];
  assert.equal(contract.merge_values._blueprint_amount_cents,expected);assert.equal(Number(order.amount_cents),expected);
  assert.equal(contract.created_by_account_id,ACCOUNT);assert.equal(contract.sent_by_account_id,ACCOUNT);
  await assert.rejects(w.run({...b,amount_cents:expected===2900000?3000000:2900000}),{code:'request_conflict'});
 }
 const before=(await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n;
 for(const amount_cents of [1999900,3000100,2900001,2900000.5,'2900000',null,NaN])await assert.rejects(w.run({...buyer(),amount_cents}),{code:'invalid_amount'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,before);
}));
test('tampered saved price and account invalidate the original request and permanent handoff',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b={...buyer(),amount_cents:2900000};const out=await w.run(b);
 const old=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 const args={id:out.contract_id,sig:new URL(out.handoff_url).searchParams.get('sig'),env};
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,amount_cents}','3000000'::jsonb) WHERE id=$1`,[old.client_id]);
 await assert.rejects(w.run(b),{code:'request_conflict'});await assert.rejects(resolveSellerHandoff(w.db,args),{code:'not_found'});
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale}',$2::jsonb) WHERE id=$1`,[old.client_id,JSON.stringify({...old,account_id:randomUUID()})]);
 await assert.rejects(resolveSellerHandoff(w.db,args),{code:'not_found'});
}));
test('account actor database guards reject cross-company, mixed actors and sender rewrite after downgrade and cleared timestamp',OPTIONS,()=>scenario(async w=>{
 const client=randomUUID(),otherAccount=randomUUID(),wrongKind=randomUUID();
 await w.db.query(`INSERT INTO accounts VALUES($1,$2,'other@example.test','affiliate','active',NULL,NULL),($3,$4,'client@example.test','client','active',NULL,NULL)`,[otherAccount,randomUUID(),wrongKind,ORG]);
 for(const account of [otherAccount,wrongKind])await assert.rejects(w.db.query(`INSERT INTO contracts(org_id,client_id,status,created_by_account_id) VALUES($1,$2,'draft',$3)`,[ORG,client,account]),/same company/);
 await assert.rejects(w.db.query(`INSERT INTO contracts(org_id,status,created_by,created_by_account_id) VALUES($1,'draft',$2,$3)`,[ORG,STAFF,ACCOUNT]),/contracts_creator_subject_ck/);
 await assert.rejects(w.db.query(`INSERT INTO contracts(org_id,status) VALUES($1,'draft')`,[ORG]),/contracts_creator_subject_ck/);
 const id=(await w.db.query(`INSERT INTO contracts(org_id,status,created_by_account_id) VALUES($1,'draft',$2) RETURNING id`,[ORG,ACCOUNT])).rows[0].id;
 await assert.rejects(w.db.query('UPDATE contracts SET created_by_account_id=$2 WHERE id=$1',[id,wrongKind]),/creator cannot be changed/);
 await w.db.query(`UPDATE contracts SET status='sent',sent_at=now(),sent_by_account_id=$2 WHERE id=$1`,[id,ACCOUNT]);
 await w.db.query(`UPDATE contracts SET status='draft',sent_at=NULL WHERE id=$1`,[id]);
 await assert.rejects(w.db.query('UPDATE contracts SET sent_by_account_id=NULL WHERE id=$1',[id]),/sender is frozen/);
 await assert.rejects(w.db.query('UPDATE contracts SET sent_by_account_id=$2 WHERE id=$1',[id,wrongKind]),/sender is frozen/);
 const staff=(await w.db.query(`INSERT INTO contracts(org_id,status,created_by) VALUES($1,'draft',$2) RETURNING id`,[ORG,STAFF])).rows[0].id;
 await w.db.query(`UPDATE contracts SET status='sent',sent_at=now(),sent_by=$2 WHERE id=$1`,[staff,STAFF]);
 await w.db.query(`UPDATE contracts SET status='draft',sent_at=NULL WHERE id=$1`,[staff]);
 await assert.rejects(w.db.query('UPDATE contracts SET sent_by=NULL WHERE id=$1',[staff]),/sender is frozen/);
}));
test('seller retries recover a sent affiliate agreement after the initial response is lost',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const original=w.deps.sendContract;let calls=0;
 w.deps.sendContract=async(...args)=>{const result=await original(...args);calls++;if(calls===1)throw Error('synthetic response lost before notify');return result;};
 const b=buyer();await assert.rejects(w.run(b),/synthetic response lost/);const out=await w.run(b);
 assert.equal(calls,2);assert.equal(out.stage,'awaiting_signature');assert.equal((await w.db.query('SELECT count(*)::int n FROM contracts')).rows[0].n,1);
}));
test('completed full Blueprint sale converts saved attribution with unknown commission NULL and replays safely',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b={...buyer(),amount_cents:2900000};await w.run(b);const client=(await record(w,b.email)).id,sale=randomUUID(),consulting=randomUUID();
 await w.db.query(`INSERT INTO products VALUES($1,$2,'consulting-package')`,[consulting,ORG]);
 await w.db.query(`INSERT INTO affiliate_commission_rules VALUES($1,$2,'direct',NULL,$3,true,now()-interval '1 day',NULL,now())`,[randomUUID(),ORG,consulting]);
 await w.db.query(`INSERT INTO sales VALUES($1,$2,$3,$4,'paid','self_funding',now())`,[sale,ORG,client,PRODUCT]);
 const out=await convert(w.db,{orgId:ORG,clientId:client,saleId:sale});assert.equal(out.converted,true);assert.equal(out.kind,'blueprint_sale');assert.equal(out.unrated,true);
 const ref=(await w.db.query('SELECT * FROM affiliate_referrals WHERE client_id=$1',[client])).rows[0];
 assert.equal(ref.status,'converted');assert.equal(ref.converting_sale_id,sale);assert.equal(ref.commission_due,null);assert.equal(ref.rule_id,null);assert.deepEqual(ref.rule_snapshot,{});
 assert.equal((await convert(w.db,{orgId:ORG,clientId:client,saleId:sale})).converted,false);
}));

test('seller heartbeat catches overdue unverified financing, missing price and wrong agreement price',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b={...buyer(),amount_cents:2900000};await w.run(b);const row=await record(w,b.email),saved=row.custom_fields.blueprint_seller_sale;
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,created_at}',to_jsonb((now()-interval '16 minutes')::text)) WHERE id=$1`,[row.id]);
 assert.equal((await w.db.query(SELLER_SQL)).rows[0].n,0);
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,financing_verified}','false') WHERE id=$1`,[row.id]);
 assert.equal((await w.db.query(SELLER_SQL)).rows[0].n,1);
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,financing_verified}','true') WHERE id=$1`,[row.id]);
 await w.db.query(`UPDATE contracts SET merge_values=jsonb_set(merge_values,'{_blueprint_amount_cents}','3000000') WHERE id=$1`,[saved.contract_id]);
 assert.equal((await w.db.query(SELLER_SQL)).rows[0].n,1);
 await w.db.query(`UPDATE contracts SET merge_values=jsonb_set(merge_values,'{_blueprint_amount_cents}','2900000') WHERE id=$1`,[saved.contract_id]);
 await w.db.query(`UPDATE clients SET custom_fields=custom_fields #- '{blueprint_seller_sale,amount_cents}' WHERE id=$1`,[row.id]);
 assert.equal((await w.db.query(SELLER_SQL)).rows[0].n,1);
}));

test('negotiated29K reaches the actual Whop helper and verified checkout unchanged',OPTIONS,()=>scenario(async w=>{
 const b={...buyer(),amount_cents:2900000};const out=await w.run(b),again=await w.run(b);
 assert.equal(out.amount_cents,2900000);assert.equal(out.handoff_url,again.handoff_url);assert.equal(w.creates,1);
 const checkout=[...w.cache.values()][0];assert.equal(checkout.plan.initial_price,29000);
 const contract=(await w.db.query('SELECT * FROM contracts WHERE id=$1',[out.contract_id])).rows[0];assert.equal(contract.merge_values._blueprint_amount_cents,2900000);
 const order=(await w.db.query('SELECT * FROM payment_links')).rows[0];assert.equal(Number(order.amount_cents),2900000);
}));

test('permanent seller broker traverses the exact sandbox checkout and refuses it in production',OPTIONS,async()=>{
 const w=await world({sandbox:true});try{
  const b={...buyer(),amount_cents:2900000};const out=await w.run(b);
  await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[out.contract_id]);
  const args={id:out.contract_id,sig:new URL(out.handoff_url).searchParams.get('sig')};
  const checkout=await resolveSellerHandoff(w.db,{...args,env:{...env,WHOP_ENV:'sandbox'}});
  assert.match(checkout,/^https:\/\/sandbox\.whop\.com\/checkout\/ch_synthetic1\/$/);
  await assert.rejects(resolveSellerHandoff(w.db,{...args,env}),{code:'not_found'});
  const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
  await w.db.query(`UPDATE payment_links SET checkout_url='https://sandbox.whop.com/checkout/ch_different/' WHERE id=$1`,[saved.payment_link_id]);
  await assert.rejects(resolveSellerHandoff(w.db,{...args,env:{...env,WHOP_ENV:'sandbox'}}),{code:'not_found'});
 }finally{await w.close();}
});

test('actual actor migration installs its checks on the active table despite preexisting public constraint names',OPTIONS,async()=>{
 const w=await world({migratedSchema:true});try{
  const publicChecks=(await w.db.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND conname IN ('contracts_creator_subject_ck','contracts_sender_subject_ck')`)).rows;
  assert.equal(publicChecks.length,2,'the full migrated schema already owns these constraint names');
  const activeChecks=(await w.db.query(`SELECT conname FROM pg_constraint WHERE conrelid='contracts'::regclass AND conname IN ('contracts_creator_subject_ck','contracts_sender_subject_ck')`)).rows;
  assert.equal(activeChecks.length,2,'the temporary active contracts table receives both real migration checks');
  await assert.rejects(w.db.query(`INSERT INTO contracts(org_id,status) VALUES($1,'draft')`,[ORG]),/contracts_creator_subject_ck/);
  await assert.rejects(w.db.query(`INSERT INTO contracts(org_id,status,created_by,created_by_account_id) VALUES($1,'draft',$2,$3)`,[ORG,STAFF,ACCOUNT]),/contracts_creator_subject_ck/);
  const id=(await w.db.query(`INSERT INTO contracts(org_id,status,created_by_account_id) VALUES($1,'draft',$2) RETURNING id`,[ORG,ACCOUNT])).rows[0].id;
  await assert.rejects(w.db.query(`UPDATE contracts SET sent_by=$2,sent_by_account_id=$3 WHERE id=$1`,[id,STAFF,ACCOUNT]),/contracts_sender_subject_ck/);
 }finally{await w.close();}
});

test('daily seller deep check uses the shared SQL, rejects bad price/unverified financing and isolates another company',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b={...buyer(),amount_cents:2900000};await w.run(b);const row=await record(w,b.email),saved=row.custom_fields.blueprint_seller_sale;
 const now=new Date(),cutoff=new Date(now.getTime()-15*60000).toISOString(),params=[ORG,cutoff],otherOrg=randomUUID();
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,created_at}',to_jsonb((now()-interval '16 minutes')::text)) WHERE id=$1`,[row.id]);
 const other={...saved,org_id:otherOrg,client_id:randomUUID(),affiliate_id:randomUUID(),account_id:randomUUID(),contract_id:randomUUID(),payment_link_id:randomUUID(),created_at:new Date(now.getTime()-16*60000).toISOString(),financing_verified:false};
 await w.db.query(`INSERT INTO clients(id,org_id,email,custom_fields) VALUES($1,$2,'other-company@example.test',$3)`,[other.client_id,otherOrg,JSON.stringify({blueprint_seller_sale:other})]);
 assert.equal((await w.db.query(WHOP_SELLER_SQL,params)).rows[0].n,0);
 assert.equal((await w.db.query(WHOP_SELLER_SQL,[otherOrg,cutoff])).rows[0].n,1);
 const daily=()=>gapChecks({db:w.db,orgId:ORG,now});
 assert.equal((await daily()).find(r=>r.id==='payments:whop-seller-handoffs').status,'PASS');
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,financing_verified}','false') WHERE id=$1`,[row.id]);
 assert.equal((await daily()).find(r=>r.id==='payments:whop-seller-handoffs').status,'FAIL');
 await w.db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,financing_verified}','true') WHERE id=$1`,[row.id]);
 await w.db.query(`UPDATE contracts SET merge_values=jsonb_set(merge_values,'{_blueprint_amount_cents}','3000000') WHERE id=$1`,[saved.contract_id]);
 assert.equal((await w.db.query(WHOP_SELLER_SQL,params)).rows[0].n,1);
 assert.equal((await daily()).find(r=>r.id==='payments:whop-seller-handoffs').status,'FAIL');
}));
test('daily paid-access deep check includes the full Blueprint and requires its exact transaction entitlement',OPTIONS,()=>scenario(async w=>{
 w.deps.createCheckout=w.localCheckout;const b={...buyer(),amount_cents:2900000};await w.run(b);const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 const params=[ORG,new Date(Date.now()-5*60000).toISOString()];
 await w.db.query(`UPDATE payment_links SET status='paid',paid_at=now()-interval '10 minutes',whop_payment_id='pay_deep' WHERE id=$1`,[saved.payment_link_id]);
 assert.equal((await w.db.query(WHOP_ACCESS_SQL,params)).rows[0].n,1);
 await w.db.query(`INSERT INTO product_entitlements VALUES($1,'blueprint-self-funding','blueprint-client-fulfillment')`,[ORG]);
 const tx=(await w.db.query(`INSERT INTO transactions(org_id,client_id,provider,provider_ref,status,amount_paid) VALUES($1,$2,'whop','pay_deep','succeeded',29000) RETURNING id`,[ORG,saved.client_id])).rows[0].id;
 assert.equal((await w.db.query(WHOP_ACCESS_SQL,params)).rows[0].n,1);
 await w.db.query(`INSERT INTO entitlements VALUES($1,$2,$3,'blueprint-client-fulfillment')`,[tx,ORG,saved.client_id]);
 assert.equal((await w.db.query(WHOP_ACCESS_SQL,params)).rows[0].n,0);
 const otherOrg=randomUUID(),otherProduct=randomUUID();
 await w.db.query(`INSERT INTO products VALUES($1,$2,'blueprint-self-funding')`,[otherProduct,otherOrg]);
 await w.db.query(`INSERT INTO payment_links(id,org_id,client_id,product_id,provider,status,paid_at) VALUES($1,$2,$3,$4,'whop','paid',now()-interval '10 minutes')`,[randomUUID(),otherOrg,randomUUID(),otherProduct]);
 assert.equal((await w.db.query(WHOP_ACCESS_SQL,params)).rows[0].n,0);
}));
