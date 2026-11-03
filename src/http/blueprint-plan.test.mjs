import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/blueprint/plan.mjs';

const ORG='10000000-0000-4000-8000-000000000001';
const CLIENT='20000000-0000-4000-8000-000000000002';
const FOREIGN='30000000-0000-4000-8000-000000000003';
function response(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
function dependencies(over={}){return{db:{query:async()=>({rows:[{exists:1}]})},requirePrincipal:async()=>({kind:'client',orgId:ORG,clientId:CLIENT}),isBlueprintCoachClient:async()=>true,buildBlueprintClientPlan:async(_db,scope)=>({ok:true,client:{id:scope.clientId},businessPlans:{businesses:[]}}),...over};}

test('actual plan reader uses authenticated client, never a requested foreign identity',async()=>{
  let scope;const res=response();await handler({method:'GET',query:{client_id:FOREIGN,org_id:FOREIGN}},res,dependencies({buildBlueprintClientPlan:async(_db,s)=>{scope=s;return{ok:true,client:{id:s.clientId}};}}));
  assert.equal(res.statusCode,200);assert.equal(scope.clientId,CLIENT);assert.equal(scope.orgId,ORG);assert.equal(res.headers['cache-control'],'private, no-store');
});
test('inactive or expired Blueprint cannot invoke any plan data reader',async()=>{
  let calls=0;const res=response();await handler({method:'GET'},res,dependencies({isBlueprintCoachClient:async()=>false,buildBlueprintClientPlan:async()=>{calls++;}}));assert.equal(res.statusCode,403);assert.equal(calls,0);
});
test('foreign-org or missing client is refused before plan aggregation',async()=>{
  let calls=0;const res=response();await handler({method:'GET'},res,dependencies({db:{query:async()=>({rows:[]})},buildBlueprintClientPlan:async()=>{calls++;}}));assert.equal(res.statusCode,404);assert.equal(calls,0);
});
test('staff account cannot impersonate the buyer through this endpoint',async()=>{
  const res=response();await handler({method:'GET'},res,dependencies({requirePrincipal:async()=>({kind:'staff',orgId:ORG,clientId:CLIENT})}));assert.equal(res.statusCode,403);
});
test('unavailable core reader stays an error rather than a made-up empty plan',async()=>{
  const res=response();await handler({method:'GET'},res,dependencies({buildBlueprintClientPlan:async()=>{throw Error('secret internal relation and storage URL');}}));assert.equal(res.statusCode,500);assert.equal(res.body.error,'blueprint_plan_unavailable');assert.equal(res.body.businessPlans,undefined);assert.equal(res.body.detail,undefined);assert.doesNotMatch(JSON.stringify(res.body),/secret internal/);
});
test('scope storage failure is caught without treating it as inactive access',async()=>{
  const res=response();await handler({method:'GET'},res,dependencies({db:{query:async()=>{throw Error('connection refused');}}}));assert.equal(res.statusCode,500);assert.equal(res.body.error,'blueprint_plan_unavailable');
});
test('plan endpoint is read only',async()=>{const res=response();await handler({method:'POST'},res,dependencies());assert.equal(res.statusCode,405);assert.equal(res.headers.allow,'GET');});
