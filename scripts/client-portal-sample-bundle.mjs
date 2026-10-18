// Generate one internally consistent, engine-derived portal story in disposable CI.
// Never runs against a live database; no provider call, event, email or payment.
import { db, close } from '../src/db.mjs';
import { resolveDefaultOrg } from '../src/auth/org.mjs';
import { createAccount, createAccountSession } from '../src/auth/account-session.mjs';
import { planMixedSandboxUser } from '../src/banking/plaid-sandbox-user.mjs';
import { buildSampleCreditFile, withEngineResult, countFields, SAMPLE_PROVIDER, sampleProviderResultId } from '../src/finance/sample-credit-file.mjs';
import { ingestCrsResult } from '../src/tradelines/store.mjs';
import { ingestCrsLiabilities } from '../src/liabilities/store.mjs';
import { mergeCustomFields } from '../src/workflows/custom-fields.mjs';
import { saveStatementCycle } from '../src/banking/accounts.mjs';
import { writeFileSync } from 'node:fs';

const target = new URL(process.env.DATABASE_URL || 'postgres://invalid');
if (process.env.CI !== 'true' || !['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/fundhub_portal_ci') throw new Error('Disposable portal CI database required');
const now = new Date('2026-10-17T12:00:00Z');
try {
  const orgId = await resolveDefaultOrg(db);
  const clientId = (await db.query(`INSERT INTO clients (org_id,first_name,last_name,email,client_master_key)
    VALUES ($1,'Portal','Sample','portal-sample@example.test','PORTAL-CI-SAMPLE-BUNDLE') RETURNING id`,[orgId])).rows[0].id;
  const account = await createAccount(db,{orgId,kind:'client',email:'portal-sample@example.test',name:'Portal Sample',clientId,password:'CI-only-Sample-2026!'});
  const accountId = account.id || account.account?.id;
  if (!accountId) throw new Error('No scratch account ID');
  const token = (await createAccountSession(db,{accountId,orgId})).token;
  const {config,facts} = planMixedSandboxUser({today:now});
  const entities = {};
  for (const kind of ['personal','business']) entities[kind]=(await db.query(`INSERT INTO entities (org_id,client_id,kind,name) VALUES ($1,$2,$3,$4) RETURNING id`,[orgId,clientId,kind,kind==='personal'?'Portal Sample (personal)':'Sample Consulting LLC'])).rows[0].id;
  for (const [i,f] of facts.accounts.entries()) {
    const kind=f.name.startsWith('Business')?'business':'personal';
    const bankId=(await db.query(`INSERT INTO bank_accounts (org_id,client_id,name,mask,account_type,account_subtype,entity_kind,entity_kind_source,entity_kind_set_at,entity_id,currency_code,current_balance_cents,credit_limit_cents,balance_as_of)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'staff_reviewed',now(),$8,'USD',$9,$10,$11) RETURNING id`,[orgId,clientId,f.name,f.mask,f.type,f.type==='credit'?'credit card':'checking',kind,entities[kind],f.currentCents,f.limitCents??null,now])).rows[0].id;
    if(f.type==='credit') await saveStatementCycle(db,{statement_close_day:f.statementDay,payment_due_day:f.paymentDay,last_statement_date:f.lastStatement.date,last_statement_balance_cents:f.lastStatement.balanceCents,minimum_payment_cents:f.minimumPaymentCents,apr:f.purchaseApr,raw:{next_payment_due_date:`2026-11-${String(f.paymentDay).padStart(2,'0')}`,last_payment_date:f.lastPayment.date,last_payment_amount_cents:f.lastPayment.amountCents}},{orgId,clientId,bankAccountId:bankId});
    for(const [j,t] of config.override_accounts[i].transactions.entries()) await db.query(`INSERT INTO bank_transactions (org_id,client_id,bank_account_id,amount_cents,posted_on,merchant_name,is_pending,provider_transaction_id,provider)
      VALUES ($1,$2,$3,$4,$5,$6,false,$7,'manual')`,[orgId,clientId,bankId,-Math.round(t.amount*100),t.date_posted,t.description,`portal-sample-${i}-${j}`]);
  }
  const f=facts.accounts.find(a=>a.name==='Personal Visa');
  const built=buildSampleCreditFile({pulledAt:now.toISOString(),person:{first:'Portal',last:'Sample'},visa:{mask:f.mask,balanceCents:f.currentCents,limitCents:f.limitCents,aprPct:f.purchaseApr,minimumPaymentCents:f.minimumPaymentCents,highBalanceCents:f.maxEodCents,lastActivityOn:f.lastPostedOn}});
  const scored=withEngineResult(built.payload,{submittedName:'Portal Sample',email:'portal-sample@example.test'});
  const crs=(await db.query(`INSERT INTO crs_results (org_id,client_id,result,outcome_tier,provider,provider_result_id) VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`,[orgId,clientId,JSON.stringify(scored.payload),scored.outcomeTier,SAMPLE_PROVIDER,sampleProviderResultId()])).rows[0];
  await ingestCrsResult(db,crs); await ingestCrsLiabilities(db,crs); await mergeCustomFields(db,clientId,countFields(built.counts));
  const bundle={version:1,as_of:now.toISOString(),notice:'Sample view — fictional data. No credit bureau or bank was contacted.',facts,engine:{tier:scored.outcomeTier,funding_estimate:scored.fundingEstimate},reads:{}};
  for(const path of ['read/portal-summary','read/client-progress','read/entitlements',...['overview','accounts','alerts','banks','connections','credit','fundability','helper','payments','plan','ready-to-fund','setup','strategy','tasks','transfers','trends','vault'].map(p=>'money/'+p)]) {
    const {default:handler}=await import('../api/'+path+'.mjs');
    let status=200,body;
    const res={status(n){status=n;return this;},setHeader(){return this;},json(d){body=d;return this;},end(d){body=d;return this;}};
    await handler({method:'GET',url:'/api/'+path,headers:{authorization:'Bearer '+token},query:{}},res,{now:()=>now});
    if(status!==200||body?.ok!==true) throw new Error(path+' failed '+status+' '+JSON.stringify(body));
    bundle.reads['/api/'+path]=body;
  }
  // Synthetic IDs can never address a real row, even if a sample page is copied.
  const ids=new Map();let n=0;
  function scrub(v,k='') {
    if(Array.isArray(v))return v.map(x=>scrub(x,k));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([key])=>!['shareUrl','share_url','checkout_url','payment_url','approve_url'].includes(key)).map(([key,x])=>[key,scrub(x,key)]));
    if(typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)){if(!ids.has(v))ids.set(v,'sample-'+(++n));return ids.get(v);}
    return v;
  }
  const safe=scrub(bundle);
  // Referral is always read from the real account, never a fabricated enrollment.
  if(safe.reads['/api/read/client-progress'])delete safe.reads['/api/read/client-progress'].referral;
  writeFileSync('/tmp/client-portal-sample-bundle.json',JSON.stringify(safe,null,2)+'\n');
  console.log('PORTAL_SAMPLE_BUNDLE_BASE64:'+Buffer.from(JSON.stringify(safe)).toString('base64'));
} finally {await close();}
