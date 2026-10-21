// lead-pipe: every hour, are the lead doors still saving real people when the ads send them?
//
// Same SQL, same verdict as the morning check lead:pipe-cut-with-traffic in gap-leads.mjs (the
// truth lives in lib/lead-truth.mjs). One read: Meta link clicks on the last two closed Arizona
// days, real people who opened /roadmap, and real people saved on the /roadmap step 1 or through
// a ClickFunnels form. Red only when the ads sent enough clicks that a healthy funnel would have
// saved about three people, and nobody real was saved. Too few clicks is "nothing to judge"
// (a skipped step), never green and never red.
//
// What it guards, and why each surface is on `covers`:
//   route:public/survey-submit   lead:pipe-cut-with-traffic here; handoff:lead-first-touches-missing in lead-handoff
//   route:public/slo-interest    lead:pipe-cut-with-traffic here; handoff:contact-no-followup in lead-handoff
// Those are the exact deep checks src/pulse/tripwires.mjs names for the two doors; the test holds it.
//
// Read only: one read through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS, FACTS_SQL, runLeadChecks } from "./lib/lead-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([CHECK_IDS[0]]);

/** A healthy day: plenty of clicks and a real person saved on /roadmap. */
const GOOD_FACTS = Object.freeze({
  ad_rows: 2, ad_clicks: 400, road_leads: 2, cf_leads: 1, lead_last: "2026-10-09T15:00:00.000Z",
  road_views: 30, form_views: 25, cf_posts: 3, cf_last: "2026-10-09T15:00:00.000Z", other_posts: 0
});

/** The cut pipe: 400 clicks, 30 people opened /roadmap, and nobody real was saved anywhere. */
const CUT_FACTS = Object.freeze({ ...GOOD_FACTS, road_leads: 0, cf_leads: 0, lead_last: "2026-10-01T15:00:00.000Z" });

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: (io) => runLeadChecks(
    { run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }), orgId: io.orgId, now: io.now },
    { only: HOURLY_CHECK_IDS }
  ),
  selfTest: Object.freeze({
    passRows: Object.freeze([Object.freeze([FACTS_SQL, Object.freeze([GOOD_FACTS])])]),
    failRows: Object.freeze([Object.freeze([FACTS_SQL, Object.freeze([CUT_FACTS])])])
  })
});

export const id = "lead-pipe";
export const title = "Ad traffic still turns into saved leads";
export const kind = "probe";
export const covers = ["route:public/survey-submit", "route:public/slo-interest"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 8000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "lead" });
}

export const fixGuide = [
  "Ads sent plenty of clicks and no real lead was saved on /roadmap or a ClickFunnels form.",
  "",
  "Likely causes:",
  "- The /roadmap step 1 save stopped: the page no longer posts to /api/public/slo-interest, or that door errors.",
  "- ClickFunnels stopped posting to /api/webhooks/clickfunnels (a wrong webhook secret looks the same as silence).",
  "- The ad link or the page tracker broke, so people land nowhere.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs lead-pipe and read the numbers in the red step.",
  "- Open https://apply.fundhub.ai/roadmap and read the slo.contact_started and entry.captured events since the first day named.",
  "- Fix the one door that stopped. Do not post a test lead from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/lead-truth.mjs, api/public/slo-interest.mjs, api/public/survey-submit.mjs, src/adapters/clickfunnels.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
