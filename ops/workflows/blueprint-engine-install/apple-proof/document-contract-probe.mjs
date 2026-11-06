import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import downloadHandler from '../../../../api/documents-download.mjs';
import {callShared} from '../../../../src/testing/s3-handler-call.mjs';
import {tableRules} from '../../../../src/testing/s3-scoped-rows.mjs';
import {req,staffSession,ORG_ID} from '../../../../src/testing/handler-harness.mjs';
const require=createRequire(process.cwd()+'/package.json');const {chromium}=require('playwright');
if(process.env.DOCUMENT_URL_SECRET)throw new Error('Probe refuses to overwrite an existing credential');
process.env.DOCUMENT_URL_SECRET='synthetic-apple-document-contract-secret-only';
const CLIENT='c1000000-0000-4000-8000-000000000001',DOC='d1000000-0000-4000-8000-0000000000d1',VERSION='e1000000-0000-4000-8000-0000000000e1';
const row={id:DOC,org_id:ORG_ID,client_id:CLIENT,title:'Synthetic packet',document_key:'synthetic-packet',kind:'deliverable',subtype:'credit_analysis_report',mime_type:'application/pdf',byte_size:100,current_version:1,current_version_id:VERSION,expires_at:null,storage_key:'synthetic-private-object'};
const {res}=await callShared(downloadHandler,req('GET',{query:{id:DOC}}),[staffSession(),...tableRules('documents',[row])]);
const SOURCE=process.env.PROBE_SOURCE||'51a57e9b61642a13cc1983ff1cefe790622f40f4';
const source=SOURCE==='working-tree'?fs.readFileSync('public/app/blueprint-fulfillment.js','utf8'):execFileSync('git',['show',SOURCE+':public/app/blueprint-fulfillment.js'],{encoding:'utf8'});
const result={checkedAt:new Date().toISOString(),source:SOURCE,scriptSha256:crypto.createHash('sha256').update(source).digest('hex'),scope:'real document-download handler and signer with synthetic stand-in DB; real client JS in isolated Chromium; no production calls',apiStatus:res.statusCode,downloadType:typeof res.body.document.download,downloadKeys:Object.keys(res.body.document.download),serverWrites:0};
const browser=await chromium.launch({headless:true,executablePath:'/Users/chrisstanbridge/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
try{
 const page=await browser.newPage();await page.context().route('**/*',r=>r.abort());await page.addInitScript(()=>localStorage.setItem('fh_token','synthetic-contract-fixture'));
 await page.context().route('**/api/**',async r=>{const p=new URL(r.request().url()).pathname;const json=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
  if(p==='/api/auth/session')return json({ok:true,principal:'client',staff:{id:'account',org_id:ORG_ID,client_id:CLIENT,role:'client'}});
  if(p==='/api/blueprint/funding')return json({ok:true,engagement:{id:'engagement',orgId:ORG_ID,clientId:CLIENT,status:'active',executionOwner:'client'},state:'held',lenders:[],applications:[]});
  if(p==='/api/blueprint/inquiries')return json({ok:true,cases:[{id:'case',bureau:'Experian',status:'In progress',packet:{complete:true},documents:[{id:DOC,title:'Open synthetic packet'}],inquiries:[],actions:{}}]});
  if(p==='/api/documents-download')return json(res.body);
  if(p.startsWith('/api/documents/')){const u=new URL(r.request().url());result.canonicalDestinationRequested=true;result.destinationPath=u.pathname;result.destinationQueryKeys=[...u.searchParams.keys()];return r.fulfill({contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n% synthetic')});}
  return json({ok:true,cases:[],requests:[],capabilities:{},allowance:{}});
 });
 await page.context().route('https://fundhub.ai/app/contract-probe.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><h1>Browser-only synthetic document contract probe</h1><section id="blueprint-fulfillment"></section><script>'+source.replaceAll('</script','<\\/script')+'</script>'}));
 await page.goto('https://fundhub.ai/app/contract-probe.html');const host=page.locator('#blueprint-fulfillment');await host.getByRole('button',{name:'Inquiry removal',exact:true}).click();
 const popup=page.waitForEvent('popup');await host.getByRole('button',{name:'Open synthetic packet'}).click();const child=await popup;await page.waitForTimeout(1000);
 result.popupClosed=child.isClosed();result.notice=await host.locator('.bf-status').innerText();result.rejectedCanonicalObject=result.notice.includes('A valid destination was not returned');
 if(!child.isClosed()){result.popupUrl=child.url().split('?')[0];await child.close();}
 const label=process.env.PROBE_LABEL||'before';fs.writeFileSync('ops/workflows/blueprint-engine-install/apple-proof/document-contract-'+label+'.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));if(SOURCE==='working-tree'&&(!result.canonicalDestinationRequested||result.rejectedCanonicalObject))process.exitCode=1;
}finally{await browser.close();}
