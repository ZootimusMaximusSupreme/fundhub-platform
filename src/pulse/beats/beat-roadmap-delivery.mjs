// roadmap-delivery: every hour, did every roadmap buyer get the pack the company owes, whole, with the
// pack-ready email, and is every buyer's trip moving?
//
// Same SQL, same verdicts as the morning checks in gap-trip-roadmap.mjs and gap-underwrite.mjs (the
// truth lives in lib/roadmap-trip-truth.mjs and lib/underwrite-truth.mjs):
//   trip:roadmap               every buyer who paid in the last 60 days, walked up the ladder (paid, form,
//                              pack, portal): red only at a step the company owes and is late on
//   uw-paid-roadmap-no-pack    a paid buyer's credit pull finished 2 hours ago and no pack file exists
//   uw-pack-files-incomplete   a saved pack is missing a promised file, has an empty file, or came from the
//                              short fallback printer
//   uw-pack-email-not-queued   a buyer owed the pack-ready email has none queued, or its template
//                              (EMAIL-U02-ANALYZER-FUNDING-DELIVERY) is missing, a draft, or not approved.
//                              Runs last, so a red here never hides the steps above it.
//
// What it guards, and why each surface is on `covers`:
//   page:roadmap/pull.html    trip:roadmap here; softpull:paid-form-not-filled-2h at the soft-pull beat's
//                             step, consent:slo-store at the consent-capture beat's step
//   job:slo-paid-form-nudge   trip:roadmap here; softpull:paid-form-not-filled-2h at the soft-pull beat's step
//   job:slo-pack-delivery     uw-paid-roadmap-no-pack, uw-pack-files-incomplete, uw-pack-email-not-queued and
//                             trip:roadmap, all here
// Those are the exact deep checks src/pulse/tripwires.mjs names; the test holds each to an hourly step.
//
// Read only: five reads through ctx.read (the read box). No send, no web call, no credit pull, no rebuild.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { ID as TRIP_ID, TRIP_SQL, judgeRoadmap, tripParams } from "./lib/roadmap-trip-truth.mjs";
import {
  PACK_EMAIL_SQL, PACK_FILES_SQL, PACK_TEMPLATE_SQL, PAID_ROADMAP_SQL, checkPackEmail, checkPackFiles, checkPaidRoadmap
} from "./lib/underwrite-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([
  "trip:roadmap",
  "uw-paid-roadmap-no-pack",
  "uw-pack-files-incomplete",
  "uw-pack-email-not-queued"
]);

/** The deep checks a covered surface names that run hourly in another beat: check id -> [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "softpull:paid-form-not-filled-2h": Object.freeze(["soft-pull", "softpull-paid-form-not-filled-2h"]),
  "consent:slo-store": Object.freeze(["consent-capture", "consent-slo-store"])
});

function clip(value, n = 180) {
  const msg = value && value.message ? value.message : value;
  return String(msg == null ? "" : msg).replace(/\s+/g, " ").trim().slice(0, n).trim();
}

/** The trip, read the way the morning lane reads it: a read that fails is a skip, never a pass. */
async function readTrip(io) {
  try {
    const out = await io.read(TRIP_SQL, tripParams(io.orgId, io.now));
    return judgeRoadmap({ rows: Array.isArray(out && out.rows) ? out.rows : [], now: io.now });
  } catch (err) {
    return { id: TRIP_ID, status: "skip", detail: `could not read the roadmap trips: ${clip(err)}`, suggestedFix: null };
  }
}

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const db = { query: (sql, params) => io.read(sql, params) };
    const scope = { orgId: io.orgId, now: io.now };
    return [
      await readTrip(io),
      await checkPaidRoadmap(db, scope),
      await checkPackFiles(db, scope),
      await checkPackEmail(db, scope)
    ];
  },
  selfTest: Object.freeze({
    passRows: Object.freeze([
      Object.freeze([TRIP_SQL, Object.freeze([])]),
      Object.freeze([PAID_ROADMAP_SQL, Object.freeze([Object.freeze({ n: 0, sample_id: null })])]),
      Object.freeze([PACK_FILES_SQL, Object.freeze([])]),
      Object.freeze([PACK_EMAIL_SQL, Object.freeze([])]),
      Object.freeze([PACK_TEMPLATE_SQL, Object.freeze([Object.freeze({ body: "Your pack is ready.", subject: "Your roadmap pack", compliance_passed: true })])])
    ]),
    // A paid buyer whose pull finished hours ago has no pack at all: red at uw-paid-roadmap-no-pack.
    failRows: Object.freeze([
      Object.freeze([PAID_ROADMAP_SQL, Object.freeze([Object.freeze({ n: 1, sample_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" })])])
    ])
  })
});

export const id = "roadmap-delivery";
export const title = "Roadmap buyers get their whole pack and email";
export const kind = "probe";
export const covers = ["page:roadmap/pull.html", "job:slo-paid-form-nudge", "job:slo-pack-delivery"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "roadmap delivery" });
}

export const fixGuide = [
  "A roadmap buyer has no pack, a half-built pack, no pack-ready email, or is stuck on a step we owe.",
  "",
  "Likely causes:",
  "- The pack job (slo-pack-delivery) did not run or failed after the credit pull finished.",
  "- A pack file did not save, saved empty, or came from the short fallback printer.",
  "- The pack email template EMAIL-U02-ANALYZER-FUNDING-DELIVERY is missing, a draft, or not approved, so no email can queue.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs roadmap-delivery and read the red step: it names the buyer or the template.",
  "- Read the slo-pack-delivery and slo-paid-form-nudge runs and the client's Documents and messages.",
  "- Restore a missing template from db/seed (the template editor for copy). Never send or rebuild a pack from the pulse.",
  "Files: src/pulse/beats/lib/underwrite-truth.mjs, src/pulse/beats/lib/roadmap-trip-truth.mjs, src/slo/deliver.mjs, src/workflows/slo-pack-delivery.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
