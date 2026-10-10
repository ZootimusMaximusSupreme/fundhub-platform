-- 477_zero_unchecked_na.sql — the morning scorecard learns "nothing to judge today".
--
-- Board: ops/workflows/zero-unchecked-2026-10-09/build-contract.md, piece A.
-- Law (owner, 2026-10-09): "if something's not checked ever, you have to check it."
-- After this, a row on the scorecard is green, red, or "na" (nothing to judge today,
-- with a code the computer re-checks every morning). Anything else is "not_checked"
-- and the self-audit turns it into one red row.
--
-- What changes, on pulse_scorecards (made by 430):
--   * na_count            how many rows say "na". Default 0, never negative.
--   * pulse_scorecards_counts_match   widened from three statuses to four. The headline
--                         counts must still equal the checks array, counted status by
--                         status. A card whose numbers disagree with its own list is
--                         refused, as before.
--
-- Old rows stay valid: na_count defaults to 0 and no old card has an "na" row, so the
-- widened check holds for every row that is already there (checked by
-- src/pulse/scorecard.pg.test.mjs). Re-running this file changes nothing:
-- ADD COLUMN IF NOT EXISTS, then the check is dropped and added back with the same body.
-- db/migrate.mjs runs each file in one transaction, so the drop and the add are one step.
--
-- Until this is applied, src/pulse/scorecard.mjs saveScorecard() hits 42703 (no column)
-- or 23514 (the old check) and saves once more in the old shape, so the morning report
-- is never lost. No grant change is needed: pulse_scorecards already gives fundhub_app
-- SELECT, INSERT and UPDATE at table level, and a new column inherits that.
-- Nothing is deleted. Retention is a "delete data" decision nobody has made.

ALTER TABLE public.pulse_scorecards
  ADD COLUMN IF NOT EXISTS na_count integer NOT NULL DEFAULT 0
    CONSTRAINT pulse_scorecards_na_count_ck CHECK (na_count >= 0);

ALTER TABLE public.pulse_scorecards
  DROP CONSTRAINT IF EXISTS pulse_scorecards_counts_match;

ALTER TABLE public.pulse_scorecards
  ADD CONSTRAINT pulse_scorecards_counts_match CHECK (
    green_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "green")'))
    AND red_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "red")'))
    AND not_checked_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "not_checked")'))
    AND na_count = jsonb_array_length(jsonb_path_query_array(checks, '$[*] ? (@.status == "na")'))
    AND green_count + red_count + not_checked_count + na_count = jsonb_array_length(checks)
  );

COMMENT ON COLUMN public.pulse_scorecards.na_count IS
  'How many checks said "na": nothing to judge today, with a code from src/pulse/na-conditions.mjs that the audit re-checks each morning. Counted apart from not_checked.';
