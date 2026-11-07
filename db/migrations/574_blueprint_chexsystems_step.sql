-- 574_blueprint_chexsystems_step.sql — the ChexSystems check, before any bank
-- account opens. Capital Blueprint only.
--
-- OWNER-SET 2026-11-06 (Finance OS CFO build, spec item 8,
-- ops/workflows/finance-os-cfo-build-2026-11-06.txt): "ChexSystems check before
-- opening any bank account. A step that shows how to get the free ChexSystems
-- report from the official site, with the AI helper answering questions."
--
-- WHERE IT SITS. position 55: after get_ein (50) and before business_checking
-- (60), so it comes before every bank-account step on the checklist. The bank
-- steps the Blueprint dashboard shows for each recommended bank are read from
-- the relationships tracker (src/waypoints/blueprint-path.mjs) and are placed
-- after this step too.
--
-- WHO SEES IT. The Capital Blueprint checklist only: src/waypoints/seed.mjs
-- skips it for a repair-only enrolment, the same way it skips the dispute rows
-- from 400 (BLUEPRINT_ONLY_DEFINITION_KEYS in src/waypoints/definitions.mjs).
-- A Blueprint buyer seeded before this file gets the step the next time the
-- checklist is seeded; until then the dashboard shows the same step from the
-- plan's own 'chexsystems' progress key.
--
-- HOW IT CLOSES. verify_kind is NULL: nothing in this platform can read a
-- ChexSystems report, so the client ticks it once they have checked it. The
-- report they upload is filed as client_upload / chexsystems_report and the
-- Fundhub team reviews it in the document vault.
--
-- COPY RULES match 362: the action, never a result. No dollar figure, and none
-- of the words the catalog test bans (src/waypoints/seed.pg.test.mjs).
--
-- SAFETY. Additive. One row. ON CONFLICT DO NOTHING, so a re-run changes
-- nothing and an owner's later edit to the copy is kept.

INSERT INTO public.waypoint_definitions
  (key, expands, title, detail, position, owner_kind,
   due_offset_days, verify_kind, notes)
VALUES
  ('check_chexsystems', 'once',
   'Check your ChexSystems report',
   'Banks read it before they open an account. Ask chexsystems.com for your free consumer disclosure, look for any account closed with money owed, and upload it here. Our team reviews it with you.',
   55, 'client', NULL, NULL,
   'Owner-set 2026-11-06, spec item 8. Before any bank account opens. NOT verifiable: no ChexSystems feed exists in this platform, so the client ticks it. The uploaded report is client_upload / chexsystems_report.')
ON CONFLICT (key) DO NOTHING;
