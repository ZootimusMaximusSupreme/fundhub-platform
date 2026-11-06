import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openScreen, json } from './harness.mjs';

const session = { ok:true, principal:'affiliate', staff:{ id:'seller-account', kind:'affiliate', role:'affiliate', name:'Fictional Seller', affiliate_id:'seller-affiliate', org_id:'org-1' } };
const capability = { enabled:true, amountCents:3000000, minAmountCents:2000000, maxAmountCents:3000000, amountStepCents:100, currency:'USD', offerKey:'BLUEPRINT_SELF_FUNDING', createPath:'/api/affiliates/blueprint-sale' };
const portal = { ok:true, enrolled:true, affiliate:{ id:'seller-affiliate', name:'Fictional Seller', code:'FIXTURE-SELLER', offerLinks:[] }, blueprintSeller:capability, rates:{}, gates:{license:{signed:true},tax:{onFile:true}}, referrals:[], payouts:[] };
const handoff = '/api/public/blueprint-handoff?id=aaaaaaaa-1111-4111-8111-111111111111&sig='+'a'.repeat(64);
const sale = (stage, amount=3000000) => ({ ok:true, sale:{ handoff_url:handoff, stage, amount_cents:amount, offer_key:'BLUEPRINT_SELF_FUNDING', contract_id:'aaaaaaaa-1111-4111-8111-111111111111' } });
const buyer = {first_name:'Avery',last_name:'Finch',email:'e2e+aff-blueprint@example.test',phone:'+15555550123'};
const evidence='ops/workflows/build-evidence/blake-blueprint-piping';

async function boot(page, handler, data=portal, principal=session) {
  await page.addInitScript(()=>{ window.fixtureCopied=[]; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.fixtureCopied.push(value)}}); });
  await openScreen(page,'/app/affiliate.html',principal,{'/api/read/affiliate-portal':data,'/api/affiliates/blueprint-sale':handler});
  await expect(page.locator('#affiliateLoadStatus')).toContainText('up to date');
}
async function fillBuyer(page) {
  await page.locator('#blueprintBuyerFirst').fill(buyer.first_name);
  await page.locator('#blueprintBuyerLast').fill(buyer.last_name);
  await page.locator('#blueprintBuyerEmail').fill(buyer.email);
  await page.locator('#blueprintBuyerPhone').fill(buyer.phone);
}
async function capture(page,name) {
  fs.mkdirSync(evidence,{recursive:true});
  await page.locator('#blueprintSeller').scrollIntoViewIfNeeded();
  await page.evaluate(label=>{
    const panel=document.getElementById('blueprintSeller');panel.style.outline='2px solid #dc2626';
    const rect=panel.getBoundingClientRect(),mark=document.createElement('div');mark.id='seller-proof-mark';mark.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','100%');svg.setAttribute('height','100%');
    const x=Math.min(innerWidth-24,rect.right-24),y=Math.max(24,Math.min(innerHeight-80,rect.top+28));
    svg.innerHTML='<circle cx="'+x+'" cy="'+y+'" r="16" fill="white" stroke="#dc2626" stroke-width="3"/><text x="'+x+'" y="'+(y+5)+'" text-anchor="middle" font-size="16" fill="#dc2626">1</text><path d="M '+(x-20)+' '+y+' L '+(x-84)+' '+y+' l 10 -7 m -10 7 l 10 7" fill="none" stroke="#eab308" stroke-width="4"/>';
    const caption=document.createElement('div');caption.textContent='FICTIONAL LOCAL CHECK · '+label;caption.style.cssText='position:absolute;top:8px;left:8px;right:8px;padding:8px;background:#fffbea;border:2px solid #dc2626;color:#111;font:13px/1.4 sans-serif';mark.append(svg,caption);document.body.append(mark);
  },name);
  await page.screenshot({path:`${evidence}/${name}-MARKED.png`,fullPage:true});
  await page.locator('#seller-proof-mark').evaluate(e=>e.remove());
}

for(const width of [1440,390]) test(`enabled seller creates and refreshes one buyer handoff at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});let release;const hold=new Promise(resolve=>release=resolve);const requests=[];let stage='awaiting_signature';
  await boot(page,async route=>{requests.push(JSON.parse(route.request().postData()));if(requests.length===1)await hold;await json(route,sale(stage));});
  await expect(page.locator('#blueprintSellerOpen')).toBeVisible();await expect(page.locator('#blueprintSeller')).toBeHidden();
  await page.locator('#blueprintSellerOpen').focus();await page.keyboard.press('Enter');await expect(page.locator('#blueprintBuyerFirst')).toBeFocused();
  await expect(page.locator('#blueprintSeller')).toHaveAttribute('data-state','empty');await capture(page,`seller-empty-${width}`);
  await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSeller')).toHaveAttribute('data-state','loading');await expect(page.locator('#blueprintSellerCreate')).toBeDisabled();await expect(page.locator('#blueprintBuyerFirst')).toBeDisabled();
  await page.locator('#blueprintSellerForm').dispatchEvent('submit');expect(requests).toHaveLength(1);await capture(page,`seller-loading-${width}`);
  release();await expect(page.locator('#blueprintSellerResult')).toBeVisible();await expect(page.locator('#blueprintSellerCopy')).toBeFocused();await expect(page.locator('#blueprintSellerNext')).toContainText('sign the agreement');await expect(page.locator('#blueprintBuyerLink')).toHaveValue(new URL(handoff,page.url()).href);
  await expect(page.locator('#blueprintSellerStatus')).toHaveText('This buyer link has no expiry.');await capture(page,`seller-full-${width}`);
  expect(requests[0]).toEqual({...buyer,amount_cents:3000000,request_id:expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)});
  await page.keyboard.press('Enter');await expect(page.locator('#blueprintSellerCopy')).toHaveText('Copied ✓');expect(await page.evaluate(()=>window.fixtureCopied)).toEqual([new URL(handoff,page.url()).href]);
  stage='ready_to_pay';await page.locator('#blueprintSellerRefresh').click();await expect(page.locator('#blueprintSellerNext')).toContainText('has signed');
  stage='paid';await page.locator('#blueprintSellerRefresh').click();await expect(page.locator('#blueprintSellerNext')).toContainText('Payment is confirmed');expect(requests).toHaveLength(3);expect(requests[1]).toEqual(requests[0]);expect(requests[2]).toEqual(requests[0]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const measures=await page.locator('#blueprintSeller').evaluate(el=>({inputs:[...el.querySelectorAll('input')].map(i=>parseFloat(getComputedStyle(i).fontSize)),copy:el.querySelector('#blueprintSellerCopy').getBoundingClientRect().height}));expect(measures.inputs.every(n=>n>=16)).toBe(true);expect(measures.copy).toBeGreaterThanOrEqual(48);
  await page.locator('#blueprintSellerAnother').click();await expect(page.locator('#blueprintSellerForm')).toBeVisible();await expect(page.locator('#blueprintBuyerFirst')).toHaveValue('');await expect(page.locator('#blueprintBuyerLink')).toHaveValue('');
  await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerResult')).toBeVisible();expect(requests[3].request_id).not.toBe(requests[0].request_id);
  await page.locator('#blueprintSellerClose').click();await expect(page.locator('#blueprintSeller')).toBeHidden();await expect(page.locator('#blueprintSellerOpen')).toBeFocused();
});

for(const width of [1440,390]) test(`seller failure keeps one retry request and requires explicit buyer edits at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const requests=[];let fail=true;
 await boot(page,async route=>{requests.push(JSON.parse(route.request().postData()));await json(route,fail?{ok:false,error:'provider_error',message:'PRIVATE backend detail'}:sale('awaiting_signature'),fail?503:200);});
 await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toContainText('Your details are still here');await expect(page.locator('#blueprintBuyerEmail')).toHaveValue(buyer.email);await expect(page.locator('#blueprintBuyerEmail')).toBeDisabled();await expect(page.locator('#blueprintSellerError')).not.toContainText('PRIVATE');await capture(page,`seller-error-${width}`);
 await page.locator('#blueprintBuyerEmail').evaluate(el=>el.value='changed@example.test');await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toContainText('Choose Edit buyer details');expect(requests).toHaveLength(1);
 await page.locator('#blueprintBuyerEmail').evaluate((el,value)=>el.value=value,buyer.email);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toBeVisible();expect(requests[1]).toEqual(requests[0]);
 await page.locator('#blueprintSellerEdit').click();await expect(page.locator('#blueprintBuyerEmail')).toBeEnabled();await expect(page.locator('#blueprintBuyerFirst')).toBeFocused();await page.locator('#blueprintBuyerFirst').fill('Morgan');fail=false;await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerResult')).toBeVisible();expect(requests[2].request_id).not.toBe(requests[0].request_id);expect(requests[2].first_name).toBe('Morgan');
});

for(const principal of ['affiliate','client'])test(`ordinary ${principal} never sees or posts seller controls`,async({page})=>{
 let writes=0;const person={...session,principal,staff:{...session.staff,kind:principal,role:principal}};
 await boot(page,()=>{writes++;return sale('awaiting_signature');},{...portal,blueprintSeller:{enabled:false}},person);
 await expect(page.locator('#blueprintSellerOpen')).toBeHidden();await expect(page.locator('#blueprintSeller')).toBeHidden();await page.locator('#blueprintSellerForm').dispatchEvent('submit');expect(writes).toBe(0);
});
for(const changed of [{amountCents:1},{offerKey:'OTHER'},{createPath:'/api/payment-links'},{minAmountCents:1},{maxAmountCents:9000000},{amountStepCents:1}])test(`seller control rejects mismatched server offer ${Object.keys(changed)[0]}`,async({page})=>{
 await boot(page,()=>sale('awaiting_signature'),{...portal,blueprintSeller:{...capability,...changed}});await expect(page.locator('#blueprintSellerOpen')).toBeHidden();
});
for(const badUrl of ['https://whop.com/checkout/raw/','javascript:alert(1)','https://example.test/api/public/blueprint-handoff'])test(`seller refuses unsafe handoff ${badUrl}`,async({page})=>{
 await boot(page,()=>({ok:true,sale:{...sale('awaiting_signature').sale,handoff_url:badUrl}}));await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toBeVisible();await expect(page.locator('#blueprintSellerResult')).toBeHidden();
});
for(const refresh of [false,true])test(`account change scrubs delayed ${refresh?'refresh':'create'} and all old buyer controls`,async({page})=>{
 let release;const hold=new Promise(resolve=>release=resolve);let calls=0;
 await boot(page,async route=>{calls++;if(!refresh||calls>1)await hold;try{await json(route,sale('awaiting_signature'));}catch{/* The request was deliberately aborted on account change. */}});
 await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();
 if(refresh){await expect(page.locator('#blueprintSellerResult')).toBeVisible();await page.locator('#blueprintSellerRefresh').click();}
 await expect.poll(()=>calls).toBe(refresh?2:1);
 await page.evaluate(()=>{localStorage.setItem('fh_token','different-fictional-account');window.dispatchEvent(new StorageEvent('storage',{key:'fh_token',newValue:'different-fictional-account'}));});release();
 await expect(page.locator('#blueprintSeller')).toBeHidden();await expect(page.locator('#blueprintSellerOpen')).toBeHidden();await expect(page.locator('#blueprintBuyerFirst')).toHaveValue('');await expect(page.locator('#blueprintBuyerEmail')).toHaveValue('');await expect(page.locator('#blueprintBuyerLink')).toHaveValue('');await expect(page.locator('#blueprintSellerVisit')).not.toHaveAttribute('href',/./);await page.locator('#blueprintSellerCopy').dispatchEvent('click');expect(await page.evaluate(()=>window.fixtureCopied)).toEqual([]);
});

for(const width of [1440,390])test(`saved buyer waits honestly for a real agreement at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});let ready=false;const requests=[];
 await boot(page,route=>{requests.push(JSON.parse(route.request().postData()));return ready?sale('awaiting_signature'):{ok:true,sale:{stage:'needs_contract',handoff_url:null,contract_id:null,amount_cents:3000000,offer_key:'BLUEPRINT_SELF_FUNDING',commission_status:'pending'}};});
 await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerResultTitle')).toHaveText('Preparing agreement');await expect(page.locator('#blueprintSellerNext')).toContainText('agreement before financing is available');await expect(page.locator('#blueprintSellerCopy')).toBeHidden();await expect(page.locator('#blueprintSellerVisit')).toBeHidden();await expect(page.locator('#blueprintSellerVisit')).not.toHaveAttribute('href',/./);await expect(page.locator('#blueprintBuyerLink')).toHaveValue('');await expect(page.locator('#blueprintSellerRefresh')).toBeFocused();await expect(page.locator('#blueprintSellerStatus')).not.toContainText('no expiry');await capture(page,`seller-needs-agreement-${width}`);
 ready=true;await page.locator('#blueprintSellerRefresh').click();await expect(page.locator('#blueprintSellerResultTitle')).toHaveText('Buyer link ready');await expect(page.locator('#blueprintSellerCopy')).toBeVisible();await expect(page.locator('#blueprintBuyerLink')).toHaveValue(new URL(handoff,page.url()).href);expect(requests[1]).toEqual(requests[0]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const viewport of [{width:440,height:956},{width:768,height:900},{width:1024,height:900},{width:838,height:390}])test(`seller expanded controls fit ${viewport.width}x${viewport.height}`,async({page})=>{
 await page.setViewportSize(viewport);await boot(page,()=>sale('awaiting_signature'));await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').scrollIntoViewIfNeeded();await expect(page.locator('#blueprintSellerCreate')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerResult')).toBeVisible();await page.locator('#blueprintSellerCopy').scrollIntoViewIfNeeded();await expect(page.locator('#blueprintSellerCopy')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#blueprintSellerCopy')).toBeFocused();
});

for(const width of [1440,390])test(`seller pins a negotiated $29K quote through handoff and refresh at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const requests=[];
 await boot(page,route=>{const body=JSON.parse(route.request().postData());requests.push(body);return sale('awaiting_signature',body.amount_cents);});
 await page.locator('#blueprintSellerOpen').click();await expect(page.locator('#blueprintBuyerPrice')).toHaveValue('30000');await expect(page.locator('#blueprintBuyerPrice')).toHaveAttribute('min','20000');await expect(page.locator('#blueprintBuyerPrice')).toHaveAttribute('max','30000');await expect(page.locator('#blueprintBuyerPrice')).toHaveAttribute('step','1');await fillBuyer(page);await page.locator('#blueprintBuyerPrice').fill('29000');await expect(page.locator('#blueprintSellerPriceSummary')).toContainText('$29,000');await capture(page,`seller-negotiated-price-${width}`);
 await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerAgreedPrice')).toHaveText('Agreed price: $29,000');await expect(page.locator('#blueprintSellerResult')).toBeVisible();await expect(page.locator('#blueprintBuyerPrice')).toBeDisabled();expect(requests[0].amount_cents).toBe(2900000);await capture(page,`seller-negotiated-link-${width}`);
 await page.locator('#blueprintBuyerPrice').evaluate(el=>{el.value='30000';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#blueprintSellerPriceSummary')).toContainText('$29,000');await page.locator('#blueprintSellerRefresh').click();expect(requests[1]).toEqual(requests[0]);await expect(page.locator('#blueprintSellerAgreedPrice')).toHaveText('Agreed price: $29,000');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const amount of ['19999','30001','29000.5',''])test(`seller refuses invalid agreed price ${amount||'empty'} before calling API`,async({page})=>{
 let writes=0;await boot(page,()=>{writes++;return sale('awaiting_signature');});await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintBuyerPrice').fill(amount);await page.locator('#blueprintSellerCreate').click();expect(await page.locator('#blueprintBuyerPrice').evaluate(el=>el.validity.valid)).toBe(false);expect(writes).toBe(0);await expect(page.locator('#blueprintSellerForm')).toBeVisible();
});
test('minimum permitted quote is accepted and a mismatched returned price is never shown as ready',async({page})=>{
 const requests=[];let wrong=false;await boot(page,route=>{const body=JSON.parse(route.request().postData());requests.push(body);return sale('awaiting_signature',wrong?3000000:body.amount_cents);});await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintBuyerPrice').fill('20000');await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerAgreedPrice')).toHaveText('Agreed price: $20,000');expect(requests[0].amount_cents).toBe(2000000);await page.locator('#blueprintSellerAnother').click();await fillBuyer(page);await page.locator('#blueprintBuyerPrice').fill('29000');wrong=true;await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toBeVisible();await expect(page.locator('#blueprintSellerResult')).toBeHidden();await expect(page.locator('#blueprintBuyerLink')).toHaveValue('');
});
test('changing a failed quote needs an explicit fresh request and cannot rewrite saved agreement details',async({page})=>{
 const requests=[];await boot(page,async route=>{requests.push(JSON.parse(route.request().postData()));await json(route,{ok:false,error:requests.length===1?'provider_error':'request_conflict'},requests.length===1?503:409);});await page.locator('#blueprintSellerOpen').click();await fillBuyer(page);await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerEdit')).toBeVisible();await expect(page.locator('#blueprintBuyerPrice')).toBeDisabled();await page.locator('#blueprintBuyerPrice').evaluate(el=>el.value='29000');await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toContainText('agreed price changed');expect(requests).toHaveLength(1);await page.locator('#blueprintSellerEdit').click();await expect(page.locator('#blueprintBuyerPrice')).toBeEnabled();await page.locator('#blueprintSellerCreate').click();await expect(page.locator('#blueprintSellerError')).toContainText('saved agreement details');expect(requests[1].request_id).not.toBe(requests[0].request_id);expect(requests[1].amount_cents).toBe(2900000);expect(requests[0].amount_cents).toBe(3000000);await expect(page.locator('#blueprintSellerResult')).toBeHidden();
});
