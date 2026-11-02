// No PostGrid, no real customer, no production writes; CI disposable Postgres ONLY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { claimLetterForMailing, sendRepairLetters } from "./send.mjs";
import { hasActivePaidRepairProgram } from "./active-paid-program.mjs";
const u=process.env.DATABASE_URL||"";
const scratch=(()=>{if(process.env.CI!=="true"||!u)return false;
 try{const x=new URL(u);return ["localhost","127.0.0.1","::1","[::1]"].includes(x.hostname)&&x.pathname==="/fundhub_ci";}
 catch{return false}})();
test("active repair mail claim rechecks cancelled/refunded status in one SQL statement",
 {skip:!scratch?"requires CI disposable Postgres /fundhub_ci":false},async()=>{
 const pool=new pg.Pool({connectionString:u,max:1});let db;
 try{
 db=await pool.connect();await db.query("BEGIN");
 for(const sql of [
 "CREATE TEMP TABLE repair_programs (org_id uuid,client_id uuid,program text,status text) ON COMMIT DROP",
 "CREATE TEMP TABLE products (id uuid,org_id uuid,category text,code text) ON COMMIT DROP",
 "CREATE TEMP TABLE sales (id uuid,org_id uuid,client_id uuid,product_id uuid,status text) ON COMMIT DROP",
 "CREATE TEMP TABLE sale_payments (org_id uuid,sale_id uuid,kind text,amount numeric) ON COMMIT DROP",
 "CREATE TEMP TABLE dispute_letters (id uuid PRIMARY KEY,org_id uuid,client_id uuid,status text,send_claimed_at timestamptz,mailed_at timestamptz) ON COMMIT DROP"
 ])await db.query(sql);
 const o=randomUUID(),c=randomUUID(),l=randomUUID(),s=randomUUID(),p=randomUUID();
 await db.query("INSERT INTO repair_programs VALUES($1,$2,'full','active')",[o,c]);
 await db.query("INSERT INTO products VALUES($1,$2,'repair','repair-bundle')",[p,o]);
 await db.query("INSERT INTO sales VALUES($1,$2,$3,$4,'active')",[s,o,c,p]);
 await db.query("INSERT INTO sale_payments VALUES($1,$2,'deposit',1000)",[o,s]);
 await db.query("INSERT INTO dispute_letters(id,org_id,client_id,status) VALUES($1,$2,$3,'ready')",[l,o,c]);
 const claim=()=>claimLetterForMailing(db,{letterId:l,orgId:o,clientId:c,requireActivePaidRepair:true});
 const state=async()=> (await db.query("SELECT status,send_claimed_at,mailed_at FROM dispute_letters WHERE id=$1",[l])).rows[0];
 assert.equal(await hasActivePaidRepairProgram(db,{orgId:o,clientId:c}),true);
 // TOCTOU: cancellation after initial read but before UPDATE.
 await db.query("UPDATE repair_programs SET status='cancelled'");
 let r=await claim();assert.equal(r.claimed,false);assert.equal(r.reason,"repair_enrollment_inactive_or_unpaid");
 assert.deepEqual(await state(),{status:"ready",send_claimed_at:null,mailed_at:null});
 await db.query("UPDATE repair_programs SET status='active'");
 await db.query("INSERT INTO sale_payments VALUES($1,$2,'refund',1000)",[o,s]);
 r=await claim();assert.equal(r.claimed,false);assert.equal(r.reason,"repair_enrollment_inactive_or_unpaid");
 assert.deepEqual(await state(),{status:"ready",send_claimed_at:null,mailed_at:null});
 const renewed=randomUUID();
 await db.query("INSERT INTO sales VALUES($1,$2,$3,$4,'active')",[renewed,o,c,p]);
 await db.query("INSERT INTO sale_payments VALUES($1,$2,'deposit',1000)",[o,renewed]);
 // R-05F: a ready letter is cancelled by another transaction after an HTTP
 // caller has read it, but before the final database claim.
 const beforeCancellation=await state();assert.equal(beforeCancellation.status,"ready");
 await db.query("UPDATE dispute_letters SET status='cancelled' WHERE id=$1",[l]);
 let providerInvocations=0;
 const refused=await sendRepairLetters(db,{
   orgId:o,clientId:c,staffId:randomUUID(),mail:true,
   from:{address_line1:"12 Test St",address_city:"Phoenix",address_state:"AZ",address_zip:"85001"},
   letters:[{letterId:l,bureau:"EX",target:"bureau",html:"Synthetic"}],
   enforceActivePaidRepair:true,
   mailSender:async()=>{providerInvocations++;return {ok:false,error:"POSTGRID_API_KEY unset — synthetic refusal"};}
 });
 assert.equal(refused.ok,false);assert.equal(refused.results[0].error,"letter_not_claimable");
 assert.equal(providerInvocations,0,"cancelled letter must never reach PostGrid");
 assert.deepEqual(await state(),{status:"cancelled",send_claimed_at:null,mailed_at:null});
 await db.query("UPDATE dispute_letters SET status='ready' WHERE id=$1",[l]);

 r=await claimLetterForMailing(db,{letterId:l,orgId:randomUUID(),clientId:c,requireActivePaidRepair:true});
 assert.equal(r.claimed,false,"foreign tenant denied");
 r=await claim();assert.equal(r.claimed,true,"new independently-paid full repair reauthorizes");
 assert.equal((await state()).status,"sending");assert.ok((await state()).send_claimed_at);
 assert.equal((await state()).mailed_at,null,"claim cannot be called a mailing");
 }finally{if(db){await db.query("ROLLBACK").catch(()=>{});db.release()}await pool.end()}
});


test("R-05H: consent revocation or expiry before final claim prevents PostGrid; fresh consent or signed paper permits",
 {skip:!scratch?"requires CI disposable Postgres /fundhub_ci":false},async()=>{
 const pool=new pg.Pool({connectionString:u,max:1});let db;
 try{
 db=await pool.connect();await db.query("BEGIN");
 for(const sql of [
  "CREATE TEMP TABLE repair_programs (org_id uuid,client_id uuid,program text,status text) ON COMMIT DROP",
  "CREATE TEMP TABLE products (id uuid,org_id uuid,category text,code text) ON COMMIT DROP",
  "CREATE TEMP TABLE sales (id uuid,org_id uuid,client_id uuid,product_id uuid,status text) ON COMMIT DROP",
  "CREATE TEMP TABLE sale_payments (org_id uuid,sale_id uuid,kind text,amount numeric) ON COMMIT DROP",
  "CREATE TEMP TABLE dispute_letters (id uuid PRIMARY KEY,org_id uuid,client_id uuid,status text,send_claimed_at timestamptz,mailed_at timestamptz) ON COMMIT DROP",
  "CREATE TEMP TABLE contracts (org_id uuid,client_id uuid,template_key text,status text) ON COMMIT DROP",
  "CREATE TEMP TABLE contract_templates (org_id uuid,template_key text,subtype text) ON COMMIT DROP",
  "CREATE TEMP TABLE client_consents (org_id uuid,client_id uuid,kind text,granted_at timestamptz,expires_at timestamptz,revoked_at timestamptz) ON COMMIT DROP"
 ])await db.query(sql);
 const o=randomUUID(),c=randomUUID(),l=randomUUID(),s=randomUUID(),p=randomUUID(),foreign=randomUUID();
 await db.query("INSERT INTO repair_programs VALUES($1,$2,'full','active')",[o,c]);
 await db.query("INSERT INTO products VALUES($1,$2,'repair','repair-bundle')",[p,o]);
 await db.query("INSERT INTO sales VALUES($1,$2,$3,$4,'active')",[s,o,c,p]);
 await db.query("INSERT INTO sale_payments VALUES($1,$2,'deposit',1000)",[o,s]);
 await db.query("INSERT INTO dispute_letters(id,org_id,client_id,status) VALUES($1,$2,$3,'ready')",[l,o,c]);
 const claim=()=>claimLetterForMailing(db,{letterId:l,orgId:o,clientId:c,requireActivePaidRepair:true,requireCurrentDisputeAuthorization:true});
 const state=async()=>(await db.query("SELECT status,send_claimed_at,mailed_at FROM dispute_letters WHERE id=$1",[l])).rows[0];
 const {hasCurrentRepairMailAuthorization}=await import("./dispute-auth.mjs");
 assert.equal((await claim()).reason,"repair_dispute_authorization_required","no paper cannot mail");
 await db.query("INSERT INTO client_consents VALUES($1,$2,'dispute_authorization',now()-interval '1 hour',NULL,NULL)",[o,c]);
 assert.equal(await hasCurrentRepairMailAuthorization(db,{orgId:o,clientId:c}),true,"preflight saw valid consent");
 // Another actor revokes after preflight but before final atomic claim.
 await db.query("UPDATE client_consents SET revoked_at=now() WHERE org_id=$1",[o]);
 let provider=0;
 const refused=await sendRepairLetters(db,{orgId:o,clientId:c,staffId:randomUUID(),mail:true,
   letters:[{letterId:l,bureau:"EX",target:"bureau",html:"Synthetic"}],
   enforceActivePaidRepair:true,enforceCurrentDisputeAuthorization:true,
   mailSender:async()=>{provider++;return {ok:true,providerId:"must_not_send"};}});
 assert.equal(refused.ok,false);assert.equal(refused.results[0].error,"repair_dispute_authorization_required");
 assert.equal(provider,0);assert.deepEqual(await state(),{status:"ready",send_claimed_at:null,mailed_at:null});
 await db.query("INSERT INTO client_consents VALUES($1,$2,'dispute_authorization',now()-interval '2 days',now()-interval '1 day',NULL)",[o,c]);
 assert.equal((await claim()).reason,"repair_dispute_authorization_required","expired consent cannot mail");
 await db.query("INSERT INTO client_consents VALUES($1,$2,'dispute_authorization',now()-interval '1 minute',NULL,NULL)",[foreign,c]);
 assert.equal((await claim()).reason,"repair_dispute_authorization_required","foreign-org consent cannot mail");
 await db.query("INSERT INTO client_consents VALUES($1,$2,'dispute_authorization',now(),NULL,NULL)",[o,c]);
 assert.equal((await claim()).claimed,true,"new consent reauthorizes");
 assert.equal((await claim()).reason,"send_claim_held","replay stays fenced");
 await db.query("UPDATE dispute_letters SET status='ready',send_claimed_at=NULL WHERE id=$1",[l]);
 await db.query("UPDATE client_consents SET revoked_at=now() WHERE org_id=$1 AND revoked_at IS NULL",[o]);
 await db.query("INSERT INTO contracts VALUES($1,$2,'FH_REPAIR_AGREEMENT','signed')",[o,c]);
 assert.equal((await claim()).claimed,true,"signed active repair contract independently authorizes");
 await db.query("UPDATE dispute_letters SET status='ready',send_claimed_at=NULL WHERE id=$1",[l]);
 await db.query("UPDATE contracts SET org_id=$1",[foreign]);
 assert.equal((await claim()).reason,"repair_dispute_authorization_required","foreign-org contract cannot mail");
 assert.deepEqual(await state(),{status:"ready",send_claimed_at:null,mailed_at:null});
 }finally{if(db){await db.query("ROLLBACK").catch(()=>{});db.release()}await pool.end()}
});
