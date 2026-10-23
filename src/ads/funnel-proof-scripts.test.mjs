// src/ads/funnel-proof-scripts.test.mjs — the /watch proof block and the
// /thank-you Sorting Hat script, proved against the files fundhub.ai serves.
//
// Both ClickFunnels pages are builder pages: their body cannot be replaced by
// API, so the new sections ride in on footer scripts (public/funnel/*.js). This
// test holds those scripts to the proof-card law
// (.claude/rules/proof-cards-from-source.md) and to the booking check (T14-01)
// they now carry.
//
// WHAT THIS CANNOT TEST: layout, image loading and the live page. That is the
// Playwright walk recorded on the board (ops/workflows/2026-09-22-watch-proof.md).
//
// npm test's glob is src/** and scripts/** only (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUSH_MANIFEST,
  WATCH_PROOF_SRC,
  FUNDING_PATHS_SRC,
  footerScriptTag,
  THANKYOU_SORT_SRC,
  VSL_WATCH_BEACON_SRC,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  CLARITY_SRC,
  FUNDHUB_PROMPTER_DOWNLOAD_SRC,
  trackingFooterScripts,
  isClickFunnelsPageHtml,
  dedupeFooterScripts,
  nextFooterCode,
  DEFER_FOOTER_SRCS,
  nextHeadCode,
  hasScriptSrc,
  metaPixelHeadHtml,
  directRoasHeadHtml,
} from "../../marketing/landing-pages/tracking-manifest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const WATCH = read("public/funnel/watch-proof.js");
const THANKS = read("public/funnel/thankyou-sort.js");
const TEMPLATE = read("marketing/landing-pages/slo/fundhub-proof-cards.html");
const TEMPLATE_CSS = TEMPLATE.slice(TEMPLATE.indexOf("<style>") + "<style>".length, TEMPLATE.indexOf("</style>"));
const DECK = JSON.parse(read("marketing/landing-pages/slo/client-wins/deck.json"));
// /roadmap is only read here, to hold /watch to the same H1 and the same video slot.
const ROADMAP = read("marketing/landing-pages/slo/slo-01-sales.html");

function cssBody(src, selector) {
  const at = src.indexOf(`${selector}{`);
  assert.ok(at > -1, `${selector} rule is missing`);
  return src.slice(at + selector.length + 1, src.indexOf("}", at));
}

function arrayLiteral(src, name) {
  const start = src.indexOf(`var ${name} = [`);
  assert.ok(start > -1, `${name} is missing`);
  const body = src.slice(start + `var ${name} = `.length, src.indexOf("];", start) + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${body};`)();
}

describe("proof cards are the template, not a copy that drifted", () => {
  test("both scripts carry the template's CSS verbatim", () => {
    assert.ok(TEMPLATE_CSS.length > 1000);
    assert.ok(WATCH.includes(TEMPLATE_CSS), "watch-proof.js template CSS differs from fundhub-proof-cards.html");
    assert.ok(THANKS.includes(TEMPLATE_CSS), "thankyou-sort.js template CSS differs from fundhub-proof-cards.html");
  });

  test("every card uses the template switches with photo off and name off", () => {
    for (const src of [WATCH, THANKS]) {
      assert.match(src, /'<article class="fh-card" data-layout="' \+ o\.layout \+ '" data-photo="off" data-name="off" data-amount="'/);
      for (const slot of ["face", "dollar-amount", "approval-screenshot", "quote", "name"]) {
        assert.ok(src.includes(`data-slot="${slot}"`), `slot ${slot} kept`);
      }
    }
  });
});

describe("every approval is a real deck crop with the amount read off it", () => {
  const byId = new Map(DECK.cards.map((c) => [c.id, c]));
  const money = (n) => `$${n.toLocaleString("en-US")}`;

  // Owner, 2026-09-22: /watch shows 16 curated approvals (not the full deck row).
  const watchWinIds = arrayLiteral(WATCH, "WINS").map((w) => w.id);
  for (const [name, src, ids] of [
    ["/watch", WATCH, watchWinIds],
    ["/thank-you", THANKS, ["t-74k-chase-ink", "t-50k-keybank", "t-25k-highland"]],
  ]) {
    test(`${name} shows exactly the planned approvals, amounts and images from deck.json`, () => {
      const wins = arrayLiteral(src, "WINS");
      assert.deepEqual(wins.map((w) => w.id), ids);
      assert.equal(new Set(wins.map((w) => w.id)).size, wins.length, "no card twice");
      for (const w of wins) {
        const card = byId.get(w.id);
        assert.ok(card, `${w.id} is in deck.json`);
        assert.equal(card.kind, "win");
        assert.equal(w.amount, money(card.amount_dollars), `${w.id} amount`);
        assert.equal(w.src, card.image.url, `${w.id} image`);
        assert.equal(w.alt, card.alt, `${w.id} alt`);
      }
    });
  }

  test("/watch has 16 curated approvals, each with the deck's image size", () => {
    const wins = arrayLiteral(WATCH, "WINS");
    assert.equal(wins.length, 16);
    for (const w of wins) {
      const card = byId.get(w.id);
      assert.equal(w.w, card.image.width, `${w.id} width`);
      assert.equal(w.h, card.image.height, `${w.id} height`);
    }
    assert.ok(WATCH.includes(String.raw`function winCard(w) { return card({ id: w.id, layout: "win", amount: w.amount, src: w.src, alt: w.alt, w: w.w, h: w.h }); }`));
    assert.ok(WATCH.includes(String.raw`'" width="' + (o.w || 1200) + '" height="' + (o.h || 900) + '"`));
  });

  test("/thank-you keeps its three approvals under $100K", () => {
    for (const w of arrayLiteral(THANKS, "WINS")) assert.ok(byId.get(w.id).amount_dollars < 100000, w.id);
  });
});

describe("no client texts in the watch funnel (owner, 2026-09-22)", () => {
  // "Please don't put what clients texted us, because we need the vertical video placeholder."
  test("neither page builds a client-text card", () => {
    for (const src of [WATCH, THANKS]) {
      assert.equal(src.includes("var TEXTS"), false, "no TEXTS list");
      assert.equal(src.includes("textCard"), false, "no text card builder");
      assert.equal(src.includes('layout: "quote-win"'), false, "no quote-win cards");
      assert.equal(src.includes("/funnel/proof/"), false, "no client-text crops");
    }
    assert.equal(WATCH.includes("What clients texted us"), false);
    assert.equal(THANKS.includes("Real approvals, real texts"), false);
    assert.ok(THANKS.includes(`'<span class="kicker">Real approvals, real screenshots</span>'`));
    assert.ok(THANKS.includes(`'<div class="fhy-row">' + WINS.map(winCard).join("") + "</div>"`), "the /thank-you row is the approvals only");
  });

  test("the client-text crops still served on fundhub.ai stay byte-for-byte the deck crops", () => {
    for (const id of ["s34-q1", "s21-b", "s23-b"]) {
      const served = fs.readFileSync(path.join(ROOT, "public/funnel/proof", `${id}.jpg`));
      const deck = fs.readFileSync(path.join(ROOT, "marketing/landing-pages/slo/client-wins/deck", `${id}.jpg`));
      assert.ok(served.equals(deck), `${id}.jpg`);
    }
  });
});

describe("/watch is one organized column: video testimonials, three roads", () => {
  const build = WATCH.slice(WATCH.indexOf("function build()"), WATCH.indexOf("function run()"));

  test("the two blocks come in order under the first Get Started, with no approvals row", () => {
    // Approvals row removed from /watch (owner, 2026-10-01).
    const at = (s) => build.indexOf(s);
    assert.equal(at("Real approvals. Real screenshots."), -1, "no approvals row on /watch");
    assert.equal(at("fhx-rail"), -1);
    const vids = at('<h2 class="fhx-h">From our clients</h2>');
    const roads = at('<h2 class="fhx-h">One call. Three roads. Nobody gets turned away.</h2>');
    assert.ok(vids > -1 && roads > vids, "videos, then roads");
    assert.equal((build.match(/<h2 class="fhx-h">/g) || []).length, 2);
    assert.ok(at('<a class="btn" href="/apply"') > roads, "the second Get Started closes the section");
    assert.ok(WATCH.includes(String.raw`var anchor = root.querySelector(".cta-note") || root.querySelector('a.btn[href="/apply"]');`));
  });

  test("the section heading is the /roadmap section heading", () => {
    const h2 = cssBody(ROADMAP, ".fh-root .h2");
    const mine = cssBody(WATCH, "#fh-watch-proof .fhx-h");
    for (const decl of ["font-family:var(--sans)", "font-size:clamp(22px,3.4vw,32px)", "font-weight:700", "letter-spacing:-.035em", "line-height:1.12", "text-align:center", "max-width:26ch"]) {
      assert.ok(h2.includes(decl), `/roadmap .h2 has ${decl}`);
      assert.ok(mine.includes(decl), `/watch heading has ${decl}`);
    }
  });

  test("three vertical video placeholders, the /roadmap slot word for word, nothing invented", () => {
    assert.deepEqual(arrayLiteral(WATCH, "VIDEOS"), ["[ VIDEO TESTIMONIAL 1 ]", "[ VIDEO TESTIMONIAL 2 ]", "[ VIDEO TESTIMONIAL 3 ]"]);
    assert.ok(build.includes(String.raw`'<div class="fhx-vgrid">' + VIDEOS.map(function (v) { return '<div class="fhx-vslot"><span>' + esc(v) + "</span></div>"; }).join("") + "</div>"`));
    assert.equal(cssBody(WATCH, "#fh-watch-proof .fhx-vslot"), cssBody(ROADMAP, ".fh-b .vslot"));
    assert.equal(cssBody(WATCH, "#fh-watch-proof .fhx-vslot span"), cssBody(ROADMAP, ".fh-b .vslot span"));
    assert.ok(cssBody(ROADMAP, ".fh-b .vslot").includes("background:#111113"));
    assert.ok(cssBody(ROADMAP, ".fh-b .vslot").includes("aspect-ratio:9/16"));
  });
});

describe("the card sizes the owner set on 2026-09-22", () => {
  // "You see how the padding on the testimonials is too much? Fix that by making the
  // video testimonial cards larger. And then make the approvals 20% larger."
  //
  // Measured on the live page (apply.fundhub.ai/watch, headless Chromium, 2026-09-22):
  //   approvals  1280: 180x229 -> 216x273     390: 150x207 -> 180x246
  //   video slot 1280: 169x300 -> 257x458     390: 106x188 -> 109x193
  //   the video row went from 531px of an 852px column (160px of air each side) to 804px
  //   (24px each side), which lines it up with the approval cards above it.

  test("every approval card is 20% wider, and the padding and type inside grow with it", () => {
    assert.ok(WATCH.includes('"#fh-watch-proof .fhx-track>.fh-card{flex:0 0 180px;width:180px}"'), "phone card 150 -> 180");
    assert.ok(WATCH.includes('"#fh-watch-proof .fhx-track>.fh-card{flex-basis:216px;width:216px}"'), "desktop card 180 -> 216");
    // Height follows width only if every length inside the card grows too.
    const card = cssBody(WATCH, "#fh-watch-proof .fh-card");
    for (const decl of ["--fh-pad:12px", "--fh-gap:7px", "--fh-radius-card:14px", "--fh-radius-frame:10px", "--fh-radius-img:5px"]) {
      assert.ok(card.includes(decl), `the card keeps ${decl}`);
    }
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fh-card>.fh-eyebrow").includes("font-size:12px"));
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fh-card>.fh-headline").includes("font-size:14px"));
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fh-card .fh-amount").includes("font-size:24px"));
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fh-card>.fh-shot").includes("padding:5px"));
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fh-card>.fh-mark").includes("--fh-mark-h:14px"));
  });

  test("the screenshot inside a card is still the whole picture, at the deck's own size", () => {
    // Bigger card, same source crop: nothing is cut off and nothing is blown up past its pixels.
    assert.ok(TEMPLATE_CSS.includes("object-fit: contain"), "the template never crops a screenshot");
    for (const w of arrayLiteral(WATCH, "WINS")) assert.equal(w.w > 1000 && w.h > 700, true, `${w.id} is a full-size crop`);
  });

  test("the video testimonials fill the row instead of floating in the middle of it", () => {
    const slot = cssBody(WATCH, "#fh-watch-proof .fhx-vgrid>.fhx-vslot");
    assert.ok(slot.includes("flex:1 1 0"), "the slots share the row");
    assert.ok(slot.includes("max-width:300px"), "the 169px cap is gone");
    assert.ok(slot.includes("max-height:none"), "/roadmap's 300px height cap is what held them small");
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fhx-vgrid").includes("gap:8px"), "phone gap 12 -> 8");
    assert.ok(WATCH.includes('"#fh-watch-proof .fhx-vgrid{margin-top:20px;gap:16px;padding:0 24px}"'), "desktop: the row is the approvals band, 24px in");
    // The shape and the dark look are untouched: the test above holds the slot to /roadmap.
    assert.ok(cssBody(WATCH, "#fh-watch-proof .fhx-vslot").includes("aspect-ratio:9/16"));
  });
});

describe("/watch approvals row slides right as the page scrolls down, and never holds the page", () => {
  const START = "CAROUSEL MATH START";
  const END = "CAROUSEL MATH END";
  const a = WATCH.indexOf(START);
  const b = WATCH.indexOf(END);
  assert.ok(a > -1 && b > a, "carousel math markers");
  const body = WATCH.slice(WATCH.indexOf("*/", a) + 2, WATCH.lastIndexOf("/*", b));
  // eslint-disable-next-line no-new-func
  const fhxShift = new Function(`${body}\nreturn fhxShift;`)();
  const vh = 900;
  const travel = 2000;
  const row = 250;
  // With a 250px row on a 900px screen the row moves while its bottom edge goes from
  // 810 (90%) up to where its top edge is 90 (10%): top 560 -> 90, 470px of scroll.

  test("rests on the first card until the whole row is on screen (bottom edge at 90%)", () => {
    assert.equal(fhxShift(900, row, vh, travel), 0, "still coming up from below");
    assert.equal(fhxShift(560, row, vh, travel), 0, "bottom edge at 810 = 90%");
  });

  test("moves in step with the scroll, and shows the last card while the whole row is still on screen", () => {
    assert.equal(fhxShift(560 - 470 / 4, row, vh, travel), -500);
    assert.equal(fhxShift(560 - 470 / 2, row, vh, travel), -1000);
    assert.equal(fhxShift(90, row, vh, travel), -2000, "top edge at 90 = 10%: last card, row fully on screen");
    assert.equal(fhxShift(-400, row, vh, travel), -2000, "rests on the last card after that");
    let last = 1;
    for (let top = 900; top >= -300; top -= 25) {
      const x = fhxShift(top, row, vh, travel);
      assert.ok(x <= last && x >= -travel, `never goes back or past the end (top ${top})`);
      last = x;
    }
  });

  test("a short screen still gets at least 40% of the screen of scroll for the whole row", () => {
    // Phone on its side: 390px tall, 250px row. 0.8 * 390 - 250 = 62px would race.
    const short = 390;
    const span = short * 0.4;
    assert.equal(fhxShift(short * 0.1 + span, row, short, travel), 0);
    assert.equal(fhxShift(short * 0.1 + span / 2, row, short, travel), -1000);
    assert.equal(fhxShift(short * 0.1, row, short, travel), -2000);
  });

  test("nothing to slide, or no screen height, means no movement", () => {
    assert.equal(fhxShift(0, row, vh, 0), 0);
    assert.equal(fhxShift(0, row, 0, travel), 0);
  });

  test("one transform per animation frame, passive listener, reduced motion gets a swipe row, nothing is pinned", () => {
    assert.ok(WATCH.includes(`document.addEventListener("scroll", queue, { capture: true, passive: true });`));
    assert.ok(WATCH.includes("window.requestAnimationFrame(frame);"));
    assert.ok(WATCH.includes("var x = fhxShift(r.top, r.height, vh, travel);"));
    assert.ok(WATCH.includes(`track.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";`));
    assert.ok(WATCH.includes(`window.matchMedia("(prefers-reduced-motion: reduce)")`));
    assert.ok(WATCH.includes("#fh-watch-proof .fhx-swipe{overflow-x:auto;"));
    assert.ok(WATCH.includes("#fh-watch-proof .fhx-swipe .fhx-track{transform:none!important}"));
    const motion = WATCH.slice(WATCH.indexOf("function motion("), WATCH.indexOf("function flushGutters("));
    for (const pin of ["position:sticky", "preventDefault", "scrollTo(", "scrollTop", "overflow"]) {
      assert.equal(motion.includes(pin), false, `the motion code never touches ${pin}`);
    }
    assert.equal(WATCH.includes("position:sticky"), false);
  });

  test("keyboard Tab never scrolls the sliding row sideways under the slide (the row went blank)", () => {
    // Reviewer 2026-09-22: Tab onto an off-side card scrolled the overflow:hidden row, and
    // that hidden scroll added to the slide until 0 of 16 cards were on screen.
    assert.ok(WATCH.includes("#fh-watch-proof .fhx-scroll{overflow:clip}"), "the sliding row is clipped, not scrollable");
    assert.ok(WATCH.includes("if (rail.scrollLeft) rail.scrollLeft = 0;"), "every frame undoes a sideways scroll where clip is missing");
  });

  test("a card that gets keyboard focus is brought fully into the row, never past either end", () => {
    // eslint-disable-next-line no-new-func
    const fhxKeep = new Function(`${body}\nreturn fhxKeep;`)();
    const view = 390;
    const w = 150;
    // Card 3 (left 24 + 2 * 160 = 344) with the row at rest: its right edge is at 494, off
    // the row. Nudged just enough that the right edge sits 24px inside: 390 - 24 - 494 = -128.
    assert.equal(fhxKeep(0, 344, w, view, 2208), -128);
    // Already fully inside: the slide is left alone.
    assert.equal(fhxKeep(-200, 344, w, view, 2208), -200);
    // Row slid far right, first card focused: back to its start, not past 0.
    assert.equal(fhxKeep(-1500, 24, w, view, 2208), 0);
    // Last card: never slid past the end of the row.
    assert.equal(fhxKeep(0, 24 + 15 * 160, w, view, 2208), -2208);
    const motion = WATCH.slice(WATCH.indexOf("function motion("), WATCH.indexOf("function flushGutters("));
    assert.ok(motion.includes(`kb = t.matches(":focus-visible");`), "only keyboard focus moves the row; a click or tap does not");
    assert.ok(motion.includes(`rail.addEventListener("focusout", function () { focused = null; queue(); });`));
  });

  test("off-screen cards load before they slide in", () => {
    assert.ok(WATCH.includes("if (!eager && r.top < vh * 2) {"));
    assert.ok(WATCH.includes(`imgs[i].loading = "eager";`));
  });
});

describe("/watch lines up with /roadmap: same side gutters, same H1", () => {
  test("the H1 rule is the /roadmap H1 rule word for word, and the amounts use the H1's own font", () => {
    assert.equal(cssBody(WATCH, ".fhw .fh-root .hero h1"), cssBody(ROADMAP, ".fh-root .hero h1"));
    assert.equal(
      cssBody(WATCH, ".fhw .fh-root .hero h1 .amt"),
      "font-family:inherit;font-size:inherit;font-weight:inherit;letter-spacing:inherit;line-height:inherit;text-decoration:none",
    );
  });

  test("only the ClickFunnels boxes around this page's .fh-root lose their side padding, and only where the script runs", () => {
    assert.ok(WATCH.includes(".fhw .fhw-flush{padding-left:0!important;padding-right:0!important;margin-left:0!important;margin-right:0!important}"));
    assert.match(WATCH, /document\.documentElement\.classList\.add\("fhw"\);\s*flushGutters\(root\);/);
    const flush = WATCH.slice(WATCH.indexOf("function flushGutters("), WATCH.indexOf("function addStyles("));
    assert.ok(flush.includes("for (var el = root.parentElement; el && el !== document.body; el = el.parentElement) {"));
    assert.ok(flush.includes(String.raw`if (!el.hasAttribute("data-page-element") && !/(^|\s)(col-inner|containerInnerV2)(\s|$)/.test(el.className)) continue;`));
    // Every page-wide rule is scoped to .fhw, which only this script sets.
    const start = WATCH.indexOf("var ALIGN_CSS = [");
    const align = WATCH.slice(start, WATCH.indexOf("].join(", start));
    const selectors = [...align.matchAll(/"([^"{]+)\{/g)].map((m) => m[1]);
    assert.equal(selectors.length, 3);
    for (const sel of selectors) assert.ok(sel.startsWith(".fhw "), sel);
  });
});

describe("no links off the page", () => {
  test("the only links the scripts add go to the next funnel step", () => {
    const hrefs = (src) => [...new Set([...src.matchAll(/href="([^"]*)"/g)].map((m) => m[1]))];
    assert.deepEqual(hrefs(WATCH), ["/apply"]);
    assert.deepEqual(hrefs(THANKS), []);
    assert.equal(/make sure you show up/i.test(THANKS), false);
  });
});

describe("fhIsBooked — the thank-you page claims a booking only when one exists (T14-01)", () => {
  const START = "BOOKING CHECK START";
  const END = "BOOKING CHECK END";
  const a = THANKS.indexOf(START);
  const b = THANKS.indexOf(END);
  assert.ok(a > -1 && b > a, "booking check markers");
  const body = THANKS.slice(THANKS.indexOf("*/", a) + 2, THANKS.lastIndexOf("/*", b));
  // eslint-disable-next-line no-new-func
  const check = new Function(`var FRESH_MS = 6 * 60 * 60 * 1000;\n${body}\nreturn fhIsBooked;`)();
  // ClickFunnels sends a real booker on from the booking page with window.location,
  // so that page is the referrer. Every case below arrives that way unless it says not.
  const FROM_BOOKING = "https://apply.fundhub.ai/funding-book-call";
  const fhIsBooked = (d, now, ref = FROM_BOOKING) => check(d, now, ref);

  const now = Date.parse("2026-09-22T15:00:00Z");
  const H = 3600e3;
  const base = {
    start: new Date(now + 26 * H).toISOString(),
    end: new Date(now + 26.5 * H).toISOString(),
    name: "Pat",
    email: "pat@example.com",
  };

  test("nothing stored, or junk, is not a booking", () => {
    assert.equal(fhIsBooked(null, now), false);
    assert.equal(fhIsBooked("x", now), false);
    assert.equal(fhIsBooked({}, now), false);
  });

  test("the live booking page's record (capturedAt only) counts when fresh", () => {
    assert.equal(fhIsBooked({ ...base, capturedAt: now - 60e3 }, now), true);
  });

  test("the repo booking page's record (submittedAt) counts when fresh", () => {
    assert.equal(fhIsBooked({ ...base, capturedAt: now - 60e3, submittedAt: now - 30e3 }, now), true);
  });

  test("a time slot clicked with an empty form is not a booking", () => {
    assert.equal(fhIsBooked({ ...base, name: "", email: "", capturedAt: now }, now), false);
  });

  test("older than six hours is not a booking", () => {
    assert.equal(fhIsBooked({ ...base, capturedAt: now - 7 * H }, now), false);
  });

  test("an appointment already in the past is not a booking", () => {
    assert.equal(fhIsBooked({ ...base, start: new Date(now - H).toISOString(), capturedAt: now - 60e3 }, now), false);
  });

  test("a stamp far in the future is not trusted", () => {
    assert.equal(fhIsBooked({ ...base, capturedAt: now + 7 * H }, now), false);
  });

  test("a full record is not a booking unless the visitor came straight from the booking page", () => {
    // The live booking page saves the record as the form is typed, before Book is
    // pressed. Filling the form and pressing Back keeps /thank-you's first referrer.
    const rec = { ...base, capturedAt: now - 60e3 };
    for (const ref of ["", "https://fundhub.ai/", "https://apply.fundhub.ai/apply", "https://apply.fundhub.ai/thank-you", "https://apply.fundhub.ai/funding-book-call-old", "https://apply.fundhub.ai/x/funding-book-call"]) {
      assert.equal(fhIsBooked(rec, now, ref), false, `referrer ${JSON.stringify(ref)}`);
    }
    assert.equal(fhIsBooked({ ...rec, submittedAt: now - 30e3 }, now, "https://fundhub.ai/"), false);
    for (const ref of ["https://apply.fundhub.ai/funding-book-call", "https://apply.fundhub.ai/funding-book-call/", "https://apply.fundhub.ai/funding-book-call?utm_source=fb&fbclid=1"]) {
      assert.equal(fhIsBooked(rec, now, ref), true, `referrer ${ref}`);
    }
  });

  test("the page passes document.referrer to the check", () => {
    assert.match(THANKS, /fhIsBooked\(readBooking\(\), Date\.now\(\), document\.referrer\)/);
  });
});

describe("/thank-you: everyone sees the booked page and confirm-your-call (owner, 2026-10-01)", () => {
  test("no pick-a-time button, the confirm block shows, a video spot sits under the headline", () => {
    assert.equal(THANKS.includes("Pick your call time"), false);
    assert.equal(THANKS.includes("One step left"), false);
    assert.ok(THANKS.includes('setText(hero.querySelector("h1.sec"), "Your Call Is Booked.");'));
    assert.ok(THANKS.includes("show(cal, true);"));
    assert.ok(THANKS.includes('setText(cal.querySelector(".kicker"), "Confirm your call");'));
    assert.ok(THANKS.includes("after(hero, buildVideo());"));
    assert.equal(/we'll be in touch with your next step/.test(THANKS), false);
    assert.equal(THANKS.includes('textContent = "You leave knowing'), false);
  });
});

describe("screenshots open full size (the cards are small, and on /watch they move)", () => {
  test("both scripts make every card screenshot open on tap, click, Enter or Space and close on Escape", () => {
    for (const [src, scope] of [[WATCH, "zoomable(sec)"], [THANKS, "zoomable(proof)"]]) {
      assert.ok(src.includes(scope), scope);
      assert.ok(src.includes(`var SHOT = 'img[data-slot="approval-screenshot"]';`));
      assert.match(src, /e\.key === "Enter" \|\| e\.key === " "/);
      assert.match(src, /e\.key === "Escape"/);
      assert.ok(src.includes(".fhz{position:fixed;inset:0;"));
    }
  });
});

describe("the fragments and the push manifest load the scripts once", () => {
  test("01-vsl.html loads watch-proof.js after attribution and beacon, and no funding-paths.js", () => {
    const html = read("marketing/landing-pages/01-vsl.html");
    const at = (s) => html.indexOf(s);
    assert.ok(at(WATCH_PROOF_SRC) > at(VSL_WATCH_BEACON_SRC) && at(VSL_WATCH_BEACON_SRC) > at(FH_ATTRIBUTION_SRC));
    assert.equal(hasScriptSrc(html, FUNDING_PATHS_SRC), false, "graphics moved to /thank-you");
  });

  test("05-thank-you.html loads funding-paths.js (defer) after thankyou-sort.js", () => {
    const html = read("marketing/landing-pages/05-thank-you.html");
    assert.ok(html.indexOf(footerScriptTag(FUNDING_PATHS_SRC, { defer: true })) > html.indexOf(THANKYOU_SORT_SRC));
  });

  test("05-thank-you.html loads thankyou-sort.js and no longer carries its own booking check", () => {
    const html = read("marketing/landing-pages/05-thank-you.html");
    assert.ok(html.includes(`<script src="${THANKYOU_SORT_SRC}"></script>`));
    assert.equal(html.includes("T14-01: nothing on this page may claim"), false, "the check lives in thankyou-sort.js now");
    assert.equal(html.includes("You get your exact funding number"), false);
    // Owner reorder 2026-10-23: "paths", the word the three-paths section uses (it said "roads").
    assert.ok(html.includes('<div class="t">You get one of three paths</div>'));
    assert.equal(html.includes("three roads"), false, "one word for the three paths");
    assert.equal(html.includes("You leave knowing your road"), false, "the step 03 title must not repeat its own text");
  });

  test("only the /watch path's builder steps get footer scripts, and only these", () => {
    const withExtras = PUSH_MANIFEST.filter((r) => r.extraFooterScripts?.length);
    assert.deepEqual(
      withExtras.map((r) => [r.key, r.pageId, r.extraFooterScripts]),
      [
        ["apply-watch", "25061160", [WATCH_PROOF_SRC, FH_EVENTS_SRC, CLARITY_SRC]],
        ["apply-book", "25062844", [FH_EVENTS_SRC, CLARITY_SRC]],
        ["apply-thank-you", "25063539", [THANKYOU_SORT_SRC, FUNDING_PATHS_SRC, FH_EVENTS_SRC, CLARITY_SRC, FUNDHUB_PROMPTER_DOWNLOAD_SRC]],
        ["apply-order", "25426768", [FH_EVENTS_SRC, CLARITY_SRC]],
      ],
    );
    assert.deepEqual(PUSH_MANIFEST.find((r) => r.key === "apply-watch").dropFooterScripts, [FUNDING_PATHS_SRC]);
  });

  test("nextFooterCode drops a script the step no longer loads", () => {
    const t = (src) => footerScriptTag(src, { defer: DEFER_FOOTER_SRCS.has(src) });
    const live = [t(FH_ATTRIBUTION_SRC), t(WATCH_PROOF_SRC), t(FUNDING_PATHS_SRC)].join("\n");
    const r = nextFooterCode(live, { extraSrcs: [WATCH_PROOF_SRC], dropSrcs: [FUNDING_PATHS_SRC] });
    assert.equal(hasScriptSrc(r.next, FUNDING_PATHS_SRC), false);
    assert.ok(hasScriptSrc(r.next, WATCH_PROOF_SRC));
  });

  test("only a rendered ClickFunnels page counts as a read of the live page", () => {
    assert.equal(isClickFunnelsPageHtml(`<div data-page-element="ContentNode"></div><script src="${FH_ATTRIBUTION_SRC}"></script>`), true);
    for (const html of ["", null, undefined, "<html><title>Just a moment...</title></html>", "Service Unavailable"]) {
      assert.equal(isClickFunnelsPageHtml(html), false, String(html));
    }
  });

  test("a builder-page push stops, and writes nothing, when the live footer or page cannot be read", () => {
    // A blind write would stack fh-attribution.js and a 4th vsl-watch-beacon.js on /watch.
    const push = read("scripts/cf-push-custom-html.mjs");
    const fn = push.slice(push.indexOf("async function pushBuilderFooter("), push.indexOf("async function putCustomHtml("));
    assert.ok(fn.length > 200, "pushBuilderFooter exists");
    const stopAt = fn.indexOf("if (liveFoot === null || !liveHtml) {");
    const putAt = fn.indexOf('method: "PUT"');
    assert.ok(fn.indexOf('getPageCode(creds, pageId, "footer_code", ctx)') < stopAt, "footer_code is read first");
    assert.ok(fn.indexOf("await fetchLiveHtml(row.liveUrl, ctx)") < stopAt, "the public page is read first");
    assert.ok(stopAt > -1 && putAt > stopAt, "the unreadable check sits before the write");
    assert.match(fn.slice(stopAt, putAt), /reason: "live_page_unreadable"/);
    assert.match(push, /return isClickFunnelsPageHtml\(html\) \? html : "";/);
    assert.match(push, /const r = await pushBuilderFooter\(creds, page\.id, row, ctx, dryRun, snapDir\);\s*if \(!r\.ok\) process\.exitCode = 1;/);
  });

  test("a builder-page push sends the whole footer in replace mode and checks the read-back", () => {
    // ClickFunnels "append" stored watch-proof.js and thankyou-sort.js twice (2026-09-22).
    const push = read("scripts/cf-push-custom-html.mjs");
    const fn = push.slice(push.indexOf("async function pushBuilderFooter("), push.indexOf("async function putCustomHtml("));
    assert.match(fn, /page\.footer_code = plan\.next/);
    assert.match(fn, /page\.footer_code_mode = "replace"/);
    assert.match(fn, /page\.head_code_mode = "replace"/);
    assert.equal(fn.includes('"append"'), false);
    assert.match(fn, /after\.trim\(\) === plan\.next\.trim\(\)/);
  });

  test("nextFooterCode: one copy of each owned script, other tags untouched, nothing added twice", () => {
    const t = (src) => `<script src="${src}"></script>`;
    const watchLive = [t(FH_ATTRIBUTION_SRC), t(VSL_WATCH_BEACON_SRC), t(VSL_WATCH_BEACON_SRC), t(VSL_WATCH_BEACON_SRC)].join("\n");
    const watchExtras = [WATCH_PROOF_SRC, FUNDING_PATHS_SRC];
    const opts = { includeVslBeacon: true, extraSrcs: watchExtras, existing: "" };
    const tDefer = (src) => footerScriptTag(src, { defer: true });

    // three old beacons collapse to one, then watch-proof.js is added once
    const oneBeacon = [t(FH_ATTRIBUTION_SRC), t(VSL_WATCH_BEACON_SRC), t(WATCH_PROOF_SRC), tDefer(FUNDING_PATHS_SRC)].join("\n");
    const first = nextFooterCode(watchLive, opts);
    assert.equal(first.next, oneBeacon);
    assert.deepEqual(first.added, watchExtras);
    assert.deepEqual(first.collapsed, [VSL_WATCH_BEACON_SRC]);
    assert.equal(first.changed, true);

    // after "append" doubled it: collapses to one copy, adds nothing
    const doubled = `${watchLive}\n${t(WATCH_PROOF_SRC)}\n${t(WATCH_PROOF_SRC)}\n${tDefer(FUNDING_PATHS_SRC)}\n${tDefer(FUNDING_PATHS_SRC)}`;
    const fixed = nextFooterCode(doubled, opts);
    assert.equal(fixed.next, first.next);
    assert.deepEqual(fixed.collapsed.sort(), [VSL_WATCH_BEACON_SRC, WATCH_PROOF_SRC, FUNDING_PATHS_SRC].sort());
    assert.deepEqual(fixed.added, []);

    // already right: no change, so no write
    assert.equal(nextFooterCode(first.next, opts).changed, false);

    // thank-you: two attribution tags collapse to one; thankyou-sort.js is added once
    const tyLive = `${t(FH_ATTRIBUTION_SRC)}\n${t(FH_ATTRIBUTION_SRC)}`;
    const ty = nextFooterCode(tyLive, { includeVslBeacon: false, extraSrcs: [THANKYOU_SORT_SRC] });
    assert.equal(ty.next, `${t(FH_ATTRIBUTION_SRC)}\n${t(THANKYOU_SORT_SRC)}`);
    assert.deepEqual(ty.collapsed, [FH_ATTRIBUTION_SRC]);

    // a step with no film drops a beacon another push left behind
    const stray = nextFooterCode(`${t(FH_ATTRIBUTION_SRC)}\n${t(VSL_WATCH_BEACON_SRC)}`, { includeVslBeacon: false, extraSrcs: [] });
    assert.equal(stray.next, t(FH_ATTRIBUTION_SRC));
    assert.deepEqual(stray.collapsed, [VSL_WATCH_BEACON_SRC]);

    // empty footer on a page whose public HTML already loads attribution
    const blank = nextFooterCode("", { includeVslBeacon: false, extraSrcs: [THANKYOU_SORT_SRC], existing: `<body>${t(FH_ATTRIBUTION_SRC)}</body>` });
    assert.equal(blank.next, t(THANKYOU_SORT_SRC));

    // a comment that names the file is not the script
    assert.equal(hasScriptSrc("<!-- so fh-attribution.js stamps them -->", FH_ATTRIBUTION_SRC), false);
    assert.equal(hasScriptSrc(t(FH_ATTRIBUTION_SRC), FH_ATTRIBUTION_SRC), true);
    const commentOnly = nextFooterCode("", {
      includeVslBeacon: false,
      extraSrcs: [],
      existing: "<!-- so fh-attribution.js stamps them -->",
    });
    assert.equal(commentOnly.next, t(FH_ATTRIBUTION_SRC));
  });

  test("nextHeadCode keeps one pixel, and drops page pixels when the funnel head already has one", () => {
    const pixel = metaPixelHeadHtml("2403674420141513");
    const roas = directRoasHeadHtml();
    const framed = "<!-- fh-framed:start v1 -->\n<style>html.fh-framed{margin:0}</style>\n<!-- fh-framed:end -->";
    const head = `${pixel}\n${roas}\n${framed}\n${pixel}\n${roas}`;
    const kept = nextHeadCode(head, { funnelHead: "" });
    assert.equal(kept.changed, true);
    assert.equal(kept.next, `${pixel}\n${roas}\n${framed}`);
    assert.equal((kept.next.match(/fbq\('init'/g) || []).length, 1);
    assert.ok(kept.next.includes("fh-framed:start"));
    assert.ok(kept.next.includes("fh-framed:end"));
    const dropped = nextHeadCode(head, { funnelHead: `${pixel}\n${roas}` });
    assert.equal(dropped.next, framed);
    assert.equal((dropped.next.match(/fbq\('init'/g) || []).length, 0);
    assert.equal(dropped.next.includes("directroas.com"), false);
    assert.equal(nextHeadCode(framed, { funnelHead: pixel }).changed, false);
  });

  test("dedupeFooterScripts keeps one copy of the row's own scripts and leaves every other tag alone", () => {
    const tag = (src) => `<script src="${src}"></script>`;
    const tDefer = (src) => footerScriptTag(src, { defer: true });
    const live = [FH_ATTRIBUTION_SRC, VSL_WATCH_BEACON_SRC, VSL_WATCH_BEACON_SRC, VSL_WATCH_BEACON_SRC, WATCH_PROOF_SRC, WATCH_PROOF_SRC].map(tag).join("\n");
    assert.equal(
      dedupeFooterScripts(live, [WATCH_PROOF_SRC]),
      [FH_ATTRIBUTION_SRC, VSL_WATCH_BEACON_SRC, VSL_WATCH_BEACON_SRC, VSL_WATCH_BEACON_SRC, WATCH_PROOF_SRC].map(tag).join("\n"),
    );
    const ty = [FH_ATTRIBUTION_SRC, FH_ATTRIBUTION_SRC, THANKYOU_SORT_SRC, THANKYOU_SORT_SRC, THANKYOU_SORT_SRC].map(tag).join("\n");
    assert.equal(dedupeFooterScripts(ty, [THANKYOU_SORT_SRC]), [FH_ATTRIBUTION_SRC, FH_ATTRIBUTION_SRC, THANKYOU_SORT_SRC].map(tag).join("\n"));
    assert.equal(dedupeFooterScripts(ty, []), ty);
    assert.equal(dedupeFooterScripts("", [WATCH_PROOF_SRC]), "");
    const deferDup = `${tDefer(FUNDING_PATHS_SRC)}\n${tag(WATCH_PROOF_SRC)}\n${tDefer(FUNDING_PATHS_SRC)}`;
    assert.equal(
      dedupeFooterScripts(deferDup, [FUNDING_PATHS_SRC]),
      `${tDefer(FUNDING_PATHS_SRC)}\n${tag(WATCH_PROOF_SRC)}`,
    );
  });

  test("trackingFooterScripts skips any src already on the page and never repeats one", () => {
    const t = (src) => `<script src="${src}"></script>`;
    const livePage = `<script src="${FH_ATTRIBUTION_SRC}"></script>` +
      `<script src="${VSL_WATCH_BEACON_SRC}"></script>`.repeat(3);
    assert.equal(
      trackingFooterScripts({ includeVslBeacon: true, skipAttribution: false, extraSrcs: [WATCH_PROOF_SRC], existing: livePage }),
      `<script src="${WATCH_PROOF_SRC}"></script>`,
    );
    assert.equal(
      trackingFooterScripts({ includeVslBeacon: true, skipAttribution: false, extraSrcs: [WATCH_PROOF_SRC], existing: livePage + `<script src="${WATCH_PROOF_SRC}"></script>` }),
      "",
    );
    assert.equal(
      trackingFooterScripts({ includeVslBeacon: false, skipAttribution: true, extraSrcs: [THANKYOU_SORT_SRC, THANKYOU_SORT_SRC] }),
      `<script src="${THANKYOU_SORT_SRC}"></script>`,
    );
    assert.equal(
      trackingFooterScripts({
        includeVslBeacon: true,
        skipAttribution: true,
        extraSrcs: [WATCH_PROOF_SRC, FUNDING_PATHS_SRC],
        existing: livePage,
      }),
      `${t(WATCH_PROOF_SRC)}\n${footerScriptTag(FUNDING_PATHS_SRC, { defer: true })}`,
    );
    assert.equal(
      trackingFooterScripts({
        includeVslBeacon: true,
        skipAttribution: true,
        extraSrcs: [FUNDING_PATHS_SRC],
        existing: livePage + footerScriptTag(FUNDING_PATHS_SRC, { defer: true }),
      }),
      "",
    );
  });
});
