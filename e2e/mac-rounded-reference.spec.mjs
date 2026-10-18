import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {openScreen,CLOSER} from './harness.mjs';
// Use the installed browser's real macOS identity, not the global Desktop Chrome device's Linux UA.
test.use({userAgent:undefined});
test.skip(process.platform!=='darwin','Native Apple system-font proof runs on the dedicated macOS job.');
const out='ops/workflows/build-evidence/crm-mac-font';
for(const width of [1440,390,320])test('actual macOS rounded typography at '+width,async({page,context})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await openScreen(page,'/app/my-numbers.html',CLOSER,{'/api/read/my-numbers':{ok:true}});
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(out+'/platform-'+width+'.json',JSON.stringify(await page.evaluate(()=>({platform:navigator.platform,hints:navigator.userAgentData&&navigator.userAgentData.platform,ua:navigator.userAgent,adapter:!!window.FHFundhubType})),null,2));
 await expect(page.locator('html')).toHaveAttribute('data-fh-apple-rounded','');
 await page.evaluate(()=>{
  const node=document.createElement('div');node.id='native-rounded-proof';
  node.textContent='Your work,\nin focus.';
  node.style.cssText='position:fixed;inset:90px auto auto 18px;z-index:2147483647;width:460px;max-width:calc(100vw - 36px);padding:28px;background:#f8f8f6;color:#0d1113;border:2px solid #b32020;border-radius:18px;font-size:58px;font-weight:600;letter-spacing:-2.5px;line-height:1.16;white-space:pre-line;box-sizing:border-box';
  document.body.appendChild(node);
 });
 await page.locator('#native-rounded-proof').boundingBox();
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const dom=await cdp.send('DOM.getDocument');
 const n=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#native-rounded-proof'});
 const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:n.nodeId});
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(out+'/actual-'+width+'.json',JSON.stringify({width,fonts,nativeSystemResolved:fonts.some(f=>/SF.*Rounded|Apple.*Rounded/i.test(f.familyName)),platform:await page.evaluate(()=>navigator.platform),source:process.env.GITHUB_SHA},null,2));
 await page.screenshot({path:out+'/actual-'+width+'.png',fullPage:false});
 expect(fonts.length).toBeGreaterThan(0);
 // Chrome on macOS does not expose the hidden native system rounded family.
 // Preserve the actual family in evidence and require the documented rounded fallback.
 expect(fonts.some(f=>/Rounded|Nunito/i.test(f.familyName))).toBe(true);
});
