// Shared read-only judge for the morning lane and the hourly beat: did every
// real paid payment reach Cortana? src/workflows/cortana-payment-feed.mjs is
// the sender; this only counts. A paid row older than 30 minutes with no sent
// (or deliberately skipped) all_payments row is a payment Cortana cannot see.

/* Midnight 2026-10-20 in Arizona. The sender starts here too (it imports this). */
export const FEED_START = "2026-10-20T07:00:00Z";
export const FEED_GRACE_MINUTES = 30;
export const FEED_FAILING_ATTEMPTS = 3;

export const CORTANA_FEED_SQL = `
  SELECT
    count(*) FILTER (
      WHERE t.created_at < now() - interval '${FEED_GRACE_MINUTES} minutes'
        AND NOT EXISTS (
          SELECT 1 FROM cortana_feed_sends s
           WHERE s.transaction_id = t.id AND s.bucket = 'all_payments'
             AND s.status IN ('sent', 'skipped'))
    )::int AS unsent,
    (SELECT count(*) FROM cortana_feed_sends s
      WHERE s.status = 'failed' AND s.attempts >= ${FEED_FAILING_ATTEMPTS})::int AS failing
  FROM transactions t
  JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
  WHERE t.status = 'succeeded'
    AND t.provider IN ('commas', 'whop')
    AND t.is_demo = false
    AND COALESCE(c.is_demo, false) = false
    AND t.amount_paid > 0
    AND t.created_at >= '${FEED_START}'::timestamptz
`;

export function cortanaFeedProblems(row) {
  const unsent = Number(row?.unsent);
  const failing = Number(row?.failing);
  if (!Number.isInteger(unsent) || unsent < 0 || !Number.isInteger(failing) || failing < 0) {
    return { healthy: false, detail: "Cortana feed check returned no usable counts." };
  }
  if (unsent || failing) {
    return {
      healthy: false,
      detail: `${unsent} paid payments older than ${FEED_GRACE_MINUTES} minutes are not in Cortana, and ${failing} Cortana sends failed ${FEED_FAILING_ATTEMPTS}+ times.`
    };
  }
  return { healthy: true, detail: "Every paid payment since the feed started is in Cortana." };
}
