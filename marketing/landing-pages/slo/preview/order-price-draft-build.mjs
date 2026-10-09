/* /order page — price fix, marked drafts. NEVER PUSHED.
 *
 * Chris, 2026-10-09: the roadmap is $147 now, the price was lowered, that is
 * fine. The pulse row funnel:order-price-matches-till is red because
 * https://apply.fundhub.ai/order still shows and charges $297 while the till
 * (GET /api/public/slo-checkout, SLO_PRICE_CENTS in src/slo/offer.mjs) says $147.
 *
 * /order is NOT a repo page. It is a native ClickFunnels builder page with a
 * native checkout (tracking-manifest.mjs key "apply-order": footer scripts only,
 * never full replace). Its words live in the builder, and the price it charges
 * is the ClickFunnels product "Complete Funding Diagnostic" (product 1035377,
 * price 5157777, 29700 cents). So the only source is the live page itself. This
 * script reads a frozen copy of it (order-live-2026-10-09.html, saved with the
 * page keys scrubbed out) and never changes it.
 *
 * Only price words change. Every other word stays exactly as it is.
 *
 * Run:  node marketing/landing-pages/slo/preview/order-price-draft-build.mjs
 *       node marketing/landing-pages/slo/preview/order-price-draft-build.mjs --snapshot <raw.html>
 *         (scrubs a fresh download of /order and writes it as the frozen copy)
 * Out:  order-price-draft.html  round 1, red boxes and numbers, the problem and the fix under each
 *       order-price-fixed.html  round 2, the fixes written in and marked green, a button hides the marks
 *       order-price-clean.html  the fixed page with every mark stripped (a reference, never pushed)
 *
 * None of the three can send anything: every page script is taken out, and a
 * Content-Security-Policy blocks forms, calls and frames. The green draft keeps
 * one small script for the hide-the-marks button.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_FILE = join(here, "order-live-2026-10-09.html");
export const OUT = Object.freeze({
  red: join(here, "order-price-draft.html"),
  green: join(here, "order-price-fixed.html"),
  clean: join(here, "order-price-clean.html")
});

/** The price that is wrong and the price the till charges. */
export const WAS = Object.freeze({ cents: 29700, dollars: "$297", money: "$297.00" });
export const NOW = Object.freeze({ cents: 14700, dollars: "$147", money: "$147.00" });

/* ---------- the frozen copy: the live page with its keys scrubbed ----------
   The page carries a sign-in check token and three public browser keys (card
   company and error tracker). None belongs in git, so each is replaced. */
export function scrubSnapshot(raw) {
  let out = String(raw)
    .replace(/(<meta content=")[^"]*(" name="csrf-token")/, "$1SCRUBBED$2")
    .replace(/pk_live_[A-Za-z0-9]+/g, "pk_live_SCRUBBED")
    .replace(/hbp_[A-Za-z0-9]+/g, "hbp_SCRUBBED");
  if (/pk_live_(?!SCRUBBED)|hbp_(?!SCRUBBED)/.test(out)) throw new Error("a key is still in the snapshot");
  return out;
}

/* ---------- the price words, every one ----------
   [what it is, exact old text, exact new text, how many the live page holds].
   The counts are what the live page held on 2026-10-09. If the page changes,
   a count stops matching and the build stops instead of guessing. */
export const PRICE_FIXES = Object.freeze([
  ["line under the headline", "Secure checkout — $297 one-time.", "Secure checkout — $147 one-time.", 1],
  ["price on the product card (one per checkout state)", '<span class="elProductCardFinalPrice">One-time $297</span>', '<span class="elProductCardFinalPrice">One-time $147</span>', 5],
  ["product price, in cents", '"price_cents":29700', '"price_cents":14700', 45],
  ["product first charge, in cents", '"initial_price_cents":29700', '"initial_price_cents":14700', 25],
  ["product price, in dollars", '"price":"$297.00"', '"price":"$147.00"', 45],
  ["product price shown", '"display_price":"$297.00"', '"display_price":"$147.00"', 7],
  ["name of the product price", '"name":"One-time $297"', '"name":"One-time $147"', 25],
  ["product search description", '"seo_description":"Fundhub $297 diagnostic', '"seo_description":"Fundhub $147 diagnostic', 7]
]);

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

/** Every price word swapped. `wrap` marks the new price in the visible lines (green draft). */
export function fixPrices(html, { wrap = (t) => t } = {}) {
  let out = String(html);
  for (const [what, from, to, n] of PRICE_FIXES) {
    const seen = count(out, from);
    if (seen !== n) throw new Error(`${what}: expected ${n} of ${JSON.stringify(from)}, found ${seen}`);
    const visible = !from.startsWith('"');
    out = out.split(from).join(visible ? to.replace(NOW.dollars, wrap(NOW.dollars)) : to);
  }
  return out;
}

/** What is left of the old price after the fix: every $297 / 29700 outside an id. */
export function oldPriceLeft(html) {
  return [...String(html).matchAll(/\$297\b|\b29700\b/g)].map((m) => String(html).slice(Math.max(0, m.index - 30), m.index + 10));
}

/* ---------- make a copy that cannot send anything ---------- */
const CSP =
  "default-src 'none'; style-src https: 'unsafe-inline'; img-src https: data:; font-src https: data:; " +
  "script-src 'nonce-fhx'; form-action 'none'; connect-src 'none'; frame-src 'none'; base-uri https://apply.fundhub.ai";

/** Takes out every page script (keeps the JSON data blocks), and adds the CSP and a base address for styles and pictures. */
export function inert(html) {
  const out = String(html)
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (all, attrs) => (/type=["']application\/json["']/i.test(attrs) ? all : ""))
    /* The page's own styles carry an integrity check that only passes on
       apply.fundhub.ai itself. Off that address the browser drops them, so the
       copy would look broken. The check is taken off; the styles are the same. */
    .replace(/(<link rel="stylesheet" href="\/assets\/[^"]+") integrity="[^"]*"/g, "$1");
  if (!/<head[^>]*>/i.test(out)) throw new Error("the page has no <head>");
  return out.replace(
    /<head([^>]*)>/i,
    `<head$1>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<base href="https://apply.fundhub.ai/">`
  );
}

/* ---------- round 1: red marks ----------
   On the screen: [css selector, text it must hold, the problem, the fix]. */
export const RED_NOTES = Object.freeze([
  [
    ".elParagraph",
    "Secure checkout",
    "Says $297. The till and /roadmap charge $147 (Chris, 2026-10-09: $147 is the price). This line is typed in the ClickFunnels builder, so changing it does not change what the card pays.",
    "Secure checkout — $147 one-time. Soft pull runs on the next step."
  ],
  [
    'form[data-wrapper-checkout-state="guest"] .elProductCardFinalPrice',
    "",
    "Says One-time $297. This is the name of the ClickFunnels price, and the card is charged that price: 29700 cents.",
    "One-time $147, charged 14700 cents. Change the product price itself, not only the words."
  ]
]);

/* Not on the screen, so they cannot get a box. Listed in a panel instead. */
export const RED_PANEL = Object.freeze([
  [
    "The same \"One-time $297\" line sits in 4 more checkout states. They stay hidden until a buyer comes back signed in, saved, or on a one-click offer.",
    "One-time $147 in all 4."
  ],
  [
    "What the card is really charged: ClickFunnels product 1035377 \"Complete Funding Diagnostic\", price 5157777 \"One-time $297\" at 29700 cents ($297.00). The page repeats it 154 times in its data. Fixing only the words would show $147 and still charge $297.",
    "Price 5157777 set to 14700 cents ($147.00) and named \"One-time $147\"."
  ],
  [
    "The product's search description says \"Fundhub $297 diagnostic — soft pull, AI underwriting, full funding blueprint pack.\"",
    "Fundhub $147 diagnostic — soft pull, AI underwriting, full funding blueprint pack."
  ]
]);

const MARK_CSS = `
<style>
.fhx-banner{position:fixed;left:0;right:0;top:0;z-index:99999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center}
.fhx-banner.red{background:#B00020}
.fhx-banner.green{background:#0B5D1E}
.fhx-banner button{font:600 12px system-ui,sans-serif;background:#fff;color:#0B5D1E;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}
.fhx-banner button:focus-visible{outline:2px solid #fff;outline-offset:2px}
body{padding-top:48px}
.fhx-bad{outline:3px solid #E00 !important;outline-offset:2px;background:rgba(255,0,0,.06) !important}
.fhx-num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:11px;background:#E00;color:#fff;font:700 12px system-ui,sans-serif;padding:0 6px;margin-right:6px;vertical-align:middle}
.fhx-note{display:block;margin:8px 0 14px;padding:10px 12px;border-left:4px solid #E00;background:#FFF1F1;color:#222;font:14px/1.45 system-ui,sans-serif;text-align:left;border-radius:4px}
.fhx-note .w{color:#900}
.fhx-note .s{margin-top:6px;color:#0B5D1E}
.fhx-panel{max-width:720px;margin:16px auto;padding:14px 16px;border:3px solid #E00;border-radius:8px;background:#FFF8F8;color:#222;font:14px/1.45 system-ui,sans-serif}
.fhx-panel.green{border-color:#16A34A;background:#F3FBF5}
.fhx-panel h2{font:700 14px system-ui,sans-serif;margin:0 0 8px}
.fhx-panel .fhx-item{display:flex;gap:6px;align-items:flex-start;margin:8px 0}
.fhx-panel.green .fhx-num{background:#16A34A}
.fhx-new{background:rgba(22,163,74,.18);box-shadow:0 0 0 2px rgba(22,163,74,.28);border-radius:3px}
html.fhx-clean .fhx-new{background:none;box-shadow:none}
html.fhx-clean .fhx-panel{display:none}
</style>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function afterBodyOpen(html, add) {
  if (!/<body[^>]*>/i.test(html)) throw new Error("the page has no <body>");
  return html.replace(/<body([^>]*)>/i, (m) => `${m}\n${add}`);
}
function beforeBodyClose(html, add) {
  const i = html.lastIndexOf("</body>");
  if (i < 0) throw new Error("the page has no </body>");
  return html.slice(0, i) + add + "\n" + html.slice(i);
}

export function buildRed(snapshot) {
  const start = RED_NOTES.length + 1;
  const panel =
    `<div class="fhx-panel"><h2>Not on the screen, but still $297</h2>` +
    RED_PANEL.map(
      ([w, s], i) =>
        `<div class="fhx-item"><span class="fhx-num">${start + i}</span><div><span style="color:#900"><b>Problem:</b> ${esc(w)}</span><div style="margin-top:4px;color:#0B5D1E"><b>Fix:</b> ${esc(s)}</div></div></div>`
    ).join("") +
    `</div>`;
  const script = `
<script nonce="fhx">
(function(){
  var NOTES=${JSON.stringify(RED_NOTES)};
  function run(){
    var n=0;
    NOTES.forEach(function(x){
      [].slice.call(document.querySelectorAll(x[0])).filter(function(e){return !x[1]||e.textContent.indexOf(x[1])>=0;}).forEach(function(el){
        n++;el.classList.add('fhx-bad');
        var note=document.createElement('div');note.className='fhx-note';
        note.innerHTML='<span class="fhx-num">'+n+'</span><span class="w"><b>Problem:</b> '+x[2]+'</span><div class="s"><b>Fix:</b> '+x[3]+'</div>';
        var host=el.closest('.elProductCardInfoContainer,.elProductCard,[data-page-element]')||el;
        host.parentNode.insertBefore(note,host.nextSibling);
      });
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
</script>`;
  let out = inert(snapshot);
  out = out.replace("</head>", `${MARK_CSS}\n</head>`);
  out = afterBodyOpen(
    out,
    `<div class="fhx-banner red">DRAFT, NOT LIVE · Red boxes = the wrong price, with the fix under each one · Nothing on this copy can take an order</div>\n${panel}`
  );
  return beforeBodyClose(out, script);
}

export function buildGreen(snapshot) {
  const G = (t) => `<span class="fhx-new">${t}</span>`;
  const panel =
    `<div class="fhx-panel green"><h2>Fixed where the screen does not show it</h2>` +
    [
      `The 4 hidden checkout states also say ${G("One-time $147")}.`,
      `ClickFunnels price 5157777 is ${G("14700 cents ($147.00)")}, named ${G("One-time $147")}. This is what the card is charged.`,
      `Search description: ${G("Fundhub $147 diagnostic — soft pull, AI underwriting, full funding blueprint pack.")}`
    ]
      .map((t, i) => `<div class="fhx-item"><span class="fhx-num">${RED_NOTES.length + 1 + i}</span><div>${t}</div></div>`)
      .join("") +
    `</div>`;
  const script = `
<script nonce="fhx">
(function(){
  var b=document.getElementById('fhx-toggle');if(!b)return;
  b.addEventListener('click',function(){var on=document.documentElement.classList.toggle('fhx-clean');b.textContent=on?'Show the marks':'Hide the marks';});
})();
</script>`;
  let out = inert(fixPrices(snapshot, { wrap: G }));
  out = out.replace("</head>", `${MARK_CSS}\n</head>`);
  out = afterBodyOpen(
    out,
    `<div class="fhx-banner green"><span>DRAFT, NOT LIVE · Green = the price, fixed · Nothing on this copy can take an order</span><button type="button" id="fhx-toggle">Hide the marks</button></div>\n${panel}`
  );
  return beforeBodyClose(out, script);
}

export function buildClean(snapshot) {
  const out = inert(fixPrices(snapshot));
  const left = out.match(/.{0,40}fhx-.{0,40}/);
  if (left) throw new Error(`draft mark left in the clean page: ${left[0]}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--snapshot");
  if (i > 0) {
    const raw = readFileSync(process.argv[i + 1], "utf8");
    writeFileSync(SNAPSHOT_FILE, scrubSnapshot(raw));
    console.log(`wrote the frozen copy ${SNAPSHOT_FILE}`);
  }
  const snap = readFileSync(SNAPSHOT_FILE, "utf8");
  writeFileSync(OUT.red, buildRed(snap));
  writeFileSync(OUT.green, buildGreen(snap));
  const clean = buildClean(snap);
  const left = oldPriceLeft(clean);
  if (left.length) throw new Error(`old price left in the clean page: ${left.join(" | ")}`);
  writeFileSync(OUT.clean, clean);
  console.log("built order-price-draft.html, order-price-fixed.html, order-price-clean.html");
}
