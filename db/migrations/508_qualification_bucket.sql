-- 508_qualification_bucket.sql — the funding call bucket on each client and booking.
--
-- Owner-set 2026-10-29: two internal buckets for the funding call.
--   funding_qualified    the survey score is 700-749 or 750+ (and no "Yes" to negatives)
--   funding_unqualified  every other score answer, "Not sure" included. Capital
--                        Blueprint and credit repair live together in this bucket.
-- NULL means the person has not answered the score question yet. Unknown, not guessed.
--
-- The rule lives in src/config/survey-qualification.mjs (qualificationBucket).
-- onSurveySubmitted (src/handlers/client-lifecycle.mjs) stamps clients.qualification_bucket
-- from the newest answers. A booking copies its client's bucket when it is saved and
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

-- Backfill from the answers already saved. Same bands as PASSING_FICO_BANDS
-- (src/config/survey-qualification.test.mjs holds this list to that one).
UPDATE clients c
   SET qualification_bucket = CASE
         WHEN translate(btrim(coalesce(c.custom_fields->>'cf_svy_self_reported_fico',
                                       c.custom_fields->>'svy_self_reported_fico')),
                        '‒–—―', '----') IN ('700-749', '750+')
              AND lower(btrim(coalesce(c.custom_fields->>'cf_svy_has_negatives',
                                       c.custom_fields->>'svy_has_negatives', '')))
                  NOT IN ('yes', 'true')
         THEN 'funding_qualified'
         ELSE 'funding_unqualified'
       END
 WHERE c.qualification_bucket IS NULL
   AND nullif(btrim(coalesce(c.custom_fields->>'cf_svy_self_reported_fico',
                             c.custom_fields->>'svy_self_reported_fico')), '') IS NOT NULL;

UPDATE bookings b
   SET qualification_bucket = c.qualification_bucket
  FROM clients c
 WHERE b.client_id = c.id
   AND b.qualification_bucket IS NULL
   AND c.qualification_bucket IS NOT NULL;
