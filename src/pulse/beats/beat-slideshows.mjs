// Hourly read-only check of every customer phone deck's live first screen.
// The daily gap lane reads the full page and checks at least five slides.
import { hasDeckStart, SLIDESHOW_PAGES } from "./lib/slideshows-pages.mjs";

export const id = "slideshows";
export const title = "Phone slideshow pages still open";
export const kind = "probe";
export const covers = SLIDESHOW_PAGES.map((file) => `page:${file}`);
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const steps = ["slideshows-content"];
export const damp = 2;
export const deadlineMs = 11000;

export async function run(ctx) {
  if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) {
    throw ctx.fail(steps[0], "the site address is missing, so the phone decks were not read");
  }
  const answers = await Promise.all(SLIDESHOW_PAGES.map(async (file) => {
    try { return await ctx.http.get(`${ctx.siteUrl}/${file}`); }
    catch { return { status: 0, body: "" }; }
  }));
  await ctx.step(steps[0], async () => {
    for (let i = 0; i < SLIDESHOW_PAGES.length; i++) {
      const answer = answers[i];
      if (answer?.status !== 200 || !hasDeckStart(answer.body ?? answer.bodySnippet)) {
        throw ctx.fail(steps[0], `${SLIDESHOW_PAGES[i]} did not answer with its deck title and first slide`);
      }
    }
  });
  return ctx.done(`all ${SLIDESHOW_PAGES.length} phone decks answered with their first slide`);
}

export const fixGuide = [
  "A phone slideshow page did not answer with its deck title and first slide.",
  "",
  "Likely causes:",
  "- The page file was missed during deployment or its address changed.",
  "- The live page is blank or an error page answered with status 200.",
  "Steps:",
  "- Open the named address on fundhub.ai and check the first slide.",
  "- Restore that page from the approved source and ship through the ordered release.",
  "- Run node scripts/pulse/run-beat.mjs slideshows after the release.",
  "Files: public/slideshows, src/pulse/beats/beat-slideshows.mjs"
].join("\n");

const GOOD = `<title>Fundhub Deck</title><main class="ss" data-deck="test"><section class="slide">First</section></main>`;
function pages(broken = null) {
  return Object.fromEntries(SLIDESHOW_PAGES.map((file) => [
    `GET https://fundhub.ai/${file}`,
    { status: file === broken ? 404 : 200, body: file === broken ? "" : GOOD }
  ]));
}
export const selfTest = {
  pass: () => ({ http: pages() }),
  fail: () => ({ http: pages(SLIDESHOW_PAGES[0]) })
};
