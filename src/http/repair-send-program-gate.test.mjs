import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/send.mjs";
const ORG="11111111-1111-4111-8111-111111111111",CLIENT="22222222-2222-4222-8222-222222222222",LETTER="44444444-4444-4444-8444-444444444444";
async function scenario({paid=false,agreement=true,consent=false,owned=true,afterPreflight=false}={}){
 const calls={send:0,provider:0,sql:[]};
 const deps={db:{async query(sql,params){calls.sql.push(sql);
   if(sql.includes("FROM clients"))return {rows:owned?[{id:CLIENT}]:[]};
   if(sql.includes("FROM dispute_letters"))return {rows:[{id:LETTER,bureau:"EX",target:"bureau",body_text:"Synthetic",status:"ready",case_id:null,furnisher_address_id:null}]};
   throw Error("unexpected SQL: "+sql);
 }},
 requireAuth:async()=>({id:"33333333-3333-4333-8333-333333333333",org_id:ORG,role:"owner"}),
 hasRepairAgreement:async()=>agreement,hasDisputeAuthorization:async()=>consent,
 hasActivePaidRepairProgram:async()=>paid,
 loadClientReturnAddress:async()=>({address_line1:"Recorded consumer address",address_state:"AZ"}),
 sendRepairLetters:async(_db,args)=>{calls.send++;assert.equal(args.enforceActivePaidRepair,true);assert.equal(args.enforceCurrentDisputeAuthorization,true);
   return afterPreflight
     ? {ok:false,results:[{ok:false,error:afterPreflight==="revoked"?"repair_dispute_authorization_required":"repair_enrollment_inactive_or_unpaid"}]}
     : {ok:true,results:[]}},
 mailBureauLetter:async()=>{calls.provider++;throw Error("provider must not be called");}};
 const req={method:"POST",body:{mail:true,client_id:CLIENT,mail_from:{address_state:"AZ"},letters:[{letter_id:LETTER,bureau:"EX",html:"Synthetic"}]}};
 const res={code:null,body:null,setHeader(){},status(n){this.code=n;return this},json(x){this.body=x;return this}};
 await handler(req,res,deps);return {res,calls};
}
test("historical signature but cancelled/refunded program refuses before mail",async()=>{
 for(const reason of ["cancelled","fully refunded"]){
  const {res,calls}=await scenario({paid:false});
  assert.equal(res.code,409,reason);assert.equal(res.body.error,"repair_enrollment_inactive_or_unpaid");
  assert.equal(calls.send,0);assert.equal(calls.provider,0);assert.equal(calls.sql.some(q=>/UPDATE dispute_letters/.test(q)),false);
 }
});
test("independent consent cannot override cancelled/refunded enrollment",async()=>{
 const {res,calls}=await scenario({paid:false,agreement:false,consent:true});
 assert.equal(res.code,409);assert.equal(calls.send,0);assert.equal(calls.provider,0);
});
test("active paid and signed current repair may reach saved-letter service",async()=>{
 const {res,calls}=await scenario({paid:true});
 assert.equal(res.code,200);assert.equal(calls.send,1);assert.equal(calls.provider,0);
});
test("refund committed after preflight surfaces a 409 from the final atomic claim",async()=>{
 const {res,calls}=await scenario({paid:true,afterPreflight:true});
 assert.equal(res.code,409);assert.equal(calls.send,1);assert.equal(calls.provider,0);
});
test("foreign-org client check precedes eligibility",async()=>{
 const {res,calls}=await scenario({paid:true,owned:false});
 assert.equal(res.code,404);assert.equal(calls.send,0);assert.equal(calls.provider,0);
});

test("revoked dispute consent detected after HTTP preflight returns 403",async()=>{
 const {res,calls}=await scenario({paid:true,agreement:false,consent:true,afterPreflight:"revoked"});
 assert.equal(res.code,403);assert.equal(res.body.error,"repair_dispute_authorization_required");
 assert.equal(calls.send,1);assert.equal(calls.provider,0);
});
