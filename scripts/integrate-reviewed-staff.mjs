import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const source='803d2b7e47f137d7773d4006445b971179cef835';
execFileSync('git',['fetch','origin','main','codex/crm-portal-layout-professional'],{stdio:'inherit'});
const base=execFileSync('git',['merge-base','origin/main',source],{encoding:'utf8'}).trim();
const paths=[
'public/app/fundhub-brand.css','public/app/crm-sidebar.css','public/app/shell.js','public/app/sidebar.fragment.html','public/app/workspace-ui.css',
'public/app/calendar.html','public/app/calendar-workspace.css','public/app/client-control-panel.html','public/app/ccp-workspace.css','public/app/ccp-workspace.js',
'public/app/closer-dashboard.html','public/app/closer-dashboard.css','public/app/closer-dashboard-layout.js',
'public/app/documents.html','public/app/documents-workspace.css','public/app/messaging.html','public/app/pipeline.html','public/app/pipeline-workspace.css',
'e2e/calendar-workspace.spec.mjs','e2e/ccp-workspace-layout.spec.mjs','e2e/closer-dashboard-layout.spec.mjs','e2e/documents-workspace.spec.mjs','e2e/messaging-layout-professional.spec.mjs','e2e/pipeline-workspace.spec.mjs',
'e2e/calendar.spec.mjs','e2e/bank-amount-suggestion.spec.mjs','e2e/ccp-headline.spec.mjs','e2e/closer-call-rhythm.spec.mjs','e2e/controls-persist.spec.mjs','e2e/fin-b01-ccp-pulls-declines.spec.mjs','e2e/funded-amount.spec.mjs','e2e/pipeline-waiting-on.spec.mjs','e2e/proxy-apply.spec.mjs','e2e/s2-ccp-portal-access.spec.mjs','e2e/sidebar-roles.spec.mjs',
'src/http/client-panel-screen.test.mjs','src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs'
];
const read=(ref,file)=>{const r=spawnSync('git',['show',ref+':'+file]);return r.status===0?r.stdout:null;};
const pending=[],report=[];
for(const file of paths){
 const incoming=read(source,file);if(!incoming)throw new Error('Reviewed file missing: '+file);
 const previous=read(base,file)||Buffer.alloc(0),current=fs.existsSync(file)?fs.readFileSync(file):Buffer.alloc(0);
 if(current.equals(incoming)){report.push({path:file,state:'identical'});continue;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fh-ui-merge-'));
 for(const [name,data] of [['current',current],['base',previous],['reviewed',incoming]])fs.writeFileSync(path.join(dir,name),data);
 const merged=spawnSync('git',['merge-file','-p',path.join(dir,'current'),path.join(dir,'base'),path.join(dir,'reviewed')],{maxBuffer:8*1024*1024});
 fs.rmSync(dir,{recursive:true,force:true});
 if(merged.status!==0){report.push({path:file,state:'conflict',detail:merged.stderr.toString().slice(0,500)});continue;}
 const ids=text=>new Set([...text.toString().matchAll(/\bid=["']([^"']+)/g)].map(m=>m[1]));
 const before=ids(current),after=ids(merged.stdout),removed=[...before].filter(id=>!after.has(id));
 if(file.endsWith('.html')&&removed.length){report.push({path:file,state:'removed production controls',removed});continue;}
 pending.push({file,content:merged.stdout});report.push({path:file,state:'merged',removedCommentIds:removed});
}
const out='ops/workflows/build-evidence/crm-font-live';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/staff-integration.json',JSON.stringify({base,production:execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim(),source,files:report},null,2));
if(report.some(r=>r.state==='conflict'||r.state==='removed production controls'))throw new Error('Manual integration required; no app merge written. See staff-integration.json');
for(const item of pending){fs.mkdirSync(path.dirname(item.file),{recursive:true});fs.writeFileSync(item.file,item.content);}
const shell='public/app/shell.js';let js=fs.readFileSync(shell,'utf8');
js=js.replace('if (!actions.length) legacy.classList.add("fh-empty-toolbar");','if (legacy.querySelector("#shiftChip")) legacy.classList.add("fh-status-toolbar");\n      if (!actions.length && !legacy.querySelector("#shiftChip")) legacy.classList.add("fh-empty-toolbar");');
const remembered='    if (remembered) {\n      var recentLink = document.createElement("a");';
if(!js.includes('This view is your own signed-in performance.')){
 if(!js.includes(remembered))throw new Error('Inspect shared scope before changing own-performance label');
 js=js.replace(remembered,'    if (PAGE === "my-numbers.html") {\n      header.setAttribute("data-fh-scope", "session-staff");\n      label.textContent = scopeText("Your performance");\n      copy.textContent = demo ? "Fictional data for exploring this staff account." : "This view is your own signed-in performance.";\n      remembered = "";\n    }\n'+remembered);
}
fs.writeFileSync(shell,js);
const side='public/app/crm-sidebar.css';let css=fs.readFileSync(side,'utf8');
if(!css.includes('Atomic desktop rail changes')){
 css+='\n/* Atomic desktop rail changes preserve labels and screenshot geometry; mobile keeps its drawer animation. */\n@media(min-width:861px){.side,.app,.app-shell{transition:none!important}}\n';fs.writeFileSync(side,css);
}
const workCSS='public/app/workspace-ui.css';let wc=fs.readFileSync(workCSS,'utf8');
if(!wc.includes('fh-status-toolbar #staffChip')){wc+='\n/* Shift state stays visible when duplicate identity moves into Account. */\n.fh-staff-workspace .fh-status-toolbar #staffChip,.fh-staff-workspace .fh-status-toolbar>.eyebrow{display:none}\n';fs.writeFileSync(workCSS,wc);}
const htmlTest='src/http/crm-html.test.mjs';let ht=fs.readFileSync(htmlTest,'utf8');
const clock='    assert.ok(clocks.length > 0, file + " has no .clock");';
if(ht.includes(clock)){
 ht=ht.replace(clock,'    if (clocks.length === 0) {\n      const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");\n      assert.ok(html.includes("shell.js"), file + " lacks the shared workspace");\n      assert.match(shell, /fh-account-technical/, "clock diagnostics must remain in the account details");\n      continue;\n    }');fs.writeFileSync(htmlTest,ht);
}
execFileSync(process.execPath,['scripts/sync-sidebar.mjs'],{stdio:'inherit'});
// Reapply this branch's font adapter and inclusions to the merged current code.
execFileSync(process.execPath,['scripts/prepare-rounded-type.mjs'],{stdio:'inherit'});
const notes=['workspace-foundation','page-pipeline','page-calendar','page-client-control-panel','page-closer-dashboard','page-documents','page-messaging'];
for(const note of notes){const file='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/'+note+'.md';const data=read(source,file);if(data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);}}
console.log('Merged '+pending.length+' reviewed staff files on current production; API/server files and client portal layout were not replaced.');
