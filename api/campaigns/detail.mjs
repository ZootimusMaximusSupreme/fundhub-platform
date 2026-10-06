// GET /api/campaigns/detail?id=<uuid> — one campaign with its daily metrics series.
//
//   ?id=<uuid>  ?days=<n, default 30, cap 180>
//
// THE POINT-READ GUARD. RLS already filters the row, so a guessed uuid returns
// nothing. The 404 is therefore indistinguishable from "exists but belongs to
// someone else" — deliberately, because telling a partner that a campaign exists
// but is not theirs is itself a disclosure: they learn a competitor is running one.
// Same reasoning as assertCanReadClient in src/partners/scope.mjs.
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";
import { AD_TODAY_SQL } from "../../src/lib/ad-account-day.mjs";

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = async (tx, { query }) => {
  const id = query.id;
  if (!id) { const e = new Error("id is required"); e.code = "BAD_REQUEST"; throw e; }
  const days = Math.min(Math.max(parseInt(query.days ?? "30", 10) || 30, 1), 180);

  const { rows } = await tx.query(
    `SELECT c.id, c.name, c.platform, c.status, c.objective, c.offer_type,
            c.special_ad_category, c.budget_cents, c.targeting, c.strategy_key,
            c.approval_state, c.approved_at, c.last_error, c.synced_at, c.created_at,
            (c.disclosure_asset_id IS NOT NULL) AS has_disclosure_asset
       FROM campaigns c WHERE c.id = $1`, [id]);
  const campaign = rows[0];
  if (!campaign) return null;

  const [adSets, series, actions] = await Promise.all([
    tx.query(
      `SELECT s.id, s.name, s.status, s.budget_cents, s.approval_state, s.learning_until,
              (s.learning_until IS NOT NULL AND s.learning_until > now()) AS in_learning_phase,
              (SELECT count(*)::int FROM ads a WHERE a.ad_set_id = s.id) AS ad_count
         FROM ad_sets s WHERE s.campaign_id = $1 ORDER BY s.created_at`, [id]).then((r) => r.rows),

    // The series the fatigue and optimiser screens read. Aggregated per day
    // across the campaign's ads; spend sums, rates average — EXCEPT ctr, which
    // is that day's clicks over that day's impressions. The plain average of
    // each ad's ctr weighed a 3-impression ad the same as a 2,000-impression
    // one (measured 2026-10-05: Oct 3 read 7.29% against a true 4.83%).
    // Days are the ad account's days (src/lib/ad-account-day.mjs).
    tx.query(
      `SELECT m.date,
              sum(m.spend_cents)::bigint AS spend_cents,
              sum(m.impressions)::bigint AS impressions,
              sum(m.clicks)::bigint      AS clicks,
              sum(m.conversions)::bigint AS conversions,
              avg(m.frequency) AS frequency,
              round(100.0 * sum(m.clicks) / NULLIF(sum(m.impressions), 0), 6) AS ctr,
              avg(m.cpa_cents) AS cpa_cents, avg(m.roas) AS roas
         FROM ad_metrics_daily m
         JOIN ads a ON a.id = m.ad_id
        WHERE a.campaign_id = $1 AND m.date > ${AD_TODAY_SQL} - ($2::int || ' days')::interval
        GROUP BY m.date ORDER BY m.date ASC`, [id, days]).then((r) => r.rows),

    tx.query(
      `SELECT id, actor, rule_key, reason, before, after, executed_at, execute_error,
              undone_at, created_at, (undo_payload IS NOT NULL AND undone_at IS NULL) AS revertible
         FROM action_log
        WHERE target_id = $1 OR target_id IN (SELECT id FROM ad_sets WHERE campaign_id = $1)
        ORDER BY created_at DESC LIMIT 50`, [id]).then((r) => r.rows)
  ]);

  return { ...campaign, ad_sets: adSets, metrics_daily: series, recent_actions: actions };
};

const run = partnerReadHandler({
  single: true,
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
