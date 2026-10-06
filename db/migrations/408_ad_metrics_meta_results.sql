-- 408_ad_metrics_meta_results.sql — Meta's purchases, cost per purchase, link
-- clicks and landing page views, one row per ad per day.
--
-- WHAT WAS MISSING. The daily Meta sync (api/campaigns/sync.mjs storeInsights)
-- already ASKED Meta for `actions` on every ad-day and then threw the answer
-- away. Measured 2026-10-05 on production: 46 ad-days, $1,002.32 spent, and no
-- column anywhere holding a purchase, a cost per purchase, a link click or a
-- landing page view (marketing/MACHINE-GAPS.md §7). So no report could say
-- what a sale cost.
--
-- WHY NEW COLUMNS AND NOT `conversions` / `cpa_cents` (046).
--   * conversions is NOT NULL DEFAULT 0. It cannot say "Meta reported nothing",
--     and the rule here is NULL means unknown and must survive (CLAUDE.md §12).
--   * Both were defined as purchase + lead + registration lumped together, not
--     purchases.
--   * The ad optimiser (src/optimize/rules.mjs, kill_no_conversions) reads
--     them. Starting to fill them would change what that optimiser does to
--     live ads, which this change was told not to touch. They are left
--     exactly as they are.
--
-- WHAT EACH COLUMN HOLDS. Meta's own action names, from Meta's Ads Action
-- Stats reference (developers.facebook.com/docs/marketing-api/reference/
-- ads-action-stats, read 2026-10-05):
--   purchases                omni_purchase ("Purchases"); when Meta sends no
--                            omni_purchase line, offsite_conversion.fb_pixel_purchase
--                            ("Purchases"). One or the other, NEVER added
--                            together — they count the same sales.
--   cost_per_purchase_cents  Meta's cost_per_action_type for that same action,
--                            in cents. When Meta sent purchases but no cost
--                            line: spend ÷ purchases, both Meta's own numbers.
--   link_clicks              link_click ("Link Clicks"). Not `clicks`, which is
--                            every click on the ad, and is kept as it was.
--   landing_page_views       landing_page_view ("Landing Page Views").
--
-- NULL MEANS META SENT NO LINE FOR IT THAT DAY. Ads Manager shows a dash there.
-- Meta leaves an action out of the list when nothing happened, but its
-- documentation does not promise that, so a missing line is stored as NULL,
-- never turned into 0. A reader that wants a count may say COALESCE(x, 0) out
-- loud in its own query. A sync that ran before this migration also leaves
-- NULL; the next daily pull re-reads the last 28 days and fills them.
--
-- MONEY IS INTEGER CENTS (src/commissions/money.mjs), like spend_cents.
--
-- SAFETY. Additive and idempotent. Four nullable columns and one CHECK. No
-- existing column, row or constraint changes.

ALTER TABLE ad_metrics_daily
  ADD COLUMN IF NOT EXISTS purchases bigint;
ALTER TABLE ad_metrics_daily
  ADD COLUMN IF NOT EXISTS cost_per_purchase_cents bigint;
ALTER TABLE ad_metrics_daily
  ADD COLUMN IF NOT EXISTS link_clicks bigint;
ALTER TABLE ad_metrics_daily
  ADD COLUMN IF NOT EXISTS landing_page_views bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ad_metrics_daily_meta_results_nonneg_ck'
       AND conrelid = 'public.ad_metrics_daily'::regclass
  ) THEN
    ALTER TABLE ad_metrics_daily
      ADD CONSTRAINT ad_metrics_daily_meta_results_nonneg_ck
      CHECK (
        (purchases               IS NULL OR purchases               >= 0) AND
        (cost_per_purchase_cents IS NULL OR cost_per_purchase_cents >= 0) AND
        (link_clicks             IS NULL OR link_clicks             >= 0) AND
        (landing_page_views      IS NULL OR landing_page_views      >= 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN ad_metrics_daily.purchases IS
  'Purchases Meta credited to this ad on this day: Meta''s omni_purchase action, or offsite_conversion.fb_pixel_purchase when Meta sent no omni_purchase line — never the two added together. NULL means Meta sent no purchase line for this ad-day (Ads Manager shows a dash); it is not turned into 0. 408.';
COMMENT ON COLUMN ad_metrics_daily.cost_per_purchase_cents IS
  'What one purchase cost, in integer cents: Meta''s cost_per_action_type for the same action as purchases; when Meta sent purchases but no cost line, spend_cents ÷ purchases (both Meta''s numbers, rounded half up). NULL when there were no purchases or Meta reported nothing. 408.';
COMMENT ON COLUMN ad_metrics_daily.link_clicks IS
  'Link clicks: Meta''s link_click action — taps that left the ad for the link. Not the clicks column, which is every click on the ad. NULL means Meta sent no link_click line for this ad-day. 408.';
COMMENT ON COLUMN ad_metrics_daily.landing_page_views IS
  'Landing page views: Meta''s landing_page_view action — the link was tapped AND the page loaded. NULL means Meta sent no landing_page_view line for this ad-day. 408.';
