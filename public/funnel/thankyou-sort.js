/*
 * Fundhub /thank-you, lined up with the Sorting Hat offer — https://fundhub.ai/funnel/thankyou-sort.js
 *
 * Loaded from the footer code of apply.fundhub.ai/thank-you (ClickFunnels builder
 * page 25063539) and from marketing/landing-pages/05-thank-you.html. A builder page's
 * body cannot be replaced by API, so this script changes the page itself.
 *
 * What it does:
 *   1. Owner, 2026-10-01: everyone sees "Your Call Is Booked.", a video spot under
 *      the headline, and the confirm-your-call buttons. fhIsBooked now only decides
 *      whether the .ics button shows (it needs a stored booking time).
 *   2. Step 03 reads "You get one of three paths".
 *   3. "Real approvals, real screenshots" before the FAQ: three approvals. No
 *      client-text cards (owner, 2026-09-22: "don't put what clients texted us").
 *      Any screenshot opens full size on tap or click.
 * The FAQ, the calendar, the prep list, the $32 wording and the speed wording are
 * not touched. No links off the page.
 * Owner reorder 2026-10-23 (marketing/landing-pages/preview/thank-you-reorg-draft-build.mjs):
 * "What the call decides" is cut, because it repeated step 03 and the three paths.
 *
 * Proof law (.claude/rules/proof-cards-from-source.md): every card is the
 * proof-card template's own markup, amounts read off the screenshots, photo off,
 * name off. The template CSS below is a verbatim copy of
 * marketing/landing-pages/slo/fundhub-proof-cards.html; src/ads/funnel-proof-scripts.test.mjs
 * fails if they drift.
 */
(function () {
  "use strict";
  if (window.__fhThankyouSort) return;
  window.__fhThankyouSort = true;

  var KEY = "fh_booking_v1";
  var FRESH_MS = 6 * 60 * 60 * 1000;
  var GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  /* ══ BOOKING CHECK START — sliced out and tested by src/ads/funnel-proof-scripts.test.mjs.
        Do not rename fhIsBooked and do not move these markers. ══ */
  /* Presence of the key is NOT proof of a booking. It must describe a real,
     recent, still-upcoming appointment, and the visitor must have come here
     straight from the booking page.
     Why the hop matters: the live /funding-book-call page saves the record every
     time the slot, name or email changes, before anyone presses Book. Fill the form,
     press Back, and the record looks like a booking. A real booking is different:
     ClickFunnels sends the booker on with window.location from /funding-book-call,
     so that page is the referrer. A Back press keeps /thank-you's first referrer.
     The live page stamps capturedAt only; the repo writer (04a-book-top.html) adds
     submittedAt. Either stamp counts, and it must be under six hours old. A record
     with no name or email is someone who clicked a time slot and never filled the form. */
  function fhIsBooked(d, now, ref) {
    if (!/^https?:\/\/[^/]+\/funding-book-call(?:[/?#]|$)/.test(String(ref || ""))) return false;
    if (!d || typeof d !== "object") return false;
    if (!d.start || !d.end) return false;
    if (!d.name || !d.email) return false;
    var at = Number(d.submittedAt || d.capturedAt);
    if (!at || !isFinite(at) || now - at > FRESH_MS || at - now > FRESH_MS) return false;
    var starts = new Date(d.start).getTime();
    if (isNaN(starts) || starts < now) return false;
    return true;
  }
  /* ══ BOOKING CHECK END ══ */

  function readBooking() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (!raw) { try { raw = sessionStorage.getItem(KEY); } catch (e) {} }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* Approvals shown here: amount read off each crop (marketing/landing-pages/slo/client-wins/deck.json). */
  var WINS = [
    { id: "t-74k-chase-ink", amount: "$74,000", alt: "Chase Ink Business Cash card approval showing $74,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715350/file/685c4e87c43f57142cfe2bd70318efeb.jpg" },
    { id: "t-50k-keybank", amount: "$50,000", alt: "KeyBank business credit card approval showing a $50,000 credit limit",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715354/file/6484dec63f442004a983f44f01eb1a5d.jpg" },
    { id: "t-25k-highland", amount: "$25,000", alt: "Highland Bank Visa Business Card approval showing $25,000",
      src: "https://statics.myclickfunnels.com/workspace/edLgGE/image/23715361/file/d619505428aae233495eb08f9ca78220.jpg" }
  ];

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* One proof-card template article: every slot kept, the switches decide what shows. */
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

  function winCard(w) { return card({ id: w.id, layout: "win", amount: w.amount, src: w.src, alt: w.alt }); }

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

  var PAGE_CSS = [
    "#fh-ty-video{max-width:860px;margin:28px auto 0;text-align:center}",
    "#fh-ty-video .kicker{display:block;margin-bottom:12px}",
    "#fh-ty-video .fhv-media{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0A0A0A;box-shadow:0 18px 40px -18px rgba(10,10,10,.45)}",
    "#fh-ty-video video{width:100%;height:100%;object-fit:cover;display:block}",
    "#fh-ty-video .fhv-slot{position:absolute;inset:0;display:grid;place-items:center;background:#111113}",
    "#fh-ty-video .fhv-slot span{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.14em;color:#9C9CA5}",
    "#fh-ty-video .fhv-unmute{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,10,10,.28);transition:opacity .2s;z-index:2}",
    "#fh-ty-video .fhv-unmute.hidden{opacity:0;pointer-events:none}",
    "#fh-ty-video .fhv-pill{display:flex;align-items:center;gap:10px;background:#188bf6;color:#fff;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:14px 22px;border-radius:999px;box-shadow:0 10px 30px rgba(10,10,10,.35)}",
    "#fh-ty-video .fhv-pill svg{width:16px;height:16px;flex:0 0 auto}",
    "#fh-ty-proof{max-width:660px;margin:36px auto 0;text-align:center}",
    /* Phones: one sideways swipe row that runs to both screen edges. */
    "#fh-ty-proof .fhy-row{display:flex;align-items:flex-start;gap:10px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;margin:14px calc(50% - 50vw) 0;padding:3px calc(50vw - 50%) 8px}",
    "#fh-ty-proof .fhy-row::-webkit-scrollbar{display:none}",
    "#fh-ty-proof .fhy-row>.fh-card{flex:0 0 150px}",
    /* The page resets padding on everything under .fh-root, so the card's own padding is restated here. */
    "#fh-ty-proof .fh-card{--fh-pad:10px;--fh-gap:6px;--fh-tilt-amount:0deg;--fh-radius-card:12px;--fh-radius-frame:8px;--fh-radius-img:4px;--fh-shadow:0 1px 2px rgba(12,12,13,.06),0 10px 24px -14px rgba(12,12,13,.28);max-width:none;padding:var(--fh-pad) var(--fh-pad) calc(var(--fh-pad) - 2px)}",
    "#fh-ty-proof .fh-card>.fh-eyebrow{font-size:10px;letter-spacing:.12em}",
    "#fh-ty-proof .fh-card>.fh-headline{font-size:12px;font-weight:600;line-height:1.2;color:#56565C}",
    "#fh-ty-proof .fh-card .fh-amount{font-size:20px;font-weight:600;line-height:1.05;margin-top:2px;color:#0C0C0D}",
    "#fh-ty-proof .fh-card>.fh-shot{padding:4px}",
    "#fh-ty-proof .fh-card>.fh-mark{--fh-mark-h:12px}",
    ".fhz{position:fixed;inset:0;z-index:2147483000;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:64px 16px 24px;background:rgba(12,12,13,.88);cursor:zoom-out}",
    ".fhz img{display:block;width:auto;height:auto;max-width:min(100%,900px);max-height:100%;object-fit:contain;background:#fff;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.45)}",
    ".fhz button{position:absolute;top:12px;right:12px;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:#fff;color:#0C0C0D;font:600 26px/44px system-ui,-apple-system,sans-serif;text-align:center;cursor:pointer}",
    "#fh-ty-proof img[data-slot=\"approval-screenshot\"]{cursor:zoom-in}",
    "@media(min-width:700px){",
    /* Desktop: the three approvals on one row. */
    "#fh-ty-proof .fhy-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;overflow:visible;margin:16px 0 0;padding:0}",
    "#fh-ty-proof .fhy-row>.fh-card{flex:none}",
    "}"
  ].join("\n");

  /* Tap or click a screenshot to see it full size: the cards are small. */
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
    x.textContent = "\u00D7";
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

  function addStyles() {
    if (document.getElementById("fh-ty-sort-css")) return;
    var s = document.createElement("style");
    s.id = "fh-ty-sort-css";
    s.textContent = TEMPLATE_CSS + "\n" + PAGE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  }
  function after(node, add) { node.parentNode.insertBefore(add, node.nextSibling); }
  function setText(node, text) { if (node) node.textContent = text; }
  var VIDEO_SRC = "https://fundhub.ai/funnel/thank-you-video.mp4";
  function buildVideo() {
    var inner = VIDEO_SRC
      ? '<video id="fh-ty-vid" autoplay muted playsinline preload="auto" poster="https://fundhub.ai/funnel/thank-you-video-poster.jpg" src="' + VIDEO_SRC + '"></video>' +
        '<div class="fhv-unmute" id="fh-ty-unmute"><span class="fhv-pill">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' +
        "Tap for sound</span></div>"
      : '<div class="fhv-slot"><span>[ VIDEO ]</span></div>';
    var wrap = el('<section id="fh-ty-video"><span class="kicker">Watch this before your call</span><div class="fhv-media">' + inner + "</div></section>");
    var v = wrap.querySelector("video"), o = wrap.querySelector(".fhv-unmute");
    if (v && o) {
      var unmute = function () { v.muted = false; v.currentTime = 0; v.play(); o.classList.add("hidden"); };
      o.addEventListener("click", unmute);
      v.addEventListener("click", function () { if (!o.classList.contains("hidden")) unmute(); });
    }
    return wrap;
  }
  function show(node, on) { if (node) node.style.display = on ? "" : "none"; }

  /* Funnel tracking (docs/tracking/tracking-spec.md). Safe before
     https://fundhub.ai/funnel/fh-events.js loads: it drains window.fhq. */
  function fht(e, p) { (window.fhTrack || function (e, p) { (window.fhq = window.fhq || []).push([e, p]); })(e, p); }

  /* survey_route: the road this page shows. The Sorting Hat's real offer (FUNDING_DFY,
     REPAIR_DFY, ...) is picked on the call, not here: the closer's cockpit saves it
     through POST /api/closer-deck "log_disposition" (src/sales/closer-deck.mjs
     logDeckDisposition). Since 2026-10-01 this page sends everyone to that one call;
     the only thing it decides is whether a fresh booking came with the visitor.
       offer "call-booked"  came straight from /funding-book-call with a fresh booking
       offer "call"         everyone else (the call is still the next step)
     survey "home" when the visitor came from fundhub.ai (the homepage survey sends its
     DOWNSELL and MANUAL_REVIEW leads here, src/config/homepage-survey-steps.mjs);
     "apply" otherwise. */
  function trackRoute(booked) {
    var fromHome = /^https?:\/\/(www\.)?fundhub\.ai(\/|$)/.test(String(document.referrer || ""));
    fht("survey_route", { survey: fromHome ? "home" : "apply", offer: booked ? "call-booked" : "call" });
  }

  function run() {
    var root = document.querySelector(".fh-root");
    if (!root || document.getElementById("fh-ty-proof")) return;
    var hero = root.querySelector(".hero");
    if (!hero) return;
    addStyles();

    var prose = root.querySelector(".prose");
    var expect = root.querySelector("section.expect");
    var prep = root.querySelector("section.prep");
    var cal = document.getElementById("fh-cal-cta") || root.querySelector(".cal-cta");
    var faq = root.querySelector("section.faq");
    var booked = fhIsBooked(readBooking(), Date.now(), document.referrer);
    trackRoute(booked);   /* once per page load: run() only gets here once */

    /* 1. Everyone sees the booked page and the confirm-your-call buttons (owner, 2026-10-01:
          "shouldn't show pick your call time ... a confirm your call button like we had before").
          The .ics button needs a real booking time, so it shows only when one is stored. */
    setText(hero.querySelector(".eyebrow"), "Confirmed · Funding Path");
    setText(hero.querySelector("h1.sec"), "Your Call Is Booked.");
    setText(hero.querySelector(".lede"), "Your advisor is holding this time for you.");
    setText(prose && prose.querySelector("p:not(.lead)"), "Check your email for the confirmation and calendar invite.");
    show(expect, true);
    show(prep, true);
    show(cal, true);
    show(document.getElementById("fh-cal-ics"), booked);
    if (cal) setText(cal.querySelector(".kicker"), "Confirm your call");

    /* Video, styled like the /watch VSL, right under the headline. VIDEO_SRC is empty until
       the video is filmed; the box shows a placeholder until then. */
    after(hero, buildVideo());

    /* An older copy of the page body still has .prose: the confirm block goes under it there.
       The current body already has the confirm block right under the headline. */
    if (cal && prose) after(prose, cal);

    /* 2. Step 03. */
    if (expect) {
      var titles = expect.querySelectorAll(".step .t");
      for (var i = 0; i < titles.length; i++) {
        if (/exact funding number|three roads/i.test(titles[i].textContent)) titles[i].textContent = "You get one of three paths";
      }
    }

    /* 3. Real approvals — before the FAQ. */
    var proof = el(
      '<section id="fh-ty-proof" aria-label="Client approvals">' +
        '<span class="kicker">Real approvals, real screenshots</span>' +
        '<div class="fhy-row">' + WINS.map(winCard).join("") + "</div>" +
      "</section>"
    );
    if (faq && faq.parentNode) faq.parentNode.insertBefore(proof, faq);
    else after(prep || expect || hero, proof);
    zoomable(proof);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
