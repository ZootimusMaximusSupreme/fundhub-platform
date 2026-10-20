import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices, expect } from "@playwright/test";
import sample from "../../../src/demo/client-portal-sample-bundle.json" with { type: "json" };
import { openScreen, CLIENT_ID, PIPELINE_STAGES } from "../../../e2e/harness.mjs";
import { startPreviewServer } from "../dashboard-ux-polish/astra-comparison/preview-server.mjs";
import { createFixture } from "../dashboard-ux-polish/astra-comparison/fixtures.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,"../../..");
const LIVE=process.argv.includes("--live-deployed");
if(LIVE&&process.env.UX_POLISH_SHOTS==="1")throw new Error("Live proof cannot replace deployed assets with local files.");
const OUT=path.join(HERE,LIVE?"evidence/live-responsive":"evidence/responsive");
fs.mkdirSync(OUT,{recursive:true});
fs.mkdirSync(path.join(OUT,"_raw"),{recursive:true});
const client={ok:true,principal:"client",portal_sample_available:true,portal_sample:true,staff:{id:CLIENT_ID,client_id:CLIENT_ID,role:"client",name:"Fictional Preview",email:"preview@example.test",affiliate_id:"preview-affiliate",org_id:"preview-org",status:"active"}};
const staff=createFixture().staff;
const owner={ok:true,principal:"staff",staff:staff[0]};
const affiliate={ok:true,enrolled:true,affiliate:{id:"preview-affiliate",name:"Fictional Preview",code:"PREVIEW-ONLY",offerLinks:[{name:"Funding",url:"https://example.test/start?ref=PREVIEW-ONLY"}]},rates:{direct:{rules:[{}],percent:20}},gates:{license:{signed:true},tax:{onFile:true}},referrals:Array.from({length:27},(_,i)=>({attributedAt:"2026-10-17",name:`Fictional Business ${i+1}`,status:i%2?"converted":"attributed",product:"Consulting",basisAmount:3000,commissionDue:null})),payouts:[]};
const pages=[
 {key:"teams",url:"/app/staff-teams.html?variant=rollout",session:owner,ready:"#rosterBody tr[data-id]",handlers:{"/api/read/staff":{ok:true,items:staff,hiddenCount:0},"/api/shifts":{ok:true,shift:null}}},
 {key:"portal",url:`/app/client-portal.html?id=${CLIENT_ID}`,session:client,ready:".cp-next-action",handlers:{"/api/read/portal-summary":sample.reads["/api/read/portal-summary"],"/api/read/affiliate-portal":{ok:true,enrolled:false}}},
 {key:"money",url:"/app/money.html",session:client,ready:"#money-root .tiles",handlers:sample.reads},
 {key:"affiliate",url:"/app/affiliate.html",session:client,ready:"#leadBody",handlers:{"/api/read/affiliate-portal":affiliate}},
 {key:"pipeline",url:"/app/pipeline.html",session:owner,ready:".card[data-client-id]",handlers:{"/api/dashboard/pipeline":{ok:true,pipeline:"sales",total:1,stages:PIPELINE_STAGES}}},
];
const selected=(process.argv.find(arg=>arg.startsWith("--pages="))||"").slice(8).split(",").filter(Boolean);
if(LIVE&&selected.length)throw new Error("Live release proof must run all five pages and all seven profiles; --pages is local-only.");
const profiles=[
 {key:"phone390",engine:"chromium",options:{viewport:{width:390,height:844},hasTouch:true}},
 {key:"promax",engine:"webkit",options:devices["iPhone 17 Pro Max"]},
 {key:"promax-landscape",engine:"webkit",options:devices["iPhone 17 Pro Max landscape"]},
 {key:"intermediate768",engine:"chromium",options:{viewport:{width:768,height:1024},hasTouch:true}},
 {key:"intermediate1024",engine:"chromium",options:{viewport:{width:1024,height:768},hasTouch:true}},
 {key:"mac-webkit1280",engine:"webkit",options:{viewport:{width:1280,height:800}}},
 {key:"desktop1440",engine:"chromium",options:{viewport:{width:1440,height:1000}}},
];
const preview=LIVE?null:await startPreviewServer();
const origin=LIVE?"https://fundhub.ai":preview.origin;
const browsers={chromium:await chromium.launch({headless:true}),webkit:await webkit.launch({headless:true})};
const results=[];
try{
 if(LIVE){
  const source=execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim();
  const baseline="f1490ce9da5006eca89c3387e575a090a371d1d0";
  const files=execFileSync("git",["diff","--name-only",`${baseline}...HEAD`,"--","public"],{cwd:ROOT,encoding:"utf8"}).trim().split("\n").filter(Boolean);
  if(!files.length)throw new Error("Release asset list is empty; this cannot prove a deployed rollout.");
  const context=await browsers.chromium.newContext({serviceWorkers:"block"});
  const assets=[];
  try{
   for(const file of files){
    if(!file.startsWith("public/")||file.includes(".."))throw new Error(`Invalid release asset path: ${file}`);
    const assetPath=file.slice("public".length);
    const response=await context.request.get(`${origin}${assetPath}?astra_release=${source}`,{headers:{"cache-control":"no-cache"}});
    const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
    const expected=hash(fs.readFileSync(path.join(ROOT,file)));
    const actual=hash(await response.body());
    assets.push({path:assetPath,status:response.status(),expected,actual,matches:response.ok()&&expected===actual});
   }
  }finally{await context.close();}
  const receipt={checkedAt:new Date().toISOString(),source,baseline,site:origin,readOnly:true,localAssetReplacement:false,assets};
  fs.writeFileSync(path.join(OUT,"asset-bytes.json"),JSON.stringify(receipt,null,2)+"\n");
  const mismatches=assets.filter(asset=>!asset.matches);
  if(mismatches.length)throw new Error(`${mismatches.length}/${assets.length} deployed release assets do not match; see live-responsive/asset-bytes.json. No live UI pass is claimed.`);
 }
 for(const target of pages.filter(page=>!selected.length||selected.includes(page.key)))for(const profile of profiles){
  const context=await browsers[profile.engine].newContext({...profile.options,baseURL:origin,timezoneId:"America/Phoenix",serviceWorkers:"block"});
  const page=await context.newPage();
  const errors=[];
  const denied=[];
  const interceptedWrites=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{
   const url=new URL(request.url());
   if(url.origin===origin&&url.pathname.startsWith("/api/")&&!["GET","HEAD"].includes(request.method()))interceptedWrites.push(`${request.method()} ${url.pathname}`);
  });
  await page.route("**/*",route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   // wireApi is installed later and intercepts every API route first. This
   // fail-closed fallback prevents an unhandled production request escaping.
   if(LIVE&&(!["GET","HEAD"].includes(request.method())||url.pathname.startsWith("/api/")||! /\.(?:html|css|js|mjs|json|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|ico|pdf)$/i.test(url.pathname))){
    denied.push(`${request.method()} ${url.pathname}`);
    return route.abort();
   }
   return route.continue();
  });
  const handlers={...sample.reads,"/api/read/affiliate-portal":{ok:true,enrolled:false},...target.handlers};
  const record={page:target.key,profile:profile.key,engine:profile.engine,fixture:true,liveAssets:LIVE,realDevice:false,errors,denied,interceptedWrites};
  try{
   await openScreen(page,LIVE?target.url.replace("?variant=rollout",""):target.url,target.session,handlers);
   await expect(page.locator(target.ready).first()).toBeVisible();
   await expect(page.locator("body")).toHaveClass(/fh-astra/);
   await page.evaluate(()=>document.fonts.ready);
   record.geometry=await page.evaluate(()=>{
     const visible=e=>{
       const r=e.getBoundingClientRect();
       if(!(r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth))return false;
       if(typeof e.checkVisibility==='function'&&!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
       for(let ancestor=e;ancestor;ancestor=ancestor.parentElement){
         const style=getComputedStyle(ancestor);
         if(style.visibility==='hidden'||style.display==='none'||Number(style.opacity)===0)return false;
         if(ancestor.tagName==='DETAILS'&&!ancestor.open&&!ancestor.querySelector(':scope > summary')?.contains(e))return false;
       }
       const style=getComputedStyle(e);
       return style.clipPath!=='inset(50%)'&&style.clip!=='rect(0px, 0px, 0px, 0px)';
     };
     const detail=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,id:e.id,text:(e.innerText||e.getAttribute("aria-label")||e.getAttribute("placeholder")||"").trim().slice(0,72),width:Math.round(r.width*100)/100,height:Math.round(r.height*100)/100,font:parseFloat(s.fontSize),x:Math.round(r.x),y:Math.round(r.y)}};
     const controls=Array.from(document.querySelectorAll("button,a[href],input,select,textarea,summary,[role=button],[role=switch]")).filter(visible).filter(e=>!e.closest("#__comparison_notice"));
     const undersized=controls.map(detail).filter(c=>c.height<43.5||c.width<43.5);
     const smallInputs=controls.filter(e=>/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)&&!['checkbox','radio'].includes(e.type)).map(detail).filter(c=>c.font<15.9);
     const text=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
     while(walker.nextNode()){const n=walker.currentNode,e=n.parentElement;if(!e||!n.textContent.trim()||e.closest("script,style,svg,#__comparison_notice")||!visible(e))continue;const s=getComputedStyle(e);if(parseFloat(s.fontSize)<12.9&&/[A-Za-z0-9]/.test(n.textContent))text.push(detail(e));}
     return{viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth,bodyFont:parseFloat(getComputedStyle(document.body).fontSize),undersized,smallInputs,smallText:text.slice(0,30)};
   });
   const rawShot=await page.screenshot();
   fs.writeFileSync(path.join(OUT,"_raw",`${target.key}-${profile.key}.png`),rawShot);
   // Red callouts preserve exact observed hit-area/readability issues, not a claimed pass.
   await page.evaluate(({title,geometry})=>{
     const issues=[...geometry.undersized,...geometry.smallInputs].slice(0,4);
     for(const [i,item]of issues.entries()){const box=document.createElement("div");box.style.cssText=`position:absolute;left:${item.x+scrollX}px;top:${item.y+scrollY}px;width:${item.width}px;height:${item.height}px;border:2px solid #dc2626;z-index:2147483646;pointer-events:none`;box.textContent=String(i+1);document.body.append(box);}
   },{title:`${target.key} · ${profile.key}`,geometry:record.geometry});
   const shot=`${target.key}-${profile.key}-MARKED.png`;
   const marked=await page.screenshot();
   const {width,height}=record.geometry.viewport;
   const poster=await browsers.chromium.newPage({viewport:{width,height:height+64},deviceScaleFactor:profile.options.deviceScaleFactor||1});
   const title=`${target.key} · ${profile.key} · ${width}×${height}`;
   await poster.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:white;font:12px system-ui}header{height:64px;padding:8px;border:2px solid #dc2626;color:#991b1b;display:flex;flex-direction:column;justify-content:center}img{display:block;width:100%;height:auto}</style><header><b>${LIVE?"LIVE ASSETS / FICTIONAL API FIXTURE":"LOCAL FICTIONAL PREVIEW"} · ${title}</b><span>Controlled browser data. Not a real-device or authenticated customer-path test.</span></header><img src="data:image/png;base64,${marked.toString("base64")}" alt="Marked application preview">`);
   await poster.locator("img").evaluate(image=>image.decode());
   await poster.screenshot({path:path.join(OUT,shot)});
   await poster.close();
   record.screenshot=shot;
   record.passed=errors.length===0&&denied.length===0&&interceptedWrites.length===0&&record.geometry.bodyFont>=15.9&&record.geometry.pageWidth<=record.geometry.viewport.width&&record.geometry.undersized.length===0&&record.geometry.smallInputs.length===0&&record.geometry.smallText.length===0;
  }catch(error){record.passed=false;record.failure=error.message.slice(0,1200);await page.screenshot({path:path.join(OUT,`${target.key}-${profile.key}-FAILED.png`)}).catch(()=>{});}
  results.push(record);console.log(JSON.stringify(record));await context.close();
 }
 const file=path.join(OUT,"results.json");
 const previous=!LIVE&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")).results:[];
 const keys=new Set(results.map(row=>row.page+":"+row.profile));
 fs.writeFileSync(file,JSON.stringify({capturedAt:new Date().toISOString(),synthetic:true,realDevice:false,liveAssets:LIVE,site:origin,localAssetReplacement:false,results:[...previous.filter(row=>!keys.has(row.page+":"+row.profile)),...results]},null,2)+"\n");
 if(results.some(row=>!row.passed))process.exitCode=1;
}finally{await Promise.all(Object.values(browsers).map(browser=>browser.close()));if(preview){preview.server.closeAllConnections();await new Promise(resolve=>preview.server.close(resolve));}}
