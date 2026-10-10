-- 476_morning_briefs_held_quiet_hours.sql — texting hours (owner law 2026-10-09,
-- .claude/rules/texting-hours.md): every text to Chris goes out only from 6:00 a.m.
-- to 10:00 p.m. Arizona time.
--
-- The 6:00 a.m. and 9:00 p.m. briefs are inside that window. A brief whose send lands
-- outside it (a late retry) is held by textMorningBrief (src/pulse/notify.mjs): nothing
-- is sent and delivery_status is 'held_quiet_hours'. The row must still save, so the
-- brief and its report link are never lost. The CHECK from 431_morning_briefs.sql only
-- allowed four values, so the held row would have been refused.
--
-- Supersedes morning_briefs_delivery_status_ck from 431 (431 itself is never edited —
-- an applied migration is a silent no-op, CLAUDE.md §12). Adds one value, removes none.
-- morning_briefs_sent_at_ck is unchanged: a held row has no sent_at, like 'failed'.

ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_delivery_status_ck;
ALTER TABLE public.morning_briefs
  ADD CONSTRAINT morning_briefs_delivery_status_ck
    CHECK (delivery_status IN ('dry_run', 'sent', 'failed', 'no_number', 'held_quiet_hours'));
