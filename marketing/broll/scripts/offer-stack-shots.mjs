// Renders the /roadmap checkout's own "See a sample" previews to PNG for the
// OfferStack B-roll cards. Source: marketing/landing-pages/slo/slo-01-sales.html
// (the live page file). It opens each sample with the page's own script, at
// phone width, and screenshots the top of the document (the part the page shows
// clearly, above its blur). Nothing on the page file is changed.
//
// Run from marketing/broll:  node scripts/offer-stack-shots.mjs
// Writes: public/offer-stack/<key>.png
//
// Sample-client rule (.claude/rules/sample-clients-consistent.md): every card
// must come from the one /roadmap sample client (the simulated 762 file).
// - snapshot, analysis, roadmap: from that file (UnderwriteIQ run, see
//   ops/workflows/2026-10-02-roadmap-sample-content.md). Shot as shown.
// - pack: the page's one full letter is for a charge-off account from a
//   different (sandbox) file, so it is hidden here; the card shows the pack's
//   six-round list, which carries no file's numbers.
// - lenders: the bank list from the lender book (no client numbers).
// - duplication: the page's sample names a different business and state than
//   the sample client, so it is NOT shot. The B-roll draws a title-only card.
import {chromium} from 'playwright';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const broll = resolve(here, '..');
const repo = resolve(broll, '..', '..');
const pagePath = join(repo, 'marketing/landing-pages/slo/slo-01-sales.html');
const logoDir = join(repo, 'public/assets/lenders');
const outDir = join(broll, 'public/offer-stack');
mkdirSync(outDir, {recursive: true});

/** key -> which sections to keep visible under the title, and how many px of the document to shoot. */
const SHOTS = [
  {key: 'snapshot', hide: [], maxHeight: 480},
  {key: 'analysis', hide: [], maxHeight: 480},
  {key: 'roadmap', hide: [], maxHeight: 480},
  // Hide the one complete letter (sandbox charge-off account); keep the round list.
  {key: 'pack', hide: ['.sp-sec:has(.letter)'], maxHeight: 480},
  {key: 'lenders', hide: [], maxHeight: 480},
];

const html = readFileSync(pagePath, 'utf8');
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 420, height: 1400}, deviceScaleFactor: 3});
const page = await ctx.newPage();
// Bank logos load from fundhub.ai on the live page; serve the same files from the repo.
await page.route('**/assets/lenders/*.png', async (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  const file = join(logoDir, name);
  if (existsSync(file)) return route.fulfill({status: 200, contentType: 'image/png', body: readFileSync(file)});
  return route.abort();
});
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`, {
  waitUntil: 'domcontentloaded',
});
// The page keeps a video and trackers busy, so wait for its fonts, not for a quiet network.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

for (const s of SHOTS) {
  await page.evaluate((k) => {
    document.querySelector('.lb-x')?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    document.querySelector(`[data-sample="${k}"]`)?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  }, s.key);
  await page.waitForSelector('#fh-lb:not([hidden]) .sp');
  await page.waitForTimeout(250);
  const box = await page.evaluate(
    ({hide, maxHeight}) => {
      const lb = document.getElementById('fh-lb');
      const card = lb.querySelector('.lb-card');
      const sp = lb.querySelector('.sp');
      // Shoot the document only: no lightbox chrome, no blur, no unlock box, no close button.
      for (const sel of hide) sp.querySelectorAll(sel).forEach((el) => (el.style.display = 'none'));
      sp.querySelectorAll('.sp-cut, .sp-unlock, .sp-lock').forEach((el) => (el.style.display = 'none'));
      lb.querySelector('.lb-bg').style.display = 'none';
      lb.querySelector('.lb-x').style.display = 'none';
      lb.querySelector('.lb-note').style.display = 'none';
      lb.querySelectorAll('.wm-lb').forEach((el) => (el.style.display = 'none'));
      Object.assign(card.style, {boxShadow: 'none', border: '0', margin: '0', maxHeight: 'none', overflow: 'visible', borderRadius: '0'});
      Object.assign(lb.style, {position: 'absolute', inset: '0', background: '#fff'});
      sp.style.minHeight = '0';
      const r = sp.getBoundingClientRect();
      return {x: r.left, y: r.top, width: r.width, height: Math.min(r.height, maxHeight)};
    },
    {hide: s.hide, maxHeight: s.maxHeight},
  );
  const pad = 14;
  await page.screenshot({
    path: join(outDir, `${s.key}.png`),
    clip: {x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad},
  });
  console.log(`wrote public/offer-stack/${s.key}.png`, Math.round(box.width), 'x', Math.round(box.height), 'css px');
}

await browser.close();
