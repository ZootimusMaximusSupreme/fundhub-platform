// money-tasks: every hour, did each "Do task" press, helper chat message and "ready to get funded" press
// get worked, or is it sitting stuck? And does the money helper screen's thread load?
//
// Two checks, each the same code as its morning lane:
//
//   helper:rows-stuck   (gap-money-helper.mjs; the truth lives in lib/money-helper-truth.mjs) a Do task
//                       row still queued or claimed and never finished, a money proposal past its expiry, a
//                       helper chat message with no answer or failed in the last day, or a ready-to-get-funded
//                       press with no CSM prep-call task. One read of six counts. Test clients are left out the
//                       same way the lane leaves them out (demo flag, synthetic flag, the test email pattern).
//   finance-os:helper   (gap-finance-os.mjs; the truth lives in lib/money-helper-door.mjs and
//                       lib/money-helper-read.mjs) for the newest client with an active bank link, the helper
//                       screen's own payload read (GET /api/money/helper: the client, the FOS-01 agent row, the
//                       thread, the halt state, the Mac bridge) runs clean, scored with the lane's own verdict.
//                       Not hourly: the handler's sign-in gate (the shared staff gate, still opened every
//                       morning) and the page's one write (answering turns left queued with the Mac off).
//
// What it guards, and why each surface is on `covers` (the exact deep checks tripwires.mjs names; the test
// fails if a covered surface names a check that does not run here):
//   route:money/tasks        helper:rows-stuck
//   route:money/helper       helper:rows-stuck, finance-os:helper
//   desk:money-helper.html   helper:rows-stuck, finance-os:helper
// One beat for the three because they are one screen and one queue: a break in either check is the money
// helper, so it is one text, not two.
//
// Read only: every read goes through ctx.read (the read box). No send, no write, no web call, no AI call.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { CHECK_IDS, STUCK_SQL, runMoneyHelperChecks } from "./lib/money-helper-truth.mjs";
import { HELPER_DOOR, LINKED_CLIENT_SQL, judgeHelperDoor } from "./lib/money-helper-door.mjs";
import { HELPER_CLIENT_SQL } from "./lib/money-helper-read.mjs";

export const HOURLY_CHECK_IDS = Object.freeze([...CHECK_IDS, HELPER_DOOR.id]);

/** The six counts STUCK_SQL returns, all zero: nothing is stuck. */
export const ZERO_ROW = Object.freeze({
  tasks_queued: 0, tasks_claimed: 0, proposals_late: 0, turns_open: 0, turns_failed: 0, ready_no_task: 0
});

/** The self test's linked client (made up; the live run reads the real one). */
export const SELF_TEST_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ONE = (row) => Object.freeze([Object.freeze(row)]);

/* The helper screen's read in the self test: one linked client, found in the org. Every other read under the
   page (agent row, thread, halt state, bridge) answers with no rows, as for a client who never wrote. */
const HELPER_ROWS = Object.freeze([
  Object.freeze([LINKED_CLIENT_SQL, ONE({ id: SELF_TEST_CLIENT })]),
  Object.freeze([HELPER_CLIENT_SQL, ONE({ id: SELF_TEST_CLIENT, first_name: "Pat", last_name: "Lee" })])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  // demoOn stays false, as on the morning pulse (no caller ever turns it on): test clients are left out.
  run: async (io) => {
    const [stuck, door] = await Promise.all([
      runMoneyHelperChecks({
        run: (fn) => fn({ query: (sql, params) => io.read(sql, params) }),
        now: io.now,
        orgId: io.orgId,
        demoOn: false
      }),
      judgeHelperDoor({ read: io.read, orgId: io.orgId, now: io.now, env: io.env })
    ]);
    return [...stuck, door];
  },
  selfTest: Object.freeze({
    passRows: Object.freeze([Object.freeze([STUCK_SQL, ONE(ZERO_ROW)]), ...HELPER_ROWS]),
    // Two Do task rows have sat queued past 10 minutes (the Mac runner is off): stop at helper-rows-stuck.
    failRows: Object.freeze([Object.freeze([STUCK_SQL, ONE({ ...ZERO_ROW, tasks_queued: 2 })])])
  })
});

export const id = "money-tasks";
export const title = "Money helper tasks, chats and thread do not break";
export const kind = "probe";
export const covers = ["desk:money-helper.html", "route:money/helper", "route:money/tasks"];
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
  "A client's money helper is broken: a task or chat is stuck, or the helper screen's thread will not load.",
  "",
  "Likely causes:",
  "- The Mac money helper runner is off, so queued Do task rows and chat messages are never claimed.",
  "- The 15-minute transfer job stopped, so a money proposal stayed open past its 3-day expiry.",
  "- The ready-to-get-funded press saved its log row but did not open the CSM prep-call task.",
  "- A read under the helper screen fails (finance-os-helper): a column or table it reads was renamed or dropped.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs money-tasks and read the red step: it names each stuck count or the failed read.",
  "- Check the runner is on (npm run money:run-queue) and read money_agent_tasks and money_helper_turns for those rows.",
  "- For finance-os-helper, open /app/money-helper.html for the linked client named in the step and fix the read it names.",
  "- Open the missing CSM prep-call task by hand. Do not move money, text anyone or change rows from the pulse.",
  "Files: src/pulse/beats/lib/money-helper-truth.mjs, src/pulse/beats/lib/money-helper-read.mjs, src/pulse/beats/lib/money-helper-door.mjs, api/money/helper.mjs, src/finance/money-helper.mjs, src/finance/money-helper-runner.mjs, scripts/money-agent-run-queue.mjs, src/finance/money-agent-tasks.mjs, src/finance/money-transfers.mjs, src/finance/ready-to-fund.mjs, api/money/tasks.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
