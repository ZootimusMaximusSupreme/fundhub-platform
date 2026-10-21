// partner-pages: every hour, does every published partner page still open?
//
// Same SQL, same page read, same verdict as the morning check partner-pages:live in
// gap-partner-pages.mjs (the truth lives in lib/partner-pages-truth.mjs). One read lists the
// published pages; then one GET of each page at /sites/<partner>/<slug> on our own site. A 200 that
// is the "Nothing is live" page is red, the same as a 404 or a 500.
//
// What it guards, and why each surface is on `covers`:
//   desk:brand-studio.html   Brand Studio is where a partner publishes; its tripwire is partner-pages:live
//   route:partner-brand      the brand row the page is drawn from; tripwire partner-pages:live
//   route:partner-pages      the publish door itself; tripwire partner-pages:live
// That is the exact deep check src/pulse/tripwires.mjs names for all three; the test holds it to a step here.
//
// Read only: one read through ctx.read (the read box), GETs to our own site through ctx.http. No send,
// no write, no publish.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { PUBLISHED_SQL, checkPublishedPages } from "./lib/partner-pages-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["partner-pages:live"]);
/** Deep checks a covered surface names that run hourly in another beat. None: all run here. */
export const RUNS_ELSEWHERE = Object.freeze({});

const SITE = "https://fundhub.ai";
const PAGE_A = "caf277ee-a7f4-4d96-985c-5579908a169b";
const PAGE_B = "068b933c-9f31-4b47-9499-857276d18c07";
const LIVE_PAGE = Object.freeze({ status: 200, body: "<html><title>Apply</title><main>Apply with us</main></html>" });

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  /** web is a fetch-shaped reader over ctx.http (lib/web-reader.mjs). */
  runWith: async (io, web) => checkPublishedPages({
    run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }),
    web,
    now: io.now,
    orgId: io.orgId,
    baseUrl: io.baseUrl
  }),
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([PUBLISHED_SQL, Object.freeze([
        Object.freeze({ id: "p1", partner_id: PAGE_A, slug: "apply" }),
        Object.freeze({ id: "p2", partner_id: PAGE_B, slug: "apply" })
      ])])
    ]),
    passHttp: Object.freeze({
      [`GET ${SITE}/sites/${PAGE_A}/apply`]: LIVE_PAGE,
      [`GET ${SITE}/sites/${PAGE_B}/apply`]: LIVE_PAGE
    }),
    // A published page that now answers the not-live page: the beat must stop at partner-pages-live.
    failHttp: Object.freeze({
      [`GET ${SITE}/sites/${PAGE_A}/apply`]: LIVE_PAGE,
      [`GET ${SITE}/sites/${PAGE_B}/apply`]: Object.freeze({ status: 404, body: "<h1>Nothing is live at this web address</h1>" })
    })
  })
});

export const id = "partner-pages";
export const title = "Published partner pages open";
export const kind = "probe";
export const covers = ["desk:brand-studio.html", "route:partner-brand", "route:partner-pages"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 11000;

export async function run(ctx) {
  const lane = { ...LANE, run: (io) => LANE.runWith(io, webFromHttp(ctx.http)) };
  return runLaneBeat(ctx, lane, { noun: "partner page" });
}

export const fixGuide = [
  "A published partner page does not open: it answers 404, 500 or the Nothing is live page.",
  "",
  "Likely causes:",
  "- The partner's brand row was removed or renamed, so the partner-site function finds no page to draw.",
  "- The page slug changed after it was published, so the old link points at nothing.",
  "- The partner-site function route is missing from the deploy, so every /sites/ link misses.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs partner-pages and read the red step: it names the partner (short id) and the slug.",
  "- Open https://fundhub.ai/sites/<partner>/<slug> and read what a visitor sees.",
  "- Read partner_pages and partner_brand for that partner. Press Publish again in Brand Studio once the cause is fixed. Do not publish from the pulse.",
  "Files: src/pulse/beats/lib/partner-pages-truth.mjs, netlify/functions/partner-site.mjs, api/partner-pages.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
