// built-funnels: every hour, does every page of every live dashboard-built funnel still answer with
// its funnel tag?
//
// Same SQL, same page read, same verdict as the morning check built-funnels:live-pages-answer in
// gap-built-funnels.mjs (the truth lives in lib/built-funnels-truth.mjs). One read lists the live
// built funnels and their pages; then one cache-busted GET of each page's live address, the way a
// buyer reads it. A page that is missing, has no address, answers anything but 200, or answers 200
// without its <meta name="fh-funnel-tag"> is red. With no live built funnel there is nothing to judge
// (the same "nothing to judge" the morning lane writes), which is not a break.
//
// What it guards, and why it is on `covers`:
//   route:marketing/funnels/push-live   the door that puts a built funnel live; its tripwire is
//                                       built-funnels:live-pages-answer, the exact check run here.
//
// Pages live on apply.fundhub.ai or on the ClickFunnels host the funnel was built on, so the beat
// may GET apply.fundhub.ai and any outside host ("*" never reaches our own main site).
// Read only: one or two reads through ctx.read (the read box), GETs through ctx.http. No ClickFunnels
// API call, no send, no write.

import { SELF_TEST_NOW, laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { LIVE_SQL, SEEN_SQL, checkLiveFunnels, tagMeta } from "./lib/built-funnels-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["built-funnels:live-pages-answer"]);
/** Deep checks a covered surface names that run hourly in another beat. None: all run here. */
export const RUNS_ELSEWHERE = Object.freeze({});

/** The pages get this long in all, so the beat ends on its own words before the harness cuts it. */
export const PAGE_BUDGET_MS = 8000;

const FUNNEL = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const TAG = "fh-selftest";
const PAGES = Object.freeze(["landing", "booking", "thank_you"]);
const pageUrl = (role) => `https://apply.fundhub.ai/selftest-${role}`;
const busted = (role) => `GET ${pageUrl(role)}?fh_cb=${SELF_TEST_NOW.getTime()}`;
const TAGGED = Object.freeze({ status: 200, body: `<html><head>${tagMeta(TAG)}</head><body>ok</body></html>` });
const LIVE_ROWS = Object.freeze(PAGES.map((role) => Object.freeze({
  funnel_id: FUNNEL, key: "selftest", tag: TAG, role, page_path: `/selftest-${role}`, live_url: pageUrl(role)
})));

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  /** web is a fetch-shaped reader over ctx.http (lib/web-reader.mjs). */
  runWith: async (io, web) => checkLiveFunnels({
    run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }),
    web,
    orgId: io.orgId,
    now: io.now,
    deadlineMs: PAGE_BUDGET_MS
  }),
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([LIVE_SQL, LIVE_ROWS]),
      Object.freeze([SEEN_SQL, Object.freeze([Object.freeze({ n: 1 })])])
    ]),
    passHttp: Object.freeze(Object.fromEntries(PAGES.map((role) => [busted(role), TAGGED]))),
    // The thank-you page answers 200 but lost its funnel tag (a blank or foreign page): red at the check.
    failHttp: Object.freeze({
      ...Object.fromEntries(PAGES.map((role) => [busted(role), TAGGED])),
      [busted("thank_you")]: Object.freeze({ status: 200, body: "<html><body>Page not found</body></html>" })
    })
  })
});

export const id = "built-funnels";
export const title = "Live built funnel pages answer";
export const kind = "probe";
export const covers = ["route:marketing/funnels/push-live"];
export const box = false;
export const reads = [
  { host: "apply.fundhub.ai", methods: ["GET"] },
  { host: "*", methods: ["GET"] }
];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 11000;

export async function run(ctx) {
  const lane = { ...LANE, run: (io) => LANE.runWith(io, webFromHttp(ctx.http)) };
  return runLaneBeat(ctx, lane, { noun: "funnel page" });
}

export const fixGuide = [
  "A live built funnel page is missing, has no address, does not answer 200, or lost its funnel tag.",
  "",
  "Likely causes:",
  "- ClickFunnels unlinked or archived a step, so the live address now shows a blank or foreign page.",
  "- The funnel was set live but one of its three pages (landing, booking, thank-you) was never saved.",
  "- The page was re-pushed without the fh-funnel-tag meta line, so it cannot be told from another page.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs built-funnels and read the red step: it names the funnel key and the page.",
  "- Open that live address with ?fh_cb=1 and read what a buyer sees.",
  "- Read the ClickFunnels funnel by API (its name carries the funnel tag) and re-push the page by API. Chris never logs in.",
  "Files: src/pulse/beats/lib/built-funnels-truth.mjs, api/marketing/funnels/push-live.mjs, src/marketing/funnel-tracking.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
