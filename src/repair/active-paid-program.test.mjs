import { test } from "node:test";
import assert from "node:assert/strict";
import { activePaidRepairSql, hasActivePaidRepairProgram } from "./active-paid-program.mjs";
const O="11111111-1111-4111-8111-111111111111",C="22222222-2222-4222-8222-222222222222";
test("current paid predicate binds org/client, program type and same-sale net",()=>{
 const s=activePaidRepairSql(2,3);
 for(const fragment of ["rp.org_id = $2::uuid","rp.client_id = $3::uuid","rp.status = 'active'","s.status = 'active'","pr.category = 'repair'","pr.code = 'repair-trial'","sp.sale_id = s.id","sp.kind = 'refund",") > 0"])assert.ok(s.includes(fragment),fragment);
});
test("missing DB/ids, SQL error and no eligible row all deny",async()=>{
 assert.equal(await hasActivePaidRepairProgram(null,{orgId:O,clientId:C}),false);
 assert.equal(await hasActivePaidRepairProgram({query:async()=>({rows:[{eligible:true}]})},{clientId:C}),false);
 assert.equal(await hasActivePaidRepairProgram({query:async()=>{throw Error("offline")}},{orgId:O,clientId:C}),false);
 assert.equal(await hasActivePaidRepairProgram({query:async()=>({rows:[{eligible:false}]})},{orgId:O,clientId:C}),false);
});
test("eligible read uses only scoped binds",async()=>{
 const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{eligible:true}]}}};
 assert.equal(await hasActivePaidRepairProgram(db,{orgId:O,clientId:C}),true);
 assert.deepEqual(calls[0].args,[O,C]);assert.match(calls[0].sql,/FROM sale_payments/);
});
