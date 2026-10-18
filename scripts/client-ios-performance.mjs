// Reproducible lab timing. API fixtures measure presentation, not live backend latency.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const port='43149';
const server=spawn(process.execPath,['e2e/static-server.mjs'],{env:{...process.env,E2E_PORT:port},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM,headless:true});
const results=[];
try {
 for(const path of ['/portal-login.html','/app/client-portal.html']){
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.addInitScript(()=>{
   localStorage.setItem('fh_token','safe-lab-fixture');localStorage.setItem('fh_role','client');
   window.lab={lcp:null,cls:0};
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.lab.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.lab.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
  });
  await page.route('**/api/**',route=>{
   const p=new URL(route.request().url()).pathname;
   let data={ok:true,items:[],db:'up'};
   if(p==='/api/auth/session')data={ok:true,principal:'client',had_call:true,staff:{role:'client',client_id:'aaaaaaaa-1111-4111-8111-111111111111',name:'Safe Lab Fixture'}};
   if(p==='/api/read/portal-summary')data={ok:true,scores:{},documents:[]};
   if(p==='/api/read/affiliate-portal')data={ok:true,enrolled:false};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(`http://127.0.0.1:${port}${path}`,{waitUntil:'load',timeout:30000});
  await page.waitForTimeout(1500);
  results.push(await page.evaluate(path=>{
   const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');
   return {path,lcp_ms:window.lab.lcp,cls:window.lab.cls,ttfb_ms:n.responseStart-n.requestStart,resource_transfer_bytes:r.reduce((n,e)=>n+e.transferSize,0),javascript_transfer_bytes:r.filter(e=>e.initiatorType==='script').reduce((n,e)=>n+e.transferSize,0),notes:'390px; 150ms RTT, 1.6Mbps download, 4x CPU; safe mocked APIs; no real backend timing. INP not measured.'};
  },path));
  await context.close();
 }
 const out='ops/workflows/build-evidence/client-portal-ios-redo/performance-lab.json';
 fs.writeFileSync(out,JSON.stringify({browser:await browser.version(),results},null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser.close();server.kill();}
