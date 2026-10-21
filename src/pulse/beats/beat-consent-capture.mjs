// consent-capture: every hour, did every consent that should have been saved get saved?
//
// Same SQL, same verdicts as the morning checks in gap-consent.mjs (the truth lives in
// lib/consent-truth.mjs). Three counts, each one SELECT:
//   consent:required    a client who paid for a credit report over 24 hours ago has no live soft-pull consent
//   consent:store       a signed soft-pull paper has no consent row
//   consent:slo-store   a roadmap order saved the buyer's identity and no consent row (last 7 days)
// Test clients are left out the same way the lane leaves them out. Zero is green; any count is red at
// that check's step.
//
// What it guards, and why it is on `covers`:
//   route:consent/capture   the door that stores a consent; its tripwire is consent:store and
//                           consent:required, both run here.
// consent:slo-store also runs here because the roadmap pull form and the slo-pull door
// (route:public/slo-pull, page:roadmap/pull.html) name it; the soft-pull and roadmap-delivery beats
// point at this step instead of reading it twice. consent:dispute-required (repair clients) guards no
// surface without a beat, so it stays daily.
//
// Read only: three reads through ctx.read (the read box). It never records consent. No send, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { REQUIRED_SQL, SLO_STORE_SQL, STORE_SQL, consentDbChecks } from "./lib/consent-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["consent:required", "consent:store", "consent:slo-store"]);
/** Deep checks a covered surface names that run hourly in another beat. None: all run here. */
export const RUNS_ELSEWHERE = Object.freeze({});

const ZERO = Object.freeze([Object.freeze({ n: 0 })]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => consentDbChecks(
    { db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId },
    { only: HOURLY_CHECK_IDS }
  ),
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([REQUIRED_SQL, ZERO]),
      Object.freeze([STORE_SQL, ZERO]),
      Object.freeze([SLO_STORE_SQL, ZERO])
    ]),
    // A signed soft-pull paper with no consent row: the beat must stop at consent-store.
    failRows: Object.freeze([
      Object.freeze([STORE_SQL, Object.freeze([Object.freeze({ n: 1 })])])
    ])
  })
});

export const id = "consent-capture";
export const title = "Consents that should be saved are saved";
export const kind = "probe";
export const covers = ["route:consent/capture"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "consent" });
}

export const fixGuide = [
  "A consent that should be on file is missing: a paid client, a signed paper, or a roadmap order.",
  "",
  "Likely causes:",
  "- The consent capture door failed after the client said yes, so the paper or the order saved and the consent row did not.",
  "- The roadmap pull form saved the identity and the consent call after it threw.",
  "- A client paid for a credit report and was never sent the consent page.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs consent-capture and read the red step: it names which count and how many.",
  "- Read client_consents, contracts (kind authorization) and payment_links (slo_ orders) for those clients.",
  "- Use the consent page with the client after a real yes. Never record consent for a real person from the pulse.",
  "Files: src/pulse/beats/lib/consent-truth.mjs, api/consent/capture.mjs, src/consent/index.mjs, src/slo/pull.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
