-- 417 — where an approved video stands on its way into Meta.
--
-- Spec docs/specs/marketing-machine-2026-10-04.md §9.1 ("New columns on
-- ad_videos", the last line) and §10.2 / §10.4. Build plan unit U28. The loader
-- is src/marketing/meta-load.mjs (job kind meta_load); the screen reads these
-- through GET /api/marketing/meta/load-status.
--
-- WHY THESE SIX AND WHY NOW. The loader saves every Meta id the moment Meta
-- hands it back (spec §10.2 "Retries"), so a run that dies halfway starts the
-- next time from the last saved id instead of making a second video, creative
-- or ad. These columns are where those ids live.
--
-- ADD COLUMN IF NOT EXISTS ON PURPOSE. §9.1 lists these six with the video
-- worker's state-machine columns (the future 9.1a migration). They land here,
-- ahead of 9.1a, so the loader can be built and proved now; 9.1a must not add
-- them again, and IF NOT EXISTS keeps this file safe if it ever runs twice.
--
-- ad_videos.status IS NOT TOUCHED. The 'loaded' state comes with 9.1a. Until
-- then "loaded" is loaded_at IS NOT NULL.
--
-- NO FOREIGN KEY ON ad_row_id, ON PURPOSE. The loader claims the row before it
-- asks Meta for the ad (spec §10.2): it reserves the id our ads row will carry
-- and writes it here first. The ads row with that id is written only after Meta
-- answers. A foreign key would refuse the reservation. A reserved id with no
-- ads row behind it means "we asked Meta for this ad and have not written it
-- down yet"; the read route shows ad_row_id only once the ads row exists.
--
-- NOTHING HERE IS MONEY. A Meta id is Meta's own string, so these are text.
-- NULL means "not yet", never "none".

ALTER TABLE ad_videos
  ADD COLUMN IF NOT EXISTS meta_video_id        text,
  ADD COLUMN IF NOT EXISTS meta_creative_id     text,
  ADD COLUMN IF NOT EXISTS meta_ad_external_id  text,
  ADD COLUMN IF NOT EXISTS ad_row_id            uuid,
  ADD COLUMN IF NOT EXISTS loaded_at            timestamptz,
  ADD COLUMN IF NOT EXISTS load_error           text;

-- No new index: "Load all approved" filters on status, which
-- ad_videos_status_idx (389) already covers, and the table holds one row per
-- filmed take.

COMMENT ON COLUMN ad_videos.meta_video_id IS
  'Meta''s id for this video, saved the moment Meta''s upload answers (417, spec §10.2). NULL = not uploaded yet, or the upload was thrown away because Meta could not process it (the old id is kept in load_error).';
COMMENT ON COLUMN ad_videos.meta_creative_id IS
  'Meta''s id for the ad creative made from this video (every enhancement OPT_OUT), saved the moment Meta answers (417). NULL = not made yet, or thrown away because Meta read back an enhancement turned on (the old id is kept in load_error).';
COMMENT ON COLUMN ad_videos.meta_ad_external_id IS
  'Meta''s id for the PAUSED ad, saved the moment createAd answers (417). The same value as ads.external_id on the ads row. NULL = no ad yet.';
COMMENT ON COLUMN ad_videos.ad_row_id IS
  'Our ads.id for this video''s ad (417). Set FIRST as the loader''s claim, a reserved id, just before it asks Meta for the ad; the ads row with that id is written once Meta answers. No foreign key, on purpose: the reservation comes before the row. NULL = not claimed.';
COMMENT ON COLUMN ad_videos.loaded_at IS
  'When the loader finished: the paused ad is in Meta and our creative_assets and ads rows are written (417). NULL = not loaded. Stands in for the ''loaded'' state until 9.1a adds it.';
COMMENT ON COLUMN ad_videos.load_error IS
  'Why the last load stopped, in plain words: a refusal (no approval, no Meta copy, no ad set, the ad set guard, the compliance screen, an enhancement turned on, the final video not in storage) or a failure (Meta said no, Meta could not process the video, 20 minutes passed). NULL = no problem, or a load is running now (417).';
