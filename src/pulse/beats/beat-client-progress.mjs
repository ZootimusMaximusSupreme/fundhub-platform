// client-progress: every hour, does the client progress page's real read run clean for the newest real paying
// client, and does what it hands the page match that client's own rows?
//
// Same read, same check as the morning lane gap-portal.mjs (portal:progress-read-real-client). The read itself is
// the one GET /api/read/client-progress runs: src/progress/read.mjs re-exports lib/progress-read.mjs, and the check
// lives in lib/progress-check.mjs. It goes red when:
//   - any read behind the page fails (the page code swallows it and shows the client an empty section),
//   - the read throws, or tries to run anything but a plain read,
//   - the answer is missing a block the page draws (stage, three score panels, movement, the three lists),
//   - the checklist steps, documents or repair stage on the page differ from the client's own rows,
//   - the read does not finish in time (the page would hang).
// The client is the newest real paying client (today Braum, FH-000507, the only real client). Reading his rows is
// fine; he is on the owner's no-contact hold, and this beat never contacts anyone. No paying client is a skip.
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   page:progress.html            portal:progress-read-real-client
//   route:read/client-progress    portal:progress-read-real-client
// The live door itself needs a signed-in client, so the beat runs the door's read, not the door.
//
// Read only: every read goes through ctx.read (the read box). No web call, no send, no write.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { PROGRESS_CLIENT_SQL, PROGRESS_ROWS_SQL, checkProgressRead } from "./lib/progress-check.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["portal:progress-read-real-client"]);

/** The whole check must finish inside this, well under the beat's deadline (the morning lane allows 12 s). */
export const HOURLY_TIMEOUT_MS = 9000;

const ONE = (row) => Object.freeze([Object.freeze(row)]);
const SELF_CLIENT = "33333333-3333-4333-8333-333333333333";

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => [await checkProgressRead({
    run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }),
    orgId: io.orgId,
    env: io.env,
    timeoutMs: HOURLY_TIMEOUT_MS
  })],
  selfTest: Object.freeze({
    // One paying client with no rows of their own: the read runs clean and the page gets nothing, which matches.
    passRows: Object.freeze([
      Object.freeze([PROGRESS_CLIENT_SQL, ONE({ id: SELF_CLIENT })]),
      Object.freeze([PROGRESS_ROWS_SQL, ONE({ waypoints: 0, deliverables: 0, repair_stages: [] })])
    ]),
    // The client has 4 checklist steps on file and the page gets none.
    failRows: Object.freeze([
      Object.freeze([PROGRESS_ROWS_SQL, ONE({ waypoints: 4, deliverables: 0, repair_stages: [] })])
    ])
  })
});

export const id = "client-progress";
export const title = "Client progress page read runs clean and matches";
export const kind = "probe";
export const covers = ["page:progress.html", "route:read/client-progress"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 12000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "progress" });
}

export const fixGuide = [
  "The client progress page's read failed, came back short, or does not match the client's own rows.",
  "",
  "Likely causes:",
  "- A column or table the progress read uses was renamed or dropped, so one section reads empty.",
  "- A change to the read made it write, or made it slow enough that the page would hang.",
  "- The checklist, documents or repair card were written somewhere the page does not read.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs client-progress and read the red step: it names the failed read or count.",
  "- Fix the named read in src/pulse/beats/lib/progress-read.mjs (src/progress/read.mjs re-exports it) and ship once.",
  "- Hold the page against client_waypoints, documents and the optimization card. Never contact FH-000507.",
  "Files: src/pulse/beats/lib/progress-read.mjs, src/pulse/beats/lib/progress-check.mjs, src/progress/read.mjs, api/read/client-progress.mjs, src/pulse/coverage/gap-portal.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
