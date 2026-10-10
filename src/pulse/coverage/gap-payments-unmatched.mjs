// Money a client sent Fundhub that nobody applied, for the morning pulse. Read only. Report only.
// (coverage batch W2, 2026-10-10)
//
// Two yes-or-no questions:
//
//   payments-unmatched:receipt-waiting          Is a Commas payment sitting on the staff Payments tab,
//                                               not applied to any plan, with nobody having touched it?
//   payments-unmatched:installment-late-no-flag Is a client's plan payment a week late, with the money
//                                               helper never having opened a task or logged a hold?
//
// WHERE THE ROWS COME FROM
//   * src/finance/clarity-autopay.mjs applyCommasPayment logs one money_agent_log row for every Commas
//     payment it cannot place on a plan: action 'payment_unmatched', reason in plain words. The plan is
//     not touched. The only place it shows is the staff Payments tab. Nothing texts, nothing makes a task.
//   * src/finance/money-agent.mjs runs a ladder each day over every open installment: a reminder before
//     it is due, a check-in 1 day late, another 3 days late, and a CSM task 7 days late. Each step logs a
//     row keyed 'money-agent:clarity_installment:<id>:<rung>', or the same key with ':held:<reason>' when
//     it will not take the step. Rung 3 (the CSM task) does not text, so nothing holds it back.
//
// THE WINDOWS, EACH WITH ITS SOURCE
//   * A receipt waits 1 day for a person. There is no clock in the code for it. One day is the cycle of
//     the money helper (it runs once a day), so a receipt older than that has been through a whole cycle.
//   * An installment is red at 8 days late: CSM_TASK_DAYS_LATE (7, LADDER rung 3 in money-agent.mjs,
//     held equal by a drift test) plus one day for the daily run. Days are counted on the UTC day,
//     the day the money helper itself counts (src/workflows/finance-os-money-agent.mjs).
//
// WHAT IT LEAVES OUT, AND SAYS SO
//   * Test and demo clients, the same test the other money lanes use.
//   * Plans whose external_ref starts "sample:" (the sample-client tool's plans; nothing is owed).
//   * Plans tied to an invoice. The AR ladder owns those (rulesBrain: invoice_owned_by_ar_ladder).
//
// A failed read is a skip with the reason, never a PASS. No text, no task, no payment recorded.

import {
  DAY_MS, TEST_CLIENT_EMAIL_RE, TRIP, addDaysIso, ageOf, dollars, intOf, nowOf, plural, readRow, row, runnerOf, skipWhy, testClientSql
} from "./money-reads.mjs";

export const CHECK_IDS = Object.freeze([
  "payments-unmatched:receipt-waiting",
  "payments-unmatched:installment-late-no-flag"
]);

/** A receipt waits one money-helper cycle for a person. */
export const UNMATCHED_WAIT_MS = DAY_MS;
/** LADDER rung 3 (csm_task) in src/finance/money-agent.mjs fires at 7 days late. */
export const CSM_TASK_DAYS_LATE = 7;
export const CSM_TASK_RUNG = 3;
/** One more day for the daily run to have gone. */
export const LATE_NO_FLAG_DAYS = CSM_TASK_DAYS_LATE + 1;
/** The sample-client tool names its plans like this (clarity_payments.external_ref). */
export const SAMPLE_REF_PREFIX = "sample:";

/* An unmatched receipt is handled once staff did anything on that client's payments after it: they
   recorded a payment or added a plan, and every such action logs a row with actor 'staff'. */
export const RECEIPT_WAITING_SQL = `
  /* gap:payments-unmatched-receipt-waiting */
  SELECT count(*) FILTER (WHERE NOT u.is_test)::int AS total_n,
         count(*) FILTER (WHERE NOT u.is_test AND NOT u.handled)::int AS n,
         count(*) FILTER (WHERE u.is_test)::int AS test_n,
         COALESCE(sum(u.amount_cents) FILTER (WHERE NOT u.is_test AND NOT u.handled), 0)::bigint AS cents,
         min(u.created_at) FILTER (WHERE NOT u.is_test AND NOT u.handled) AS oldest,
         left(
           string_agg(COALESCE(u.client_code, 'no code') || ' (' || COALESCE(u.reason, 'no reason') || ')', ', ' ORDER BY u.created_at DESC)
             FILTER (WHERE NOT u.is_test AND NOT u.handled),
           240
         ) AS sample
    FROM (
      SELECT l.created_at, l.amount_cents, l.reason, c.client_code,
             ${testClientSql("c.email", "$3")} AS is_test,
             EXISTS (
               SELECT 1
                 FROM money_agent_log h
                WHERE h.org_id = l.org_id
                  AND h.client_id = l.client_id
                  AND h.actor = 'staff'
                  AND h.created_at > l.created_at
             ) AS handled
        FROM money_agent_log l
        LEFT JOIN clients c ON c.id = l.client_id AND c.org_id = l.org_id
       WHERE l.org_id = $1::uuid
         AND l.action = 'payment_unmatched'
         AND l.created_at < $2::timestamptz
    ) u
`;

/* An open installment that is LATE_NO_FLAG_DAYS or more past due (New York days, the money helper's
   own day) and has no money_agent_log row for the CSM rung. The key LIKE matches both
   '...:3' (the task) and '...:3:held:<reason>' (a hold). */
export const LATE_NO_FLAG_SQL = `
  /* gap:payments-unmatched-installment-late-no-flag */
  SELECT count(*) FILTER (WHERE NOT f.is_test AND NOT f.sample)::int AS late_n,
         count(*) FILTER (WHERE NOT f.is_test AND NOT f.sample AND NOT f.flagged)::int AS n,
         count(*) FILTER (WHERE f.sample AND NOT f.is_test)::int AS sample_n,
         count(*) FILTER (WHERE f.is_test)::int AS test_n,
         COALESCE(sum(f.left_cents) FILTER (WHERE NOT f.is_test AND NOT f.sample AND NOT f.flagged), 0)::bigint AS cents,
         min(f.due_on) FILTER (WHERE NOT f.is_test AND NOT f.sample AND NOT f.flagged) AS oldest_due,
         left(
           string_agg(COALESCE(f.client_code, 'no code') || ' (due ' || f.due_on::text || ')', ', ' ORDER BY f.due_on)
             FILTER (WHERE NOT f.is_test AND NOT f.sample AND NOT f.flagged),
           240
         ) AS sample
    FROM (
      SELECT i.due_on, (i.amount_cents - i.paid_cents) AS left_cents, c.client_code,
             ${testClientSql("c.email", "$3")} AS is_test,
             (COALESCE(p.external_ref, '') LIKE '${SAMPLE_REF_PREFIX}%') AS sample,
             EXISTS (
               SELECT 1
                 FROM money_agent_log l
                WHERE l.org_id = p.org_id
                  AND l.client_id = p.client_id
                  AND l.idempotency_key LIKE 'money-agent:clarity_installment:' || i.id::text || ':${CSM_TASK_RUNG}%'
             ) AS flagged
        FROM clarity_payment_installments i
        JOIN clarity_payments p ON p.id = i.clarity_payment_id
        LEFT JOIN clients c ON c.id = p.client_id AND c.org_id = p.org_id
       WHERE p.org_id = $1::uuid
         AND p.status = 'open'
         AND p.invoice_id IS NULL
         AND i.paid_cents < i.amount_cents
         AND i.due_on <= $2::date
    ) f
`;

async function checkReceiptWaiting({ run, orgId, now }) {
  const id = CHECK_IDS[0];
  const why = skipWhy({ run, orgId }, "unmatched payments");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - UNMATCHED_WAIT_MS).toISOString();
  const got = await readRow(run, id, "unmatched payments", RECEIPT_WAITING_SQL, [orgId, cutoff, TEST_CLIENT_EMAIL_RE]);
  if (got.skip) return got.skip;
  const r = got.r;
  const n = intOf(r.n);
  const testNote = intOf(r.test_n) ? ` (${plural(intOf(r.test_n), "test-client payment")} left out)` : "";
  if (n === 0) {
    return row(
      id,
      "PASS",
      intOf(r.total_n) === 0
        ? `no Commas payment is waiting on the Payments tab for a person${testNote}`
        : `${plural(intOf(r.total_n), "unmatched Commas payment")} on file, and staff have worked each client since${testNote}`
    );
  }
  const oldest = r.oldest ? ` The oldest came in ${ageOf(r.oldest, now)} ago.` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Clients: ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "Commas payment")} (${dollars(r.cents)} in all) came in, fit no plan, and no staff member has touched that client since.${oldest}${sample}${testNote}`,
    `Open the staff Payments tab for each client (public/app/money-payments.html, "Commas payments not matched to a plan"). Read the reason, then record the payment ` +
      `against the right plan with Record payment, or add the plan. The payment came from src/finance/clarity-autopay.mjs, which never guesses. ${TRIP}`
  );
}

async function checkLateNoFlag({ run, orgId, now }) {
  const id = CHECK_IDS[1];
  const why = skipWhy({ run, orgId }, "late plan payments");
  if (why) return row(id, "skip", why);
  // The money helper counts days late from the UTC day (src/workflows/finance-os-money-agent.mjs todayIso).
  const dueBy = addDaysIso(now.toISOString().slice(0, 10), -LATE_NO_FLAG_DAYS);
  const got = await readRow(run, id, "late plan payments", LATE_NO_FLAG_SQL, [orgId, dueBy, TEST_CLIENT_EMAIL_RE]);
  if (got.skip) return got.skip;
  const r = got.r;
  const n = intOf(r.n);
  const left = [];
  if (intOf(r.sample_n)) left.push(`${plural(intOf(r.sample_n), "sample plan")}`);
  if (intOf(r.test_n)) left.push(`${plural(intOf(r.test_n), "test-client plan")}`);
  const leftNote = left.length ? ` Left out: ${left.join(", ")}.` : "";
  if (n === 0) {
    return row(
      id,
      "PASS",
      intOf(r.late_n) === 0
        ? `no real plan payment is ${LATE_NO_FLAG_DAYS} or more days late.${leftNote}`
        : `${plural(intOf(r.late_n), "plan payment")} is ${LATE_NO_FLAG_DAYS} or more days late, and the money helper has a CSM task or a hold on each.${leftNote}`
    );
  }
  const oldest = r.oldest_due ? ` The oldest was due ${String(r.oldest_due).slice(0, 10)}.` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Clients: ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "plan payment")} (${dollars(r.cents)} left) ${n === 1 ? "is" : "are"} ${LATE_NO_FLAG_DAYS} or more days late and the money helper never opened its CSM task or logged a hold.${oldest}${sample}${leftNote}`,
    `Read money_agent_log for that installment (idempotency_key money-agent:clarity_installment:<id>:${CSM_TASK_RUNG}) and the job heartbeat finance-os-money-agent. ` +
      `The ladder is in src/finance/money-agent.mjs (rung ${CSM_TASK_RUNG} is the CSM task at ${CSM_TASK_DAYS_LATE} days late). Open the task by hand and reach the client. ${TRIP}`
  );
}

/**
 * Two read-only checks. ctx: { db, scope, orgId, now }.
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  const out = [];
  for (const [id, fn] of [[CHECK_IDS[0], checkReceiptWaiting], [CHECK_IDS[1], checkLateNoFlag]]) {
    try {
      out.push(await fn({ run, orgId, now }));
    } catch (err) {
      out.push(row(id, "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`));
    }
  }
  return out;
}
