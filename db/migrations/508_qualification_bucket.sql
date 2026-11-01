-- 508_qualification_bucket.sql — the funding call bucket on each client and booking.
--
-- Owner-set 2026-10-29: two internal buckets for the funding call.
--   funding_qualified    the score is 700 and up (current and earlier survey bands)
--   funding_unqualified  every other readable score, "Not sure" included. Capital
--                        Blueprint and credit repair live together in this bucket.
-- NULL means the person has not answered the score question yet. Unknown, not guessed.
--
-- The rule lives in src/config/survey-qualification.mjs (qualificationBucket).
-- onSurveySubmitted (src/handlers/client-lifecycle.mjs) stamps clients.qualification_bucket
-- from the effective score, including setter corrections. A booking copies its client's bucket when it is saved and
-- keeps it from then on, so a later survey answer never rewrites a booked call.
--
-- Same people take both kinds of call. Customers never see this value.

ALTER TABLE clients  ADD COLUMN IF NOT EXISTS qualification_bucket text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qualification_bucket text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_qualification_bucket_check') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_qualification_bucket_check
      CHECK (qualification_bucket IN ('funding_qualified', 'funding_unqualified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_qualification_bucket_check') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_qualification_bucket_check
      CHECK (qualification_bucket IN ('funding_qualified', 'funding_unqualified'));
  END IF;
END $$;

-- A booking takes its client's bucket once, then keeps it.
CREATE OR REPLACE FUNCTION bookings_keep_qualification_bucket() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.qualification_bucket IS NOT NULL THEN
    NEW.qualification_bucket := OLD.qualification_bucket;
  ELSIF NEW.qualification_bucket IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT c.qualification_bucket INTO NEW.qualification_bucket
      FROM clients c WHERE c.id = NEW.client_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_qualification_bucket ON bookings;
CREATE TRIGGER trg_bookings_qualification_bucket
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_keep_qualification_bucket();

-- Backfill only a known tier or a readable current/legacy score. The saved
-- credit_tier already includes setter corrections; it wins over an old raw answer.
-- Unknown CF option IDs and absent scores stay NULL rather than being guessed.
WITH answers AS (
  SELECT id,
         custom_fields->>'credit_tier' AS tier,
         translate(btrim(coalesce(
           nullif(custom_fields->'setter_survey_edits'->>'cf_svy_self_reported_fico', ''),
           nullif(custom_fields->>'cf_svy_self_reported_fico_label', ''),
           nullif(custom_fields->>'cf_svy_self_reported_fico', ''),
           nullif(custom_fields->>'svy_self_reported_fico', '')
         )), '‒–—―', '----') AS score
    FROM clients
), classified AS (
  SELECT id,
         CASE
           WHEN tier = 'qualified' THEN 'funding_qualified'
           WHEN tier = 'unqualified' THEN 'funding_unqualified'
           WHEN score IN ('700-759', '760-850', '700-749', '750+') THEN 'funding_qualified'
           WHEN score IN ('500-619', '620-699', 'Not sure',
                          '500-579', '580-649', '650-699') THEN 'funding_unqualified'
           ELSE NULL
         END AS bucket
    FROM answers
)
UPDATE clients c
   SET qualification_bucket = scored.bucket
  FROM classified scored
 WHERE c.id = scored.id
   AND c.qualification_bucket IS NULL
   AND scored.bucket IS NOT NULL;

-- Older bookings have no saved at-booking score. Use the known client bucket for
-- rows still missing one; after this, the trigger prevents later rewrites.
UPDATE bookings b
   SET qualification_bucket = c.qualification_bucket
  FROM clients c
 WHERE b.client_id = c.id
   AND b.qualification_bucket IS NULL
   AND c.qualification_bucket IS NOT NULL;
