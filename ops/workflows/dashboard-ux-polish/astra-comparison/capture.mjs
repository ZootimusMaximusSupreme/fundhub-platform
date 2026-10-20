import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { startPreviewServer } from "./preview-server.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const OUT=path.join(HERE,"evidence");
fs.mkdirSync(path.join(OUT,"_raw"),{recursive:true});
const versions=process.argv.includes("--baseline")?["current"]:process.argv.includes("--astra")?["astra"]:["current","astra"];
const {server,origin}=await startPreviewServer();
const browser=await chromium.launch({headless:true});
const results=[];

async function marks(page,view){
  await page.evaluate(({view})=>{
    document.getElementById('__review_marks')?.remove();
    const overlay=document.createElement('div');overlay.id='__review_marks';
    overlay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:2147483646';
    const header=document.body.classList.contains('astra-team')?'.team-heading':'.main .topbar';
    const entries=view==='editor'?[['#editor .editor-hd','Person details'],['#editor .editor-ft','Actions']]:view==='roster'?[[header,'Page header'],['.content > .stats','Team status'],['#tab-roster .card-hd','Find a person']]:[['#tab-'+({permissions:'perms',clock:'clock',telemetry:'telemetry'}[view]||'roster'),'Page state']];
    let index=0;
    for(const [selector,caption]of entries){const el=document.querySelector(selector);if(!el)continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;index++;const box=document.createElement('div');box.style.cssText=`position:absolute;left:${r.left+scrollX}px;top:${r.top+scrollY}px;width:${r.width}px;height:${r.height}px;border:2px solid #dc2626`;const badge=document.createElement('span');badge.textContent=index;badge.style.cssText='position:absolute;left:2px;top:2px;background:#dc2626;color:white;border-radius:50%;width:20px;height:20px;text-align:center;font:700 12px/20px system-ui';box.append(badge);overlay.append(box);}
    const legend=document.createElement('div');legend.textContent=entries.map((x,i)=>(i+1)+': '+x[1]).join(' · ');legend.style.cssText='position:fixed;bottom:4px;right:8px;max-width:calc(100% - 16px);padding:4px 8px;border:1px solid #dc2626;background:white;color:#991b1b;font:600 11px system-ui';overlay.append(legend);document.body.append(overlay);
  },{view});
}

async function save(page,version,view,width){
  await page.screenshot({path:path.join(OUT,'_raw',`${version}-${view}-${width}.png`)});
  await marks(page,view);
  await page.screenshot({path:path.join(OUT,`${version}-${view}-${width}-MARKED.png`)});
  await page.evaluate(()=>document.getElementById('__review_marks')?.remove());
}

try{
 for(const width of [1440,390])for(const version of versions){
  const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'America/Phoenix',serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-20T16:00:00Z'));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(`${origin}/app/staff-teams.html?variant=${version}`);
  await expect(page.locator('#rosterBody')).toContainText('Alex Morgan');
  await expect(page.locator('#kHead')).toHaveText('27');
  await page.evaluate(()=>document.fonts.ready);
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
  const rosterGeometry=await page.locator('#rosterTbl').evaluate(table=>({tableRight:table.getBoundingClientRect().right,containerRight:table.parentElement.getBoundingClientRect().right,rowRight:Math.max(...Array.from(table.querySelectorAll('tr[data-id]'),row=>row.getBoundingClientRect().right))}));
  if(version==='astra'&&width===390){
    expect(rosterGeometry.tableRight).toBeLessThanOrEqual(rosterGeometry.containerRight+1);
    expect(rosterGeometry.rowRight).toBeLessThanOrEqual(rosterGeometry.containerRight+1);
  }
  await save(page,version,'roster',width);
  await page.locator('#roleFilter').selectOption('Closer');
  await expect(page.locator('#rosterBody')).toContainText('Sam Rivera');
  await expect(page.locator('#rosterBody')).not.toContainText('Alex Morgan');
  await page.locator('#roleFilter').selectOption('');
  await page.locator('#qFilter').fill('alex.morgan@');
  await expect(page.locator('#rosterBody tr[data-id]')).toHaveCount(1);
  await page.locator('#qFilter').fill('');
  await page.locator('#rosterBody tr[data-id="preview-02"]').click();
  await expect(page.locator('#editor')).toHaveClass(/open/);
  await expect(page.locator('#ed_first')).toHaveValue('Jordan');
  await save(page,version,'editor',width);
  await page.locator('#edCancel').click();
  await expect(page.locator('#editor')).not.toHaveClass(/open/);
  for(const [tab,view]of [['perms','permissions'],['clock','clock'],['telemetry','telemetry']]){
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await expect(page.locator('#tab-'+tab)).toHaveClass(/on/);
    if(tab==='telemetry'){
      await page.locator('#teleStaff').selectOption('preview-02');
      await expect(page.locator('#teleHours')).toHaveText('6.25h');
      await page.locator('#teleRefresh').click();
    }
    await save(page,version,view,width);
  }
  results.push({version,width,overflow,rosterGeometry,pageErrors:errors,checks:['27 staff','role filter','email filter','person drawer','cancel','permissions tab','clock tab','telemetry picker','telemetry refresh']});
  if(errors.length)throw new Error(errors.join('; '));
  for(const state of ['empty','loading','error']){
    const staffRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/read/staff');
    const staffResponse=state==='loading'?null:page.waitForResponse(response=>new URL(response.url()).pathname==='/api/read/staff');
    await page.goto(`${origin}/app/staff-teams.html?variant=${version}&state=${state}`,{waitUntil:'domcontentloaded'});
    await staffRequest;
    if(staffResponse)await staffResponse;
    if(state==='empty')await expect(page.locator('#kHead')).toHaveText('0');
    // Capture the baseline honestly even where its original page has no state panel.
    const text=await page.locator('body').innerText();
    results.at(-1).states??={};
    results.at(-1).states[state]={loadingText:/loading/i.test(text),errorText:/unavailable|could not|failed/i.test(text)};
    await save(page,version,state,width);
  }
  await context.close();
  console.log(JSON.stringify(results.at(-1)));
 }
 const resultPath=path.join(OUT,'capture-results.json');
 const previous=fs.existsSync(resultPath)?JSON.parse(fs.readFileSync(resultPath,'utf8')).results:[];
 const combined=[...previous.filter(row=>!versions.includes(row.version)),...results];
 fs.writeFileSync(resultPath,JSON.stringify({capturedAt:new Date().toISOString(),synthetic:true,liveConnections:0,results:combined},null,2)+'\n');
 if(combined.some(row=>row.version==='current')&&combined.some(row=>row.version==='astra')){
   const page=await browser.newPage({viewport:{width:1800,height:1100}});
   await page.goto(origin+'/comparison');
   await expect.poll(()=>page.locator('.shot').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
   await page.screenshot({path:path.join(OUT,'desktop-comparison.png'),fullPage:true});
   await page.setViewportSize({width:1000,height:1200});
   await page.locator('#size').selectOption('390');
   await expect.poll(()=>page.locator('.shot').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth===390))).toBe(true);
   await page.screenshot({path:path.join(OUT,'phone-comparison.png'),fullPage:true});
   await page.close();
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
