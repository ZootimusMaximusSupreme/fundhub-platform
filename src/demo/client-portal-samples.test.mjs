import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clientSampleAccount,installClientSamples} from './client-portal-samples.mjs';
import bundle from './client-portal-sample-bundle.json' with {type:'json'};
const p={kind:'client',accountId:'a',clientId:'c',orgId:'o',email:'client@fundhub.ai'};
const row={account_id:'a',client_id:'c',org_id:'o',client_org_id:'o',email:'client@fundhub.ai',kind:'client',status:'active',client_master_key:'FDH-TEST-CLIENT-ROLE-ACCOUNT'};
const db=(r=row)=>({query:async(sql,params)=>{assert.match(sql,/JOIN clients/);assert.deepEqual(params,['a','o','c']);return {rows:r?[r]:[]};}});
const response=()=>({code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},json(v){this.body=v;return this;}});
test('only exact active joined role account can get samples',async()=>{
  assert.equal(await clientSampleAccount(db(),p),true);
  for(const patch of [{kind:'staff'},{kind:'affiliate'},{authorizedRep:true},{email:'chris@fundhub.ai'},{email:'ordinary@example.test'},{accountId:null},{orgId:null},{clientId:null}])assert.equal(await clientSampleAccount({query(){throw Error('must not query');}},{...p,...patch}),false);
  for(const patch of [{account_id:'other'},{org_id:'other'},{client_org_id:'other'},{client_id:'other'},{kind:'staff'},{status:'disabled'},{email:'other@example.test'},{client_master_key:'other'}])assert.equal(await clientSampleAccount(db({...row,...patch}),p),false);
  assert.equal(await clientSampleAccount(db(null),p),false);
  assert.equal(await clientSampleAccount({query:async()=>{throw Error('offline');}},p),null);
});
test('successful reads decorated; errors and real account view stay original',async()=>{
  const data={notice:'Sample',reads:{'/api/money/overview':{ok:true,value:17}}};
  for(const [code,body,expected] of [[200,{ok:true,value:1},17],[500,{ok:true,value:1},1],[200,{ok:false,value:1},1]]){const res=response();await installClientSamples({method:'GET',url:'/api/money/overview',headers:{}},res,p,db(),{data});res.status(code).json(body);assert.equal(res.body.value,expected);}
  const res=response();await installClientSamples({method:'GET',url:'/api/money/overview',headers:{cookie:'other=1; fh_portal_data=real'}},res,p,db(),{data});res.json({ok:true,value:2});assert.equal(res.body.value,2);
});
test('sample money, banking, upload, signature and booking mutations refused; referral stays real',async()=>{
  for(const path of ['/api/money/accounts','/api/banking/link-token','/api/banking/link-exchange','/api/documents-upload','/api/consent/capture','/api/bookings','/api/chat/send']){const res=response();assert.equal(await installClientSamples({method:'POST',url:path,headers:{}},res,p,db()),false);assert.equal(res.code,409);assert.equal(res.body.ok,false);}
  for(const path of ['/api/affiliates/refer','/api/money/accounts']){const res=response();assert.equal(await installClientSamples({method:'POST',url:path,headers:{cookie:'fh_portal_data=real'}},res,p,db()),true);assert.equal(res.body,undefined);}
  const res=response();assert.equal(await installClientSamples({method:'POST',url:'/api/affiliates/refer',headers:{}},res,p,db()),true);
});
test('real referral state survives sample progress decoration',async()=>{const res=response();await installClientSamples({method:'GET',url:'/api/read/client-progress',headers:{}},res,p,db(),{data:{reads:{'/api/read/client-progress':{ok:true}}}});res.json({ok:true,referral:{enrolled:true,shareUrl:'own-real-url'}});assert.deepEqual(res.body.referral,{enrolled:true,shareUrl:'own-real-url'});});
test('unknown sample identity fails closed before any mutation',async()=>{const res=response();assert.equal(await installClientSamples({method:'POST',url:'/api/documents-upload',headers:{}},res,p,{query:async()=>{throw Error('offline');}}),false);assert.equal(res.code,503);assert.equal(res.body.ok,false);});
test('canonical bundle agrees across Home, progress, accounts and FinanceOS',()=>{
  const r=bundle.reads,home=r['/api/read/portal-summary'],credit=r['/api/money/credit'],overview=r['/api/money/overview'];
  assert.equal(Object.keys(r).length,20);
  for(const bureau of ['experian','equifax','transunion'])assert.equal(home.scores[bureau],credit.personal[bureau].score);
  const visa=overview.accounts.find(a=>a.name==='Personal Visa');
  assert.equal(visa.current_cents,credit.accounts.list.find(a=>a.open&&a.kind==='revolving').balance_cents);
  assert.equal(overview.debt.total_cents,overview.debt.by_kind.personal+overview.debt.by_kind.business);
  assert.equal(home.prequal_amount,bundle.engine.funding_estimate);
  assert.equal(overview.cash.personal.cents,bundle.facts.accounts.find(a=>a.name==='Personal Checking').currentCents);
  assert.equal(JSON.stringify(bundle).includes('Bearer '),false);
  assert.doesNotMatch(JSON.stringify(bundle),/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
