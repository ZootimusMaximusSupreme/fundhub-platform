// Beat: survey-resume. Every hour: does the come-back link a quit-survey lead gets still work?
//
// The truth lives in lib/survey-resume-truth.mjs. Three checks, one GET and one read:
//   survey-resume-door-answers      the door answers its own "token required" to a GET with no code
//   survey-resume-links-signed      the come-back emails of the last 24 hours carry a signed link
//   survey-resume-no-link-in-texts  no text of the last 24 hours carries one (a link in a text is a
//                                   leak: it opens saved answers to whoever holds the phone)
// The 6 a.m. deep check survey:resume-link-opens opens a real lead's link end to end.
//
// What it guards, and why it is on `covers`:
//   route:public/survey-resume   the door every come-back email links to. src/pulse/tripwires.mjs
//                                names these three checks and the 6 a.m. one for it; the test holds it.
//
// READ ONLY. One GET to our own site and one read through ctx.read. No send, no write.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS, COME_BACK_LINKS_SQL, DOOR_PATH, runSurveyResumeChecks } from "./lib/survey-resume-truth.mjs";

const SITE = "https://fundhub.ai";
const DOOR_ANSWER = Object.freeze({ status: 400, body: JSON.stringify({ ok: false, error: "token_required" }) });

export const LANE = Object.freeze({
  checks: Object.freeze(CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: (io) => runSurveyResumeChecks(io),
  selfTest: Object.freeze({
    passRows: Object.freeze([Object.freeze([COME_BACK_LINKS_SQL, Object.freeze([Object.freeze({ total: 3, signed: 3, texts: 5, texts_with_link: 0 })])])]),
    // One text of five carries a come-back link: the leak this beat exists to catch.
    failRows: Object.freeze([Object.freeze([COME_BACK_LINKS_SQL, Object.freeze([Object.freeze({ total: 3, signed: 3, texts: 5, texts_with_link: 1 })])])]),
    passHttp: Object.freeze({ [`GET ${SITE}${DOOR_PATH}`]: DOOR_ANSWER })
  })
});

export const id = "survey-resume";
export const title = "Come-back links in the survey follow-ups open";
export const kind = "probe";
export const covers = ["route:public/survey-resume"];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 8000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "come-back link" });
}

export const fixGuide = [
  "The come-back link in the quit-survey texts and emails is not working, so a lead who comes back starts the survey over.",
  "",
  "Likely causes:",
  "- A 404 on GET /api/public/survey-resume means the route fell out of the ROUTES map in netlify/functions/api.mjs, or the deploy broke.",
  "- A 500 means the door crashed. Read the Netlify function log for public/survey-resume.",
  "- Come-back messages with no signed link mean the server has no UNSUBSCRIBE_TOKEN_SECRET or DOCUMENT_URL_SECRET, so every link falls back to the plain /apply page.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs survey-resume and read the red step.",
  "- Check that UNSUBSCRIBE_TOKEN_SECRET is set on Netlify production (by name; never print the value).",
  "- Open the link in a recent come-back text: it should open the survey at the question that person stopped on.",
  "Files: api/public/survey-resume.mjs, src/survey/resume-link.mjs, src/workflows/s-02-incomplete-survey-nudge.mjs, netlify/functions/api.mjs, src/pulse/beats/lib/survey-resume-truth.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
