import {test,expect} from '@playwright/test';
import {withSession,wireApi} from './harness.mjs';
test.use({hasTouch:true});
for(const width of [1440,390,320]) test(`consent workspace ${width} states and controls`,async({page})=>{
 await page.setViewportSize({width,height:1000});await withSession(page);let state='loading',release;const pending=new Promise(r=>release=r);const posts=[];
 const capture=async state=>test.info().attach(`Safe consent fixture ${width}px — ${state}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 await wireApi(page,{handlers:{'/api/consent/capture':async(route,{method})=>{
 if(method==='POST'){posts.push(route.request().postDataJSON());return {ok:false,message:'Test refusal — no authorization saved.'};}
 if(state==='loading')await pending;
 if(state==='error')return {ok:false,message:'Consent service unavailable. Try again.'};
 return {ok:true,disclosure:{version:'2.1',text:'Fixture disclosure supplied by the test server. No real permission is recorded.'},status:{valid:false,reason:'none_on_file'},history:state==='full'?[{id:'safe-consent',valid:true,granted_at:'2026-10-17',capture_method:'typed',granted_name:'Sample Client',granted_by_kind:'client'}]:[]};}}});
 await page.goto('/app/consent-capture.html?client_id=aaaaaaaa-1111-4111-8111-111111111111');
 await expect(page.locator('#ccStatusLede')).toHaveText('Loading…');await capture('loading');state='empty';release();
 await expect(page.locator('#ccHistory')).toContainText('Nothing recorded yet');await capture('empty');
 await page.locator('[data-method="signature"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-method="signature"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#ccName').fill('Sample Client');await page.locator('#ccSubmit').click();await expect(page.locator('#ccMsg')).toContainText('Draw your signature');
 await page.locator('#ccSignPad').scrollIntoViewIfNeeded();const box=await page.locator('#ccSignPad').boundingBox();
 await page.mouse.move(box.x+25,box.y+25);await page.mouse.down();await page.mouse.move(box.x+110,box.y+65,{steps:8});await page.mouse.up();
 await page.locator('#ccSubmit').click();await expect(page.locator('#ccMsg')).toContainText('Test refusal');expect(posts[0]).toMatchObject({capture_method:'signature',granted_name:'Sample Client',consent_version:'2.1'});
 await page.locator('#ccSignClear').tap();await page.locator('#ccSubmit').click();await expect(page.locator('#ccMsg')).toContainText('Draw your signature');
 state='full';await page.reload();await expect(page.locator('#ccHistory')).toContainText('Sample Client');await capture('full');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.cc-note summary').click();await expect(page.locator('.cc-note')).toHaveAttribute('open','');
 state='error';await page.reload();await expect(page.locator('#ccSubmit')).toBeDisabled();await expect(page.locator('#ccStatusLede')).toHaveText('Cannot check consent');await capture('error');
});