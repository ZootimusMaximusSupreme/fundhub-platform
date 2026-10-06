-- seed/296_marketing_copy_writer_house.sql
--
-- Makes "Write ad copy" able to run for Fundhub's own marketing. Two things,
-- both for the house partner's company and nothing else:
--
--   1. The copy writer row. creative_providers has never had a row in any
--      migration or seed (048 left it empty on purpose), so every copy job died
--      on "no active provider configured for asset kind copy". One row for
--      asset kind 'copy', served by src/creative/providers/copy.mjs.
--
--   2. The marketing switch ON for the house partner (slug 'fundhub-house',
--      created in 377). partner_module_settings.marketing_suite_enabled
--      defaults off (172), and the copy writer refuses to run while it is off
--      (src/brand/meter.mjs assertSuiteEnabled). ONLY the house partner. No
--      other partner's switch is read or written here.
--
-- Owner decision behind it: the Marketing Command Center's first slice
-- (docs/specs/marketing-dashboard-plan-2026-10-05.md §5, step 5).
--
-- WHY db/seed AND NOT A MIGRATION. It adds rows, it changes no table. Seed
-- files take no migration number, so this cannot collide with the migrations
-- other lanes are adding. db/migrate.mjs runs seeds after every migration, so
-- on a fresh database 048, 172 and 377 have already made the tables, the
-- column and the house partner by the time this runs. 296 sorts after 295,
-- the last seed before it.
--
-- SAFE TO RUN TWICE, AND SAFE ON A DATABASE THAT ALREADY HAS EITHER ROW.
--   - The provider insert is ON CONFLICT DO NOTHING on the unique
--     (org_id, asset_kind, provider_key) index from 048. A row somebody already
--     made by hand — active or not, any priority, any config — is left exactly
--     as it is.
--   - The switch is an upsert on the unique partner_id index from 046. It only
--     writes when the switch is not already on, so a re-run touches nothing.
--     It sets marketing_suite_enabled and updated_at and no other column: the
--     token cap, the approval gate (approve_before_launch stays at its default,
--     ON) and the concurrency cap are left alone.
--   - Neither statement deletes anything.
--   - No house partner (a database 377 never reached) → both statements match
--     no row and do nothing. They never create a partner.
--
-- MEASURED 2026-10-05 on production, read only: creative_providers has 0 rows;
-- the house partner's switch already reads true. So on production this file
-- adds the one provider row and the switch upsert is a no-op.
--
-- NO SECRET IS STORED. config is '{}': the writer reads ANTHROPIC_API_KEY (and
-- OPENAI_API_KEY first, with the Anthropic backup) from the environment. 048's
-- creative_providers_no_secrets_ck refuses a key in config anyway. An empty
-- config means the module's own defaults: model claude-sonnet-4-5-20250929,
-- 2000 max tokens, unit cost 0.

-- partner_module_settings FORCEs row-level security (046, fundhub_apply_partner_rls).
-- Run this file as staff so the upsert passes its policy whatever role the
-- migration connection is. is_local = true: it ends with this file's COMMIT and
-- cannot leak into the next file on the same pooled connection (377 Part 0).
SELECT set_config('fundhub.actor', 'staff', true);

-- 1. The copy writer, for the company the house partner belongs to (the
--    default org — 377 creates the house partner there and nowhere else).
INSERT INTO creative_providers (org_id, asset_kind, provider_key, priority, config, active)
SELECT p.org_id, 'copy', 'copy', 100, '{}'::jsonb, true
  FROM partners p
  JOIN orgs o ON o.id = p.org_id AND o.is_default
 WHERE p.slug = 'fundhub-house'
ON CONFLICT (org_id, asset_kind, provider_key) DO NOTHING;

-- 2. The marketing switch, house partner only.
INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
SELECT p.org_id, p.id, true
  FROM partners p
  JOIN orgs o ON o.id = p.org_id AND o.is_default
 WHERE p.slug = 'fundhub-house'
ON CONFLICT (partner_id) DO UPDATE
   SET marketing_suite_enabled = true,
       updated_at = now()
 WHERE partner_module_settings.marketing_suite_enabled IS DISTINCT FROM true;
