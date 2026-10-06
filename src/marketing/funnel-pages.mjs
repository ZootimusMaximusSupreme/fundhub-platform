// @ts-check
// The three pages of a book-a-call funnel, drawn from checked words (build unit X4).
//
// PURE. No database, no network, no model. The model writes WORDS only
// (src/marketing/funnel-copy.mjs COPY_SCHEMA); this file puts them into the
// house page. So the model can never add a script, a link, a price box or a
// face: every tag on the page is written here, every word is escaped.
//
// THE TEMPLATE is the roadmap book-a-call pages (marketing/landing-pages/slo/
// slo-02-booking.html and slo-03-thank-you.html): Inter and JetBrains Mono, the
// 44px grid paper, the spectrum line on the eyebrow, the dark card, the same
// footer words. The booking page frames the same live calendar the roadmap
// funnel uses (https://apply.fundhub.ai/funding-book-call), sizes the frame to
// the height the calendar posts, and moves a booked visitor to this funnel's
// thank-you page the same way slo-02 does (fh_booking_v1 in localStorage, written
// by the calendar's own capture script on a real booking).
//
// Phone first: one column, 16px side gutters at 390px, 48px buttons, text 11px
// or larger.

import { pageDocument } from "./funnel-tracking.mjs";
import { FUNNEL_HOST } from "./funnel-paths.mjs";

/** The live calendar the roadmap funnel frames. Never replaced, only framed. */
export const CALENDAR_URL = `https://${FUNNEL_HOST}/funding-book-call`;
const CALENDAR_ORIGIN = `https://${FUNNEL_HOST}`;
const WORDMARK = "https://fundhub.ai/assets/fundhub-wordmark.svg";

/** Escape text for HTML (body and attributes). */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const list = (v) => (Array.isArray(v) ? v : []);

const CSS = `<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
html,body{margin:0;padding:0;background:#FCFCFC;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:#FCFCFC;
  background-image:linear-gradient(rgba(10,10,10,.048) 1px,transparent 1px),linear-gradient(90deg,rgba(10,10,10,.048) 1px,transparent 1px);
  background-size:44px 44px}
.fh-f{--spectrum:linear-gradient(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%);
  --ink:#0A0A0A;--ink2:#18181B;--gray:#52525B;--gray2:#8A8A93;--line:#E4E4E7;--soft:#F4F4F5;--card:#111113;--cardline:#26262B;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;--sans:'Inter',system-ui,-apple-system,sans-serif;
  color:var(--ink);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased}
.fh-f *{box-sizing:border-box;margin:0;padding:0}
.fh-f a{color:inherit}
.fh-f :focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.fh-f .wrap{max-width:760px;margin:0 auto;padding:0 16px}
.fh-f header{padding:18px 0 0;text-align:center}
.fh-f header img{width:116px;height:auto;display:inline-block}
.fh-f .hero{text-align:center;padding:30px 0 6px}
.fh-f .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gray);display:inline-block}
.fh-f .eyebrow::before{content:"";display:inline-block;width:16px;height:2px;background:var(--spectrum);border-radius:1px;margin-right:9px;vertical-align:middle}
.fh-f h1{font-size:clamp(30px,7.4vw,50px);font-weight:700;letter-spacing:-.045em;line-height:1.02;margin:18px auto 0;max-width:19ch}
.fh-f .sub{font-size:clamp(18px,4.4vw,24px);font-weight:600;color:var(--gray);letter-spacing:-.02em;line-height:1.25;margin:16px auto 0;max-width:30ch}
.fh-f .lede{margin:18px auto 0;font-size:16.5px;color:var(--gray);max-width:54ch}
.fh-f .cta{display:flex;flex-direction:column;align-items:center;gap:10px;margin:28px auto 0}
.fh-f .btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:14px 28px;border-radius:999px;
  background:var(--ink);color:#fff;font-weight:600;font-size:17px;letter-spacing:-.01em;text-decoration:none;
  box-shadow:0 10px 26px rgba(10,10,10,.18);transition:transform .15s ease,box-shadow .15s ease;max-width:100%;text-align:center}
.fh-f .btn:hover{transform:translateY(-1px);box-shadow:0 14px 32px rgba(10,10,10,.22)}
.fh-f .btn::after{content:"\\2192";margin-left:10px}
.fh-f .cta-note{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--gray2);text-align:center}
.fh-f section.block{margin:44px auto 0}
.fh-f .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gray2);display:block;text-align:center}
.fh-f .card{background:var(--card);border:1px solid var(--cardline);border-radius:14px;padding:22px 20px;color:#fff;margin-top:16px;box-shadow:0 18px 44px rgba(10,10,10,.16)}
.fh-f .card li{list-style:none;padding:14px 0;border-bottom:1px solid var(--cardline)}
.fh-f .card li:last-child{border-bottom:0}
.fh-f .card .t{font-weight:600;font-size:16.5px;letter-spacing:-.015em}
.fh-f .card .d{color:#A1A1AA;font-size:15px;margin-top:4px;line-height:1.6}
.fh-f .steps{margin-top:16px;border-top:1px solid var(--line)}
.fh-f .step{display:flex;gap:16px;align-items:flex-start;padding:18px 2px;border-bottom:1px solid var(--line)}
.fh-f .step .n{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--gray2);flex:0 0 auto;width:26px;padding-top:4px}
.fh-f .step .t{font-size:16.5px;font-weight:600;letter-spacing:-.015em;line-height:1.35}
.fh-f .step .d{margin-top:5px;font-size:15px;color:var(--gray);line-height:1.62}
.fh-f .faq{margin-top:16px}
.fh-f .faq details{border-bottom:1px solid var(--line)}
.fh-f .faq details:first-of-type{border-top:1px solid var(--line)}
.fh-f .faq summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:14px;padding:16px 2px;min-height:44px;font-size:16px;font-weight:600;letter-spacing:-.015em;line-height:1.4}
.fh-f .faq summary::-webkit-details-marker{display:none}
.fh-f .faq summary::before{content:"+";font-family:var(--mono);font-size:13px;color:var(--gray2);flex:0 0 auto;width:16px}
.fh-f .faq details[open] summary::before{content:"\\2212"}
.fh-f .faq .a{padding:0 2px 18px 30px;font-size:15px;color:var(--gray);line-height:1.66}
.fh-f .note{margin:26px auto 0;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gray)}
.fh-f .frame{max-width:900px;margin:18px auto 0;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 18px 44px rgba(10,10,10,.10)}
.fh-f .frame iframe{display:block;width:100%;height:920px;min-height:600px;border:0;background:#fff}
.fh-f .prep{max-width:640px;margin:22px auto 0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.fh-f .prep li{margin:8px 0 0 18px;font-size:15.5px;color:var(--gray)}
.fh-f footer{margin-top:56px;background:#fff;border-top:1px solid var(--line);padding:30px 0 34px}
.fh-f .disc{max-width:700px;margin:0 auto;font-size:11px;line-height:1.75;color:#5F5F68;text-align:center}
.fh-f .disc p{margin-bottom:12px}
.fh-f .disc strong{color:#2A2A31;font-weight:600}
.fh-f .foot{margin-top:18px;padding-top:16px;border-top:1px solid var(--line);text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:var(--gray)}
.fh-f .foot a{color:var(--ink2);text-decoration:underline;text-underline-offset:3px}
@media(min-width:700px){.fh-f .wrap{padding:0 24px}.fh-f .hero{padding:40px 0 8px}.fh-f .card{padding:26px 28px}}
@media(prefers-reduced-motion:reduce){.fh-f .btn{transition:none}}
</style>`;

const HEADER = `<header><img src="${WORDMARK}" alt="Fundhub" width="116" height="23"></header>`;

/* The house footer, word for word from the roadmap booking page. */
const FOOTER = `<footer data-fh-section="footer"><div class="wrap"><div class="disc">
<p><strong>FUNDING DISCLAIMER:</strong> Fundhub LLC is not a bank or a lender. We are a funding advisory and application service. Funding amounts shown are maximum potential amounts and are not an offer of credit.</p>
<p>Results vary. Individual outcomes depend on credit profile, business history, and other factors.</p>
<p><strong>NOT AFFILIATED WITH META:</strong> This site is not a part of the Facebook website or Facebook Inc. FACEBOOK is a trademark of FACEBOOK, Inc.</p>
</div>
<div class="foot">Fundhub.ai | Copyright &copy; 2026 Fundhub LLC | All Rights Reserved &nbsp;&middot;&nbsp; <a href="https://fundhub.ai/privacy/">Privacy Policy</a> &nbsp;&middot;&nbsp; <a href="https://fundhub.ai/terms/">Terms &amp; Conditions</a></div>
</div></footer>`;

/* Carries the visitor's ad tags (and fbclid) onto the next page's link, so the
   attribution survives a hop even when storage is blocked. */
const CARRY_QUERY = `<script>
(function(){try{var q=location.search;if(!q||q.length<2)return;var a=document.querySelectorAll('a[data-fh-next]');
for(var i=0;i<a.length;i++){var h=a[i].getAttribute('href')||'';if(h.indexOf('?')===-1)a[i].setAttribute('href',h+q);}}catch(e){}})();
</script>`;

function hero(c, { level = "h1" } = {}) {
  const sub = c.subhead ? `<p class="sub">${esc(c.subhead)}</p>` : "";
  const lede = c.lede ? `<p class="lede">${esc(c.lede)}</p>` : "";
  return `<section class="hero" data-fh-section="hero">
<span class="eyebrow">${esc(c.eyebrow)}</span>
<${level}>${esc(c.headline)}</${level}>
${sub}
${lede}
</section>`;
}

function cta(text, note, href) {
  return `<div class="cta"><a class="btn" data-fh-next href="${esc(href)}">${esc(text)}</a>${note ? `<span class="cta-note">${esc(note)}</span>` : ""}</div>`;
}

function cardList(items) {
  return `<ul class="card">${list(items).map((b) =>
    `<li><div class="t">${esc(b.title)}</div><div class="d">${esc(b.detail)}</div></li>`).join("")}</ul>`;
}

function stepList(items) {
  return `<div class="steps">${list(items).map((s, i) =>
    `<div class="step"><div class="n">${String(i + 1).padStart(2, "0")}</div><div><div class="t">${esc(s.title)}</div><div class="d">${esc(s.detail)}</div></div></div>`).join("")}</div>`;
}

function faqList(items) {
  return `<div class="faq">${list(items).map((f) =>
    `<details data-fh-faq><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join("")}</div>`;
}

/** The landing page body: the promise, what they get, how the call goes, questions, the button. */
export function landingBody(copy, paths) {
  const c = copy.landing;
  return `${CSS}
<div class="fh-f">
${HEADER}
<div class="wrap">
${hero(c)}
${cta(c.cta, c.cta_note, paths.booking)}
<section class="block" data-fh-section="what-you-get">
<span class="kicker">${esc(c.bullets_title)}</span>
${cardList(c.bullets)}
</section>
<section class="block" data-fh-section="how-it-works">
<span class="kicker">${esc(c.steps_title)}</span>
${stepList(c.steps)}
</section>
<section class="block" data-fh-section="faq">
<span class="kicker">Questions</span>
${faqList(c.faq)}
</section>
${cta(c.cta, c.cta_note, paths.booking)}
</div>
${FOOTER}
</div>
${CARRY_QUERY}`;
}

/** The booking page body: the live calendar in a frame, sized to it, and the move to thank-you on a real booking. */
export function bookingBody(copy, paths) {
  const c = copy.booking;
  const prep = list(c.prep).length
    ? `<div class="prep" data-fh-section="prep"><span class="kicker" style="text-align:left">${esc(c.prep_title)}</span><ul>${list(c.prep).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`
    : "";
  return `${CSS}
<div class="fh-f">
${HEADER}
<div class="wrap">
${hero(c)}
<div class="note">${esc(c.booknote)}</div>
</div>
<div class="frame" data-fh-section="calendar">
<iframe id="fh-book-frame" title="Book your Fundhub call" src="${CALENDAR_URL}" loading="lazy"></iframe>
</div>
<div class="wrap">${prep}</div>
${FOOTER}
</div>
<script>
/* Size the frame to the height the calendar posts (fh-book-height) and bring the
   part being used into view. Same rules as the roadmap booking page. */
(function(){
  var ORIGIN=${JSON.stringify(CALENDAR_ORIGIN)},MIN=600,PAD=16,cur=0;
  var f=document.getElementById('fh-book-frame');
  if(!f) return;
  function vh(){ return window.innerHeight||document.documentElement.clientHeight; }
  function reveal(t,b){
    var F=f.getBoundingClientRect().top,H=vh(),dy;
    if(F+t>=0&&F+b<=H) return;
    if(b+2*PAD<=H) dy=F-PAD;
    else if(b-t+2*PAD<=H) dy=F+b-(H-PAD);
    else dy=F+t-PAD;
    if(Math.abs(dy)>1) window.scrollBy({top:dy,behavior:'smooth'});
  }
  window.addEventListener('message',function(e){
    if(e.origin!==ORIGIN||e.source!==f.contentWindow) return;
    var d=e.data;
    if(!d||d.type!=='fh-book-height') return;
    var h=Math.ceil(Number(d.h));
    if(!isFinite(h)||h<=0) return;
    h=Math.max(MIN,h);
    var shrank=cur>0&&h<cur-150;
    cur=h;
    f.style.height=h+'px';
    var fo=d.focus,t=fo?Number(fo.t):NaN,b=fo?Number(fo.b):NaN;
    if(t>=0&&t<h&&b>t){ reveal(t,Math.min(b,h)); return; }
    if(shrank&&f.getBoundingClientRect().bottom<80) reveal(Math.max(0,h-(vh()-2*PAD)),h);
  });
})();
</script>
<script>
/* Booked -> this funnel's thank-you page. The calendar's capture script writes
   fh_booking_v1 to localStorage on a real booking; only a booking made after
   this page loaded counts. The ad tags ride along. */
(function(){
  var KEY='fh_booking_v1',TY=${JSON.stringify(paths.thank_you)},done=false,LOADED=Date.now();
  function go(){
    if(done)return;done=true;
    var cur=new URLSearchParams(location.search),q=new URLSearchParams();
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid'].forEach(function(k){var v=cur.get(k);if(v)q.set(k,v);});
    var qs=q.toString();location.href=TY+(qs?'?'+qs:'');
  }
  function booked(raw){try{var d=JSON.parse(raw||'null');return !!(d&&d.name&&d.email&&d.submittedAt&&d.submittedAt>=LOADED);}catch(e){return false;}}
  window.addEventListener('storage',function(e){if(e.key===KEY&&booked(e.newValue))go();});
  var t=setInterval(function(){try{if(booked(localStorage.getItem(KEY))){clearInterval(t);go();}}catch(e){clearInterval(t);}},1500);
})();
</script>`;
}

/** The thank-you page body: what happens next. */
export function thankYouBody(copy) {
  const c = copy.thank_you;
  return `${CSS}
<div class="fh-f">
${HEADER}
<div class="wrap">
${hero(c)}
<section class="block" data-fh-section="next-steps">
<span class="kicker">${esc(c.steps_title)}</span>
${stepList(c.next_steps)}
</section>
</div>
${FOOTER}
</div>`;
}

const BODY = Object.freeze({ landing: landingBody, booking: bookingBody, thank_you: thankYouBody });

/**
 * One whole page, ready to save or send.
 * @param {{ funnel: any, page: { role: 'landing'|'booking'|'thank_you', path: string },
 *           copy: any, paths: { landing: string, booking: string, thank_you: string },
 *           pageToken?: string|null, env?: Record<string, string|undefined> }} opts
 */
export function renderPage({ funnel, page, copy, paths, pageToken = null, env = process.env }) {
  const body = BODY[page.role];
  if (!body) throw new Error(`renderPage: unknown page role ${JSON.stringify(page.role)}`);
  return pageDocument({ funnel, page, bodyHtml: body(copy, paths), pageToken, env });
}
