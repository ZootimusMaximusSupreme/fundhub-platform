// Deep read-only proof for the phone decks sent before a sales call.
// The page registry pings every phone and film URL; this checks that each
// customer-facing phone URL still contains a real presentation.

import { check, fail, makeGetter, readPage, skip } from "../beats/lib/funnel-pages-truth.mjs";
import { SLIDESHOW_PAGES } from "../beats/lib/slideshows-pages.mjs";

export { SLIDESHOW_PAGES };

export async function gapChecks(ctx = {}) {
  const id = "slideshows:content";
  const fetchImpl = ctx.fetchImpl ?? ctx.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return [skip(id, "no fetch in this run — live slideshows were not read")];
  const origin = new URL(ctx.appBaseUrl || ctx.baseUrl || "https://fundhub.ai").origin;
  const get = makeGetter(fetchImpl);
  const problems = (await Promise.all(SLIDESHOW_PAGES.map(async (file) => {
    const url = `${origin}/${file}`;
    const read = await readPage(get, url);
    if (read.why) return read.why;
    const body = read.page.text;
    const slides = (body.match(/<section\s+class="slide\b/g) || []).length;
    if (!/<title>Fundhub\b/.test(body) || slides < 5 || !/<main\s+class="ss"\s+data-deck=/.test(body)) {
      return `${url} lost its deck title, body, or slides`;
    }
    return null;
  }))).filter(Boolean);
  if (problems.length) return [fail(id, problems.join("; "), "Restore the missing slideshow page from marketing/slideshows and ship it.")];
  return [check(id, "PASS", `${SLIDESHOW_PAGES.length} live phone decks have a title, body and at least five slides`)];
}
