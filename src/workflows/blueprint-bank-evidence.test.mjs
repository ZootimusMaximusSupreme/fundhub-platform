import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "./blueprint-bank-evidence.mjs";

test("the existing hourly job also processes paid reports and help when no bank handoff is pending",async()=>{
  let called=0;
  const db={query:async()=>({rows:[]})};
  const result=await handle({db,processServices:async conn=>{assert.equal(conn,db);called++;return {ok:true,waiting:1};}});
  assert.equal(called,1);assert.equal(result.services.waiting,1);assert.equal(result.checked,0);
  await assert.rejects(handle({db,processServices:async()=>({ok:false,errors:[{error:"provider failed"}]})}),/provider failed/);
});
