/*
 * Fundhub /watch proof block — https://fundhub.ai/funnel/watch-proof.js
 *
 * Loaded from the footer code of apply.fundhub.ai/watch (ClickFunnels builder
 * page 25061160) and from marketing/landing-pages/01-vsl.html. A builder page's
 * body cannot be replaced by API, so this script adds the new section itself,
 * right under the first "Get Started" button and its note, above the ticker.
 *
 * What it adds, one column, one rhythm (owner, 2026-09-22: "it needs to be organized"):
 *   1. "Real approvals. Real screenshots." — all 16 client approvals from the deck
 *      ("put 10 more approvals here"; the /roadmap page shows the same 16). The row
 *      slides to the right as the page scrolls down. It never holds the page.
 *   2. "One call. Three roads. Nobody gets turned away." + a second Get Started.
 *
 * It also lines the page up with /roadmap (only where this script runs):
 *   - the builder containers around the page lose their side padding, so the text
 *     column sits 24px from the screen edge on a phone, as on /roadmap;
 *   - the H1 uses the /roadmap H1 rule, and its dollar amounts use the H1's own
 *     font (no mono, no underline). The H1 words are not touched.
 * The video and the first button are not touched.
 *
 * Proof law (.claude/rules/proof-cards-from-source.md): every card is the
 * proof-card template's own markup (marketing/landing-pages/slo/fundhub-proof-cards.html),
 * every amount is read off its screenshot, photo off, name off. The template CSS
 * below is a verbatim copy of that file's <style> block; a test fails if they drift
 * (src/ads/funnel-proof-scripts.test.mjs).
 *
 * Any screenshot opens full size on tap or click.
 */
(function () {
  "use strict";
  if (window.__fhWatchProof) return;
  window.__fhWatchProof = true;

  var SECTION_ID = "fh-watch-proof";
  var GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  /* Approvals: every card in marketing/landing-pages/slo/client-wins/deck.json, in the
     deck's order (smallest first, climbing to the biggest). Amount read off each crop;
     src, width, height and alt are the deck's. */
  var WINS = [
    { id: "t-20k-truist", amount: "$20,000", w: 1200, h: 900, alt: "Truist Business credit card approval showing $20,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715364/file/b828126991a18a561b9b0489ffef31dc.jpg" },
    { id: "d-23k-chase-freedom", amount: "$23,000", w: 1200, h: 900, alt: "Chase Freedom Unlimited approval showing a $23,000 credit line",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715363/file/f45edd9e680d174dd614f8a09b6079e4.jpg" },
    { id: "d-24k-navy", amount: "$24,000", w: 1200, h: 900, alt: "Navy Federal Credit Union Platinum Visa credit card approval showing $24,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715362/file/7fc29e8b494832b6b5c14a2f82d1610e.jpg" },
    { id: "d-25k-personal-card", amount: "$25,000", w: 1200, h: 900, alt: "Navy Federal Credit Union cashRewards Visa credit card approval showing $25,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715360/file/f2ab5e090077acb25ec2a06820c9aa7e.jpg" },
    { id: "t-25k-highland", amount: "$25,000", w: 1200, h: 900, alt: "Highland Bank Visa Business Card approval showing $25,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715361/file/d619505428aae233495eb08f9ca78220.jpg" },
    { id: "d-30k-navy", amount: "$30,000", w: 1200, h: 900, alt: "Navy Federal Platinum credit card approval showing $30,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715359/file/c7c14fe81e2ebce892266ef580078d8b.jpg" },
    { id: "d-41k-chase-ink", amount: "$41,000", w: 1200, h: 900, alt: "Chase Ink Business Unlimited card approval showing $41,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715357/file/7eca23557c059231d5a4ec46f9a4af53.jpg" },
    { id: "d-50k-loc", amount: "$50,000", w: 1200, h: 900, alt: "Commercial line of credit approval showing $50,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715353/file/89de6b8fb2e72f1708bf9d0e232e0264.jpg" },
    { id: "t-50k-keybank", amount: "$50,000", w: 1200, h: 900, alt: "KeyBank business credit card approval showing a $50,000 credit limit",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715354/file/6484dec63f442004a983f44f01eb1a5d.jpg" },
    { id: "t-50k-chase", amount: "$50,000", w: 1200, h: 900, alt: "Chase Ink Business card approval showing $50,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715355/file/68b915259e7c0a5f060eb2a43841fcd1.jpg" },
    { id: "d-54k-ink", amount: "$54,500", w: 1200, h: 900, alt: "Chase Ink Business Unlimited card approval showing $54,500",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715352/file/37f8476a42f24b8a951b3bbab7356c86.jpg" },
    { id: "d-70k-loc", amount: "$70,000", w: 1200, h: 900, alt: "Business Revolving Line of Credit approval showing $70,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715351/file/87ce21a9d56365a948583e5c47d1bced.jpg" },
    { id: "t-74k-chase-ink", amount: "$74,000", w: 1200, h: 900, alt: "Chase Ink Business Cash card approval showing $74,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715350/file/685c4e87c43f57142cfe2bd70318efeb.jpg" },
    { id: "d-400k-loc", amount: "$400,000", w: 1200, h: 900, alt: "Commercial line of credit approval showing $400,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715348/file/87977dcab48ab92052338711db574153.jpg" },
    { id: "d-469k-loc", amount: "$469,800", w: 1200, h: 900, alt: "Commercial Line of Credit approval showing $469,800",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715347/file/62e762095e88a7911fdf48dcef0e15a6.jpg" },
    { id: "d-500k-loc", amount: "$500,000", w: 1200, h: 900, alt: "Commercial Line of Credit approval showing $500,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715346/file/2ebcf1ec2959eafec36ed810cdcef6f5.jpg" }
  ];

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* One proof-card template article. Same markup and switches as the template:
     every slot kept, the switches decide what shows. */
  function card(o) {
    return "<!-- Client approval " + esc(o.id) + ": amount read off the screenshot (deck.json). -->" +
      '<article class="fh-card" data-layout="' + o.layout + '" data-photo="off" data-name="off" data-amount="' + (o.amount ? "on" : "off") + '">' +
        '<p class="fh-eyebrow"><span class="fh-for-win">Client win</span><span class="fh-for-quote">Testimonial</span></p>' +
        '<figure class="fh-face"><img data-slot="face" src="' + GIF + '" alt="" width="168" height="168"></figure>' +
        '<h3 class="fh-headline">Approved for <span class="fh-amount" data-slot="dollar-amount">' + esc(o.amount || "") + "</span></h3>" +
        '<figure class="fh-shot"><img data-slot="approval-screenshot" src="' + esc(o.src) + '" alt="' + esc(o.alt) + '" width="' + (o.w || 1200) + '" height="' + (o.h || 900) + '" loading="lazy" decoding="async"></figure>' +
        '<blockquote class="fh-quote"><p data-slot="quote"></p></blockquote>' +
        '<div class="fh-rule" aria-hidden="true"></div>' +
        '<span class="fh-name" data-slot="name"></span>' +
        '<span class="fh-mark" role="img" aria-label="Fundhub"></span>' +
      "</article>";
  }

  function winCard(w) { return card({ id: w.id, layout: "win", amount: w.amount, src: w.src, alt: w.alt, w: w.w, h: w.h }); }

  /* ── proof-card template CSS, verbatim. Do not edit here; edit the template. ── */
  var TEMPLATE_CSS = String.raw`
.fh-card {
  /* Palette: guidelines section 03 */
  --fh-paper: #FFFFFF;
  --fh-ink: #0C0C0D;
  --fh-graphite: #56565C;
  --fh-steel: #8A8A90;
  --fh-hairline: #E4E4E7;
  --fh-surface: #F6F6F7;
  /* Type: guidelines section 04 */
  --fh-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --fh-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* Not set by the guidelines. Adjust here. */
  --fh-radius-card: 16px;
  --fh-radius-face: 12px;
  --fh-radius-frame: 10px;
  --fh-radius-img: 6px;
  --fh-pad: 20px;
  --fh-gap: 16px;
  --fh-face: 64px;
  --fh-avatar: 44px;
  --fh-shadow: 0 1px 2px rgba(12, 12, 13, .06), 0 14px 36px -14px rgba(12, 12, 13, .24);
  --fh-tilt-amount: 1deg;
  --fh-tilt-dir: -1;
  --fh-photo-filter: grayscale(1);
  --fh-mark-opacity: .85;

  box-sizing: border-box;
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "eye eye eye" "face head head" "shot shot shot" "rule rule rule" "name name mark";
  align-items: center;
  gap: var(--fh-gap);
  width: 100%;
  max-width: 560px;
  margin: 0;
  padding: var(--fh-pad) var(--fh-pad) calc(var(--fh-pad) - 2px);
  background: var(--fh-paper);
  border: 1px solid var(--fh-hairline);
  border-radius: var(--fh-radius-card);
  box-shadow: var(--fh-shadow);
  transform: rotate(calc(var(--fh-tilt-dir) * var(--fh-tilt-amount)));
  color: var(--fh-ink);
  font-family: var(--fh-sans);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.fh-card *, .fh-card *::before, .fh-card *::after { box-sizing: border-box; }
@media (min-width: 640px) {
  .fh-card { --fh-pad: 28px; --fh-gap: 20px; --fh-face: 84px; --fh-avatar: 48px; --fh-tilt-amount: 1.5deg; }
}

/* ---------- Switches: layout ---------- */
.fh-card[data-layout="win-quote"] { grid-template-areas: "eye eye eye" "face head head" "shot shot shot" "quote quote quote" "rule rule rule" "name name mark"; }
.fh-card[data-layout="quote"] { grid-template-areas: "eye eye eye" "quote quote quote" "rule rule rule" "face name mark"; }
.fh-card[data-layout="quote-win"] { grid-template-areas: "eye eye eye" "quote quote quote" "head head head" "shot shot shot" "rule rule rule" "face name mark"; }
.fh-card[data-layout="quote-win"][data-amount="off"] { grid-template-areas: "eye eye eye" "quote quote quote" "shot shot shot" "rule rule rule" "face name mark"; }

/* ---------- Switches: photo off (the headline or name takes the photo's space) ---------- */
.fh-card[data-photo="off"] { grid-template-areas: "eye eye eye" "head head head" "shot shot shot" "rule rule rule" "name name mark"; }
.fh-card[data-photo="off"][data-layout="win-quote"] { grid-template-areas: "eye eye eye" "head head head" "shot shot shot" "quote quote quote" "rule rule rule" "name name mark"; }
.fh-card[data-photo="off"][data-layout="quote"] { grid-template-areas: "eye eye eye" "quote quote quote" "rule rule rule" "name name mark"; }
.fh-card[data-photo="off"][data-layout="quote-win"] { grid-template-areas: "eye eye eye" "quote quote quote" "head head head" "shot shot shot" "rule rule rule" "name name mark"; }
.fh-card[data-photo="off"][data-layout="quote-win"][data-amount="off"] { grid-template-areas: "eye eye eye" "quote quote quote" "shot shot shot" "rule rule rule" "name name mark"; }

/* ---------- Switches: what hides ---------- */
.fh-card:not([data-layout="win-quote"]):not([data-layout="quote"]):not([data-layout="quote-win"]) > .fh-quote,
.fh-card[data-layout="quote"] > .fh-headline,
.fh-card[data-layout="quote"] > .fh-shot,
.fh-card[data-layout="quote-win"][data-amount="off"] > .fh-headline,
.fh-card[data-photo="off"] > .fh-face,
.fh-card[data-name="off"] > .fh-name,
.fh-card[data-layout^="quote"] .fh-for-win,
.fh-card:not([data-layout^="quote"]) .fh-for-quote { display: none; }

.fh-card[data-name="blur"] > .fh-name {
  filter: blur(5px);
  user-select: none;
  -webkit-user-select: none;
}

/* ---------- Pieces ---------- */
.fh-card > .fh-eyebrow {
  grid-area: eye;
  margin: 0;
  font-family: var(--fh-mono);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--fh-steel);
}
.fh-card > .fh-face {
  grid-area: face;
  width: var(--fh-face);
  margin: 0;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: var(--fh-surface);
  border: 1px solid var(--fh-hairline);
  border-radius: var(--fh-radius-face);
}
.fh-card[data-layout^="quote"] > .fh-face { width: var(--fh-avatar); border-radius: var(--fh-radius-frame); }
.fh-card > .fh-face img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: cover;
  object-position: 50% 30%;
  filter: var(--fh-photo-filter);
}
.fh-card > .fh-headline {
  grid-area: head;
  margin: 0;
  font-family: var(--fh-sans);
  font-size: clamp(20px, 4.6vw, 24px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--fh-ink);
}
.fh-card .fh-amount {
  display: block;
  margin-top: 4px;
  font-family: var(--fh-mono);
  font-size: clamp(34px, 9vw, 52px);
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.fh-card > .fh-shot {
  grid-area: shot;
  margin: 0;
  padding: 8px;
  background: var(--fh-surface);
  border: 1px solid var(--fh-hairline);
  border-radius: var(--fh-radius-frame);
}
.fh-card > .fh-shot img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: min(72vh, 680px);
  object-fit: contain;
  background: var(--fh-paper);
  border-radius: var(--fh-radius-img);
}
.fh-card .fh-face img[src^="data:image/gif"] {
  background: var(--fh-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23F6F6F7'/%3E%3Ccircle cx='60' cy='48' r='21' fill='%23E4E4E7'/%3E%3Cpath d='M20 120c3-27 19-42 40-42s37 15 40 42z' fill='%23E4E4E7'/%3E%3C/svg%3E") center / cover no-repeat;
}
.fh-card .fh-shot img[src^="data:image/gif"] {
  aspect-ratio: 4 / 3;
  background: var(--fh-paper) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23FFFFFF'/%3E%3Ctext x='200' y='144' text-anchor='middle' font-family='JetBrains Mono, ui-monospace, Menlo, monospace' font-size='16' letter-spacing='2.5' fill='%238A8A90'%3ESCREENSHOT GOES HERE%3C/text%3E%3Ctext x='200' y='172' text-anchor='middle' font-family='Inter, Helvetica, Arial, sans-serif' font-size='15' fill='%238A8A90'%3ECrop to the approval message%3C/text%3E%3C/svg%3E") center / 100% 100% no-repeat;
}
.fh-card > .fh-quote {
  grid-area: quote;
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--fh-sans);
  font-size: clamp(18px, 4.8vw, 21px);
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: -0.011em;
  color: var(--fh-ink);
  quotes: "\201C" "\201D";
}
.fh-card[data-layout="win-quote"] > .fh-quote { margin-top: 4px; font-size: clamp(17px, 4.4vw, 19px); }
.fh-card[data-layout="quote-win"] > .fh-headline,
.fh-card[data-layout="quote-win"][data-amount="off"] > .fh-shot { margin-top: 4px; }
.fh-card .fh-quote p { margin: 0; text-wrap: pretty; }
.fh-card .fh-quote p::before { content: open-quote; }
.fh-card .fh-quote p::after { content: close-quote; }
.fh-card > .fh-rule {
  grid-area: rule;
  height: 1px;
  background: var(--fh-hairline);
}
.fh-card > .fh-name {
  grid-area: name;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--fh-sans);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--fh-ink);
}
/* fundhub. logo: cleaned vector traced from fundhub-logo.png, ink #0C0C0D, softened with --fh-mark-opacity */
.fh-card > .fh-mark {
  --fh-mark-h: 16px;
  grid-area: mark;
  justify-self: end;
  display: block;
  width: calc(var(--fh-mark-h) * 4.966);
  height: var(--fh-mark-h);
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2200 443'%3E%3Cpath fill='%230C0C0D' d='M120 0.5c-32.6 2.1-62.9 24.8-75.5 56.6c-5.3 13.4-5.9 17.5-6.5 46.1c-0.7 32 1 29.4-19 29.8c-15.3 0.4-15.9 0.4-17.6 4.4l-1.2 2.4l0 34.7l0 34.7l1 2c1.7 3.4 2.4 3.5 17.6 3.8c14.1 0.3 14.4 0.3 16.7 2.8l1.4 1.3l0.3 9.3l0.4 80.8l0.3 95l0 23.6l1.2 1.6c0.6 1 1.8 2 2.8 2.5l1.9 0.8l38.4 0l38.6 0.1l1.5-0.9c3.9-2.1 4.5 1.6 4.5-81.9l0-131.1c1.6-3.5 3.1-3.6 19.2-3.9c21.3-0.3 19.6 3.8 19.3-48.1l0-28.1l-1-1.7c-0.5-0.9-1.7-2.1-3-2.7l-2.1-0.2l-13.7 0c-19.4-0.3-18.5-0.8-19.1-16.3c-1-26.5-0.1-27.9 21.6-28.5l11.8 0l1.7-1.2c3.8-2.3 4.2-6.6 3.8-50.2c-0.4-36.9-0.2-36.2-5.8-37.5zM1044.2 41.3c-11.2 0.4-12.4 0.3-14 3.7l-1.1 1.8l0 45.4c-0.4 57.7 0.3 54.5-13.3 47.4c-47.3-25-107.8-19-150.3 14.9c-46 36.6-67.1 87.1-61.7 147.7c6.2 71.4 65.7 134.9 130.7 139.8c33.7 2.5 57.9-3 86.8-19.8c8.6-5 11.6-4.6 12.5 1.6c1.2 9.1-0.8 8.8 43.3 8.9l34.1 0l1.8-1c3.2-1.8 2.8 0.4 3.3-60.2l0-320.9c-0.4-6.8-1.3-8.3-4.8-9.3zM977.2 207.8c46 9.5 71.4 70.2 47.7 113.9c-26.1 48.1-85.4 53.4-117.9 10.5c-13.3-17.3-18.5-40-14.9-63.6c4.5-28.5 31.5-57.2 57.4-61c2-0.4 4.3-0.7 5-0.8c2.9-0.6 18.9 0.1 22.7 1zM1156.8 41.3c-5.3 1.3-5.2 1.8-5.7 21.5l0 364.8c1.4 5.2 1.1 5.1 44.9 5.1l36.8 0l1.8-0.8c1.2-0.7 2.2-1.7 2.7-2.8l0.9-1.9l0-68.4c0.3-102.4 1.1-112.5 10.6-131c8.3-15.9 18.6-21.6 37.7-21.1l8.7 0l4.5 1.6c14.5 5.1 24.9 18.3 29.5 40.8l0 95.1c0.6 84.1 1.8 86.3 4.3 88.5l43 0c39.7 0.1 38 0.2 40.2-2.8l1.3-1.5l-0.5-13.3l0-183.6c-4.6-33.1-14.3-53-33.8-72c-35.9-35.1-88-44.9-130.5-24.8c-9.9 4.7-11.4 4.7-13.5 0.7l-1.1-1.6l-0.4-43.3l0-44.3c-0.9-2.4-2-3.3-3.4-4.1l-1.6-0.9l-37.4 0.1zM1761.3 41.3c-6.1 1.2-5.5-16.8-5.5 197.7l0 188.2l1 1.8c0.5 0.9 1.8 2.1 2.7 2.6l1.8 1.1l35.7 0c43 0.1 40.7 0.4 42.3-7.2c1.7-8.1 2.7-8.3 14.5-1.3c14.6 8.9 31.4 15.1 46.5 17.4l44.5 0c60.7-10 108.7-58.1 122.4-123c2.7-12.8 3.2-51.7 0.9-63.8c-17.6-90.9-95.9-145.5-181.6-126.7l-29.7 11c-9 4.4-10.1 4.6-11.7 1.7l-1-1.6l0-46.4c-0.2-50.9-0.2-48.2-3.3-50.5l-1.3-1.1l-38.2 0.1zM1920.5 207c19.3 1.7 36.5 12.4 48.5 30.4c9.9 14.7 11.8 22.2 11.8 47.1l0 17.3l-1.3 4.7c-7.1 28.6-30.5 51.1-56.1 53.9c-40.1 4.5-71.5-17-81.9-55.9l-1.7-6.7l0-14.8c0-26.4 5.1-39.6 21.2-55.9c16.5-16.7 33.3-22.3 59.5-20.1zM636.5 125.1c-12.1 1.1-23.5 4.7-37 11.5c-12 6-12.4 6.2-15.9 2c-4-4.7-1.2-4.4-39.4-4.5c-42.8-0.2-41.5-0.4-42.7 6.7l0 286.2c1.3 5.8 0.1 5.6 44 5.7l37.3 0l1.6-0.8c4.1-2.3 4-0.1 4.4-80.7c0.3-83.6 0.8-98.4 3.7-109.4c6.4-24.1 27.4-38.3 51.7-34.9c15.9 2.3 28 17.1 32.8 39.9c2.7 12.8 2.5 8.1 3 96.4c0.4 87.8 0.4 86.2 2.9 88.6l42.6 0.9l37.7 0l1.7-0.8c0.9-0.5 2-1.7 2.5-2.5l0.8-1.6l0-87c-0.1-108.5-0.2-109.7-6.2-133c-13.4-51.9-68.5-88.2-125.5-82.7zM203.5 134.2c-2.5 0.6-3.8 1.7-4.9 3.8l-0.8 1.8l0 88.7c0.2 106.1 0.2 105.1 5 124.1c12.4 49.3 51.9 83.8 102.2 89.2c28.1 3.1 49.6-0.4 66.4-10.4c9.7-5.9 10.2-6 14.7-1.6c3.7 3.5 1 3.3 40.7 3.1c37.6-0.1 36.2 0 38.4-3l1.2-1.5l0.1-12l0-270.5c-0.4-8-0.7-9.2-3.6-10.8l-1.7-0.9l-38.4 0l-38.6 0l-1.6 0.9c-3.9 2.2-3.8 0.9-4.4 93.9c-0.3 84.7-0.5 86.9-5 100.4c-7.8 23.7-24.1 34-48.6 31.2c-16.8-2-27.2-11.7-33.8-31.9c-3.9-11.8-4.1-15.1-4.8-112.7c-0.6-81.6-0.4-78.6-4.2-80.8l-1.6-1l-37.4 0zM1459.2 134.2c-0.2 0.2-1 0.4-1.7 0.5c-2.2 0.4-3.7 2.6-4.3 5.5l0 190.7c1.8 15 7.3 33.7 13.6 47.3c26.2 57.2 109.4 83.2 163.2 51.1c6-3.6 6.9-3.6 10.7-0.3c4.1 3.6 2.8 3.6 41.1 3.7l34.4 0l1.6-0.8c1-0.5 2.1-1.7 2.5-2.5l1.1-1.6l0.1-26.3l0-244c-0.4-20.2-0.4-20.6-3.7-22.4l-1.6-0.9l-38.4 0l-38.6 0l-1.5 0.9c-4.2 2.3-5.3-0.6-5.9 92.9l0 91.8c-6 29-20 40.8-45 40.8c-25.1 0.1-37.2-11.8-43.9-43l-1.7-7.4l0-84c-0.5-95.5-0.3-90-5-92zM2083 376.5a58.5 58.5 0 1 0 117 0a58.5 58.5 0 1 0-117 0z'/%3E%3C/svg%3E") center / contain no-repeat;
  opacity: var(--fh-mark-opacity);
}
@media (min-width: 640px) {
  .fh-card > .fh-mark { --fh-mark-h: 18px; }
}

/* Optional wrapper for showing cards together. Cards also work on their own. */
.fh-proof {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  align-items: start;
  gap: 40px;
  width: 100%;
  padding: 32px 16px 40px;
  overflow-x: clip;
}
.fh-proof > .fh-card:nth-child(even) { --fh-tilt-dir: 1; }
@media (min-width: 1024px) {
  .fh-proof {
    grid-template-columns: repeat(2, minmax(0, 560px));
    justify-content: center;
    gap: 48px;
    padding: 56px 32px 64px;
  }
}
`;
  /* ── end template CSS ── */

  /* Page alignment with /roadmap. run() puts .fhw on <html>, so none of this reaches
     any page this script is not on. The H1 rule is the /roadmap H1 rule, word for word
     (marketing/landing-pages/slo/slo-01-sales.html); a test fails if they drift. */
  var ALIGN_CSS = [
    ".fhw .fhw-flush{padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important}",
    ".fhw .fh-root .hero h1{font-family:var(--sans);font-size:clamp(28px,4.8vw,46px);font-weight:700;letter-spacing:-.045em;line-height:1.02;margin:20px auto 0;max-width:26ch}",
    ".fhw .fh-root .hero h1 .amt{font-family:inherit;font-size:inherit;font-weight:inherit;letter-spacing:inherit;line-height:inherit;text-decoration:none}"
  ].join("\n");

  /* This section. One column: every heading is the /roadmap section heading, every
     block is the page's text column, the same space between blocks. */
  var PAGE_CSS = [
    "#fh-watch-proof{margin:48px 0 0;text-align:center}",
    "#fh-watch-proof .fhx-sec+.fhx-sec{margin-top:48px}",
    "#fh-watch-proof .fhx-h{font-family:var(--sans);font-size:clamp(22px,3.4vw,32px);font-weight:700;letter-spacing:-.035em;line-height:1.12;text-align:center;color:#0A0A0A;margin:0 auto;max-width:26ch}",
    /* Approvals row. Phones: it runs to both screen edges (the page column is 24px in);
       the first card lines up with the text above, the last with the text edge. The
       padding keeps the card shadows; the margins give it back, so the row sits in
       the same rhythm as the other blocks. */
    "#fh-watch-proof .fhx-rail{position:relative;overflow:hidden;margin:12px -24px -20px;padding:4px 0 20px}",
    "#fh-watch-proof .fhx-track{display:flex;align-items:flex-start;gap:10px;width:max-content;padding:0 24px}",
    /* Sliding row: clipped, not scrollable, so a card that takes keyboard focus off to
       the side cannot scroll the row sideways under the slide (the row went blank). */
    "#fh-watch-proof .fhx-scroll{overflow:clip}",
    "#fh-watch-proof .fhx-scroll .fhx-track{will-change:transform}",
    "#fh-watch-proof .fhx-track>.fh-card{flex:0 0 180px;width:180px}",
    /* Reduced motion: a plain sideways swipe row instead. */
    "#fh-watch-proof .fhx-swipe{overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scroll-padding:0 24px;scrollbar-width:none;-webkit-overflow-scrolling:touch}",
    "#fh-watch-proof .fhx-swipe::-webkit-scrollbar{display:none}",
    "#fh-watch-proof .fhx-swipe .fhx-track{transform:none!important}",
    "#fh-watch-proof .fhx-swipe .fh-card{scroll-snap-align:start}",
    /* The page resets padding on everything under .fh-root, so the card's own padding is
       restated here. Every length below is the 2026-09-22 card grown 20% (owner: "make the
       approvals 20% larger"), so the card's height grows with its width. */
    "#fh-watch-proof .fh-card{--fh-pad:12px;--fh-gap:7px;--fh-tilt-amount:0deg;--fh-radius-card:14px;--fh-radius-frame:10px;--fh-radius-img:5px;--fh-shadow:0 1px 2px rgba(12,12,13,.06),0 10px 24px -14px rgba(12,12,13,.28);max-width:none;padding:var(--fh-pad) var(--fh-pad) calc(var(--fh-pad) - 2px)}",
    "#fh-watch-proof .fh-card>.fh-eyebrow{font-size:12px;letter-spacing:.12em}",
    "#fh-watch-proof .fh-card>.fh-headline{font-size:14px;font-weight:600;line-height:1.2;color:#56565C}",
    "#fh-watch-proof .fh-card .fh-amount{font-size:24px;font-weight:600;line-height:1.05;margin-top:2px;color:#0C0C0D}",
    "#fh-watch-proof .fh-card>.fh-shot{padding:5px}",
    "#fh-watch-proof .fh-card>.fh-mark{--fh-mark-h:14px}",
    "#fh-watch-proof .fhx-roads p{max-width:52ch;margin:12px auto 0;font-size:16px;line-height:1.6;color:#52525B}",
    "#fh-watch-proof .fhx-roads .btn{margin-top:22px}",
    ".fhz{position:fixed;inset:0;z-index:2147483000;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:64px 16px 24px;background:rgba(12,12,13,.88);cursor:zoom-out}",
    ".fhz img{display:block;width:auto;height:auto;max-width:min(100%,900px);max-height:100%;object-fit:contain;background:#fff;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.45)}",
    ".fhz button{position:absolute;top:12px;right:12px;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:#fff;color:#0C0C0D;font:600 26px/44px system-ui,-apple-system,sans-serif;text-align:center;cursor:pointer}",
    "#fh-watch-proof img[data-slot=\"approval-screenshot\"]{cursor:zoom-in}",
    "@media(min-width:700px){",
    "#fh-watch-proof{margin-top:56px}",
    "#fh-watch-proof .fhx-sec+.fhx-sec{margin-top:56px}",
    /* Desktop: the row is the page column; its edges fade so a card slides in and out softly. */
    "#fh-watch-proof .fhx-rail{margin:16px 0 -20px;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%)}",
    "#fh-watch-proof .fhx-track{gap:14px}",
    "#fh-watch-proof .fhx-track>.fh-card{flex-basis:216px;width:216px}",
    "}"
  ].join("\n");

  /* Tap or click a screenshot to see it full size: the cards are small, and moving. */
  var SHOT = 'img[data-slot="approval-screenshot"]';
  function zoomable(scope) {
    var shots = scope.querySelectorAll(SHOT);
    for (var i = 0; i < shots.length; i++) {
      shots[i].setAttribute("tabindex", "0");
      shots[i].setAttribute("role", "button");
      shots[i].setAttribute("aria-label", "See full size: " + shots[i].alt);
    }
    scope.addEventListener("click", function (e) {
      var img = e.target && e.target.closest ? e.target.closest(SHOT) : null;
      if (img) openZoom(img);
    });
    scope.addEventListener("keydown", function (e) {
      var t = e.target;
      if ((e.key === "Enter" || e.key === " ") && t && t.matches && t.matches(SHOT)) {
        e.preventDefault();
        openZoom(t);
      }
    });
  }
  function openZoom(img) {
    if (document.querySelector(".fhz")) return;
    var ov = document.createElement("div");
    ov.className = "fhz";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", img.alt);
    var big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    ov.appendChild(big);
    ov.appendChild(x);
    function onKey(e) { if (e.key === "Escape") close(); }
    function close() {
      document.removeEventListener("keydown", onKey, true);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      try { img.focus({ preventScroll: true }); } catch (e) {}
    }
    ov.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(ov);
    try { x.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ══ CAROUSEL MATH START — sliced out and tested by src/ads/funnel-proof-scripts.test.mjs.
        Do not rename fhxShift and do not move these markers. ══ */
  /* How far the approvals row has slid, in px (0 or less). It starts to move once the
     whole row is on screen (its bottom edge 90% of the way down) and shows its last
     card while the whole row is still on screen (its top edge 10% down), so every card,
     the biggest approvals too, is read in full. Before and after that it rests. On a
     short screen, where that stretch would be under 40% of the screen, it is stretched
     to 40% so the row never races. The page is never held: this only reads where the
     row is; it never stops or slows the scroll. */
  function fhxShift(top, height, vh, travel) {
    if (!(vh > 0) || !(travel > 0)) return 0;
    var span = Math.max(vh * 0.8 - height, vh * 0.4);
    var p = (vh * 0.1 + span - top) / span;
    if (p <= 0) return 0;
    if (p > 1) p = 1;
    return -p * travel;
  }
  /* A card that has keyboard focus stays in view: the slide is nudged just enough to
     bring the card fully inside the row, 24px from its edges, never past either end. */
  function fhxKeep(x, left, width, view, travel) {
    var lo = 24 - left, hi = view - 24 - left - width;
    if (x > hi) x = hi;
    if (x < lo) x = lo;
    return Math.min(0, Math.max(-travel, x));
  }
  /* ══ CAROUSEL MATH END ══ */

  /* Scroll down, the row slides right: one transform per animation frame, nothing
     else moves. The live page scrolls inside <body>, not the window, so the listener
     is on the document in the capture phase, which hears both. Reduced motion: the
     row is a normal sideways swipe row and never moves on its own. */
  function motion(sec) {
    var rail = sec.querySelector(".fhx-rail");
    var track = rail && rail.querySelector(".fhx-track");
    if (!track) return;
    var imgs = rail.querySelectorAll("img[loading=\"lazy\"]");
    var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var travel = 0, queued = false, on = false, eager = false, focused = null;
    function measure() { travel = Math.max(0, track.offsetWidth - rail.clientWidth); }
    function frame() {
      queued = false;
      var r = rail.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      /* Cards off to the side sit outside the clipped row, where lazy images never
         start. Load all of them once the row is within two screens. */
      if (!eager && r.top < vh * 2) {
        eager = true;
        for (var i = 0; i < imgs.length; i++) imgs[i].loading = "eager";
      }
      if (!on) return;
      /* A browser that cannot clip the row can still scroll it sideways on focus. Undo it. */
      if (rail.scrollLeft) rail.scrollLeft = 0;
      var x = fhxShift(r.top, r.height, vh, travel);
      if (focused) {
        var c = focused.getBoundingClientRect(), t = track.getBoundingClientRect();
        x = fhxKeep(x, c.left - t.left, c.width, rail.clientWidth, travel);
      }
      track.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";
    }
    function queue() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(frame);
    }
    function mode() {
      on = !(mq && mq.matches);
      rail.classList.toggle("fhx-scroll", on);
      rail.classList.toggle("fhx-swipe", !on);
      if (on) { rail.scrollLeft = 0; measure(); } else track.style.transform = "";
      queue();
    }
    if (!window.requestAnimationFrame) { rail.classList.add("fhx-swipe"); return; }
    document.addEventListener("scroll", queue, { capture: true, passive: true });
    /* Tab onto a card: the row shows that card. Mouse and touch focus leave it alone. */
    rail.addEventListener("focusin", function (e) {
      var t = e.target, kb = true;
      try { kb = t.matches(":focus-visible"); } catch (err) {}
      focused = kb && t.closest ? t.closest(".fh-card") : null;
      queue();
    });
    rail.addEventListener("focusout", function () { focused = null; queue(); });
    window.addEventListener("resize", function () { if (on) measure(); queue(); }, { passive: true });
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", mode);
      else if (mq.addListener) mq.addListener(mode);
    }
    mode();
  }

  /* The builder's section, row and column boxes each add side padding (15px + 15px on
     a phone), so /watch read 54px in from the screen edge where /roadmap reads 24px.
     Only the ClickFunnels boxes around this page's .fh-root lose it. */
  function flushGutters(root) {
    for (var el = root.parentElement; el && el !== document.body; el = el.parentElement) {
      if (!el.hasAttribute("data-page-element") && !/(^|\s)(col-inner|containerInnerV2)(\s|$)/.test(el.className)) continue;
      var cs = window.getComputedStyle(el);
      if (parseFloat(cs.paddingLeft) || parseFloat(cs.paddingRight) || parseFloat(cs.marginLeft) || parseFloat(cs.marginRight)) {
        el.classList.add("fhw-flush");
      }
    }
  }

  function addStyles() {
    if (document.getElementById("fh-watch-proof-css")) return;
    var s = document.createElement("style");
    s.id = "fh-watch-proof-css";
    s.textContent = TEMPLATE_CSS + "\n" + ALIGN_CSS + "\n" + PAGE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function build() {
    var sec = document.createElement("section");
    sec.id = SECTION_ID;
    sec.setAttribute("aria-label", "Get started");
    sec.innerHTML =
      '<div class="fhx-sec fhx-roads">' +
        '<h2 class="fhx-h">One call. Three roads. Nobody gets turned away.</h2>' +
        "<p>Funding now, fix the file first, or learn to do it yourself. Soft pull only. No obligation.</p>" +
        '<a class="btn" href="/apply" style="text-align:center;text-decoration:none">Get Started</a>' +
      "</div>";
    return sec;
  }

  function run() {
    if (document.getElementById(SECTION_ID)) return;
    var root = document.querySelector(".fh-root");
    if (!root) return;
    /* Anchor: the note under the first Get Started. Fall back to the button itself. */
    var anchor = root.querySelector(".cta-note") || root.querySelector('a.btn[href="/apply"]');
    if (!anchor || !anchor.parentNode) return;
    document.documentElement.classList.add("fhw");
    flushGutters(root);
    addStyles();
    var sec = build();
    anchor.parentNode.insertBefore(sec, anchor.nextSibling);
    zoomable(sec);
    motion(sec);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
