// The phone slideshows that booked leads are sent, for the morning pulse. Read only. Report only.
//
// From 2026-10-31 a lead who books a call is texted and emailed a link to one of 22 slideshows on our own site,
// https://fundhub.ai/slideshows/<name>/. Each one is a static page that build.mjs --publish writes under
// public/slideshows/ and ships with the next push to main. If a page is gone, short of a slide or showing another
// deck, the lead who opens the link sees it. Nothing else watches these pages, and no database row names them.
//
// This lane opens every page the way a lead does and asks one yes-or-no question:
//
//   slideshows:pages-live   does every page answer 200, show its own deck (title and slide 1 code) and hold all of
//                           its slides?
//
// The list of pages is src/slideshows/deck-pages.mjs. build.mjs --publish writes it from the pages it writes, and
// check.mjs fails when the list and public/slideshows/ disagree, so this lane watches exactly what is published.
//
// ONE JUDGE, TWO CLOCKS. The reading and the verdict live in src/pulse/beats/lib/slideshow-pages-truth.mjs; the
// hourly beat beat-slideshow-pages.mjs runs the same judge. This lane reads each page whole, so it also holds the
// exact slide count. The hourly read stops at 64 KB and holds the rest.
//
// READ ONLY. Every call is a GET of a page on our own site. No database, no text, no email, no AI call. All 22 pages
// are asked at once, each waits at most 8 seconds, and the whole read ends at 12 seconds, well under the 20 seconds
// a lane may take. A page that gives no answer is a skip with the reason, never a PASS.
//
// NO REPO FILE IS READ AT RUN TIME. The list is imported, so it ships inside the bundle.

import { DECK_PAGES } from "../../slideshows/deck-pages.mjs";
import { checkDeckPages, row } from "../beats/lib/slideshow-pages-truth.mjs";

export { CHECK_IDS, DEADLINE_MS, TIMEOUT_MS } from "../beats/lib/slideshow-pages-truth.mjs";

/**
 * One read-only check. ctx: { fetchImpl, baseUrl, deadlineMs }. The daily pulse hands every lane its web client as
 * ctx.fetchImpl and the site as ctx.baseUrl (https://fundhub.ai).
 * The row is { id, status, detail, suggestedFix } with status PASS, FAIL or skip.
 */
export async function gapChecks(ctx = {}) {
  const web = ctx.fetchImpl;
  if (typeof web !== "function") return [row("skip", "this run has no web client, so no phone slideshow page was read")];
  let base;
  try {
    base = new URL(ctx.baseUrl || "https://fundhub.ai").origin;
  } catch {
    return [row("skip", "the site address is not a web address, so no phone slideshow page was read")];
  }
  return checkDeckPages({ decks: DECK_PAGES, web, base, deadlineMs: ctx.deadlineMs });
}
