import fs from'node:fs';import os from'node:os';import path from'node:path';import{execFileSync,spawnSync}from'node:child_process';
const source='803d2b7e47f137d7773d4006445b971179cef835';
execFileSync('git',['fetch','origin','main','codex/crm-portal-layout-professional'],{stdio:'inherit'});
const base=execFileSync('git',['merge-base','origin/main',source],{encoding:'utf8'}).trim();
const prior=JSON.parse(fs.readFileSync('ops/workflows/build-evidence/crm-client-integrated/integration.json','utf8'));
const done=new Set(prior.files.map(f=>f.path));
const files=execFileSync('git',['diff','--name-only',base,source,'--','public/app'],{encoding:'utf8'}).trim().split('\n').filter(p=>/^public\/app\/(?:money(?:[.\-])|financeos(?:[.\-])|affiliate(?:[.\-]))/.test(p)&&/\.(?:js|css)$/.test(p)&&!done.has(p));
if(!files.length)throw Error('No dependency inventory found');
const read=(ref,p)=>{const r=spawnSync('git',['show',ref+':'+p]);return r.status===0?r.stdout:null;};
const pending=[],report=[];
for(const file of files){
 const incoming=read(source,file);if(!incoming)throw Error('Missing reviewed dependency '+file);
 const current=fs.existsSync(file)?fs.readFileSync(file):Buffer.alloc(0),old=read(base,file)||Buffer.alloc(0);
 if(current.equals(incoming)){report.push({path:file,state:'identical'});continue;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fh-client-dep-'));
 for(const[n,data]of[['current',current],['base',old],['reviewed',incoming]])fs.writeFileSync(path.join(dir,n),data);
 const r=spawnSync('git',['merge-file','-p',...['current','base','reviewed'].map(n=>path.join(dir,n))],{maxBuffer:8*1024*1024});fs.rmSync(dir,{recursive:true,force:true});
 if(r.status!==0){report.push({path:file,state:'conflict'});continue;}
 pending.push({file,data:r.stdout});report.push({path:file,state:'clean merge',bytes:r.stdout.length});
}
const dir='ops/workflows/build-evidence/crm-client-dependencies';fs.mkdirSync(dir,{recursive:true});
const complete=!report.some(r=>r.state==='conflict');
fs.writeFileSync(dir+'/integration.json',JSON.stringify({source,base,checkedHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),complete,noProductionDeploy:true,noCustomerWrites:true,files:report},null,2));
if(!complete)throw Error('No dependencies written: manual reconciliation required');
for(const p of pending){fs.mkdirSync(path.dirname(p.file),{recursive:true});fs.writeFileSync(p.file,p.data);}
console.log('Reconciled '+pending.length+' supporting client CSS/JS files from the existing page-agent results.');
