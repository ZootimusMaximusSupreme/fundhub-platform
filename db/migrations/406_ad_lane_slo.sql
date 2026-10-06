-- 406_ad_lane_slo.sql — a lane for the roadmap (SLO) ads.
--
-- WHAT WAS MISSING. The live $297 roadmap campaign is named
-- `oPur: TOF-SLO: $297`. fundhub_ad_lane() (286) only knows funding600,
-- premium, sorting, uwiq and wl, so every visitor from it reads lane
-- `unknown`. Measured 2026-10-05 on production: both client_ad_attribution
-- rows that carry a Meta ad tag say utm_campaign = 'oPur: TOF-SLO: $297',
-- lane = 'unknown' (marketing/MACHINE-GAPS.md §4).
--
-- WHY THIS IS ITS OWN FILE, WITH NOTHING ELSE IN IT. Postgres refuses to USE
-- an enum value inside the transaction that added it ("unsafe use of new
-- value"). db/migrate.mjs and scripts/ship.mjs both run each file as one
-- transaction, so the value is added here and first used in 407, after this
-- file has committed.
--
-- SAFETY. Additive and idempotent: IF NOT EXISTS makes a re-run a no-op.
-- Nothing is renamed, nothing is removed, no row is touched.

ALTER TYPE ad_lane ADD VALUE IF NOT EXISTS 'slo' BEFORE 'unknown';
