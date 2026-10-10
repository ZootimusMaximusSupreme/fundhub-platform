// FinanceOS money moves for the morning pulse. Read only. Report only. (coverage batch W2, 2026-10-10)
//
//   money-moves:stuck   Is any money move a client said yes to stuck: never sent, never settled, or
//                       failed with its task still open?
//
// A MOVE, END TO END (docs/journeys/money-transfers-flow.md, src/finance/money-transfers.mjs)
//   money_agent_tasks (the proposal)  ->  the client's yes  ->  money_transfers at 'approved'
//   ->  the 15-minute pass sends the debit leg on its date  ->  'authorized' ->  'submitted'
//   ->  Plaid's events settle each leg  ->  'settled'.   Ends: settled, failed, declined, cancelled.
//   When a move ends the engine closes its proposal (done, failed or cancelled).
//
// WHAT EACH COUNT MEANS
//   unsent      'approved' and its date was before today (New York day, the ACH banking day). The pass
//               tries every 15 minutes, so a move still 'approved' the day after its date is waiting on
//               a limit, a bank login, or a dead clock. The engine gives up after 3 days
//               (EXECUTION_GRACE_DAYS) and cancels it with reason date_passed, which the client never
//               asked for.
//   unsettled   'authorized' or 'submitted' longer than SETTLE_WINDOW_DAYS. See below.
//   task open   the move failed, was declined, or a leg failed or was returned, and its proposal is
//               still queued, needing approval, approved or claimed. closeProposal never ran.
//
// SETTLE_WINDOW_DAYS (10) IS A NAMED SETTING, NOT A NUMBER THE CODE WRITES DOWN. The engine states no
// settle time. Its header says an ACH debit "is held a few days after it settles" and a bank-to-bank
// move has two legs, debit then credit. Ten calendar days covers a debit to funds_available and the
// credit leg. It is one number in this file. Chris can change it.
//
// NOTHING TO JUDGE: while no real client has a money move on file, the row says so with the lane code
// `not-connected` ("Live money movement through Plaid"), and the audit re-reads the table every morning.
// The day a client's move lands, the row judges it. Test clients and sandbox role-play rows by a demo
// client are left out and counted apart.
//
// A failed read is a skip with the reason, never a PASS. No Plaid call. No money moved. No task closed.

import {
  DAY_MS, TEST_CLIENT_EMAIL_RE, TRIP, ageOf, dollars, etDay, intOf, naRow, nowOf, plural, readRow, row, runnerOf, skipWhy, testClientSql
} from "./money-reads.mjs";

export const CHECK_IDS = Object.freeze(["money-moves:stuck"]);

/** src/finance/money-transfers.mjs EXECUTION_GRACE_DAYS. Held equal by a drift test. */
export const EXECUTION_GRACE_DAYS = 3;
/** Calendar days an ACH move (debit, hold, credit) is given from start to settled. A named setting. */
export const SETTLE_WINDOW_DAYS = 10;
/** The three states a proposal is "still open" in (src/finance/money-transfers.mjs closeProposal closes them). */
export const OPEN_TASK_STATUSES = Object.freeze(["queued", "needs_approval", "approved", "claimed"]);

export const NA_WHAT = "Live money movement through Plaid";

export const STUCK_SQL = `
  /* gap:money-moves-stuck */
  SELECT count(*) FILTER (WHERE NOT x.is_test)::int AS judged_n,
         count(*) FILTER (WHERE x.is_test)::int AS test_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.environment = 'production')::int AS live_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'approved' AND x.scheduled_for < $2::date)::int AS unsent_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status IN ('authorized', 'submitted')
                            AND x.touched < $3::timestamptz)::int AS unsettled_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.ended_bad AND x.task_status = ANY($5::text[]))::int AS task_open_n,
         COALESCE(sum(x.amount_cents) FILTER (WHERE NOT x.is_test AND (
               (x.status = 'approved' AND x.scheduled_for < $2::date)
            OR (x.status IN ('authorized', 'submitted') AND x.touched < $3::timestamptz)
            OR (x.ended_bad AND x.task_status = ANY($5::text[])))), 0)::bigint AS cents,
         min(x.scheduled_for) FILTER (WHERE NOT x.is_test AND (
               (x.status = 'approved' AND x.scheduled_for < $2::date)
            OR (x.status IN ('authorized', 'submitted') AND x.touched < $3::timestamptz)
            OR (x.ended_bad AND x.task_status = ANY($5::text[])))) AS oldest_date,
         left(
           string_agg(x.environment || ' ' || x.status || ' ' || x.scheduled_for::text, '; ' ORDER BY x.scheduled_for)
             FILTER (WHERE NOT x.is_test AND (
               (x.status = 'approved' AND x.scheduled_for < $2::date)
            OR (x.status IN ('authorized', 'submitted') AND x.touched < $3::timestamptz)
            OR (x.ended_bad AND x.task_status = ANY($5::text[])))),
           240
         ) AS sample
    FROM (
      SELECT t.environment, t.status, t.scheduled_for, t.amount_cents,
             COALESCE(t.started_at, t.updated_at) AS touched,
             k.status AS task_status,
             (t.status IN ('failed', 'declined')
              OR t.debit_status IN ('failed', 'returned')
              OR t.credit_status IN ('failed', 'returned')) AS ended_bad,
             ${testClientSql("c.email", "$4")} AS is_test
        FROM money_transfers t
        LEFT JOIN money_agent_tasks k ON k.id = t.agent_task_id AND k.org_id = t.org_id
        LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       WHERE t.org_id = $1::uuid
    ) x
`;

async function checkStuck({ run, orgId, now }) {
  const id = CHECK_IDS[0];
  const why = skipWhy({ run, orgId }, "money moves");
  if (why) return row(id, "skip", why);
  // A move dated before today (New York day) and still 'approved' is past its date.
  const unsentBefore = etDay(now);
  const settledBy = new Date(now.getTime() - SETTLE_WINDOW_DAYS * DAY_MS).toISOString();
  const got = await readRow(run, id, "money moves", STUCK_SQL, [
    orgId, unsentBefore, settledBy, TEST_CLIENT_EMAIL_RE, [...OPEN_TASK_STATUSES]
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const judged = intOf(r.judged_n);
  const testNote = intOf(r.test_n) ? ` (${plural(intOf(r.test_n), "test-client move")} left out)` : "";
  if (judged === 0) {
    return naRow(
      id,
      "not-connected",
      { check: id, what: NA_WHAT, moves: 0 },
      `No real client has a money move on file${testNote}, so nothing can be stuck. Judged the day a client's move lands.`
    );
  }
  const unsent = intOf(r.unsent_n);
  const unsettled = intOf(r.unsettled_n);
  const taskOpen = intOf(r.task_open_n);
  if (unsent + unsettled + taskOpen === 0) {
    const live = intOf(r.live_n);
    return row(
      id,
      "PASS",
      `${plural(judged, "money move")} on file (${live} live, ${judged - live} practice), none stuck: each is sent on its date, settling inside ${SETTLE_WINDOW_DAYS} days, or closed with its task${testNote}`
    );
  }
  const parts = [];
  if (unsent) parts.push(`${plural(unsent, "move")} the client approved and the engine never sent, past its date`);
  if (unsettled) parts.push(`${plural(unsettled, "move")} sent and not settled in ${SETTLE_WINDOW_DAYS} days`);
  if (taskOpen) parts.push(`${plural(taskOpen, "move")} failed or returned with the task still open`);
  const oldest = r.oldest_date ? ` The oldest was dated ${String(r.oldest_date).slice(0, 10)} (${ageOf(r.oldest_date, now)} ago).` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Moves: ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${parts.join("; ")} (${dollars(r.cents)} in all).${oldest}${sample}${testNote}`,
    `Read money_transfers, money_transfer_events and the proposal in money_agent_tasks for those moves, and the job heartbeat finance-os-money-transfers. ` +
      `The engine is src/finance/money-transfers.mjs (runTransfersPass). It needs FINANCE_OS_TRANSFER_MAX_CENTS and FINANCE_OS_TRANSFER_DAILY_MAX_CENTS set, a live bank login, ` +
      `and the same environment as the row. ${TRIP}`
  );
}

/**
 * The audit calls this to prove a "nothing to judge" row again. `not-connected` is true only while no real
 * client's money move is on file, by the same read the lane used.
 */
export const naVerify = Object.freeze({
  "not-connected": async (args, ctx = {}) => {
    const run = runnerOf(ctx);
    if (!run || !args || args.check !== CHECK_IDS[0]) return false;
    let orgId = ctx.orgId || null;
    if (!orgId) {
      const o = await run((tx) => tx.query("SELECT id FROM orgs WHERE is_default LIMIT 1"));
      orgId = o && o.rows && o.rows[0] ? String(o.rows[0].id) : null;
    }
    if (!orgId) return false;
    const now = nowOf(ctx);
    const out = await run((tx) => tx.query(STUCK_SQL, [
      orgId, etDay(now), new Date(now.getTime() - SETTLE_WINDOW_DAYS * DAY_MS).toISOString(), TEST_CLIENT_EMAIL_RE, [...OPEN_TASK_STATUSES]
    ]));
    const r = out && out.rows && out.rows[0];
    if (!r) return false;
    return intOf(r.judged_n) === 0;
  }
});

/** One read-only check. ctx: { db, scope, orgId, now }. */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  try {
    return [await checkStuck({ run, orgId, now })];
  } catch (err) {
    return [row(CHECK_IDS[0], "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`)];
  }
}
