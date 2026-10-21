// repair-trip: every hour, is each credit-repair customer moving through round 1, and is no document stuck?
//
// Same SQL, same verdicts as the morning lanes. Nothing here judges on its own words:
//   trip:repair                 lib/repair-trip-truth.mjs     (gap-trip-repair.mjs imports it back)
//   repair-case-stuck,
//   repair-letter-round         lib/repair-desk-truth.mjs     (gap-repair.mjs imports it back)
//   pipeline:repair             lib/repair-motion-truth.mjs   (src/pulse/pipeline-motion.mjs imports it back)
//   documents:stuck-processing  lib/documents-truth.mjs       (gap-documents.mjs imports it back)
// It reads the EFFECT: the program row, the letters, the card stage and its clock, the stuck documents.
//
// OWNER HOLD. A file on the owner's no-contact hold (lib/owner-hold.mjs; today only FH-000507) is not judged,
// exactly as the morning lanes do it: trip:repair names the held file on its green line, and a letter round
// whose only late file is held is "nothing to judge" (a skipped step). Any other late customer is red.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names):
//   job:doc-check, job:doc-check-retry-sweeper            trip:repair and documents:stuck-processing
//   job:repair-bureau-response-reader                     trip:repair and repair-case-stuck
//   route:repair/enroll                                   trip:repair
//   route:repair/generate                                 trip:repair and repair-letter-round
//   route:repair/inbound-mail, route:repair/send          trip:repair and repair-case-stuck
//   send:src/metro2/delivery/send.mjs                     pipeline:repair and repair-case-stuck
// Not on covers: route:documents-upload. Its documents:upload-store check reads the newest file back from
// the file store through the store's own package, which a beat may not load; half of that check is not it.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { TRIP_SQL, readRepairTrip } from "./lib/repair-trip-truth.mjs";
import {
  CARD_NO_LETTER_SQL, CLOCK_CARDS_SQL, OPEN_CASE_NO_LETTER_SQL, STALLED_CASES_SQL, readRepairDesk
} from "./lib/repair-desk-truth.mjs";
import { REPAIR_STUCK_SQL, readRepairMotion } from "./lib/repair-motion-truth.mjs";
import { STUCK_DELIVERY_SQL, STUCK_READER_SQL, readStuckProcessing } from "./lib/documents-truth.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([
  "trip:repair",
  "repair-case-stuck",
  "repair-letter-round",
  "pipeline:repair",
  "documents:stuck-processing"
]);

const PASS_ROWS = Object.freeze([
  Object.freeze([TRIP_SQL, Object.freeze([])]),
  Object.freeze([STALLED_CASES_SQL, Object.freeze([])]),
  Object.freeze([CLOCK_CARDS_SQL, Object.freeze([])]),
  Object.freeze([OPEN_CASE_NO_LETTER_SQL, Object.freeze([])]),
  Object.freeze([CARD_NO_LETTER_SQL, Object.freeze([])]),
  Object.freeze([REPAIR_STUCK_SQL, Object.freeze([Object.freeze({ n: 0 })])]),
  Object.freeze([STUCK_DELIVERY_SQL, Object.freeze([Object.freeze({ pending: 0, failed: 0 })])]),
  Object.freeze([STUCK_READER_SQL, Object.freeze([Object.freeze({ overdue: 0, unread: 0 })])])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const trip = await readRepairTrip(io);
    const desk = await readRepairDesk(io);
    const motion = await readRepairMotion(io);
    const documents = await readStuckProcessing(io);
    return [trip, ...desk, motion, documents];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A repair case the system marked stalled: the beat must stop at repair-case-stuck.
    failRows: Object.freeze([
      Object.freeze([STALLED_CASES_SQL, Object.freeze([Object.freeze({ id: "case-9" })])])
    ])
  })
});

export const id = "repair-trip";
export const title = "Repair files move through round 1";
export const kind = "probe";
export const covers = [
  "job:doc-check",
  "job:doc-check-retry-sweeper",
  "job:repair-bureau-response-reader",
  "route:repair/enroll",
  "route:repair/generate",
  "route:repair/inbound-mail",
  "route:repair/send",
  "send:src/metro2/delivery/send.mjs"
];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "repair" });
}

export const fixGuide = [
  "A credit-repair file stopped moving, or a document is stuck on its way in or out.",
  "",
  "Likely causes:",
  "- A repair payment saved, but the program row, the letters or the card move never came (a handler did not run).",
  "- The letter engine has its three inputs (ID read, credit file, signed agreement) and made no letters in its hour.",
  "- A file sits in a stage past the desk's own clock (src/repair/sla.mjs), or in Stalled, and nobody moved it.",
  "- A document is pending, failed or bounced on delivery, or the doc-check reader keeps failing.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs repair-trip and read the red step: it names the file or the count.",
  "- Open that client on the Repair desk. Read failed_events and the repair workflow runs for that client.",
  "- A file on owner hold (src/pulse/beats/lib/owner-hold.mjs) is never red here. Do not contact FH-000507.",
  "- Fix the handler or the workflow. Do not mail letters or upload files from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/repair-trip-truth.mjs, src/pulse/beats/lib/repair-desk-truth.mjs,",
  "src/pulse/beats/lib/repair-motion-truth.mjs, src/pulse/beats/lib/documents-truth.mjs, src/repair/handlers.mjs,",
  "src/workflows/doc-check-retry-sweeper.mjs, src/metro2/delivery/send.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
