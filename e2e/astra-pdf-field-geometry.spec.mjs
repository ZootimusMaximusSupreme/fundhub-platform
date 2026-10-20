import { test, expect, devices, chromium, webkit } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';

const signingUrl = '/contract.html?id=sample-contract&sig=sample-signature&exp=4102444800&signer=sample-signer';
// Same fictional document and saved placement fractions as page_contract.spec.mjs.
const fields = [
  { id:'address', type:'text', label:'Address', required:true, x:.1, y:.2, w:.6, h:.05, page:0 },
  { id:'confirm', type:'checkbox', label:'Confirm details', required:true, x:.1, y:.3, w:.05, h:.05, page:0 },
  { id:'sig', type:'signature', label:'Signature', required:true, x:.1, y:.5, w:.5, h:.05, page:0 },
  { id:'initials', type:'initials', label:'Initials', required:true, x:.1, y:.6, w:.2, h:.05, page:0 }
];
const contract = {
  title:'Your funding agreement', body:'This sample document is used only by the browser test.',
  source_kind:'pdf', can_sign:true, verified:true, status:'sent',
  signer:{ name:'Sample Client', status:'sent' },
  signature_statement:'I have read this document and agree to sign electronically.', fields
};
const { defaultBrowserType: _defaultBrowserType, ...proMax } = devices['iPhone 17 Pro Max'];
const profiles = [
  { name:'phone390', options:{ viewport:{ width:390, height:844 }, hasTouch:true } },
  { name:'promax440', options:proMax },
  { name:'desktop1440', options:{ viewport:{ width:1440, height:1000 } } }
];

async function measure(page) {
  return page.evaluate(expected => {
    const rect = element => {
      const b = element.getBoundingClientRect();
      return { x:b.x, y:b.y, width:b.width, height:b.height, right:b.right, bottom:b.bottom };
    };
    const host = document.querySelector('.pagewrap');
    const hr = rect(host), hs = getComputedStyle(host);
    const origin = { x:hr.x + parseFloat(hs.borderLeftWidth), y:hr.y + parseFloat(hs.borderTopWidth) };
    const normal = ['#name', '.agree', '#go', '#barGo'].map(selector => {
      const el = document.querySelector(selector), css = getComputedStyle(el);
      return { selector, box:rect(el), font:parseFloat(css.fontSize), lineHeight:css.lineHeight };
    });
    return {
      viewport:{ width:innerWidth, height:innerHeight }, pageWidth:document.documentElement.scrollWidth,
      host:{ ...hr, clientWidth:host.clientWidth, clientHeight:host.clientHeight }, normal,
      fields:expected.map(field => {
        const el = document.querySelector(`[data-fid="${field.id}"]`);
        const input = el.querySelector('input'), css = getComputedStyle(el);
        const textNode = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        let text = null;
        if (textNode) { const range = document.createRange(); range.selectNodeContents(textNode); text = rect(range); }
        return {
          id:field.id, type:field.type, box:rect(el), text,
          expected:{ x:origin.x + host.clientWidth*field.x, y:origin.y + host.clientHeight*field.y,
            width:host.clientWidth*field.w, height:host.clientHeight*field.h },
          inline:{ left:el.style.left, top:el.style.top, width:el.style.width, height:el.style.height },
          border:parseFloat(css.borderTopWidth),
          input:input ? { ...rect(input), font:parseFloat(getComputedStyle(input).fontSize),
            paddingTop:parseFloat(getComputedStyle(input).paddingTop),
            paddingBottom:parseFloat(getComputedStyle(input).paddingBottom),
            border:parseFloat(getComputedStyle(input).borderTopWidth) } : null
        };
      })
    };
  }, fields);
}

function expectGeometry(result) {
  expect(result.pageWidth).toBeLessThanOrEqual(result.viewport.width);
  for (const [index, field] of result.fields.entries()) {
    const saved = fields[index];
    expect(field.inline).toEqual({ left:`${saved.x*100}%`, top:`${saved.y*100}%`, width:`${saved.w*100}%`, height:`${saved.h*100}%` });
    for (const key of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(field.box[key] - field.expected[key]), `${field.id} ${key} follows saved PDF fraction`).toBeLessThan(.6);
    }
    if (field.input) {
      expect(field.input.y).toBeGreaterThanOrEqual(field.box.y + field.border - .6);
      expect(field.input.bottom).toBeLessThanOrEqual(field.box.bottom - field.border + .6);
      expect(field.input.x).toBeGreaterThanOrEqual(field.box.x + field.border - .6);
      expect(field.input.right).toBeLessThanOrEqual(field.box.right - field.border + .6);
      expect(field.input.font).toBeGreaterThanOrEqual(16);
      expect(field.input.paddingTop + field.input.paddingBottom + field.input.border).toBe(0);
    }
    if (field.text) {
      expect(field.text.y, `${field.id} painted text top`).toBeGreaterThanOrEqual(field.box.y - .6);
      expect(field.text.bottom, `${field.id} painted text bottom`).toBeLessThanOrEqual(field.box.bottom + .6);
      expect(field.text.x).toBeGreaterThanOrEqual(field.box.x - .6);
      expect(field.text.right).toBeLessThanOrEqual(field.box.right + .6);
    }
  }
  for (let a=0; a<result.fields.length; a++) for (let b=a+1; b<result.fields.length; b++) {
    const one=result.fields[a].box, two=result.fields[b].box;
    const overlapX=Math.min(one.right,two.right)-Math.max(one.x,two.x);
    const overlapY=Math.min(one.bottom,two.bottom)-Math.max(one.y,two.y);
    expect(overlapX>0 && overlapY>0, 'distinct fixture annotations must not overlap').toBe(false);
  }
  for (const control of result.normal) {
    expect(control.box.height, `${control.selector} ordinary hit height`).toBeGreaterThanOrEqual(control.selector === '.agree' ? 44 : 48);
    expect(control.box.width).toBeGreaterThanOrEqual(44);
    expect(control.font, `${control.selector} ordinary font`).toBeGreaterThanOrEqual(16);
  }
}

async function markedCapture(page, testInfo) {
  await page.locator('[data-fid="address"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const root=document.createElement('div');
    root.id='pdf-geometry-review';
    root.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    for (const [index,id] of ['address','sig','initials'].entries()) {
      const b=document.querySelector(`[data-fid="${id}"]`).getBoundingClientRect();
      const mark=document.createElement('div');
      mark.style.cssText=`position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;border:2px solid #dc2626;box-sizing:border-box`;
      const label=document.createElement('span');
      label.textContent=`${index+1} → ${id}: ${b.height.toFixed(2)}px`;
      label.style.cssText='position:absolute;left:0;top:-24px;white-space:nowrap;background:#fffbea;color:#b91c1c;font:700 13px/20px Arial';
      mark.append(label); root.append(mark);
    }
    const caption=document.createElement('div');
    caption.textContent='KEEP: red boxes match saved PDF coordinates. Address input stays inside; signature/initials retain their scaled height. Fictional fixture; Sign not clicked.';
    caption.style.cssText='position:absolute;bottom:4px;left:4px;right:4px;background:#fffbea;border:2px solid #dc2626;padding:8px;color:#111;font:13px/1.4 Arial';
    root.append(caption);document.body.append(root);
  });
  const screenshot=testInfo.outputPath('pdf-fields-MARKED.png');
  await page.screenshot({ path:screenshot });
  await testInfo.attach('marked PDF geometry', { path:screenshot, contentType:'image/png' });
  await page.locator('#pdf-geometry-review').evaluate(el=>el.remove());
}

for (const engine of ['chromium', 'webkit']) for (const profile of profiles) {
  test.describe(`${engine} ${profile.name}`, () => {
    test('saved PDF boxes contain editors without shrinking ordinary signing controls', async ({ baseURL }, testInfo) => {
      const browser=await test.step(`launch ${engine}`, () => ({ chromium, webkit })[engine].launch({
        // The runner's Chromium executable override otherwise leaks into this launch.
        ...(engine === 'chromium' ? testInfo.project.use.launchOptions : { executablePath:webkit.executablePath() }),
        timeout:10_000
      }));
      const context=await test.step('create isolated context', () => browser.newContext({ ...profile.options, baseURL, serviceWorkers:'block' }));
      const page=await test.step('create page', () => context.newPage());
      try {
      const pdf=await PDFDocument.create();pdf.addPage([612,792]);
      const bytes=Buffer.from(await pdf.save()).toString('base64');
      const receipt={ errors:[], api:[], writes:[], auth:[], blockedExternal:[], unexpected:[] };
      page.on('pageerror', error=>receipt.errors.push(error.message));
      const origin=new URL(baseURL).origin;
      // A pre-existing staff session must never become this public link's credential.
      await context.addInitScript(() => {
        localStorage.setItem('fh_token','e2e-fake-staff-session');
        localStorage.setItem('fh_role','owner');
      });
      await context.route('**/*', async route => {
        const request=route.request(), target=new URL(request.url());
        if (target.origin !== origin) {
          receipt.blockedExternal.push(target.hostname);
          return route.abort();
        }
        if (request.headers().authorization) receipt.auth.push(target.pathname);
        if (request.method() !== 'GET') {
          receipt.writes.push({ method:request.method(), path:target.pathname });
          return route.fulfill({ status:403, json:{ ok:false } });
        }
        if (target.pathname === '/api/contracts/sign') {
          receipt.api.push(target.search);
          expect(target.searchParams.get('sig')).toBe('sample-signature');
          expect(target.searchParams.get('signer')).toBe('sample-signer');
          return route.fulfill({ json:target.searchParams.has('file') ? { ok:true, pdf_base64:bytes } : { ok:true, contract } });
        }
        if (target.pathname.startsWith('/api/')) {
          receipt.unexpected.push(target.pathname);
          return route.fulfill({ status:404, json:{ ok:false } });
        }
        return route.continue();
      });
      await test.step('open fictional signed link', () => page.goto(signingUrl));
      await expect(page.locator('.pagewrap canvas')).toBeVisible();
      await expect(page.locator('.fld')).toHaveCount(4);
      await test.step('wait for local fonts', () => page.evaluate(()=>document.fonts.ready));
      await expect(page.locator('#go')).toBeDisabled();
      const blank=await measure(page);
      expectGeometry(blank);
      const address=page.getByLabel('Address (required)');
      await address.click();
      await expect(address).toBeFocused();
      await page.keyboard.type('123 Test Street');
      await expect(address).toHaveValue('123 Test Street');
      await expect(page.locator('#go')).toBeDisabled();
      const checkbox=page.getByRole('checkbox', { name:'Confirm details (required)' });
      await checkbox.focus();await page.keyboard.press('Space');
      await expect(checkbox).toHaveAttribute('aria-checked','true');
      for (const [id,key] of [['sig','Enter'],['initials','Space']]) {
        await page.locator(`[data-fid="${id}"]`).focus();
        await page.keyboard.press(key);
        await expect(page.locator('#name')).toBeFocused();
      }
      await page.keyboard.type('Sample Client');
      await expect(page.locator('#name')).toHaveValue('Sample Client');
      await expect(page.locator('#go')).toBeDisabled();
      await page.locator('#agree').focus();await page.keyboard.press('Space');
      await expect(page.locator('#agree')).toBeChecked();
      await expect(page.locator('#go')).toBeEnabled();
      await expect(page.locator('#barGo')).toBeEnabled();
      await expect(page.locator('[data-fid="sig"]')).toContainText('Sample Client');
      await expect(page.locator('[data-fid="initials"]')).toContainText('SC');
      await page.locator('#go').focus();
      await expect(page.locator('#go')).toBeFocused();
      // Do not activate Sign: exercise the local gates, never send a write.
      await page.locator('[data-fid="address"]').scrollIntoViewIfNeeded();
      const filled=await measure(page);
      expectGeometry(filled);
      await markedCapture(page,testInfo);
      expect(receipt.errors).toEqual([]);
      expect(receipt.writes).toEqual([]);
      expect(receipt.auth).toEqual([]);
      expect(receipt.unexpected).toEqual([]);
      expect(receipt.api).toHaveLength(2);
      expect(await page.locator('script[src*="shell.js"],script[src*="data.js"]').count()).toBe(0);
      expect(await page.evaluate(()=>localStorage.getItem('fh_token'))).toBe('e2e-fake-staff-session');
      const evidence=testInfo.outputPath('geometry.json');
      await fs.writeFile(evidence,JSON.stringify({ engine, profile:profile.name, blank, filled, receipt },null,2));
      await testInfo.attach('geometry and zero-write isolation', { path:evidence, contentType:'application/json' });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  });
}
