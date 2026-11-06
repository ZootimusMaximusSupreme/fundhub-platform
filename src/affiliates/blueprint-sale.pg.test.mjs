// Real PostgreSQL semantics, isolated temporary tables. The normal app database
// URL is ignored locally; CI accepts only its guarded loopback scratch URL.
// An explicit scratch URL or PGlite module also works. No real buyer/provider is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
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
async function world(){
 const db=PG_MODULE?new (await import(PG_MODULE)).PGlite():new pg.Client({connectionString:SCRATCH});
 if(!PG_MODULE)await db.connect();
 await (PG_MODULE ? db.exec.bind(db) : db.query.bind(db))(`CREATE TEMP TABLE clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid,email text,first_name text,last_name text,phone text,ghl_contact_id text,channel_source text,is_demo boolean DEFAULT false,custom_fields jsonb DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX ON clients(org_id,lower(email)) WHERE email IS NOT NULL;
 CREATE TEMP TABLE affiliates(id uuid PRIMARY KEY,org_id uuid,name text,status text,tracking_id text,recruited_by uuid);
 CREATE TEMP TABLE accounts(id uuid PRIMARY KEY,org_id uuid,email text,kind text,status text,affiliate_id uuid,client_id uuid);
 CREATE TEMP TABLE staff(id uuid PRIMARY KEY,org_id uuid,email text,role text,status text,is_demo boolean DEFAULT false);
 CREATE TEMP TABLE affiliate_referrals(id uuid DEFAULT gen_random_uuid(),org_id uuid,affiliate_id uuid,client_id uuid,tier text,tracking_id_used text,attributed_at timestamptz,source text,source_event text,detail jsonb,status text,commission_due numeric,UNIQUE(client_id,tier));
 CREATE TEMP TABLE contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid,client_id uuid,template_key text,status text,created_by uuid,sent_by uuid,created_at timestamptz DEFAULT now(),merge_values jsonb,rendered_body text,body_sha text);
 CREATE TEMP TABLE products(id uuid PRIMARY KEY,org_id uuid,code text);
 CREATE TEMP TABLE sales(id uuid,org_id uuid,client_id uuid,product_id uuid,status text,sale_motion text,sold_at timestamptz);
 CREATE TEMP TABLE sale_attributions(sale_id uuid,staff_id uuid,role text,attributed_at timestamptz);
 CREATE TEMP TABLE call_outcomes(org_id uuid,client_id uuid,staff_id uuid,logged_at timestamptz);
 CREATE TEMP TABLE payment_links(id uuid PRIMARY KEY,org_id uuid,client_id uuid,purpose text,description text,amount_cents bigint,currency text,link_ref text,checkout_url text,provider text,product_id uuid,sale_id uuid,sale_motion text,created_by_staff_id uuid,closer_staff_id uuid,sales_manager_staff_id uuid,status text DEFAULT 'created',created_at timestamptz DEFAULT now(),whop_checkout_configuration_id text,whop_plan_id text,whop_payment_id text);
 CREATE TEMP TABLE transactions(id uuid DEFAULT gen_random_uuid(),org_id uuid,client_id uuid,provider text,provider_ref text,status text);
 CREATE TEMP TABLE entitlements(source_transaction_id uuid,org_id uuid,client_id uuid,entitlement_code text);`);
 await db.query(`INSERT INTO affiliates VALUES ($1,$2,'Synthetic seller','active','AFF-SYNTHETIC',NULL)`,[AFF,ORG]);
 await db.query(`INSERT INTO accounts VALUES ($1,$2,'seller@example.test','affiliate','active',$3,NULL)`,[ACCOUNT,ORG,AFF]);
 await db.query(`INSERT INTO products VALUES ($1,$2,'blueprint-self-funding')`,[PRODUCT,ORG]);
 const cache=new Map(); let posts=0,creates=0,failAfterCreate=false,financing=true,configuration=null;
 const send=async(url,init={})=>{
  let out;
  if(init.method==='POST'){
   posts++; const key=init.headers['Idempotency-Key']; const body=JSON.parse(init.body);
   assert.deepEqual(body.payment_method_configuration,{enabled:['claritypay'],disabled:[],include_platform_defaults:true});
   if(!cache.has(key)){
    creates++; out={id:'ch_synthetic'+creates,account_id:'biz_synthetic',mode:'payment',metadata:body.metadata,plan:{id:'plan_synthetic'+creates,...body.plan},purchase_url:`https://whop.com/checkout/ch_synthetic${creates}/`,payment_method_configuration:configuration?configuration.selected:body.payment_method_configuration,effective_payment_method_configuration:configuration?configuration.effective:{enabled:financing?['claritypay']:[],disabled:[]}};
    cache.set(key,out);
   }else out=cache.get(key);
   if(failAfterCreate){failAfterCreate=false;throw Error('synthetic lost provider response');}
  }else if(String(url).includes('/variants/')){
   const checkout=[...cache.values()].find(c=>String(url).endsWith(c.plan.id));
   out={id:checkout.plan.id,account:{id:'biz_synthetic'},product:{id:'prod_synthetic'},currency:'usd',plan_type:'one_time',title:'Consulting Services Package',initial_price:30000};
  }else out=[...cache.values()].find(c=>String(url).endsWith(c.id));
  return new Response(JSON.stringify(out),{headers:{'content-type':'application/json'}});
 };
 const deps={getContract:async(db,{orgId,id})=>(await db.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2',[id,orgId])).rows[0],fetchImpl:send};
 const run=(body,over={})=>createSellerSale(db,{principal,body,env,deps,...over});
 const agreement=async(email,{status='sent',amount=3000000}={})=>{
  const client=(await db.query('SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2',[ORG,email])).rows[0];
  const rendered=`Full Blueprint service agreement: $${(amount/100).toLocaleString('en-US')}.`;
  return (await db.query(`INSERT INTO contracts(org_id,client_id,template_key,status,created_by,sent_by,merge_values,rendered_body,body_sha) VALUES($1,$2,'BLUEPRINT-SELF-FUNDING-AGREEMENT',$3,$4,$4,$5,$6,$7) RETURNING id`,[ORG,client.id,status,STAFF,JSON.stringify({package_fee:`$${(amount/100).toLocaleString('en-US')}`,_blueprint_amount_cents:amount}),rendered,'sha256:'+createHash('sha256').update(rendered).digest('hex')])).rows[0].id;
 };
 return {db,run,agreement,deps,cache,get posts(){return posts;},get creates(){return creates;},loseResponse(){failAfterCreate=true;},denyFinancing(){financing=false;},malformedConfig(value){configuration=value;},close:()=>PG_MODULE?db.close():db.end()};
}
async function scenario(run){const w=await world();try{await run(w);}finally{await w.close();}}
const record=async(w,email)=>(await w.db.query('SELECT id,custom_fields FROM clients WHERE lower(email)=$1',[email])).rows[0];
test('capability is restricted to explicit affiliate account and valid allowlist',()=>{
 const a={id:AFF,status:'active'};assert.equal(sellerCapability(principal,a,env).enabled,true);
 for(const p of [{...principal,kind:'staff'},{...principal,kind:'client'},{...principal,affiliateId:randomUUID()}])assert.equal(sellerCapability(p,a,env).enabled,false);
 assert.equal(sellerCapability(principal,a,{...env,BLUEPRINT_AFFILIATE_SELLER_IDS:AFF+',bad'}).enabled,false);
 assert.throws(()=>parseSellerBuyer({...buyer(),client_id:randomUUID()}),/Send only/);
});
test('seller creates one native buyer/sticky referral and honestly waits for a real agreement',OPTIONS,()=>scenario(async w=>{
 const b=buyer(); const a=await w.run(b),again=await w.run(b);
 assert.equal(a.stage,'needs_contract');assert.equal(a.handoff_url,null);assert.equal(a.contract_id,null);assert.deepEqual(again,a);assert.equal(w.posts,0);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM affiliate_referrals WHERE commission_due IS NULL')).rows[0].n,1);
 assert.equal((await w.db.query('SELECT count(*)::int n FROM contracts')).rows[0].n,0);
}));
test('wrong role, disabled seller and foreign org cannot create a buyer',OPTIONS,()=>scenario(async w=>{
 for(const p of [{...principal,kind:'client'},{...principal,orgId:randomUUID()}])await assert.rejects(w.run(buyer(),{principal:p}),{code:'seller_disabled'});
 await assert.rejects(w.run(buyer(),{env:{...env,BLUEPRINT_AFFILIATE_SELLER_IDS:''}}),{code:'seller_disabled'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,0);
}));
test('incompatible account and employee emails are refused before intake',OPTIONS,()=>scenario(async w=>{
 for(const email of ['seller@example.test','staff@example.test']){
  if(email.startsWith('staff'))await w.db.query(`INSERT INTO staff VALUES($1,$2,$3,'closer','active',false)`,[STAFF,ORG,email]);
  await assert.rejects(w.run({...buyer(),email}),{code:'buyer_login_conflict'});
 }
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,0);
}));
test('existing another-affiliate first touch is never overwritten',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);const c=await record(w,b.email);const other=randomUUID();
 await w.db.query('UPDATE affiliate_referrals SET affiliate_id=$1 WHERE client_id=$2',[other,c.id]);
 await assert.rejects(w.run(b),{code:'buyer_already_attributed'});assert.equal(w.posts,0);
 assert.equal((await w.db.query('SELECT affiliate_id FROM affiliate_referrals')).rows[0].affiliate_id,other);
}));
test('exact staff-issued agreement enables one explicit ClarityPay checkout and stable permanent handoff',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);const id=await w.agreement(b.email);const one=await w.run(b),two=await w.run({...b,request_id:randomUUID()});
 assert.equal(one.contract_id,id);assert.equal(one.stage,'awaiting_signature');assert.equal(one.handoff_url,two.handoff_url);assert.equal(w.creates,1);assert.equal(w.posts,1);
 const url=new URL(one.handoff_url);assert.equal(url.pathname,'/api/public/blueprint-handoff');assert.equal(url.searchParams.get('id'),id);assert.match(url.searchParams.get('sig'),/^[0-9a-f]{64}$/);
 const later=await resolveSellerHandoff(w.db,{id,sig:url.searchParams.get('sig'),env,now:()=>Date.parse('2040-01-01')});
 assert.equal(new URL(later).pathname,'/contract.html');assert.equal(new URL(later).searchParams.get('return_to'),url.pathname+url.search);
 await assert.rejects(resolveSellerHandoff(w.db,{id,sig:'0'.repeat(64),env}),{code:'not_found'});
 const calls=w.posts;await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[id]);
 assert.match(await resolveSellerHandoff(w.db,{id,sig:url.searchParams.get('sig'),env}),/^https:\/\/whop.com\/checkout\//);assert.equal(w.posts,calls);
}));
test('lost provider response resumes the exact saved order and original provider idempotency key',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);await w.agreement(b.email);w.loseResponse();await assert.rejects(w.run(b));
 const reserved=(await record(w,b.email)).custom_fields.blueprint_seller_sale.payment_link_id;
 const done=await w.run(b);assert.ok(done.handoff_url);assert.equal(w.creates,1);assert.equal(w.posts,2);
 const links=(await w.db.query('SELECT id FROM payment_links')).rows;assert.deepEqual(links.map(x=>x.id),[reserved]);
}));
test('unrelated same-buyer order is never adopted by the pinned sale',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);const c=await record(w,b.email);await w.agreement(b.email);const unrelated=randomUUID();
 await w.db.query(`INSERT INTO payment_links(id,org_id,client_id,product_id,provider,amount_cents,currency,checkout_url,status) VALUES($1,$2,$3,$4,'whop',3000000,'USD','https://whop.com/checkout/ch_unrelated/','paid')`,[unrelated,ORG,c.id,PRODUCT]);
 const done=await w.run(b);assert.equal(done.stage,'awaiting_signature');assert.equal(w.creates,1);
 assert.notEqual((await record(w,b.email)).custom_fields.blueprint_seller_sale.payment_link_id,unrelated);
}));
test('missing effective financing confirmation fails closed without exposing a buyer handoff',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);await w.agreement(b.email);w.denyFinancing();await assert.rejects(w.run(b),/required financing method/);
 const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;assert.notEqual(saved.financing_verified,true);
 await assert.rejects(resolveSellerHandoff(w.db,{id:saved.contract_id,sig:new URL(handoffUrl(saved,env)).searchParams.get('sig'),env}),{code:'not_found'});
}));
test('wrong price and a newer agreement cannot authorize another pinned checkout',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);await w.agreement(b.email,{amount:2500000});await assert.rejects(w.run(b),{code:'blueprint_agreement_price_mismatch'});assert.equal(w.posts,0);
 const id=await w.agreement(b.email);const done=await w.run(b);await w.agreement(b.email,{status:'draft'});
 await assert.rejects(w.run(b));await w.db.query(`UPDATE contracts SET status='signed' WHERE id=$1`,[id]);
 await assert.rejects(resolveSellerHandoff(w.db,{id,sig:new URL(done.handoff_url).searchParams.get('sig'),env}));
 assert.equal(w.creates,1);
}));
test('paid flag alone grants no portal redirect; exact matched payment and full entitlement are required',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);await w.agreement(b.email);const done=await w.run(b);const saved=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 await w.db.query(`UPDATE payment_links SET status='paid',whop_payment_id='pay_synthetic' WHERE id=$1`,[saved.payment_link_id]);
 const args={id:saved.contract_id,sig:new URL(done.handoff_url).searchParams.get('sig'),env};
 await assert.rejects(resolveSellerHandoff(w.db,args),{code:'payment_processing'});
 const tx=(await w.db.query(`INSERT INTO transactions(org_id,client_id,provider,provider_ref,status) VALUES($1,$2,'whop','pay_synthetic','succeeded') RETURNING id`,[ORG,saved.client_id])).rows[0].id;
 await w.db.query(`INSERT INTO entitlements VALUES($1,$2,$3,'blueprint-client-fulfillment')`,[tx,ORG,saved.client_id]);
 assert.equal(await resolveSellerHandoff(w.db,args),'https://fundhub.ai/portal-login.html');
 const order=(await w.db.query(`SELECT l.*,p.code AS product_code FROM payment_links l JOIN products p ON p.id=l.product_id WHERE l.id=$1`,[saved.payment_link_id])).rows[0];
 const payment={id:'pay_synthetic',account_id:'biz_synthetic',checkout_configuration_id:order.whop_checkout_configuration_id,plan_id:order.whop_plan_id,product_id:'prod_synthetic',currency:'usd',metadata:whopBlueprintMetadata(order),line_items:[{quantity:1,plan_id:order.whop_plan_id,product_id:'prod_synthetic'}],total:{amount:'30000.00',currency:'usd',decimals:2}};
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
 const made=response();await sellerHandler({method:'POST',body:buyer(),headers},made,{db:authDb('affiliate'),connect:async()=>({...w.db,query:(...a)=>w.db.query(...a),release(){}}),env,services:w.deps});assert.equal(made.statusCode,200);assert.equal(made.body.sale.stage,'needs_contract');
}));

test('request UUID and canonical buyer details cannot be reused for a different buyer',OPTIONS,()=>scenario(async w=>{
 const a=buyer();await w.run(a);
 await assert.rejects(w.run({...buyer(),request_id:a.request_id}),{code:'request_conflict'});
 await assert.rejects(w.run({...a,phone:'+12025550124'}),{code:'request_conflict'});
 await assert.rejects(w.run({...a,first_name:'Different',request_id:randomUUID()}),{code:'request_conflict'});
 assert.equal((await w.db.query('SELECT count(*)::int n FROM clients')).rows[0].n,1);
 assert.equal(w.posts,0);
}));

test('accepted request aliases stay bound to their original buyer',OPTIONS,()=>scenario(async w=>{
 const a=buyer();await w.run(a);const alias=randomUUID();await w.run({...a,request_id:alias});
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
  const b=buyer();await w.run(b);await w.agreement(b.email);w.malformedConfig(configuration);
  await assert.rejects(w.run(b),/required financing method/);
  assert.notEqual((await record(w,b.email)).custom_fields.blueprint_seller_sale.financing_verified,true);
 }
}));


test('provider completion preserves aliases committed by another retry while it waited',OPTIONS,()=>scenario(async w=>{
 const b=buyer();await w.run(b);await w.agreement(b.email);
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
 const b=buyer();await w.run(b);await w.agreement(b.email);const replacement=randomUUID();
 w.deps.createCheckout=async(db,args)=>{
  await db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{blueprint_seller_sale,payment_link_id}',to_jsonb($1::text)) WHERE org_id=$2 AND id=$3`,
   [replacement,ORG,args.clientId]);
  return {id:args.reservationId};
 };
 await assert.rejects(w.run(b),{code:'sale_changed'});
 const after=(await record(w,b.email)).custom_fields.blueprint_seller_sale;
 assert.equal(after.payment_link_id,replacement);assert.notEqual(after.financing_verified,true);
}));
