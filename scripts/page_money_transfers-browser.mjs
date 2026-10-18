import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(), out='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
const fixture=JSON.parse(await fs.readFile('src/http/fixtures/money-transfers.sample.json','utf8'));
const server=http.createServer(async(req,res)=>{try{const p=path.join(root,'public',new URL(req.url,'http://localhost').pathname);const data=await fs.readFile(p);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'image/svg+xml');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM||'/workspace/scratch/browser-tools/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try{for(const width of [1440,390,320]){const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<760});let state='loading', role='client', posts=0;
await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(route.request().method()!=='GET'){posts++;return route.fulfill({status:409,json:{ok:false,message:'Safe test: transfer rejected'}});}
if(u.pathname==='/api/auth/session')return route.fulfill({json:{ok:true,principal:role}});
if(u.pathname==='/api/money/overview')return route.fulfill({json:{ok:true,client:{name:'Test Test'},sandbox:true}});
if(u.pathname==='/api/read/affiliate-portal')return route.fulfill({json:{ok:true,enrolled:false}});
if(u.pathname==='/api/money/transfers'){if(state==='loading')await new Promise(r=>setTimeout(r,350));if(state==='error')return route.fulfill({status:503,json:{ok:false,db:'down'}});return route.fulfill({json:state==='empty'?{...fixture,waiting:[],history:[]}:fixture});}return route.fulfill({json:{ok:false}});});
await page.goto(`http://127.0.0.1:${server.address().port}/app/money-transfers.html`);await page.waitForSelector('body[data-client-ios]');
await page.screenshot({path:`${out}/page_money_transfers-${width}-loading.png`,fullPage:true});
await page.getByRole('button',{name:'Review this move'}).waitFor();
assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true,`overflow ${width}`);
await page.getByRole('button',{name:'Review this move'}).focus();await page.keyboard.press('Enter');await page.locator('.confirm:not([hidden])').waitFor();assert.equal(posts,0);
await page.getByRole('button',{name:'Go back',exact:false}).count().then(async n=>{if(n)await page.getByRole('button',{name:'Go back',exact:false}).click();else await page.locator('[data-act="back"]').click();});
if(width<760)await page.getByRole('button',{name:'Review this move'}).tap();else await page.getByRole('button',{name:'Review this move'}).click();await page.locator('.confirm button[type="submit"]').click();await page.getByText('Safe test: transfer rejected').waitFor();assert.equal(posts,1);await page.locator('[data-act="back"]').click();
state='full';await page.reload();await page.getByRole('button',{name:'Review this move'}).waitFor();await page.locator('#transfers-root details summary').first().click();await page.screenshot({path:`${out}/page_money_transfers-${width}.png`,fullPage:true});
state='empty';await page.reload();await page.getByText('Nothing to answer').waitFor();await page.screenshot({path:`${out}/page_money_transfers-${width}-empty.png`,fullPage:true});
state='error';await page.reload();await page.locator('[data-act="retry"]').waitFor();state='full';await page.locator('[data-act="retry"]').click();await page.getByRole('button',{name:'Review this move'}).waitFor();
state='error';await page.reload();await page.locator('[data-act="retry"]').waitFor();await page.screenshot({path:`${out}/page_money_transfers-${width}-error.png`,fullPage:true});
role='owner';state='full';await page.goto(`http://127.0.0.1:${server.address().port}/app/money-transfers.html?client_id=safe-fixture`);await page.getByText('Staff only · Set up a move').waitFor();assert.equal(await page.locator('body[data-client-ios]').count(),0);assert.equal(await page.locator('[data-act="review"]').count(),0);role='client';state='full';await page.goto(`http://127.0.0.1:${server.address().port}/app/financeos.html#transfers`);await page.locator('#fos-transfers [data-act="review"]').waitFor();assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true,`tab overflow ${width}`);await page.screenshot({path:`${out}/page_money_transfers-${width}-tab.png`,fullPage:true});
results.push({tabOverflow:false,touchReview:width<760,width,overflow:false,clientActivation:true,states:['loading','full','empty','error'],keyboardReview:true,rejectedApproval:true,retry:true,staffNoClientChrome:true});await page.close();}
await fs.writeFile(`${out}/page_money_transfers-browser.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();}
