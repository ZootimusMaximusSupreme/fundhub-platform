import fs from 'node:fs';
import path from 'node:path';
const pages=fs.readdirSync('public/app').filter(name=>name.endsWith('.html')&&!['index.html','closer-call.html','sidebar.fragment.html'].includes(name)).map(name=>'public/app/'+name);
pages.push(...['login','portal-login','reset-password','contract','progress'].map(name=>'public/'+name+'.html'));
const changed=[];
const include='\n<!-- Shared Fundhub rounded typography; custom tenant fonts stay server-selected. -->\n<link rel="preload" href="/assets/fonts/nunito-latin-variable.woff2" as="font" type="font/woff2" crossorigin>\n<link rel="stylesheet" href="/app/fundhub-font.css">\n<script defer src="/app/fundhub-font.js"></script>\n';
for(const file of pages){
 if(!fs.existsSync(file))throw new Error('Missing actual page '+file);
 let text=fs.readFileSync(file,'utf8');
 if(!text.includes('/app/fundhub-font.css')){
  if(!/<head(?:\s[^>]*)?>/i.test(text))throw new Error('No head: '+file);
  text=text.replace(/<head(?:\s[^>]*)?>/i,match=>match+include);
  fs.writeFileSync(file,text);changed.push(file);
 }
}
const shell='public/app/shell.js';let js=fs.readFileSync(shell,'utf8');
if(!js.includes('FHFundhubType.applyBrand')){
 if(!js.includes('function paintBrand(b) {')||!js.includes('function applyBrand(/* staff */) {')||!js.includes('paintBrand(d.brand);'))throw new Error('Brand adapter changed; inspect before patching');
 js=js.replace('function paintBrand(b) {','function paintBrand(b, staff) {');
 js=js.replace('function paintBrand(b, staff) {\n    if (!b) return;','function paintBrand(b, staff) {\n    if (!b) return;\n    if (window.FHFundhubType) window.FHFundhubType.applyBrand(b, staff);');
 js=js.replace('function applyBrand(/* staff */) {','function applyBrand(staff) {').replace('paintBrand(d.brand);','paintBrand(d.brand, staff);');
 fs.writeFileSync(shell,js);changed.push(shell);
}
const brandTest='e2e/partner-brand-crm.spec.mjs';let test=fs.readFileSync(brandTest,'utf8');
const old='expect(t.sans).toContain("Inter");';
if(test.includes(old)){test=test.replace(old,'expect(t.sans).toContain("Fundhub Rounded");');fs.writeFileSync(brandTest,test);changed.push(brandTest);}
const gap='src/pulse/coverage/gap-portal.test.mjs';let g=fs.readFileSync(gap,'utf8');
const marker='  const portal = names("app/client-portal.html", "/app/client-portal.html");';
if(!g.includes('sharedTypeAssets')){
 if(!g.includes(marker))throw new Error('Asset proof changed');
 g=g.replace(marker,'  const sharedTypeAssets = ["/app/fundhub-font.css", "/app/fundhub-font.js"];\n'+marker);
 for(const entry of [
  ['portal-login.html','/portal-login.html','["/fh.css"]'],
  ['reset-password.html','/reset-password.html','["/fh.css", "/pw-toggle.js"]'],
  ['progress.html','/progress.html','[]'],
  ['app/payment-success.html','/app/payment-success.html','["/app/fundhub-brand.css"]']
 ]){
  const before='assert.deepEqual(names("'+entry[0]+'", "'+entry[1]+'"), '+entry[2]+');';
  const after='assert.deepEqual(names("'+entry[0]+'", "'+entry[1]+'"), [...sharedTypeAssets, ...'+entry[2]+']);';
  if(!g.includes(before))throw new Error('Inspect changed entry asset proof: '+entry[0]);
  g=g.replace(before,after);
 }
 g=g.replace('for (const name of [...portal, ...money, "/fh.css", "/pw-toggle.js"]) {','for (const name of [...portal, ...money, ...sharedTypeAssets, "/fh.css", "/pw-toggle.js"]) {');
 fs.writeFileSync(gap,g);changed.push(gap);
}
fs.mkdirSync('ops/workflows/build-evidence/crm-font-live',{recursive:true});
fs.writeFileSync('ops/workflows/build-evidence/crm-font-live/font-preparation.json',JSON.stringify({changed,pages:pages.length,reference:'tools/fundhub-mac/FundhubMac.swift WelcomeView .system(size:58,weight:.semibold,design:.rounded)',appleFontsBundled:false,webFallback:'Nunito under OFL1.1; actual Apple system face used only when available'},null,2));
console.log('Prepared shared typography for '+pages.length+' actual pages; no business handlers or role gates changed.');
