// Real app-role SQL and actual native handler/auth; every synthetic row rolls back.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import handler from '../../api/push/native-device.mjs';
import {db} from '../db.mjs';
import {createSession} from '../auth/session.mjs';
import {createAccountSession} from '../auth/account-session.mjs';
import {decryptField} from '../push/store.mjs';

const ROLES=['owner','admin','sales_manager','setter','closer','outbound_rep','inquiry_specialist','funding_advisor','csm'];
const dsn=process.env.APP_DATABASE_URL||process.env.DATABASE_URL;
const options={skip:!dsn&&'scratch app-role database URL not set'};
function response(){return{statusCode:null,headers:{},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},setHeader(k,v){this.headers[k]=v;}};}
async function fixture(run){
 const url=new URL(dsn);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 assert.ok((url.port==='55432'&&url.pathname==='/fundhub_test_fix')||
   (url.port==='5432'&&url.pathname==='/fundhub_ci'),'Only the isolated scratch or existing CI database is permitted');
 assert.equal(url.username,'fundhub_app');
 const sql=new pg.Client({connectionString:dsn});await sql.connect();
 const oldQuery=db.query;const previous=new Map();const queries=[];
 const key=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
 const env={PUSH_SUB_ENC_KEY:crypto.randomBytes(32).toString('base64'),APNS_KEY_ID:'TESTKEY001',APNS_TEAM_ID:'TESTTEAM01',APNS_PRIVATE_KEY_BASE64:Buffer.from(key.export({type:'pkcs8',format:'pem'})).toString('base64')};
 for(const[k,v]of Object.entries(env)){previous.set(k,process.env[k]);process.env[k]=v;}
 const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('No outbound network permitted in native registration proof');};
 try{
  await sql.query('BEGIN'); assert.equal((await sql.query('select current_user')).rows[0].current_user,'fundhub_app');
  db.query=async(text,params)=>{queries.push({text,params});return sql.query(text,params);};
  const org=(await sql.query("INSERT INTO orgs(slug,name)VALUES($1,'Native proof')RETURNING id",['native-'+crypto.randomUUID()])).rows[0].id;
  const foreignOrg=(await sql.query("INSERT INTO orgs(slug,name)VALUES($1,'Foreign native proof')RETURNING id",['native-'+crypto.randomUUID()])).rows[0].id;
  async function staff(role,tenant=org,status='active'){
   const id=(await sql.query("INSERT INTO staff(org_id,name,email,role,status)VALUES($1,'Native proof',$2,$3,$4)RETURNING id",[tenant,crypto.randomUUID()+'@example.test',role,status])).rows[0].id;
   return{id,org:tenant,...await createSession(sql,{orgId:tenant,staffId:id})};
  }
  async function account(kind='client'){
   const clientId=(await sql.query("INSERT INTO clients(org_id,email,first_name,last_name)VALUES($1,$2,'Native','Proof')RETURNING id",[org,crypto.randomUUID()+'@example.test'])).rows[0].id;
   const id=(await sql.query("INSERT INTO accounts(org_id,kind,email,name,status,client_id,password_hash)VALUES($1,'client',$2,'Native proof','active',$3,'scrypt$fixture')RETURNING id",[org,crypto.randomUUID()+'@example.test',clientId])).rows[0].id;
   if(kind==='partner'){
    // A non-employee principal uses its real supported account kind and FK.
    const partner=(await sql.query("INSERT INTO partners(org_id,name,slug)VALUES($1,'Native proof',$2)RETURNING id",[org,'native-'+crypto.randomUUID()])).rows[0].id;
    await sql.query("UPDATE accounts SET kind='partner',client_id=NULL,partner_id=$2 WHERE id=$1",[id,partner]);
   }
   return{id,clientId,...await createAccountSession(sql,{orgId:org,accountId:id})};
  }
  async function call(actor,method,{installation=crypto.randomUUID(),token='ab'.repeat(32),body={},query={}}={}){
   const res=response();await handler({method,url:'/api/push/native-device',headers:{authorization:'Bearer '+actor.token},query:{installation_id:installation,...query},body:{installation_id:installation,token,environment:'development',...body}},res);
   return res;
  }
  await run({sql,org,foreignOrg,staff,account,call,env,queries});
 }finally{db.query=oldQuery;globalThis.fetch=oldFetch;for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}await sql.query('ROLLBACK');await sql.end();}
}

test('real native handler: nine primary roles bind POST/GET/DELETE to their own live session, ciphertext only',options,()=>fixture(async f=>{
 for(const role of ROLES){
  const actor=await f.staff(role),installation=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');
  const forged={org_id:f.foreignOrg,staff_id:crypto.randomUUID(),client_id:crypto.randomUUID(),session_id:crypto.randomUUID()};
  const put=await f.call(actor,'POST',{installation,token,body:forged});assert.equal(put.statusCode,201,role+JSON.stringify(put.body));
  const row=(await f.sql.query('SELECT * FROM staff_apns_devices WHERE installation_id=$1',[installation])).rows[0];
  assert.equal(row.org_id,f.org);assert.equal(row.staff_id,actor.id);assert.equal(row.session_id,actor.sessionId);assert.notEqual(row.encrypted_token,token);assert.equal(decryptField(row.encrypted_token,{rowId:row.id,env:f.env}),token);
  assert.equal(JSON.stringify(put.body).includes(token),false);assert.equal((await f.sql.query('SELECT count(*)::int n FROM client_apns_devices WHERE installation_id=$1',[installation])).rows[0].n,0);
  const get=await f.call(actor,'GET',{installation,query:forged});assert.equal(get.statusCode,200);assert.equal(get.body.registered,true);assert.equal(JSON.stringify(get.body).includes(token),false);
  const del=await f.call(actor,'DELETE',{installation,body:forged});assert.equal(del.statusCode,200);assert.equal(del.body.revoked,true);assert.equal((await f.call(actor,'GET',{installation})).body.registered,false);
 }
}));

test('real native handler: foreign installation cannot be read/revoked; same phone rebind invalidates old staff/client ownership',options,()=>fixture(async f=>{
 const a=await f.staff('admin'),b=await f.staff('outbound_rep'),foreign=await f.staff('closer',f.foreignOrg),installation=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');
 assert.equal((await f.call(a,'POST',{installation,token})).statusCode,201);
 for(const actor of[b,foreign]){assert.equal((await f.call(actor,'GET',{installation})).body.registered,false);assert.equal((await f.call(actor,'DELETE',{installation})).body.revoked,false);}
 assert.equal((await f.call(a,'GET',{installation})).body.registered,true);
 const invalidClient=await f.account();
 for(const invalid of[{token:'not-hex'},{environment:'sandbox'},{installation_id:'invalid-installation'}]){
  const rejected=await f.call(invalidClient,'POST',{installation,token,body:invalid});assert.equal(rejected.statusCode,400,JSON.stringify(rejected.body));
  assert.equal((await f.call(a,'GET',{installation})).body.registered,true,'invalid device input cannot retire prior staff registration');
 }

 const second={...a,...await createSession(f.sql,{orgId:f.org,staffId:a.id})};assert.equal((await f.call(second,'GET',{installation})).body.registered,false);
 assert.equal((await f.call(second,'POST',{installation,token})).statusCode,200);assert.equal((await f.call(a,'GET',{installation})).body.registered,false);assert.equal((await f.call(second,'GET',{installation})).body.registered,true);
 const foreignInstallation=crypto.randomUUID(),foreignToken=crypto.randomBytes(32).toString('hex');
 assert.equal((await f.call(foreign,'POST',{installation:foreignInstallation,token:foreignToken})).statusCode,201);
 const client=await f.account();assert.equal((await f.call(client,'POST',{installation,token,body:{staff_id:a.id,org_id:f.foreignOrg}})).statusCode,201);assert.equal((await f.call(second,'GET',{installation})).body.registered,false);assert.equal((await f.call(client,'GET',{installation})).body.registered,true);
 assert.equal((await f.call(foreign,'GET',{installation:foreignInstallation})).body.registered,true,'different tenant/installation/token must remain untouched');
 assert.equal((await f.call(client,'POST',{installation,token})).statusCode,200,'same-client reattach still works');
 assert.equal((await f.call(second,'GET',{installation})).body.registered,false);
 const rotatedToken=crypto.randomBytes(32).toString('hex');assert.equal((await f.call(client,'POST',{installation,token:rotatedToken})).statusCode,201,'rotated token retains same physical installation');
 assert.equal((await f.call(client,'GET',{installation})).body.registered,true);assert.equal((await f.call(second,'GET',{installation})).body.registered,false);
 assert.equal((await f.call(foreign,'GET',{installation:foreignInstallation})).body.registered,true);

 assert.equal((await f.call(b,'POST',{installation,token})).statusCode,201);assert.equal((await f.call(client,'GET',{installation})).body.registered,false);assert.equal((await f.call(b,'GET',{installation})).body.registered,true);
 const active=(await f.sql.query('SELECT staff_id FROM staff_apns_devices WHERE installation_id=$1 AND revoked_at IS NULL',[installation])).rows;assert.deepEqual(active,[{staff_id:b.id}]);
 assert.equal((await f.call(foreign,'GET',{installation:foreignInstallation})).body.registered,true,'reverse registration must preserve unrelated foreign device');
}));

test('real native handler: revoked/expired/suspended/disabled/unknown/partner cannot register or borrow another identity',options,()=>fixture(async f=>{
 for(const mode of['revoked','expired','suspended','disabled','unknown']){
  const actor=await f.staff(mode==='unknown'?'unknown_job':'funding_advisor');
  if(mode==='revoked')await f.sql.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[actor.sessionId]);
  if(mode==='expired')await f.sql.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[actor.sessionId]);
  if(mode==='suspended')await f.sql.query("UPDATE staff SET status='suspended' WHERE id=$1",[actor.id]);
  if(mode==='disabled')await f.sql.query('UPDATE staff SET active=false WHERE id=$1',[actor.id]);
  for(const method of['GET','POST','DELETE']){const res=await f.call(actor,method,{body:{role:'owner',staff_id:crypto.randomUUID()}});assert.equal(res.statusCode,mode==='unknown'?403:401,mode+'/'+method+JSON.stringify(res.body));}
  assert.equal((await f.sql.query('SELECT count(*)::int n FROM staff_apns_devices WHERE staff_id=$1',[actor.id])).rows[0].n,0);
 }
 const partner=await f.account('partner');for(const method of['GET','POST','DELETE'])assert.equal((await f.call(partner,method)).statusCode,403);
 const missing={token:'not-a-real-session'};assert.equal((await f.call(missing,'POST')).statusCode,401);
}));
