import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{execFileSync,spawnSync}from'node:child_process';
const source='803d2b7e47f137d7773d4006445b971179cef835';
const files=[
  "e2e/client-ios-integration.spec.mjs",
  "e2e/client-ios-samples.spec.mjs",
  "e2e/page_affiliate.spec.mjs",
  "e2e/page_client_portal.spec.mjs",
  "e2e/page_contract.spec.mjs",
  "e2e/page_financeos.spec.mjs",
  "e2e/page_login.spec.mjs",
  "e2e/page_money.spec.mjs",
  "e2e/page_money_alerts.spec.mjs",
  "e2e/page_money_banks.spec.mjs",
  "e2e/page_money_connections.spec.mjs",
  "e2e/page_money_credit.spec.mjs",
  "e2e/page_money_fundability.spec.mjs",
  "e2e/page_money_helper.spec.mjs",
  "e2e/page_money_next.spec.mjs",
  "e2e/page_money_payments.spec.mjs",
  "e2e/page_money_plan.spec.mjs",
  "e2e/page_money_setup.spec.mjs",
  "e2e/page_money_strategy.spec.mjs",
  "e2e/page_portal_login.spec.mjs",
  "e2e/page_progress.spec.mjs",
  "e2e/page_soft_pull_approve.spec.mjs",
  "public/app/affiliate-ios.css",
  "public/app/affiliate.html",
  "public/app/client-ios.css",
  "public/app/client-ios.js",
  "public/app/client-portal-ios.css",
  "public/app/client-portal.html",
  "public/app/financeos-ios.css",
  "public/app/financeos.html",
  "public/app/money-accounts-ios.css",
  "public/app/money-accounts.html",
  "public/app/money-alerts-ios.css",
  "public/app/money-alerts.html",
  "public/app/money-banks-ios.css",
  "public/app/money-banks.html",
  "public/app/money-connections-ios.css",
  "public/app/money-connections.html",
  "public/app/money-credit-ios.css",
  "public/app/money-credit.html",
  "public/app/money-declines-ios.css",
  "public/app/money-declines.html",
  "public/app/money-fundability-ios.css",
  "public/app/money-fundability.html",
  "public/app/money-helper-ios.css",
  "public/app/money-helper.html",
  "public/app/money-ios.css",
  "public/app/money-next-ios.css",
  "public/app/money-next.html",
  "public/app/money-payments-ios.css",
  "public/app/money-payments.html",
  "public/app/money-plan-ios.css",
  "public/app/money-plan.html",
  "public/app/money-setup-ios.css",
  "public/app/money-setup.html",
  "public/app/money-strategy-ios.css",
  "public/app/money-strategy.html",
  "public/app/money-transfers-ios.css",
  "public/app/money-transfers.html",
  "public/app/money-vault-ios.css",
  "public/app/money-vault.html",
  "public/app/money.html",
  "public/app/soft-pull-approve-ios.css",
  "public/app/soft-pull-approve.html",
  "public/contract-ios.css",
  "public/contract.html",
  "public/login-ios.css",
  "public/login.html",
  "public/portal-login-ios.css",
  "public/portal-login.html",
  "public/progress-ios.css",
  "public/progress.html",
  "scripts/client-ios-performance.mjs",
  "scripts/page_money_accounts-browser.mjs",
  "scripts/page_money_declines-browser.mjs",
  "scripts/page_money_transfers-browser.mjs",
  "src/http/financeos-screen.test.mjs",
  "src/http/portal-own-footer.test.mjs"
];
const out='ops/workflows/build-evidence/crm-client-integrated';
fs.mkdirSync(out,{recursive:true});
const marker=out+'/integration.json';
if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).complete&&files.every(p=>fs.existsSync(p))){console.log('Reviewed client checkpoint already integrated; preserving later fixes.');process.exit(0);}
execFileSync('git',['fetch','origin','main','codex/crm-portal-layout-professional'],{stdio:'inherit'});
const base=execFileSync('git',['merge-base','origin/main',source],{encoding:'utf8'}).trim();
const read=(ref,p)=>{const r=spawnSync('git',['show',ref+':'+p]);return r.status===0?r.stdout:null;};
const pending=[],report=[];
for(const file of files){
 const incoming=read(source,file);if(!incoming)throw Error('Reviewed source missing '+file);
 const current=fs.existsSync(file)?fs.readFileSync(file):Buffer.alloc(0),old=read(base,file)||Buffer.alloc(0);
 if(current.equals(incoming)){report.push({path:file,state:'identical'});continue;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fh-client-merge-'));
 for(const[n,data]of[['current',current],['base',old],['reviewed',incoming]])fs.writeFileSync(path.join(dir,n),data);
 const r=spawnSync('git',['merge-file','-p',...['current','base','reviewed'].map(n=>path.join(dir,n))],{maxBuffer:8*1024*1024});fs.rmSync(dir,{recursive:true,force:true});
 if(r.status!==0){report.push({path:file,state:'conflict'});continue;}
 const ids=b=>new Set([...b.toString().matchAll(/\bid=["']([^"']+)/g)].map(m=>m[1]));
 const before=ids(current),after=ids(r.stdout),removed=[...before].filter(id=>!after.has(id));
 if(file.endsWith('.html')&&removed.length){report.push({path:file,state:'removed production IDs',removed});continue;}
 pending.push({file,data:r.stdout});report.push({path:file,state:'clean merge',bytes:r.stdout.length});
}
const refused=report.some(r=>r.state==='conflict'||r.state==='removed production IDs');
fs.writeFileSync(marker,JSON.stringify({source,base,production:execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim(),checkedHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),complete:!refused,noProductionDeploy:true,noCustomerWrites:true,files:report},null,2));
if(refused)throw Error('No UI files written: manual integration required; see integration.json.');
for(const p of pending){fs.mkdirSync(path.dirname(p.file),{recursive:true});fs.writeFileSync(p.file,p.data);}
console.log('Integrated '+pending.length+' reviewed client files without removing current production HTML IDs.');
