import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/send.mjs";

const ORG="11111111-1111-4111-8111-111111111111";
const CLIENT="22222222-2222-4222-8222-222222222222";
const LETTER="44444444-4444-4444-8444-444444444444";
const HTML="<p>Saved and approved content A</p>";
function fixture({owned=true,authorized=true,saved=true,status="ready"}={}) {
  const sends=[],statements=[];
  const deps={
    db:{async query(sql,params) {
      statements.push({sql,params});
      if (sql.includes("FROM clients")) return {rows:owned?[{id:CLIENT}]:[]};
      if (sql.includes("FROM dispute_letters")) {
        assert.match(sql,/org_id = \$1::uuid AND client_id = \$2::uuid/);
        assert.deepEqual(params.slice(0,2),[ORG,CLIENT]);
        return {rows:saved?[{id:LETTER,bureau:"EX",target:"bureau",
          body_text:HTML,status,case_id:"55555555-5555-4555-8555-555555555555",
          furnisher_address_id:null}]:[]};
      }
      throw new Error("unexpected SQL: "+sql);
    }},
    requireAuth:async()=>({id:"33333333-3333-4333-8333-333333333333",org_id:ORG,role:"owner"}),
    hasRepairAgreement:async()=>authorized,
    hasDisputeAuthorization:async()=>false,
    sendRepairLetters:async (_db,args)=>{sends.push(args);return {ok:true,results:[]}}
  };
  const req={method:"POST",body:{mail:true,client_id:CLIENT,mail_from:{address_line1:"Synthetic"},
    letters:[{letter_id:LETTER,bureau:"EX",html:HTML}]}};
  const res={code:null,body:null,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  return {deps,req,res,sends,statements};
}
async function run(change,opts) {
  const h=fixture(opts);
  if(change)change(h.req.body);
  await handler(h.req,h.res,h.deps);
  return h;
}
test("valid letter uses only exact persisted body and routing",async()=>{
  const h=await run();
  assert.equal(h.res.code,200);
  assert.equal(h.sends.length,1);
  assert.deepEqual(h.sends[0].letters,[{letterId:LETTER,bureau:"EX",target:"bureau",
    html:HTML,caseId:"55555555-5555-4555-8555-555555555555",
    furnisher_address_id:null}]);
});
for(const [name,edit] of [
  ["changed body", b=>{b.letters[0].html="<p>Injected B</p>"}],
  ["wrong bureau",b=>{b.letters[0].bureau="TU"}],
  ["wrong target",b=>{b.letters[0].target="furnisher"}],
  ["manual recipient",b=>{b.letters[0].to={address_line1:"Wrong"}}],
  ["unverified PDF",b=>{b.letters[0].pdf="JVBERi0="}],
  ["wrong case",b=>{b.letters[0].caseId="99999999-9999-4999-8999-999999999999"}],
  ["wrong furnisher ID",b=>{b.letters[0].furnisher_address_id="99999999-9999-4999-8999-999999999999"}],
  ["tampered later batch member",b=>{b.letters.push({letter_id:LETTER,bureau:"EX",html:"B"})}]
]) test(name+" blocks the entire batch before claiming or provider",async()=>{
  const h=await run(edit);
  assert.equal(h.res.code,409);
  assert.equal(h.res.body.error,"saved_repair_letter_content_mismatch");
  assert.equal(h.sends.length,0);
  assert.equal(h.statements.some(x=>/UPDATE dispute_letters/.test(x.sql)),false);
});
test("missing saved letter refuses",async()=>{
  const h=await run(null,{saved:false});
  assert.equal(h.res.code,404);assert.equal(h.sends.length,0);
});
test("cancelled letter refuses despite earlier authorization",async()=>{
  const h=await run(null,{status:"cancelled"});
  assert.equal(h.res.code,409);assert.equal(h.sends.length,0);
});
test("authorization or foreign-client denial happens before saved lookup",async()=>{
  for(const opts of [{authorized:false},{owned:false}]) {
    const h=await run(null,opts);
    assert.equal(h.res.code,opts.owned===false?404:403);
    assert.equal(h.sends.length,0);
    assert.equal(h.statements.some(x=>/FROM dispute_letters/.test(x.sql)),false);
  }
});
