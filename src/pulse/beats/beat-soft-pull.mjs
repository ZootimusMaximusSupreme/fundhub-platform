// soft-pull: every hour, can a client open the soft-pull approve screen, and did every credit pull
// that should have run, run?
//
// Same reads, same verdicts as the morning checks in gap-soft-pull.mjs and gap-keys.mjs (the truth
// lives in lib/soft-pull-truth.mjs and lib/credit-pull-key-truth.mjs):
//   soft-pull:approve-page             GET /app/soft-pull-approve.html: 200 and it still calls its read door
//   soft-pull:approve-read             GET /api/soft-pull-approve with no link: the refusal shape, not a 404 or 5xx
//   softpull:request-failed-or-stuck   a credit pull failed in the last 3 days, or sits queued or mid-run past its clock
//   softpull:paid-form-not-filled-2h   a paid roadmap buyer left the pull form empty over 2 hours and got no reminder
//   softpull:approve-click-no-pull     a client approved the pull and paid, and no pull started 15 minutes later
//   keys:credit-pull-live-allowed      the live settings allow a real pull (CRS_ALLOW_LIVE on, production host,
//                                      login set). Judged only on the live server; on a laptop it is a skip.
// Test clients are left out the same way the lanes leave them out.
//
// What it guards, and why each surface is on `covers`:
//   desk:soft-pull-approve.html     softpull:approve-click-no-pull and soft-pull:approve-page here
//   route:soft-pull-approve         softpull:approve-click-no-pull and soft-pull:approve-read here
//   route:public/slo-pull           softpull:request-failed-or-stuck here; consent:slo-store at the
//                                   consent-slo-store step of the consent-capture beat
//   job:c-00-crs-soft-pull-request  softpull:request-failed-or-stuck and keys:credit-pull-live-allowed here
// Those are the exact deep checks src/pulse/tripwires.mjs names; the test holds each to an hourly step.
//
// Read only: reads through ctx.read (the read box) and two GETs to our own site. It never pulls
// credit, never sends bureau mail, never POSTs, and never signs an approve link.

import { laneSelfTest, runLaneBeat, SELF_TEST_NOW } from "./lib/money-hourly.mjs";
import {
  APPROVE_PAGE_PATH, APPROVE_READ_PATH, LEDGER_SQL, checkApproveClickNoPull, checkApprovePage, checkApproveRead,
  checkPaidFormNotFilled, checkRequestFailedOrStuck
} from "./lib/soft-pull-truth.mjs";
import { creditPullLiveAllowed } from "./lib/credit-pull-key-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([
  "soft-pull:approve-page",
  "soft-pull:approve-read",
  "softpull:request-failed-or-stuck",
  "softpull:paid-form-not-filled-2h",
  "softpull:approve-click-no-pull",
  "keys:credit-pull-live-allowed"
]);

/** The deep checks a covered surface names that run hourly in another beat: check id -> [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "consent:slo-store": Object.freeze(["consent-capture", "consent-slo-store"])
});

const SITE = "https://fundhub.ai";
const HOUR = 60 * 60 * 1000;
/** A live server with a real-pull setup, so the self test walks the credit key's PASS path too. */
const LIVE_SETUP = Object.freeze({
  NETLIFY: "true",
  CRS_ALLOW_LIVE: "1",
  CRS_API_HOST: "mware.crscreditapi.com",
  CRS_API_USERNAME: "selftest-user",
  CRS_API_PASSWORD: "selftest-pass"
});

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  /** web is a fetch-shaped reader over ctx.http (lib/web-reader.mjs). */
  runWith: async (io, web) => {
    const reader = { db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now };
    const rows = await Promise.all([
      checkApprovePage({ web, baseUrl: io.baseUrl }),
      checkApproveRead({ web, baseUrl: io.baseUrl }),
      checkRequestFailedOrStuck(reader),
      checkPaidFormNotFilled(reader),
      checkApproveClickNoPull(reader)
    ]);
    return [...rows, creditPullLiveAllowed(io.env)];
  },
  selfTest: Object.freeze({
    passHttp: Object.freeze({
      [`GET ${SITE}${APPROVE_PAGE_PATH}`]: Object.freeze({ status: 200, body: `<html><body data-read="${APPROVE_READ_PATH}">Approve the soft pull</body></html>` }),
      [`GET ${SITE}${APPROVE_READ_PATH}`]: Object.freeze({ status: 400, body: JSON.stringify({ ok: false, error: "missing_token" }) })
    }),
    passEnv: LIVE_SETUP,
    // A pull C-00 ran for a paid buyer failed an hour ago and nobody retried it: red at the ledger step.
    failRows: Object.freeze([
      Object.freeze([LEDGER_SQL, Object.freeze([Object.freeze({
        id: "11111111-2222-4333-8444-555555555555",
        client_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        status: "failed",
        state_reason: "vendor timeout",
        requested_by_kind: "system",
        idempotency_key: "diagnostic-paid:selftest",
        requested_at: new Date(SELF_TEST_NOW.getTime() - HOUR).toISOString(),
        updated_at: new Date(SELF_TEST_NOW.getTime() - HOUR).toISOString()
      })])])
    ])
  })
});

export const id = "soft-pull";
export const title = "Soft pull approve screen and credit pulls run";
export const kind = "probe";
export const covers = [
  "desk:soft-pull-approve.html",
  "route:soft-pull-approve",
  "route:public/slo-pull",
  "job:c-00-crs-soft-pull-request"
];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 11000;

export async function run(ctx) {
  const lane = { ...LANE, run: (io) => LANE.runWith(io, webFromHttp(ctx.http)) };
  return runLaneBeat(ctx, lane, { noun: "soft pull" });
}

export const fixGuide = [
  "A soft pull did not run, failed or stalled, the approve screen broke, or real pulls are not allowed.",
  "",
  "Likely causes:",
  "- C-00 stopped with no pull row: the client has no portal account, or no live soft-pull consent.",
  "- The credit vendor refused or timed out, so the pull row is failed or stuck in processing.",
  "- CRS_ALLOW_LIVE, CRS_API_HOST or the CRS login on Netlify changed, so the pull refuses the real host.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs soft-pull and read the red step: it names the count, the age and short client ids.",
  "- Read soft_pull_requests and the C-00 run for that payment; for a paid buyer with an empty form, read the slo-paid-form-nudge run.",
  "- Fix the cause, then use the staff pull button. Never pull credit or send bureau mail from the pulse.",
  "Files: src/pulse/beats/lib/soft-pull-truth.mjs, src/workflows/c-00-crs-soft-pull-request.mjs, api/soft-pull-approve.mjs, src/finance/crs-identities.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
