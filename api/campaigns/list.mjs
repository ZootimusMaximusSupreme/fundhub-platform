// GET /api/campaigns/list — the campaign list.
//
//   ?state=draft|awaiting_approval|approved|live|paused|archived|all
//   ?platform=meta|tiktok|google  ?offer_type=  ?limit= ?offset=
//
// Yesterday's spend rather than today's for the list view: today's is partial and
// a list sorted or judged on it makes a campaign that started at 11pm look dead.
// The detail endpoint carries the full series including today.
//
// "Yesterday" is the AD ACCOUNT's yesterday (America/Phoenix), because that is
// how Meta dates the rows. CURRENT_DATE is UTC and read today's unsynced day as
// "yesterday" from 5pm to midnight Arizona time — see src/lib/ad-account-day.mjs.
import { db } from "../../src/db.mjs";
import { partnerReadHandler, stateFilter } from "../../src/http/partner-read-api.mjs";
import { AD_TODAY_SQL } from "../../src/lib/ad-account-day.mjs";

const STATES = ["draft", "awaiting_approval", "approved", "live", "paused", "archived"];
const PLATFORMS = ["meta", "tiktok", "google"];
const OFFERS = ["funding", "credit_cards", "credit_repair"];

/* fetchRows is exported so the SQL can be executed directly by
   src/http/creative-endpoints.pg.test.mjs. An endpoint whose query only ever runs
   behind an HTTP handler is one whose column names go unchecked until a partner
   opens the screen. */
export const fetchRows = (tx, { limit, offset, query }) => {
  const state = stateFilter(query, "c.approval_state", STATES);
  const params = [limit + 1, offset];
  const where = [];
  if (state.sql !== "TRUE") { params.push(state.params[0]); where.push(state.sql.replace("$$", `$${params.length}`)); }
  if (PLATFORMS.includes(String(query.platform))) { params.push(query.platform); where.push(`c.platform = $${params.length}`); }
  if (OFFERS.includes(String(query.offer_type))) { params.push(query.offer_type); where.push(`c.offer_type = $${params.length}`); }

  return tx.query(
    `SELECT c.id, c.name, c.platform, c.status, c.objective, c.offer_type,
            c.special_ad_category, c.budget_cents, c.strategy_key,
            c.approval_state, c.approved_at, c.last_error, c.synced_at, c.created_at,
            (c.disclosure_asset_id IS NOT NULL) AS has_disclosure_asset,
            (SELECT count(*)::int FROM ad_sets s WHERE s.campaign_id = c.id) AS ad_set_count,
            (SELECT count(*)::int FROM ads a WHERE a.campaign_id = c.id)     AS ad_count,
            COALESCE((SELECT sum(m.spend_cents) FROM ad_metrics_daily m
                        JOIN ads a ON a.id = m.ad_id
                       WHERE a.campaign_id = c.id AND m.date = ${AD_TODAY_SQL} - 1), 0)
              AS spend_yesterday_cents,
            (SELECT avg(m.roas) FROM ad_metrics_daily m
               JOIN ads a ON a.id = m.ad_id
              WHERE a.campaign_id = c.id AND m.date > ${AD_TODAY_SQL} - 8) AS roas_7d
       FROM campaigns c
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  ).then((r) => r.rows);
};

const run = partnerReadHandler({
  fetch: fetchRows,

});

export default (req, res) => run(req, res, { db });
