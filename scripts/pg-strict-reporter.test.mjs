import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unitShardFor } from "./run-suite-shards.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const reporter=path.join(HERE,"pg-strict-reporter.mjs");
// Child controls are independent CLI runs, not nested Node test workers.
const childEnv=()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;return env;};
const cases=[
  ["after-hook",`import {describe,test,after} from 'node:test';describe('after-hook-control',()=>{test('child-pass',()=>{});after(()=>{throw Error('controlled-after-hook');});});`,1,/not ok .*after-hook-control/],
  ["before-hook",`import {describe,test,before} from 'node:test';describe('before-hook-control',()=>{before(()=>{throw Error('controlled-before-hook');});test('child',()=>{});});`,1,/not ok .*before-hook-control/],
  ["assertion",`import test from 'node:test';import assert from 'node:assert/strict';test('assertion-control',()=>assert.equal(1,2));`,1,/not ok .*assertion-control/],
  ["clean",`import test from 'node:test';test('clean-control',()=>{});`,0,/ok .*clean-control/],
  ["literal-not-ok",`import test from 'node:test';test('literal-control',()=>console.log('not ok 99 - literal diagnostic only'));`,0,/# not ok 99 - literal diagnostic only/]
];

for(const [name,source,status,output] of cases){
  test(`strict PG reporter child: ${name} preserves TAP and returns ${status}`,()=>{
    const dir=mkdtempSync(path.join(tmpdir(),"fundhub-pg-reporter-"));
    try{
      const file=path.join(dir,"control.test.mjs");writeFileSync(file,source);
      const r=spawnSync(process.execPath,["--test",`--test-reporter=${reporter}`,file],{encoding:"utf8",timeout:15000,env:childEnv()});
      assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,status,r.stdout+r.stderr);
      assert.match(r.stdout,/TAP version 13/);assert.match(r.stdout,output);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}

test("actual runner uses the strict reporter only for PG and leaves all twelve unit jobs unchanged",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"fundhub-pg-runner-"));
  try{
    for(const p of ["scripts","src/pulse/catalog/proofs","src/verification"])mkdirSync(path.join(dir,p),{recursive:true});
    // Execute the actual runner/reporter bytes in a tiny discovered suite;
    // no database or application/provider code is involved in this control.
    for(const p of ["run-suite.mjs","run-suite-shards.mjs","pg-strict-reporter.mjs"])
      writeFileSync(path.join(dir,"scripts",p),readFileSync(path.join(HERE,p)));
    writeFileSync(path.join(dir,"src/verification/scratch-guard.mjs"),readFileSync(path.join(HERE,"../src/verification/scratch-guard.mjs")));
    writeFileSync(path.join(dir,"src/pulse/catalog/proofs/display-proof-cases.mjs"),"export const DISPLAY_PROOF_CASES=[];\n");
    const found=new Map();
    for(let i=0;i<256&&found.size<6;i++){
      const file=`src/unit-control-${i}.test.mjs`,shard=unitShardFor(file);
      if(!found.has(shard))found.set(shard,file);
    }
    assert.equal(found.size,6);
    const unitSource=`import test from 'node:test';import assert from 'node:assert/strict';test('unit-args-unchanged',()=>assert.equal(process.execArgv.some(a=>a.includes('pg-strict-reporter')),false));`;
    for(const file of found.values())writeFileSync(path.join(dir,file),unitSource);
    writeFileSync(path.join(dir,"src/control.pg.test.mjs"),`import {describe,test,after} from 'node:test';import assert from 'node:assert/strict';describe('runner-PG-hook',()=>{test('PG-reporter-selected',()=>assert.ok(process.execArgv.some(a=>a.endsWith('/pg-strict-reporter.mjs'))));after(()=>{throw Error('runner-controlled-hook');});});`);
    const env=childEnv();delete env.FUNDHUB_SUITE_PART;delete env.FUNDHUB_SUITE_SHARD_INDEX;
    const run=extra=>spawnSync(process.execPath,[path.join(dir,"scripts/run-suite.mjs")],{encoding:"utf8",timeout:15000,env:{...env,...extra}});
    const pg=run({FUNDHUB_SUITE_PART:"pg",DATABASE_URL:"postgres://fixture@127.0.0.1/fundhub_test_no_connection"});
    assert.ifError(pg.error);assert.equal(pg.status,1,pg.stdout+pg.stderr);
    assert.match(pg.stdout,/ok .*PG-reporter-selected/);assert.match(pg.stdout,/not ok .*runner-PG-hook/);
    assert.match(pg.stderr,/unit exit 0, pg exit 1/);
    for(const NODE_ENV of ["test","production"])for(let i=0;i<6;i++){
      const unit=run({FUNDHUB_SUITE_PART:"unit",FUNDHUB_SUITE_SHARD_INDEX:String(i),NODE_ENV});
      assert.ifError(unit.error);assert.equal(unit.status,0,unit.stdout+unit.stderr);
      assert.match(unit.stdout,/ok .*unit-args-unchanged/);assert.doesNotMatch(unit.stdout,/runner-PG-hook/);
      assert.match(unit.stderr,/unit exit 0, pg exit 0/);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
