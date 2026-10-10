-- 479 — a script's place in its offer's stack, for the take file name (owner, 2026-10-10).
--
-- THE FILE NAME IS OWNER LAW (marketing/ads/NAMING.md): {Offer} Ad {n} — {angle} Take {k}.mp4.
-- The {n} is the ad's number INSIDE its offer ("SLO Ad 7"), not the tracking number in the ad link
-- (ad_scripts.ad_id, which is 90 for that same ad). Until now the name builder
-- (src/marketing/shoot-plan.mjs) had only ad_id and the title, so the 13 book-a-call films on the
-- open shoot had no name at all and every take landed in Drive as "Take.mp4".
--
--   stack_kind  what the film is in its offer: an ad, the VSL, or the thank-you video.
--   stack_no    its number in that offer (Ad 1, Ad 2, VSL 1). NULL = not numbered yet; an ad then
--               falls back to ad_id, as before. The thank-you video has no number.
--   angle_name  the clean angle for the file name. NULL = use the title. A title can carry an old
--               ad label ("Ad 19 — Over and over (broad, film first)") or a film note; the angle
--               is only "Over and over".
--
-- A new version of a script (src/marketing/scripts-store.mjs editScript) copies all three forward.
-- No new table, so no new row rule: ad_scripts keeps its own.

ALTER TABLE public.ad_scripts
  ADD COLUMN IF NOT EXISTS stack_kind text NOT NULL DEFAULT 'ad',
  ADD COLUMN IF NOT EXISTS stack_no   integer,
  ADD COLUMN IF NOT EXISTS angle_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_scripts_stack_kind_ck') THEN
    ALTER TABLE public.ad_scripts
      ADD CONSTRAINT ad_scripts_stack_kind_ck CHECK (stack_kind IN ('ad', 'vsl', 'thank_you'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_scripts_stack_no_ck') THEN
    ALTER TABLE public.ad_scripts
      ADD CONSTRAINT ad_scripts_stack_no_ck CHECK (stack_no IS NULL OR stack_no > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_scripts_angle_name_ck') THEN
    ALTER TABLE public.ad_scripts
      ADD CONSTRAINT ad_scripts_angle_name_ck
      CHECK (angle_name IS NULL OR (char_length(btrim(angle_name)) BETWEEN 1 AND 160 AND angle_name !~ '[/\\]'));
  END IF;
END $$;

-- The 13 book-a-call films Chris named on 2026-10-10: the Direct Book offer, Ad 1 to Ad 11 in film
-- order, then the VSL and the thank-you video. Each row is matched on its ad number, its offer AND
-- the start of its title, so this touches nothing on a database that does not hold these scripts
-- (a scratch or CI database: zero rows). Every version of a script gets the same place.
UPDATE public.ad_scripts s
   SET stack_kind = v.kind, stack_no = v.no, angle_name = v.angle
  FROM (VALUES
    ('92',  'Script 4 — Tool analogy%',            'ad',         1, 'Tool analogy, the hammer on the flat tire'),
    ('93',  'Ad 19 — Over and over%',              'ad',         2, 'Over and over'),
    ('94',  'Ad 14 — It''s a skill%',              'ad',         3, 'It''s a skill'),
    ('95',  'Ad 15 — High earners%',               'ad',         4, 'High earners'),
    ('96',  'Ad 17 — Paying for speed%',           'ad',         5, 'Paying for speed'),
    ('97',  'Ad 16 — The hidden tax%',             'ad',         6, 'The hidden tax'),
    ('98',  'Script 1 — Notes green screen%',      'ad',         7, 'Notes green screen, seven steps'),
    ('99',  'Script 2 — Notes green screen%',      'ad',         8, 'Notes green screen'),
    ('100', 'Ad 9 — The bank%',                    'ad',         9, 'The bank'),
    ('101', 'Scale without your own cash%',        'ad',        10, 'Scale without your own cash'),
    ('102', 'The penthouse%',                      'ad',        11, 'The penthouse'),
    ('103', '/watch VSL%',                         'vsl',        1, 'Watch page'),
    ('104', '/watch thank-you video%',             'thank_you', NULL, NULL)
  ) AS v(ad_id, title_like, kind, no, angle)
 WHERE s.ad_id = v.ad_id
   AND s.offer_key = 'funding_dfy'
   AND s.title LIKE v.title_like;
