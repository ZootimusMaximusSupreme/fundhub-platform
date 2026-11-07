// Whop plans — is every Whop plan a client sees on Payments still true? Read only. Report only.
//
// Finance OS unit W. The daily read (src/finance/whop-plans-sync.mjs, job
// finance-os-whop-plans-sweeper) saves each client's Whop plans in whop_memberships
// (db/migrations/584). The Payments screen and the phone alert both trust that copy. One
// yes-or-no a client would feel: "is the Whop charge day on my Payments screen real?"
//
//   payments:whop-plans-current  FAIL when an open Whop plan of a real client
//     * was not read from Whop in the last 36 hours (the daily read stopped), or
//     * still says it charges on a day more than a day gone while it is active or in a trial
//       and not ending (Whop would have moved it, so our copy is old).
//   An old copy means a wrong "Next payment" day and a phone alert on the wrong day.
//
// ONE JUDGE, TWO CLOCKS: the morning lane (src/pulse/coverage/gap-whop-plans.mjs, a thin
// adapter) and the hourly beat run this file. A file in src/pulse/beats/lib imports only from
// this folder, and this one imports nothing.
//
// RULES (heartbeat law): SELECT only. No Whop call, no send. A failed read is a FAIL with the
// reason, never a PASS (the same call as gap-whop-billing.mjs). No database: skip.

export const CHECK_IDS = Object.freeze(["payments:whop-plans-current"]);
/** Hours a saved plan may go without a fresh read from Whop. The read runs daily. */
export const STALE_HOURS = 36;

/** $1 org, $2 read-by time, $3 Arizona today. Open plans of real clients that are out of date. */
export const WHOP_PLANS_STALE_SQL = `
SELECT count(*)::integer AS n,
       count(*) FILTER (WHERE w.synced_at < $2::timestamptz)::integer AS not_read
  FROM whop_memberships w
  JOIN clients c ON c.id = w.client_id AND c.org_id = w.org_id
 WHERE w.org_id = $1::uuid
   AND w.unlinked_at IS NULL
   AND w.status IN ('trialing', 'active', 'past_due')
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.custom_fields ->> 'synthetic', '') <> 'true'
   AND (w.synced_at < $2::timestamptz
        OR (w.status IN ('trialing', 'active') AND NOT w.cancel_at_period_end
            AND w.period_end_on < ($3::date - 1)))`.trim();

export const FIX =
  "Read the last runs of finance-os-whop-plans-sweeper (job_heartbeats) and its error. A run that " +
  "stopped at Whop means WHOP_API_KEY, WHOP_ACCOUNT_ID or the key's member:basic:read scope. " +
  "Re-run the read once it can reach Whop. Do not edit whop_memberships by hand. Do not send from this check.";

/** Arizona (UTC-7, no daylight saving) calendar day of a moment. Pure. */
export function arizonaToday(now) {
  return new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * runWhopPlanChecks — one read-only row, payments:whop-plans-current.
 * io: { db, orgId, now }. db is anything with query(sql, params): the pool in the morning
 * lane, the read box in the hourly beat. SELECT only. Never sends.
 */
export async function runWhopPlanChecks(io = {}) {
  const id = CHECK_IDS[0];
  if (!io.db || typeof io.db.query !== "function" || !io.orgId) {
    return [{ id, status: "skip", detail: "No scoped database; Whop plans were not checked", suggestedFix: FIX }];
  }
  const now = io.now instanceof Date && Number.isFinite(io.now.getTime()) ? io.now : new Date();
  const readBy = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000).toISOString();
  try {
    const row = (await io.db.query(WHOP_PLANS_STALE_SQL, [io.orgId, readBy, arizonaToday(now)])).rows[0];
    const n = Number(row?.n);
    const notRead = Number(row?.not_read);
    if (!row || !Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(notRead) || notRead < 0) {
      throw new Error("Missing or invalid Whop plan count");
    }
    if (!n) return [{ id, status: "PASS", detail: "0 Whop plans out of date on a client's Payments screen", suggestedFix: null }];
    const why = [
      notRead ? `${notRead} not read from Whop in ${STALE_HOURS} hours` : null,
      n - notRead ? `${n - notRead} with a charge day that has passed` : null
    ].filter(Boolean).join("; ");
    return [{ id, status: "FAIL", detail: `${n} Whop ${n === 1 ? "plan is" : "plans are"} out of date on a client's Payments screen (${why})`, suggestedFix: FIX }];
  } catch (err) {
    return [{ id, status: "FAIL", detail: `Whop plans could not be read: ${String(err?.message || err).slice(0, 160)}`, suggestedFix: FIX }];
  }
}
