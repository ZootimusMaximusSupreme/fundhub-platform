// GET /api/campaigns/fatigue — frequency and CTR by ad, with a refresh
// recommendation.
//
//   ?state=refresh|queue|ok|all   ?days=<n, default 7, cap 30>
//
// THE RECOMMENDATION IS DERIVED FROM THE SAME CONFIG THE OPTIMISER READS, not from
// numbers restated here. If this screen said "refresh at frequency 3" while
// optimization_rules said 4, the partner would watch the autopilot ignore its own
// dashboard — and would be right to stop trusting both. So the thresholds are read
// from optimization_rules and joined in.
//
// A rule that is INACTIVE produces no recommendation rather than a default one.
// That keeps the two thresholds the spec said not to invent honest: an unset
// spend-tier table means this screen shows the metrics and stays quiet about
// cadence, instead of inventing one.
//
// CTR IS CLICKS OVER IMPRESSIONS FOR THE WHOLE WINDOW, not the average of each
// day's CTR. A 3-impression day at 66% and a 400-impression day at 5% are not a
// 35% ad. Measured 2026-10-05 over 7 days: SLO1 showed 7.58% against a true
// 9.87%. Meta's own ctr field is the same percent (clicks / impressions x 100),
// so the floor in optimization_rules still compares like with like.
//
// The window is days in the AD ACCOUNT's zone (src/lib/ad-account-day.mjs).
import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";
import { AD_TODAY_SQL } from "../../src/lib/ad-account-day.mjs";

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = async (tx, { limit, offset, query, partnerId }) => {
  const days = Math.min(Math.max(parseInt(query.days ?? "7", 10) || 7, 1), 30);

  // The live thresholds, from the PARTNER's org — not the caller's. A staff
  // session's own org is not necessarily the partner's, so resolving it from the
  // principal would read the wrong rules for a cross-org staff read.
  const { rows: ruleRows } = await tx.query(
    `SELECT rule_key, params, active FROM optimization_rules
      WHERE org_id = (SELECT org_id FROM partners WHERE id = $1)`,
    [partnerId]);
  const rules = Object.fromEntries(ruleRows.map((r) => [r.rule_key, { active: r.active, params: r.params || {} }]));

  const freq = rules.frequency_bands?.active ? rules.frequency_bands.params : null;
  const ctr  = rules.ctr_below_floor?.active ? rules.ctr_below_floor.params : null;

  const params = [
    limit + 1, offset, days,
    freq ? Number(freq.no_action_below ?? 2) : null,
    freq ? Number(freq.refresh_at_or_above ?? 3) : null,
    ctr ? Number(ctr.floor_pct ?? 2) : null,
    ctr ? Number(ctr.rotate_every_hours ?? 72) : null
  ];
  const state = String(query.state || "all").toLowerCase();

  return tx.query(
    `WITH m AS (
       SELECT a.id AS ad_id, a.name AS ad_name, a.campaign_id, a.ad_set_id, a.rotated_at,
              c.name AS campaign_name, c.platform,
              sum(d.spend_cents)::bigint AS spend_cents,
              sum(d.impressions)::bigint AS impressions,
              avg(d.frequency) AS frequency,
              round(100.0 * sum(d.clicks) / NULLIF(sum(d.impressions), 0), 6) AS ctr,
              avg(d.roas)      AS roas,
              max(d.date)      AS last_date
         FROM ads a
         JOIN campaigns c ON c.id = a.campaign_id
         JOIN ad_metrics_daily d ON d.ad_id = a.id
        WHERE d.date > ${AD_TODAY_SQL} - ($3::int || ' days')::interval
        GROUP BY a.id, a.name, a.campaign_id, a.ad_set_id, a.rotated_at, c.name, c.platform
     ), scored AS (
       SELECT m.*,
              -- $4/$5 null means the frequency rule is inactive, so no
              -- recommendation is produced rather than a guessed one.
              CASE
                WHEN $5::numeric IS NOT NULL AND m.frequency >= $5 THEN 'refresh'
                WHEN $4::numeric IS NOT NULL AND m.frequency >= $4 THEN 'queue'
                WHEN $6::numeric IS NOT NULL AND m.ctr < $6 THEN 'refresh'
                WHEN $4::numeric IS NULL AND $6::numeric IS NULL THEN 'unconfigured'
                ELSE 'ok'
              END AS recommendation,
              CASE
                WHEN $7::numeric IS NULL OR m.rotated_at IS NULL THEN NULL
                ELSE greatest(0, $7 - EXTRACT(EPOCH FROM (now() - m.rotated_at)) / 3600)
              END AS hours_until_next_rotation
         FROM m
     )
     SELECT * FROM scored
      WHERE ($8::text = 'all' OR recommendation = $8)
      ORDER BY frequency DESC NULLS LAST, ctr ASC NULLS LAST
      LIMIT $1 OFFSET $2`,
    [...params, ["refresh", "queue", "ok", "unconfigured"].includes(state) ? state : "all"]
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
