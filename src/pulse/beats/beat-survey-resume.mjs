// Beat: survey-resume. Every hour: is the come-back door up, and does no follow-up carry a resume code?
//
// The truth lives in lib/survey-resume-truth.mjs. Two checks, one GET and one read:
//   survey-resume-door-answers  the door answers its own "token required" to a GET with no code
//   survey-resume-links-signed  CONTAINMENT (2026-10-31): no welcome or come-back message of the
//                               last 24 hours carries a resume code (the id is kept, the meaning flipped)
// The 6 a.m. deep check survey:resume-link-opens proves a real lead's code opens nothing.
//
// What it guards, and why it is on `covers`:
//   route:public/survey-resume   the door every come-back text and email links to. src/pulse/tripwires.mjs
//                                names these two checks and the 6 a.m. one for it; the test holds it.
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
    passRows: Object.freeze([Object.freeze([COME_BACK_LINKS_SQL, Object.freeze([Object.freeze({ total: 3, coded: 0 })])])]),
    // One of three follow-ups carries a resume code again: a sender went back to signed links.
    failRows: Object.freeze([Object.freeze([COME_BACK_LINKS_SQL, Object.freeze([Object.freeze({ total: 3, coded: 1 })])])]),
    passHttp: Object.freeze({ [`GET ${SITE}${DOOR_PATH}`]: DOOR_ANSWER })
  })
});

export const id = "survey-resume";
export const title = "Survey follow-ups carry no resume code";
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
  "The survey come-back door is down, or a survey follow-up carries a resume code that can reach a stranger's phone.",
  "",
  "Likely causes:",
  "- A 404 on GET /api/public/survey-resume means the route fell out of the ROUTES map in netlify/functions/api.mjs, or the deploy broke.",
  "- A 500 means the door crashed. Read the Netlify function log for public/survey-resume.",
  "- A message with ?r= in its link means S-00 or S-02 went back to signed links. They must send the plain /apply page until a link proves who opens it.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs survey-resume and read the red step.",
  "- Check survey_resume_link in src/workflows/s-00-welcome.mjs and s-02-incomplete-survey-nudge.mjs: it must be RESUME_BASE_URL.",
  "- Messages written before the 2026-10-31 containment ship can read red for up to 24 hours; their codes open nothing now.",
  "Files: api/public/survey-resume.mjs, src/survey/resume-link.mjs, src/workflows/s-02-incomplete-survey-nudge.mjs, netlify/functions/api.mjs, src/pulse/beats/lib/survey-resume-truth.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
