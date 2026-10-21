// message-health: every hour, are the messages the company sends right, and is the message desk telling the truth?
//
// Same SQL, same verdicts as the morning lanes gap-sms.mjs and gap-msg.mjs (the truth lives in
// lib/sms-truth.mjs and lib/msg-truth.mjs). It reads the message rows themselves: a text stuck on sending,
// a watched step that wrote no text, a customer reply that got lost, a body with an empty merge spot, staff copy
// sent to a client, a link that is blank or dead, a template that never reaches an inbox, and a send past the
// pause switch, the daily cap, or twice to one phone. Zero problems is green. One is red at that check's step.
//
// Eight checks run here, and only eight. Template readiness (approved copy, draft marks, the senders' doors) is
// already hourly in the email-path and text-path beats, so it is not read again here.
//
// What it guards, and why each surface is on `covers` (the deep checks src/pulse/tripwires.mjs names for it):
//   desk:messaging.html      gap:msg-inbound-unmatched, gap:sms-sending-stuck, msg:brakes, msg:staff-template-to-client
//   desk:ops-admin.html      msg:brakes, msg:per-template-path, msg:sent-body-blanks
//   route:messages-outbound  msg:brakes, msg:per-template-path, msg:sent-body-blanks, msg:links-in-body
//   job:s-00-welcome         gap:sms-journey-zero here; handoff:lead-first-touches-missing runs hourly in lead-handoff
//
// The link check opens our own pages the way the morning lane does (HEAD, then GET when HEAD is refused), but only
// on the two hosts this beat declares, through ctx.http. A page on any other host of ours is not opened from here;
// the check then says it could not judge that page (a skip), never green. A page that gave no answer is not asked
// twice inside one run (the next hour asks again), so a slow page cannot hold the beat past its deadline.
//
// Read only: every read goes through ctx.read (the read box); web calls are GET or HEAD through ctx.http.
// No send, no write.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import {
  REPLY_SQL, SENDING_SQL, buildJourneyZeroSql, msgChecks, smsChecks
} from "./lib/sms-truth.mjs";
import {
  BLANKS_SQL, BLANKS_TOTAL_SQL, DAILY_SENDS_SQL, DUPLICATE_TEXTS_SQL, LINK_BODIES_SQL, SETTINGS_SQL,
  STAFF_TO_CLIENT_SQL, TEMPLATE_PATH_SQL, TRUTH_CHECK_IDS, buildEmailStepsSql, runMsgTruthChecks
} from "./lib/msg-truth.mjs";

export const SMS_IDS = Object.freeze(["gap:sms-sending-stuck", "gap:sms-journey-zero"]);
export const QUEUE_IDS = Object.freeze(["gap:msg-inbound-unmatched"]);
export const HOURLY_CHECK_IDS = Object.freeze([...SMS_IDS, ...QUEUE_IDS, ...TRUTH_CHECK_IDS]);

/** The hosts the link check may open from here. They are exactly the hosts on `reads`. */
export const LINK_HOSTS = Object.freeze(["fundhub.ai", "apply.fundhub.ai"]);
/** No new page is opened after this long. The morning lane allows 10 seconds; the beat ends at 10 in all. */
export const LINK_BUDGET_MS = 3000;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The page opener the link check is handed: ctx.http (through the lane's GET/HEAD reader), our two hosts only.
 * A refusal is a throw, so the check counts the page as "could not open", which is a skip and never a PASS.
 */
export function pageOpener(io) {
  const silent = new Set();
  return async (url, init = {}) => {
    const host = hostOf(url);
    if (!host || !LINK_HOSTS.includes(host)) throw new Error(`${host || "that address"} is not opened from the hourly check`);
    if (silent.has(url)) throw new Error("the page gave no answer earlier in this run");
    const method = String(init.method || "GET").toUpperCase() === "HEAD" ? "HEAD" : "GET";
    const answer = await io.readWeb(method, url, { headers: init.headers });
    const status = Number(answer && answer.status) || 0;
    if (!status) {
      silent.add(url);
      throw new Error("the page gave no answer");
    }
    return { status };
  };
}

const ZERO_SMS = Object.freeze({ customer_n: 0, staff_n: 0 });
const ZERO_REPLY = Object.freeze({ own_n: 0, real_n: 0, saved_n: 0, lost_n: 0, unlinked_n: 0, matchable_n: 0 });
const ZERO_N = Object.freeze([Object.freeze({ n: 0 })]);
const ZERO_STEPS = Object.freeze([Object.freeze({ n: 0, names: [] })]);
const SETTINGS_ON = Object.freeze([Object.freeze({ outbound_enabled: true, daily_send_cap: 500, alert_email: "", updated_at: "2026-10-01T00:00:00.000Z" })]);

const PASS_ROWS = Object.freeze([
  Object.freeze([SENDING_SQL, Object.freeze([ZERO_SMS])]),
  Object.freeze([buildJourneyZeroSql(), ZERO_STEPS]),
  Object.freeze([REPLY_SQL, Object.freeze([ZERO_REPLY])]),
  Object.freeze([SETTINGS_SQL, SETTINGS_ON]),
  Object.freeze([BLANKS_SQL, Object.freeze([])]),
  Object.freeze([BLANKS_TOTAL_SQL, ZERO_N]),
  Object.freeze([STAFF_TO_CLIENT_SQL, Object.freeze([])]),
  Object.freeze([LINK_BODIES_SQL, Object.freeze([])]),
  Object.freeze([TEMPLATE_PATH_SQL, Object.freeze([])]),
  Object.freeze([buildEmailStepsSql(), ZERO_STEPS]),
  Object.freeze([DAILY_SENDS_SQL, Object.freeze([])]),
  Object.freeze([DUPLICATE_TEXTS_SQL, Object.freeze([])])
]);

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  run: async (io) => {
    const base = { db: { query: (sql, params) => io.read(sql, params) }, orgId: io.orgId, now: io.now };
    const [sms, queue, truth] = await Promise.all([
      smsChecks(base, { only: SMS_IDS }),
      msgChecks(base, { only: QUEUE_IDS }),
      runMsgTruthChecks(base, { openPage: pageOpener(io), linkBudgetMs: LINK_BUDGET_MS })
    ]);
    return [...sms, ...queue, ...truth];
  },
  selfTest: Object.freeze({
    passRows: PASS_ROWS,
    // A customer text stuck on sending for an hour: the beat must stop at sms-sending-stuck.
    failRows: Object.freeze([
      Object.freeze([SENDING_SQL, Object.freeze([Object.freeze({ customer_n: 1, staff_n: 0 })])])
    ])
  })
});

export const id = "message-health";
export const title = "Messages to clients are right and on time";
export const kind = "probe";
export const covers = [
  "desk:messaging.html",
  "desk:ops-admin.html",
  "route:messages-outbound",
  "job:s-00-welcome"
];
export const box = false;
export const reads = LINK_HOSTS.map((host) => ({ host, methods: ["GET", "HEAD"] }));
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 10000;

export async function run(ctx) {
  return runLaneBeat(ctx, LANE, { noun: "message" });
}

export const fixGuide = [
  "A message the company sends is stuck, wrong, sent past a brake, or a reply was lost.",
  "",
  "Likely causes:",
  "- The sender picked a text up and never finished it (sending), or a workflow step wrote no text row.",
  "- A customer reply reached the door and the reply handler did not save it, or saved it with no client.",
  "- A body went out with an empty merge spot, a blank or wrong link, or staff copy went to a client.",
  "- A template's mail never arrives, or a send went past the pause switch, the daily cap, or twice to one phone.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs message-health and read the red step: it names how many and which templates.",
  "- Open those message rows (status, last_error, rendered_body, provider_ref) and the workflow or template behind them.",
  "- Fix the workflow, template or sender. Do not send or resend from the pulse; the beat only reads.",
  "Files: src/pulse/beats/lib/sms-truth.mjs, src/pulse/beats/lib/msg-truth.mjs, src/messaging/dispatch.mjs, src/workflows/s-00-welcome.mjs, src/handlers/comms.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
