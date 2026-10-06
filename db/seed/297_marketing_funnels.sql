-- seed/297_marketing_funnels.sql
--
-- The two funnels the marketing machine starts with, for Fundhub's own company
-- (the default org, the one the house partner 'fundhub-house' from 377 lives in —
-- found the same way db/seed/296 finds it). Table: marketing_funnels (410).
--
-- Spec: docs/specs/marketing-machine-2026-10-04.md §6 Step 3, "Seed two rows":
--
--   key          landing page                        lane     other
--   book_call    https://apply.fundhub.ai/watch      sorting  book_call true; mix {"standard":2,"sorting":1}
--   roadmap_147  https://apply.fundhub.ai/roadmap    uwiq     mix {"standard":1}
--
-- PLAN-CHOSEN, NOT IN THE SPEC (recorded in the U03 change manifest):
--   * offer_key. The spec names the column but no values. book_call sells the
--     done-for-you funding offer on a call → 'funding_dfy' (OFFERS.FUNDING_DFY,
--     src/config/offers.mjs). roadmap_147 sells the roadmap → 'slo_roadmap'
--     (SLO_PRICE_CENTS, src/slo/offer.mjs). src/marketing/offer-facts.mjs reads the
--     price from those two files; no price is written here or anywhere else.
--   * name. Plain words: 'Book a call' and 'Roadmap'.
--
-- LANE uwiq IS THE SPEC'S VALUE, AND AN OPEN QUESTION. Live roadmap visitors read
-- lane 'slo' (406/407: a campaign named with SLO). The spec seeds 'uwiq' for new
-- roadmap ads. Chris's yes/no is on the board; until he answers, the spec wins.
-- Numbers (M5) group by funnel, not by lane, so the lane does not move money.
--
-- NEVER HERE:
--   * meta_campaign_ids stay empty. Chris maps campaigns in Settings. Nothing
--     guesses which Meta campaign belongs to which funnel.
--   * marketing_settings.enabled is not touched. Only Chris's tap in Settings
--     turns the machine on.
--
-- SAFE TO RUN TWICE. ON CONFLICT (org_id, key) DO NOTHING: a funnel that already
-- exists — seeded earlier, or made or edited by Chris — is left exactly as it is.
-- Nothing is updated or deleted. No house partner → no row (it never makes one).
--
-- WHY db/seed. It adds rows and changes no table, and seeds take no migration
-- number. db/migrate.mjs runs seeds after every migration, so 410 has made the
-- table by the time this runs. 297 sorts after 296.

-- marketing_funnels forces row security (410); its policy admits every role, so
-- the actor is not needed for the insert. Set the same way 296 does anyway, so a
-- tighter policy later cannot silently turn this file into a no-op. is_local =
-- true: it ends with this file's COMMIT.
SELECT set_config('fundhub.actor', 'staff', true);

INSERT INTO marketing_funnels (org_id, key, name, landing_url, offer_key, lane, book_call, format_mix)
SELECT p.org_id, f.key, f.name, f.landing_url, f.offer_key, f.lane::ad_lane, f.book_call, f.format_mix::jsonb
  FROM partners p
  JOIN orgs o ON o.id = p.org_id AND o.is_default
 CROSS JOIN (VALUES
   ('book_call',   'Book a call', 'https://apply.fundhub.ai/watch',   'funding_dfy', 'sorting', true,  '{"standard":2,"sorting":1}'),
   ('roadmap_147', 'Roadmap',     'https://apply.fundhub.ai/roadmap', 'slo_roadmap', 'uwiq',    false, '{"standard":1}')
 ) AS f(key, name, landing_url, offer_key, lane, book_call, format_mix)
 WHERE p.slug = 'fundhub-house'
ON CONFLICT (org_id, key) DO NOTHING;
