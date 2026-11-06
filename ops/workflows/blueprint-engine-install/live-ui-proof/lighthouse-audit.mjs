import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const ROOT='/Users/chrisstanbridge/.codex/worktrees/blueprint-client-fulfillment/fundhub-platform';
const LH='/Users/chrisstanbridge/.npm/_npx/8003d8991b0d346b/node_modules/lighthouse';
const require=createRequire(LH+'/package.json');
const {launch}=await import(require.resolve('chrome-launcher'));
const {default:lighthouse}=await import(LH+'/core/index.js');
const EXE='/Users/chrisstanbridge/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const OUT=ROOT+'/ops/workflows/blueprint-engine-install/live-ui-proof/lighthouse';
await fs.mkdir(OUT,{recursive:true});
const summary={checkedAt:new Date().toISOString(),lighthouseVersion:'12.8.2',mode:'LIVE unauthenticated entry; the final URL identifies redirect destination. No full authenticated page claim.',throttling:{method:'simulate',rttMs:150,throughputKbps:1638.4,cpuSlowdownMultiplier:4},runs:[]};
const chrome=await launch({chromePath:EXE,chromeFlags:['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],logLevel:'silent'});
try {
 for(const [label,rel] of [['client-portal-entry','app/client-portal.html'],['csm-queue-entry','app/csm-queue.html']])for(let run=1;run<=3;run++){
  const lr=await lighthouse('https://fundhub.ai/'+rel,{port:chrome.port,output:['json','html'],logLevel:'error',onlyCategories:['performance'],formFactor:'mobile',throttlingMethod:'simulate',throttling:{rttMs:150,throughputKbps:1638.4,cpuSlowdownMultiplier:4},screenEmulation:{mobile:true,width:390,height:844,deviceScaleFactor:1,disabled:false},disableStorageReset:false});
  const f=label+'-'+run;await fs.writeFile(OUT+'/'+f+'.json',lr.report[0]);await fs.writeFile(OUT+'/'+f+'.html',lr.report[1]);
  const l=lr.lhr,a=l.audits,requests=a['network-requests']?.details?.items||[],blocking=a['render-blocking-resources']?.details?.items||[];
  summary.runs.push({label,run,requestedUrl:l.requestedUrl,finalDisplayedUrl:l.finalDisplayedUrl,finalUrl:l.finalUrl,runtimeError:l.runtimeError||null,performance:l.categories.performance.score,lcpMs:a['largest-contentful-paint']?.numericValue,tbtMs:a['total-blocking-time']?.numericValue,cls:a['cumulative-layout-shift']?.numericValue,ttfbMs:a['server-response-time']?.numericValue,speedIndexMs:a['speed-index']?.numericValue,totalBytes:a['total-byte-weight']?.numericValue,jsBytes:requests.filter(r=>r.resourceType==='Script').reduce((s,r)=>s+(r.transferSize||0),0),byType:Object.fromEntries([...new Set(requests.map(r=>r.resourceType))].map(t=>[t,requests.filter(r=>r.resourceType===t).reduce((s,r)=>s+(r.transferSize||0),0)])),blockingRequests:blocking.sort((a,b)=>(b.wastedMs||0)-(a.wastedMs||0)).slice(0,5),lcpElement:a['largest-contentful-paint-element']?.details||a['lcp-discovery-insight']?.details||a['lcp-phases-insight']?.details||null,thirdParty:requests.filter(r=>{try{return new URL(r.url).hostname!=='fundhub.ai'}catch{return false}}).map(r=>({url:r.url,transferSize:r.transferSize})),report:f});
  console.log(JSON.stringify({label,run,score:l.categories.performance.score,lcpMs:a['largest-contentful-paint']?.numericValue,finalUrl:l.finalDisplayedUrl||l.finalUrl}));
  await fs.writeFile(OUT+'/summary.json',JSON.stringify(summary,null,2)+'\n');
 }
const reqRoot=createRequire(ROOT+'/package.json');const {chromium}=reqRoot('playwright');const browser=await chromium.connectOverCDP('http://127.0.0.1:'+chrome.port);const context=browser.contexts()[0];const metadata=[];for(const rel of ['app/client-portal.html','app/csm-queue.html']){const page=await context.newPage();await page.goto('https://fundhub.ai/'+rel,{waitUntil:'networkidle'});metadata.push(await page.evaluate(()=>({url:location.href,inlineStyleAttributes:document.querySelectorAll('[style]').length,renderBlockingHeadScriptCount:[...document.head.querySelectorAll('script[src]')].filter(e=>!e.async&&!e.defer&&e.type!=='module').length,headScripts:[...document.head.querySelectorAll('script[src]')].map(e=>({src:e.src,defer:e.defer,async:e.async})),stylesheets:[...document.querySelectorAll('link[rel=stylesheet]')].map(e=>e.href)})));await page.close();}await fs.writeFile(OUT+'/page-metadata.json',JSON.stringify(metadata,null,2)+'\n');await browser.close();
}finally{await chrome.kill();}
