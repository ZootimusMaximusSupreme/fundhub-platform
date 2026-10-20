# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: astra-pdf-field-geometry.spec.mjs >> webkit phone390 >> saved PDF boxes contain editors without shrinking ordinary signing controls
- Location: e2e/astra-pdf-field-geometry.spec.mjs:128:5

# Error details

```
TimeoutError: browserType.launch: Timeout 10000ms exceeded.
Call log:
  - <launching> /Users/chrisstanbridge/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --inspector-pipe --headless --no-startup-window
  - <launched> pid=70292

```

# Test source

```ts
  29  |       const b = element.getBoundingClientRect();
  30  |       return { x:b.x, y:b.y, width:b.width, height:b.height, right:b.right, bottom:b.bottom };
  31  |     };
  32  |     const host = document.querySelector('.pagewrap');
  33  |     const hr = rect(host), hs = getComputedStyle(host);
  34  |     const origin = { x:hr.x + parseFloat(hs.borderLeftWidth), y:hr.y + parseFloat(hs.borderTopWidth) };
  35  |     const normal = ['#name', '.agree', '#go', '#barGo'].map(selector => {
  36  |       const el = document.querySelector(selector), css = getComputedStyle(el);
  37  |       return { selector, box:rect(el), font:parseFloat(css.fontSize), lineHeight:css.lineHeight };
  38  |     });
  39  |     return {
  40  |       viewport:{ width:innerWidth, height:innerHeight }, pageWidth:document.documentElement.scrollWidth,
  41  |       host:{ ...hr, clientWidth:host.clientWidth, clientHeight:host.clientHeight }, normal,
  42  |       fields:expected.map(field => {
  43  |         const el = document.querySelector(`[data-fid="${field.id}"]`);
  44  |         const input = el.querySelector('input'), css = getComputedStyle(el);
  45  |         const textNode = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  46  |         let text = null;
  47  |         if (textNode) { const range = document.createRange(); range.selectNodeContents(textNode); text = rect(range); }
  48  |         return {
  49  |           id:field.id, type:field.type, box:rect(el), text,
  50  |           expected:{ x:origin.x + host.clientWidth*field.x, y:origin.y + host.clientHeight*field.y,
  51  |             width:host.clientWidth*field.w, height:host.clientHeight*field.h },
  52  |           inline:{ left:el.style.left, top:el.style.top, width:el.style.width, height:el.style.height },
  53  |           border:parseFloat(css.borderTopWidth),
  54  |           input:input ? { ...rect(input), font:parseFloat(getComputedStyle(input).fontSize),
  55  |             paddingTop:parseFloat(getComputedStyle(input).paddingTop),
  56  |             paddingBottom:parseFloat(getComputedStyle(input).paddingBottom),
  57  |             border:parseFloat(getComputedStyle(input).borderTopWidth) } : null
  58  |         };
  59  |       })
  60  |     };
  61  |   }, fields);
  62  | }
  63  |
  64  | function expectGeometry(result) {
  65  |   expect(result.pageWidth).toBeLessThanOrEqual(result.viewport.width);
  66  |   for (const [index, field] of result.fields.entries()) {
  67  |     const saved = fields[index];
  68  |     expect(field.inline).toEqual({ left:`${saved.x*100}%`, top:`${saved.y*100}%`, width:`${saved.w*100}%`, height:`${saved.h*100}%` });
  69  |     for (const key of ['x', 'y', 'width', 'height']) {
  70  |       expect(Math.abs(field.box[key] - field.expected[key]), `${field.id} ${key} follows saved PDF fraction`).toBeLessThan(.6);
  71  |     }
  72  |     if (field.input) {
  73  |       expect(field.input.y).toBeGreaterThanOrEqual(field.box.y + field.border - .6);
  74  |       expect(field.input.bottom).toBeLessThanOrEqual(field.box.bottom - field.border + .6);
  75  |       expect(field.input.x).toBeGreaterThanOrEqual(field.box.x + field.border - .6);
  76  |       expect(field.input.right).toBeLessThanOrEqual(field.box.right - field.border + .6);
  77  |       expect(field.input.font).toBeGreaterThanOrEqual(16);
  78  |       expect(field.input.paddingTop + field.input.paddingBottom + field.input.border).toBe(0);
  79  |     }
  80  |     if (field.text) {
  81  |       expect(field.text.y, `${field.id} painted text top`).toBeGreaterThanOrEqual(field.box.y - .6);
  82  |       expect(field.text.bottom, `${field.id} painted text bottom`).toBeLessThanOrEqual(field.box.bottom + .6);
  83  |       expect(field.text.x).toBeGreaterThanOrEqual(field.box.x - .6);
  84  |       expect(field.text.right).toBeLessThanOrEqual(field.box.right + .6);
  85  |     }
  86  |   }
  87  |   for (let a=0; a<result.fields.length; a++) for (let b=a+1; b<result.fields.length; b++) {
  88  |     const one=result.fields[a].box, two=result.fields[b].box;
  89  |     const overlapX=Math.min(one.right,two.right)-Math.max(one.x,two.x);
  90  |     const overlapY=Math.min(one.bottom,two.bottom)-Math.max(one.y,two.y);
  91  |     expect(overlapX>0 && overlapY>0, 'distinct fixture annotations must not overlap').toBe(false);
  92  |   }
  93  |   for (const control of result.normal) {
  94  |     expect(control.box.height, `${control.selector} ordinary hit height`).toBeGreaterThanOrEqual(control.selector === '.agree' ? 44 : 48);
  95  |     expect(control.box.width).toBeGreaterThanOrEqual(44);
  96  |     expect(control.font, `${control.selector} ordinary font`).toBeGreaterThanOrEqual(16);
  97  |   }
  98  | }
  99  |
  100 | async function markedCapture(page, testInfo) {
  101 |   await page.locator('[data-fid="address"]').scrollIntoViewIfNeeded();
  102 |   await page.evaluate(() => {
  103 |     const root=document.createElement('div');
  104 |     root.id='pdf-geometry-review';
  105 |     root.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  106 |     for (const [index,id] of ['address','sig','initials'].entries()) {
  107 |       const b=document.querySelector(`[data-fid="${id}"]`).getBoundingClientRect();
  108 |       const mark=document.createElement('div');
  109 |       mark.style.cssText=`position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;border:2px solid #dc2626;box-sizing:border-box`;
  110 |       const label=document.createElement('span');
  111 |       label.textContent=`${index+1} → ${id}: ${b.height.toFixed(2)}px`;
  112 |       label.style.cssText='position:absolute;left:0;top:-24px;white-space:nowrap;background:#fffbea;color:#b91c1c;font:700 13px/20px Arial';
  113 |       mark.append(label); root.append(mark);
  114 |     }
  115 |     const caption=document.createElement('div');
  116 |     caption.textContent='KEEP: red boxes match saved PDF coordinates. Address input stays inside; signature/initials retain their scaled height. Fictional fixture; Sign not clicked.';
  117 |     caption.style.cssText='position:absolute;bottom:4px;left:4px;right:4px;background:#fffbea;border:2px solid #dc2626;padding:8px;color:#111;font:13px/1.4 Arial';
  118 |     root.append(caption);document.body.append(root);
  119 |   });
  120 |   const screenshot=testInfo.outputPath('pdf-fields-MARKED.png');
  121 |   await page.screenshot({ path:screenshot });
  122 |   await testInfo.attach('marked PDF geometry', { path:screenshot, contentType:'image/png' });
  123 |   await page.locator('#pdf-geometry-review').evaluate(el=>el.remove());
  124 | }
  125 |
  126 | for (const engine of ['chromium', 'webkit']) for (const profile of profiles) {
  127 |   test.describe(`${engine} ${profile.name}`, () => {
  128 |     test('saved PDF boxes contain editors without shrinking ordinary signing controls', async ({ baseURL }, testInfo) => {
> 129 |       const browser=await test.step(`launch ${engine}`, () => ({ chromium, webkit })[engine].launch({
      |                                                                                              ^ TimeoutError: browserType.launch: Timeout 10000ms exceeded.
  130 |         ...(engine === 'chromium' ? testInfo.project.use.launchOptions : {}), timeout:10_000
  131 |       }));
  132 |       const context=await test.step('create isolated context', () => browser.newContext({ ...profile.options, baseURL, serviceWorkers:'block' }));
  133 |       const page=await test.step('create page', () => context.newPage());
  134 |       try {
  135 |       const pdf=await PDFDocument.create();pdf.addPage([612,792]);
  136 |       const bytes=Buffer.from(await pdf.save()).toString('base64');
  137 |       const receipt={ errors:[], api:[], writes:[], auth:[], blockedExternal:[], unexpected:[] };
  138 |       page.on('pageerror', error=>receipt.errors.push(error.message));
  139 |       const origin=new URL(baseURL).origin;
  140 |       await context.route('**/*', async route => {
  141 |         const request=route.request(), target=new URL(request.url());
  142 |         if (target.origin !== origin) {
  143 |           receipt.blockedExternal.push(target.hostname);
  144 |           return route.abort();
  145 |         }
  146 |         if (request.headers().authorization) receipt.auth.push(target.pathname);
  147 |         if (request.method() !== 'GET') {
  148 |           receipt.writes.push({ method:request.method(), path:target.pathname });
  149 |           return route.fulfill({ status:403, json:{ ok:false } });
  150 |         }
  151 |         if (target.pathname === '/api/contracts/sign') {
  152 |           receipt.api.push(target.search);
  153 |           expect(target.searchParams.get('sig')).toBe('sample-signature');
  154 |           expect(target.searchParams.get('signer')).toBe('sample-signer');
  155 |           return route.fulfill({ json:target.searchParams.has('file') ? { ok:true, pdf_base64:bytes } : { ok:true, contract } });
  156 |         }
  157 |         if (target.pathname.startsWith('/api/')) {
  158 |           receipt.unexpected.push(target.pathname);
  159 |           return route.fulfill({ status:404, json:{ ok:false } });
  160 |         }
  161 |         return route.continue();
  162 |       });
  163 |       await test.step('open fictional signed link', () => page.goto(signingUrl));
  164 |       await expect(page.locator('.pagewrap canvas')).toBeVisible();
  165 |       await expect(page.locator('.fld')).toHaveCount(4);
  166 |       await test.step('wait for local fonts', () => page.evaluate(()=>document.fonts.ready));
  167 |       await expect(page.locator('#go')).toBeDisabled();
  168 |       const blank=await measure(page);
  169 |       expectGeometry(blank);
  170 |       const address=page.getByLabel('Address (required)');
  171 |       await address.click();
  172 |       await expect(address).toBeFocused();
  173 |       await page.keyboard.type('123 Test Street');
  174 |       await expect(address).toHaveValue('123 Test Street');
  175 |       await expect(page.locator('#go')).toBeDisabled();
  176 |       const checkbox=page.getByRole('checkbox', { name:'Confirm details (required)' });
  177 |       await checkbox.focus();await page.keyboard.press('Space');
  178 |       await expect(checkbox).toHaveAttribute('aria-checked','true');
  179 |       for (const [id,key] of [['sig','Enter'],['initials','Space']]) {
  180 |         await page.locator(`[data-fid="${id}"]`).focus();
  181 |         await page.keyboard.press(key);
  182 |         await expect(page.locator('#name')).toBeFocused();
  183 |       }
  184 |       await page.keyboard.type('Sample Client');
  185 |       await expect(page.locator('#name')).toHaveValue('Sample Client');
  186 |       await expect(page.locator('#go')).toBeDisabled();
  187 |       await page.locator('#agree').focus();await page.keyboard.press('Space');
  188 |       await expect(page.locator('#agree')).toBeChecked();
  189 |       await expect(page.locator('#go')).toBeEnabled();
  190 |       await expect(page.locator('#barGo')).toBeEnabled();
  191 |       await expect(page.locator('[data-fid="sig"]')).toContainText('Sample Client');
  192 |       await expect(page.locator('[data-fid="initials"]')).toContainText('SC');
  193 |       await page.locator('#go').focus();
  194 |       await expect(page.locator('#go')).toBeFocused();
  195 |       // Do not activate Sign: exercise the local gates, never send a write.
  196 |       await page.locator('[data-fid="address"]').scrollIntoViewIfNeeded();
  197 |       const filled=await measure(page);
  198 |       expectGeometry(filled);
  199 |       await markedCapture(page,testInfo);
  200 |       expect(receipt.errors).toEqual([]);
  201 |       expect(receipt.writes).toEqual([]);
  202 |       expect(receipt.auth).toEqual([]);
  203 |       expect(receipt.unexpected).toEqual([]);
  204 |       expect(receipt.api).toHaveLength(2);
  205 |       expect(await page.locator('script[src*="shell.js"],script[src*="data.js"]').count()).toBe(0);
  206 |       const evidence=testInfo.outputPath('geometry.json');
  207 |       await fs.writeFile(evidence,JSON.stringify({ engine, profile:profile.name, blank, filled, receipt },null,2));
  208 |       await testInfo.attach('geometry and zero-write isolation', { path:evidence, contentType:'application/json' });
  209 |       } finally {
  210 |         await context.close();
  211 |         await browser.close();
  212 |       }
  213 |     });
  214 |   });
  215 | }
  216 |
```
