-- 433_morning_briefs_kind.sql — the evening brief shares morning_briefs (MB6,
-- ops/workflows/morning-brief-2026-10-05.md). Owner-set 2026-10-05: a
-- "Good evening, Chris." text at 9:00 p.m. Arizona, same sections as the
-- morning, built by the same code (src/ops/morning-brief.mjs, kind 'evening').
--
-- Supersedes two constraints from 431_morning_briefs.sql (431 itself is never
-- edited — an applied migration is a silent no-op, CLAUDE.md §12):
--   * one row per (org, day)        → one row per (org, day, kind)
--   * text starts "Good morning, Chris." → morning rows start that way,
--     evening rows start "Good evening, Chris."
--
-- Every existing row is a morning row, so the new column defaults to 'morning'
-- and nothing is rewritten.
--
-- 430 = MB2, 431 = MB3, 432 = MB4; 406–429 are reserved for the marketing machine.

ALTER TABLE public.morning_briefs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'morning';

ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_kind_ck;
ALTER TABLE public.morning_briefs
  ADD CONSTRAINT morning_briefs_kind_ck CHECK (kind IN ('morning', 'evening'));

ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_one_per_day;
ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_one_per_kind_per_day;
ALTER TABLE public.morning_briefs
  ADD CONSTRAINT morning_briefs_one_per_kind_per_day UNIQUE (org_id, brief_date, kind);

ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_text_starts_ck;
ALTER TABLE public.morning_briefs
  ADD CONSTRAINT morning_briefs_text_starts_ck CHECK (
    (kind = 'morning' AND text_body LIKE 'Good morning, Chris.%')
    OR (kind = 'evening' AND text_body LIKE 'Good evening, Chris.%')
  );

COMMENT ON COLUMN public.morning_briefs.kind IS
  'morning (6:00 a.m. Arizona, step 2 of the daily pulse) or evening (9:00 p.m. Arizona, the evening-brief job). One row per org per Arizona day per kind.';

COMMENT ON TABLE public.morning_briefs IS
  'One row per Arizona day per kind: the Good morning, Chris / Good evening, Chris text and its full report. Written by src/ops/morning-brief.mjs. Audit only.';
