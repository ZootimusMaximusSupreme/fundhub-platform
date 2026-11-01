// Beat: slideshow-pages. Every hour, open each phone slideshow page a booked lead is sent and check it is the right deck.
//
// From 2026-10-31 a lead who books a call is texted and emailed a link to one of 22 slideshows on our own site,
// https://fundhub.ai/slideshows/<name>/. Each one is a static page that marketing/slideshows/build.mjs --publish
// writes under public/slideshows/ and the next push to main ships. If a page is gone, short of a slide or showing
// another deck, the lead who opens the link sees it.
//
// The morning check slideshows:pages-live (src/pulse/coverage/gap-slideshow-pages.mjs) asks this same question with
// this same judge (lib/slideshow-pages-truth.mjs). This beat asks it every hour, so a broken page goes red before the
// next lead opens it.
//
// THE 64 KB LIMIT. The pulse probe reads at most 64 KB of a page, and a deck page is 66 KB to 315 KB, so each read here
// is cut short. The judge then holds the page to its title, its slide 1 code (the letters in "PU-01") and "at least
// one slide, no more than the page should have". The morning lane reads each page whole and holds the exact slide
// count. build.mjs refuses to publish a deck whose slide 1 code sits past the first 60,000 bytes, so a cut-short read
// can always see the code.
//
// A page that gives no answer at all is red here, the way doors-live treats a door that gives none: our own site not
// answering is something a lead feels. The damp of 2 keeps one blip from texting Chris.
//
// READ ONLY. 22 GETs to our own site (host SITE), all started at once. No body is sent and nothing is saved. A detail
// names a deck and a short reason. It never holds a word the page said.
//
// The list of pages is lib/slideshow-pages-list.mjs, a generated copy of src/slideshows/deck-pages.mjs (a beat may
// read only ./contract.mjs and ./lib). beat-slideshow-pages.test.mjs fails when the two differ.

import { DECK_PAGES } from "./lib/slideshow-pages-list.mjs";
import { CHECK_IDS, readPages, verdictRow } from "./lib/slideshow-pages-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const HOURLY_CHECK_IDS = CHECK_IDS;
/** Deep checks a covered surface names that run hourly in another beat. None: the one check runs here. */
export const RUNS_ELSEWHERE = Object.freeze({});

/** All pages are asked at once and the read ends here, before the beat's own deadline, so a slow page is named and not cut off. */
export const READ_BUDGET_MS = 9000;

export const id = "slideshow-pages";
export const title = "Phone slideshow pages answer";
export const kind = "probe";
export const covers = DECK_PAGES.map((deck) => `page:slideshows/${deck.slug}/index.html`);
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = DECK_PAGES.map((deck) => `page-${deck.slug}`);
export const damp = 2;
export const deadlineMs = 11000;

function listed(slugs, max = 4) {
  const shown = slugs.slice(0, max).join(", ");
  return slugs.length > max ? `${shown}, and ${slugs.length - max} more` : shown;
}

export async function run(ctx) {
  if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) {
    throw ctx.fail(steps[0], "the site address (URL) is not set for this run, so no slideshow page can be asked");
  }
  // Start every read at once. The steps then walk the answers in list order, so a red names the first deck that is
  // wrong and the detail lists the others that are wrong too.
  const results = await readPages({ decks: DECK_PAGES, web: webFromHttp(ctx.http), base: ctx.siteUrl, deadlineMs: READ_BUDGET_MS });
  for (const result of results) {
    const step = `page-${result.deck.slug}`;
    await ctx.step(step, async () => {
      if (result.kind === "ok") return;
      const others = results.filter((r) => r !== result && r.kind !== "ok").map((r) => r.deck.slug);
      const more = others.length ? `. Also wrong: ${listed(others)}` : "";
      throw ctx.fail(step, `${result.deck.slug} ${result.why}${more}`);
    });
  }
  return ctx.done(verdictRow(results).detail);
}

export const fixGuide = [
  "A phone slideshow page that booked leads are sent is gone, short of slides, or showing the wrong deck.",
  "",
  "Likely causes:",
  "- The last ship did not carry the page. Its folder under public/slideshows is missing from the live site, or the deploy did not finish.",
  "- The deck changed and the page was never rebuilt, so the live page no longer matches the list in src/slideshows/deck-pages.mjs (its title, its slide 1 code or its slide count).",
  "- A redirect or header rule in netlify.toml or public/_headers now catches /slideshows/* and answers 301, 404 or an error.",
  "- Netlify itself is down. Then many pages are red at once and the doors-live beat is red too.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs slideshow-pages. It names the first page that is wrong and any others.",
  "- Open that page at https://fundhub.ai/slideshows/<name>/ on a phone-width screen and read what a lead sees.",
  "- Run node marketing/slideshows/check.mjs. It fails when a published page or the list is stale or missing.",
  "- Rebuild with node marketing/slideshows/build.mjs --publish, run check.mjs again, then push to main (GitHub ships it).",
  "Files: marketing/slideshows/build.mjs, marketing/slideshows/check.mjs, src/slideshows/deck-pages.mjs, public/_headers, src/pulse/beats/lib/slideshow-pages-truth.mjs"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const SITE = "https://fundhub.ai";

/** A page as the hourly read sees it: the head and the first slides, cut short. Only the title, slide 1's eyebrow and the slide tags matter. */
function pageText(deck, slides) {
  const parts = [`<!doctype html><html><head><title>${deck.title}</title></head><body>`];
  for (let n = 1; n <= slides; n++) {
    parts.push(`<section class="slide"><p class="eyebrow">${deck.code}-0${n} / Selftest</p></section>`);
  }
  return parts.join("");
}

/** The right answer from every page, as the fake http wants it: { "GET <url>": partial }. Each read is cut short, like the real one. */
export function goodAnswers() {
  return Object.fromEntries(DECK_PAGES.map((deck) => [
    `GET ${SITE}${deck.path}`,
    { status: 200, body: pageText(deck, Math.min(2, deck.slides)), truncated: true }
  ]));
}

/** The deck the fail case breaks: the one in the middle of the list. */
export const BROKEN_DECK = DECK_PAGES[Math.floor(DECK_PAGES.length / 2)];

export const selfTest = {
  pass: () => ({ http: goodAnswers() }),
  // One page answers 404: the last ship lost it.
  fail: () => ({ http: { ...goodAnswers(), [`GET ${SITE}${BROKEN_DECK.path}`]: { status: 404, body: "" } } })
};
