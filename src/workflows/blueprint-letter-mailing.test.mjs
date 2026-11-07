import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sweepBlueprintLetterMailing,trackBlueprintLetterMailing,SOURCE_WORKFLOW,SWEEP_CRON,handle} from './blueprint-letter-mailing.mjs';
test('the mail tracker reads in its own step after the order sweep, three letters at most, and a failed read never throws',async()=>{
  const reads=[];const r=await trackBlueprintLetterMailing({}, {limit:50,track:async(_db,o)=>{reads.push(o);return {ok:true,examined:3,updated:3,failed:0};}});
  assert.equal(reads[0].limit,3);assert.equal(r.updated,3);
  assert.deepEqual(await trackBlueprintLetterMailing({}, {track:async()=>{throw new Error('fixture_private_postgrid_body');}}),{ok:false,examined:0,updated:0,failed:1});
  const names=[];const step={run:async(name,work)=>{names.push(name);return name==='reconcile-confirmed-mailing-orders'?{ok:true,examined:0}:{ok:true};}};
  assert.deepEqual(await handle({db:{},step}),{ok:true,examined:0});assert.deepEqual(names,['reconcile-confirmed-mailing-orders','read-mail-tracker']);
});
test('bounded five-minute recovery passes at most five existing orders/two envelopes and records its actual result',async()=>{const reads=[],receipts=[];const r=await sweepBlueprintLetterMailing({}, {limit:99,sweep:async(_db,o)=>{reads.push(o);return {ok:true,examined:5,mailed:1,needsReview:0,failed:0};},recordHeartbeat:async(_db,r)=>receipts.push(r)});assert.equal(SWEEP_CRON,'*/5 * * * *');assert.equal(reads[0].limit,5);assert.equal(reads[0].maxEnvelopes,2);assert.equal(r.mailed,1);assert.equal(receipts[0].job,SOURCE_WORKFLOW);assert.equal(receipts[0].outcome,'ok');});
test('failed recovery remains red without printing provider/customer details',async()=>{let receipt;const r=await sweepBlueprintLetterMailing({}, {sweep:async()=>{throw new Error('fixture_private_provider_body');},recordHeartbeat:async(_db,v)=>{receipt=v;}});assert.equal(r.ok,false);assert.equal(receipt.outcome,'error');assert.doesNotMatch(JSON.stringify({r,receipt}),/fixture_private_provider_body/);assert.equal(typeof handle,'function');});
