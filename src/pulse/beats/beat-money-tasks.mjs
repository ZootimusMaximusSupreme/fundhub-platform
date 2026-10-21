// money-tasks: every hour, did each "Do task" press, helper chat message and "ready to get funded" press
// get worked, or is it sitting stuck?
//
// Same SQL, same verdict as the morning lane gap-money-helper.mjs (the truth lives in
// lib/money-helper-truth.mjs). One read of six counts. Test clients are left out the same way the lane
// leaves them out (demo flag, synthetic flag, the test email pattern).
//
//   helper:rows-stuck   a Do task row still queued or claimed and never finished, a money proposal past its
//                       expiry, a helper chat message with no answer or failed in the last day, or a
//                       ready-to-get-funded press with no CSM prep-call task
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names):
//   route:money/tasks   helper:rows-stuck
// desk:money-helper.html and route:money/helper also name finance-os:helper, which opens the real
// api/money/helper.mjs handler in process (src/pulse/coverage/gap-finance-os.mjs). That handler imports the
// database module and the model client, which a beat may never import, and the live door needs a signed-in
// staff session a GET from the pulse does not have. So finance-os:helper stays on the morning pulse and
// those two surfaces are not on `covers`.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS, STUCK_SQL, runMoneyHelperChecks } from "./lib/money-helper-truth.mjs";

export const HOURLY_CHECK_IDS = CHECK_IDS;

/** The six counts STUCK_SQL returns, all zero: nothing is stuck. */
export const ZERO_ROW = Object.freeze({
  tasks_queued: 0, tasks_claimed: 0, proposals_late: 0, turns_open: 0, turns_failed: 0, ready_no_task: 0
});

const ONE = (row) => Object.freeze([Object.freeze(row)]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  // demoOn stays false, as on the morning pulse (no caller ever turns it on): test clients are left out.
  run: (io) => runMoneyHelperChecks({
    run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }),
    now: io.now,
    orgId: io.orgId,
    demoOn: false
  }),
  selfTest: Object.freeze({
    passRows: Object.freeze([Object.freeze([STUCK_SQL, ONE(ZERO_ROW)])]),
    // Two Do task rows have sat queued past 10 minutes (the Mac runner is off): stop at helper-rows-stuck.
    failRows: Object.freeze([Object.freeze([STUCK_SQL, ONE({ ...ZERO_ROW, tasks_queued: 2 })])])
  })
});

export const id = "money-tasks";
export const title = "Money helper tasks and chats do not get stuck";
export const kind = "probe";
export const covers = ["route:money/tasks"];
export const box = false;
export const reads = [];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 8000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "money helper" });
}

export const fixGuide = [
  "A client's Do task, helper chat message or ready-to-get-funded press is stuck with nobody working it.",
  "",
  "Likely causes:",
  "- The Mac money helper runner is off, so queued Do task rows and chat messages are never claimed.",
  "- The 15-minute transfer job stopped, so a money proposal stayed open past its 3-day expiry.",
  "- The ready-to-get-funded press saved its log row but did not open the CSM prep-call task.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-tasks and read the red step: it names each stuck count.",
  "- Check the runner is on (npm run money:run-queue) and read money_agent_tasks and money_helper_turns for those rows.",
  "- Open the missing CSM prep-call task by hand. Do not move money, text anyone or change rows from the pulse.",
  "Files: src/pulse/beats/lib/money-helper-truth.mjs, src/finance/money-helper-runner.mjs, scripts/money-agent-run-queue.mjs, src/finance/money-agent-tasks.mjs, src/finance/money-transfers.mjs, src/finance/ready-to-fund.mjs, api/money/tasks.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
