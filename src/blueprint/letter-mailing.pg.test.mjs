// PostgreSQL proof of migration545 and the real repository. Rollback-only local
// fixture tables; fake provider transports. Never production or a test charge.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createMailingRepository,quoteLetterMailing,confirmLetterMailing,reconcileLetterMailing,fulfilLetterMailing} from './letter-mailing.mjs';
const url=process.env.BLUEPRINT_TEST_DATABASE_URL||process.env.DATABASE_URL||'';
function safe(raw){try{const u=new URL(raw);return ['postgres:','postgresql:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]','::1'].includes(u.hostname)
  &&/^[a-z0-9_-]+$/i.test(u.pathname.slice(1))&&/(?:^|[_-])(test|scratch|ci)(?:$|[_-])/i.test(u.pathname.slice(1))&&!u.search&&!u.hash;}catch{return false;}}
test('mailing PG guard rejects production, foreign hosts and URL overrides',()=>{assert.equal(safe('postgres://127.0.0.1/fundhub_ci'),true);
  for(const s of ['postgres://localhost/production','postgres://db.example.com/fundhub_test','postgres://localhost/fundhub_test?host=production','postgres://localhost/production#_test'])assert.equal(safe(s),false);
});
test('PG migration545: exact scoped quotes, replacement, payment CAS, irreversible envelopes and $97 receipt survive fresh reads',{
  skip:!url?'No local scratch database: PostgreSQL mailing proof NOT RUN':false
},async()=>{
  assert.equal(safe(url),true,'Refused connection: only a named loopback test/scratch/CI URL without overrides is allowed');
  const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});let db;
  try{db=await pool.connect();assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,new URL(url).pathname.slice(1));
    await db.query('BEGIN');await db.query('SET LOCAL search_path TO pg_temp, public');
    await db.query(`CREATE TEMP TABLE orgs(id uuid PRIMARY KEY);
      CREATE TEMP TABLE clients(id uuid PRIMARY KEY,org_id uuid,email text);
      CREATE TEMP TABLE accounts(id uuid PRIMARY KEY,org_id uuid,client_id uuid,kind text,status text);
      CREATE TEMP TABLE documents(id uuid PRIMARY KEY,org_id uuid,client_id uuid,kind text,subtype text,title text,metadata jsonb,generated_at timestamptz,current_version_id uuid,checksum text,expires_at timestamptz);
      CREATE TEMP TABLE document_versions(id uuid PRIMARY KEY,org_id uuid,document_id uuid,storage_key text,checksum text,mime_type text,byte_size bigint);
      CREATE TEMP TABLE transactions(org_id uuid,client_id uuid,provider text,status text,amount_paid numeric,is_demo boolean);
      CREATE TEMP TABLE paid_service_requests (LIKE public.paid_service_requests INCLUDING ALL);`);
    const sql=readFileSync(new URL('../../../db/migrations/545_blueprint_letter_mailing.sql',import.meta.url),'utf8').replaceAll('public.','pg_temp.');
    await db.query(sql);
    const org=randomUUID(),client=randomUUID(),account=randomUUID(),foreign=randomUUID();
    const scope={orgId:org,clientId:client,accountId:account,now:new Date()};
    await db.query('INSERT INTO orgs VALUES($1)',[org]);await db.query('INSERT INTO clients VALUES($1,$2,$3),($4,$2,$5)',[client,org,'fixture@example.test',foreign,'foreign@example.test']);
    await db.query("INSERT INTO accounts VALUES($1,$2,$3,'client','active')",[account,org,client]);
    await db.query("INSERT INTO transactions VALUES($1,$2,'commas','succeeded',5000,false)",[org,client]);
    const bytes=Buffer.from('%PDF-1.7\nfixture mailing bytes'),checksum=`sha256:${createHash('sha256').update(bytes).digest('hex')}`,docs=[];
    for(const [bureau,owner] of [['EX',client],['EQ',client],['TU',foreign]]){const id=randomUUID(),version=randomUUID();docs.push(id);
      await db.query("INSERT INTO documents(id,org_id,client_id,kind,subtype,title,metadata,generated_at,current_version_id,checksum) VALUES($1,$2,$3,'deliverable','funding_personal_info','Fixture letter',$4::jsonb,now(),$5,$6)",[id,org,owner,JSON.stringify({bureau}),version,checksum]);
      await db.query("INSERT INTO document_versions VALUES($1,$2,$3,$4,$5,'application/pdf',$6)",[version,org,id,`fixture-${version}`,checksum,bytes.length]);}
    const counts={charge:0,mail:0,hosted:0};
    const providers={capabilities:()=>({mailSupported:true,hostedCheckoutSupported:true}),savedCards:async()=>[{customerId:'123',methodId:'fixture_saved',label:'Card ending 4242'}],
      hosted:async()=>{counts.hosted++;return {ok:true,checkoutUrl:'https://www.fanbasis.com/fixture',sessionId:'fixture_session',productId:'fixture_product'};},
      charge:async()=>{counts.charge++;return {ok:true,paid:true,amountCents:9700,providerRef:'fixture_charge'};},
      readHosted:async()=>({status:'paid',amountCents:9700,providerRef:'fixture_hosted_receipt'}),sendEnvelope:async()=>{counts.mail++;return {ok:true,providerId:'letter_fixture'};}};
    const deps={providers,loadFrom:async()=>({name:'Fixture Person',line1:'1 Fixture St',line2:null,city:'Phoenix',state:'AZ',postalCode:'85004'}),loadPdf:async()=>bytes,active:async()=>true};
    const rejected=async(work,constraint=null)=>{await db.query('SAVEPOINT expected_refusal');try{await assert.rejects(work,e=>!constraint||e.constraint===constraint);}finally{await db.query('ROLLBACK TO SAVEPOINT expected_refusal');}};
    const q=await quoteLetterMailing(db,scope,{documentIds:[docs[0]]},deps);
    const replacement=await quoteLetterMailing(db,scope,{documentIds:[docs[1]]},deps);
    assert.notEqual(q.id,replacement.id);assert.equal((await db.query('SELECT status FROM paid_service_requests WHERE id=$1',[q.id])).rows[0].status,'cancelled');
    const confirm=q=>confirmLetterMailing(db,scope,{orderId:q.id,quoteVersion:q.quoteVersion,paymentOptionId:'hosted_checkout',authorization:true,idempotencyKey:'fixture_confirm_key_123'},deps);
    await assert.rejects(confirm(q),{code:'quote_changed'});assert.equal(counts.charge+counts.hosted,0);
    await assert.rejects(quoteLetterMailing(db,scope,{documentIds:[docs[2]]},deps),{code:'letter_not_available'});
    await rejected(()=>db.query("UPDATE paid_service_requests SET status='awaiting_payment' WHERE id=$1",[replacement.id]),'paid_service_requests_awaiting_needs_expiry_ck');
    const first=await confirm(replacement);assert.equal(first.status,'awaiting_payment');await confirm(replacement);assert.equal(counts.hosted,1);assert.ok((await db.query('SELECT checkout_expires_at FROM paid_service_requests WHERE id=$1',[replacement.id])).rows[0].checkout_expires_at);
    await reconcileLetterMailing(db,scope,replacement.id,deps);assert.equal(counts.mail,0);
    const order=await createMailingRepository(db).get(scope,replacement.id);assert.equal(order.payment_state,'paid');assert.equal(order.price_total_cents,9700);
    await rejected(()=>db.query("UPDATE paid_service_requests SET status='fulfilled',resolved_at=now() WHERE id=$1",[order.id]),'paid_service_requests_fulfilled_ck');
    await rejected(()=>db.query("UPDATE blueprint_letter_mailing_orders SET snapshot='{}' WHERE id=$1",[order.id]));
    await rejected(()=>db.query('UPDATE blueprint_letter_mailing_orders SET client_id=$2 WHERE id=$1',[order.id,foreign]));
    await rejected(()=>db.query('UPDATE blueprint_letter_mailing_envelopes SET document_id=$2 WHERE order_id=$1',[order.id,docs[2]]));
    const repo=createMailingRepository(db),eid=order.envelopes[0].id;
    const claims=await Promise.all([repo.claim(scope,order.id,eid),repo.claim(scope,order.id,eid)]);assert.equal(claims.filter(Boolean).length,1);
    const claim=claims.find(Boolean);await repo.accepted(scope,order.id,claim,'letter_fixture');await repo.complete(scope,order.id);
    assert.equal((await repo.get(scope,order.id)).state,'mailed');
    await rejected(()=>db.query("UPDATE blueprint_letter_mailing_envelopes SET state='ready',claim_token=NULL,claimed_at=NULL WHERE id=$1",[eid]));
    const ledger=(await db.query('SELECT status,price_total_cents,amount_paid_cents,payment_ref,produced_kind,produced_ref,produced FROM paid_service_requests WHERE id=$1',[order.id])).rows[0];
    assert.equal(ledger.status,'fulfilled');assert.equal(ledger.produced_kind,'letter_mailing_batch');assert.equal(ledger.produced_ref,order.id);assert.equal(ledger.price_total_cents,9700);assert.equal(ledger.amount_paid_cents,9700);assert.equal(ledger.produced.mailed,true);
    assert.equal(await repo.get({...scope,clientId:foreign},order.id),null);
    assert.equal((await fulfilLetterMailing(db,scope,order.id,deps)).status,'mailed');assert.equal(counts.mail,0,'accepted receipt never resends on reload');
    const rls=(await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname IN ('blueprint_letter_mailing_orders','blueprint_letter_mailing_envelopes') AND relrowsecurity AND relforcerowsecurity")).rows[0].n;
    assert.equal(rls,2,'both new tables have forced RLS');
  }finally{if(db){try{await db.query('ROLLBACK');}finally{db.release();}}await pool.end();}
});
