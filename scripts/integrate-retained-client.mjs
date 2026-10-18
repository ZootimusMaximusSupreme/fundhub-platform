import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
const base='0998ff49969c6e2663a6e1851b4634ab5896113d';
const pages=(process.env.RECOVERY_PAGES||'payment-success,reset-password,consent-capture,automations').split(',');
const read=(ref,p)=>{const r=spawnSync('git',['show',ref+':'+p]);return r.status===0?r.stdout:null;};
const aside=/<aside\b[^>]*class=["'][^"']*\b(?:sidebar|side)\b[^"']*["'][^>]*>[\s\S]*?<\/aside>/i;
const font=/<!-- Shared Fundhub rounded typography; custom tenant fonts stay server-selected\. -->\s*<link rel="preload" href="\/assets\/fonts\/nunito-latin-variable\.woff2"[^>]*>\s*<link rel="stylesheet" href="\/app\/fundhub-font\.css">\s*<script defer src="\/app\/fundhub-font\.js"><\/script>\s*/;
const inventory=[],pending=[],report=[];let refused=false;
for(const page of pages){
 const ref='origin/codex/recover-'+page;
 execFileSync('git',['fetch','origin','codex/recover-'+page],{stdio:'inherit'});
 const source=execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim();
 if(source===base)throw Error(page+' original owner recovery has not been pushed');
 const files=execFileSync('git',['diff','--name-only',base,source],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const prefix=page==='reset-password'?'public/':'public/app/';
 const named=p=>p.replaceAll('_','-').includes(page);
 const allowed=p=>p.startsWith(prefix+page)&&/\.(?:html|css|js)$/.test(p)||p.startsWith('e2e/')&&named(p)&&p.endsWith('.mjs')||(p.startsWith('ops/workflows/')&&named(p)&&p.endsWith('.md'))||p.startsWith('src/')&&named(p)&&p.endsWith('.test.mjs');
 if(files.some(p=>!allowed(p)))throw Error('Page ownership boundary failed: '+page+' '+files.filter(p=>!allowed(p)).join(', '));
 inventory.push({page,branch:ref,source,files});
 for(const file of files){
  const incoming=read(ref,file);if(!incoming)throw Error('Refusing deletion '+file);
  const current=fs.existsSync(file)?fs.readFileSync(file):Buffer.alloc(0),old=read(base,file)||Buffer.alloc(0);
  let data=[current,old,incoming],savedAside=null,savedFont=null;
  if(file.endsWith('.html')){
   const text=current.toString();savedAside=text.match(aside)?.[0];savedFont=text.match(font)?.[0];
   if(!savedFont)throw Error('Shared font boundary missing '+file);
   if(!savedAside&&data.some(v=>aside.test(v.toString())))throw Error('Refusing to add or remove shared chrome '+file);
   data=data.map(v=>Buffer.from(v.toString().replace(aside,'<!-- ROOT_SHARED_SIDEBAR -->').replace(font,'')));
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fh-staff-recover-'));
  for(let i=0;i<3;i++)fs.writeFileSync(path.join(dir,String(i)),data[i]);
  const r=spawnSync('git',['merge-file','-p',...[0,1,2].map(n=>path.join(dir,String(n)))],{maxBuffer:8*1024*1024});
  fs.rmSync(dir,{recursive:true,force:true});
  if(r.status!==0){refused=true;report.push({page,path:file,state:'conflict'});continue;}
  let merged=r.stdout;
  if(file.endsWith('.html')){
   let html=merged.toString().replace('<!-- ROOT_SHARED_SIDEBAR -->',savedAside||'').replace(/(<head[^>]*>\s*)/i,'$1'+savedFont);
   merged=Buffer.from(html);
   const ids=v=>new Set([...v.toString().matchAll(/\bid=["']([^"']+)/g)].map(m=>m[1]));
   const after=ids(merged),removed=[...ids(current)].filter(x=>!after.has(x));
   if(removed.length){refused=true;report.push({page,path:file,state:'production IDs removed',removed});continue;}
  }
  pending.push({page,file,data:merged});report.push({page,path:file,state:current.equals(merged)?'identical':'clean merge',bytes:merged.length});
 }
}
for(const {page,file,data}of pending.filter(p=>p.file.endsWith('.js')||p.file.endsWith('.mjs'))){
 const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:data});
 if(result.status!==0){refused=true;report.push({page,path:file,state:'syntax failure',reason:result.stderr.toString().slice(0,2000)});}
}
const dir='ops/workflows/build-evidence/crm-client-retained';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/integration.json',JSON.stringify({base,checkedHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),complete:!refused,inventory,files:report,noProductionDeploy:true,noCustomerWrites:true},null,2));
if(refused)throw Error('No page files written: manual reconciliation required');
for(const {file,data}of pending){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);}
console.log('Integrated retained original client-page owners with current shared type/navigation and all production HTML IDs retained.');
