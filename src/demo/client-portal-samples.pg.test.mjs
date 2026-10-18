import {test} from 'node:test';
import assert from 'node:assert/strict';
import {db,close} from '../db.mjs';
import {resolveDefaultOrg} from '../auth/org.mjs';
import {createAccount,createAccountSession,verifyAccountSession} from '../auth/account-session.mjs';
import {clientSampleAccount,installClientSamples} from './client-portal-samples.mjs';
import bankLink from '../../api/banking/link-token.mjs';
const response=()=>({code:200,status(n){this.code=n;return this;},setHeader(){},json(d){this.body=d;return this;}});
test('real account/session/sentinel linkage isolates samples and blocks bank side effects',{skip:!process.env.DATABASE_URL},async()=>{
  let clientId,accountId;
  try{
    const orgId=await resolveDefaultOrg(db);
    clientId=(await db.query(`INSERT INTO clients (org_id,first_name,last_name,email,client_master_key) VALUES ($1,'Portal','Role fixture','client@fundhub.ai','FDH-TEST-CLIENT-ROLE-ACCOUNT') RETURNING id`,[orgId])).rows[0].id;
    accountId=(await createAccount(db,{orgId,clientId,kind:'client',email:'client@fundhub.ai',name:'Portal role fixture',password:'Scratch-only-Portal-2026!'})).id;
    const session=await createAccountSession(db,{accountId,orgId});
    const p=(await verifyAccountSession(db,session.token)).principal;
    assert.equal(await clientSampleAccount(db,p),true);
    assert.equal(await clientSampleAccount(db,{...p,accountId:clientId}),false);
    assert.equal(await clientSampleAccount(db,{...p,authorizedRep:true}),false);
    let called=false;const refused=response();
    await bankLink({method:'POST',url:'/api/banking/link-token',headers:{}},refused,{db,resolvePrincipal:async()=>p,startLink:async()=>{called=true;throw Error('must never contact bank');}});
    assert.equal(refused.code,409);assert.equal(called,false);
    const referral=response();assert.equal(await installClientSamples({method:'POST',url:'/api/affiliates/refer',headers:{}},referral,p,db),true);
    const real=response();assert.equal(await installClientSamples({method:'POST',url:'/api/money/accounts',headers:{cookie:'fh_portal_data=real'}},real,p,db),true);
    await db.query(`UPDATE clients SET client_master_key='PORTAL-SCRATCH-WRONG-SENTINEL' WHERE id=$1`,[clientId]);
    assert.equal(await clientSampleAccount(db,p),false);
  }finally{
    if(accountId)await db.query('DELETE FROM accounts WHERE id=$1',[accountId]);
    if(clientId)await db.query('DELETE FROM clients WHERE id=$1',[clientId]);
    await close();
  }
});
