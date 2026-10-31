import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {REQUIRED_CI_JOBS,checkRequiredJobs,releaseDecision,ownerLane,prOwnershipDecision} from './release-control.mjs';

const a='a'.repeat(40), b='b'.repeat(40);
const jobs=REQUIRED_CI_JOBS.map(name=>({name,status:'completed',conclusion:'success'}));
const run={name:'tests',event:'push',head_branch:'main',head_sha:a,
  head_repository:{full_name:'ZootimusMaximusSupreme/fundhub-platform'},
  status:'completed',conclusion:'success'};
const fixture={eventName:'workflow_run',repo:'ZootimusMaximusSupreme/fundhub-platform',
  mainSha:a,mainMessage:'Merge PR',testRun:run,jobs};

test('14 named CI jobs are mandatory and cannot be skipped or doubled',()=>{
  assert.equal(REQUIRED_CI_JOBS.length,14);
  assert.equal(checkRequiredJobs(jobs).ok,true);
  assert.equal(checkRequiredJobs(jobs.slice(1)).ok,false);
  assert.equal(checkRequiredJobs([...jobs.slice(0,-1),jobs[0]]).ok,false);
  assert.equal(checkRequiredJobs(jobs.map((j,i)=>i===2?{...j,conclusion:'skipped'}:j)).ok,false);
  assert.equal(checkRequiredJobs(jobs.map((j,i)=>i===2?{...j,conclusion:'failure'}:j)).ok,false);
});
test('ship requires exact latest main success and not a pull request receipt',()=>{
  assert.equal(releaseDecision(fixture).status,'ship');
  assert.equal(releaseDecision({...fixture,mainSha:b}).status,'skip');
  assert.equal(releaseDecision({...fixture,testRun:{...run,event:'pull_request'}}).status,'fail');
  assert.equal(releaseDecision({...fixture,testRun:{...run,head_repository:{full_name:'foreign/repo'}}}).status,'fail');
  assert.equal(releaseDecision({...fixture,testRun:null}).status,'fail');
  assert.equal(releaseDecision({...fixture,jobs:jobs.slice(1)}).status,'fail');
  assert.equal(releaseDecision({...fixture,mainMessage:'ship: marker'}).status,'skip');
  assert.equal(releaseDecision({...fixture,eventName:'push'}).status,'fail');
  assert.equal(releaseDecision({...fixture,eventName:'workflow_dispatch'}).status,'ship');
});
test('owner lane must be declared, never inferred from shared agent GitHub author',()=>{
  assert.equal(ownerLane('Owner lane: fulfillment'),'fulfillment');
  assert.equal(ownerLane('Owner lane: front-house'),'front-house');
  assert.equal(ownerLane('No owner'),null);
  assert.equal(ownerLane('Owner lane: ; DROP'),null);
});
test('new overlapping PR is blocked, legacy Monday queue is not',()=>{
  const current={number:450,state:'open',created_at:'2026-11-03T10:00:00Z',body:'Owner lane: native'};
  const older={number:449,state:'open',created_at:'2026-11-03T09:00:00Z',title:'Existing'};
  const later={number:451,state:'open',created_at:'2026-11-03T11:00:00Z',title:'Later'};
  const input={current,files:['tools/fundhub-ios/App.swift','src/a.mjs'],peers:[older,later],
    peerFiles:{449:['tools/fundhub-ios/App.swift'],451:['src/a.mjs']}};
  assert.deepEqual(prOwnershipDecision(input).blockers.map(x=>x.number),[449]);
  assert.equal(prOwnershipDecision(input).ok,false);
  assert.equal(prOwnershipDecision({...input,current:{...current,created_at:'2026-11-02T20:00:00Z'}}).ok,true);
  assert.equal(prOwnershipDecision({...input,current:{...current,body:'No owner'}}).ok,false);
  assert.equal(prOwnershipDecision({...input,peers:[{...older,state:'closed'},later]}).ok,true);
  assert.equal(prOwnershipDecision({...input,files:['src/new.mjs']}).ok,true);
});
test('workflow source keeps PR guard read-only and ship behind CI',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const ship=readFileSync(root+'/.github/workflows/ship.yml','utf8');
  const guard=readFileSync(root+'/.github/workflows/pr-file-ownership.yml','utf8');
  assert.match(ship,/workflow_run:/);
  assert.match(ship,/workflows:\s*\[tests\]/);
  assert.match(ship,/needs:\s*release_gate/);
  assert.match(ship,/releaseDecision/);
  assert.match(ship,/Enforce exact main SHA before Ship/);
  assert.match(ship,/EXPECTED_RELEASE_SHA:\s*\$\{\{\s*needs\.release_gate\.outputs\.sha\s*\}\}/);
  assert.doesNotMatch(ship,/on:\n  push:\n    branches:\s*\[main\]/);
  assert.match(guard,/pull_request:/);
  assert.match(guard,/prOwnershipDecision/);
  assert.match(guard,/ref: main/);
  assert.match(guard,/pull-requests:\s*read/);
  assert.doesNotMatch(guard,/contents:\s*write/);
});
