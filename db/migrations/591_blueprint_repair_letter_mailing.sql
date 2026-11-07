-- 591_blueprint_repair_letter_mailing.sql — the $97 "we mail it for you" for
-- repair-round dispute letters, and the mail tracker (Finance OS unit MAIL).
--
-- OWNER-SET 2026-11-07 (Chris), on repair letters: "if you want us to print,
-- generate and send them, we can do that." The SAME $97 batch mailing that
-- already mails the two funding letters (546) now also mails a repair round's
-- bureau letters: the same quote, the same secure checkout, the same mail house
-- (src/messaging/providers/blueprint-letter-mailing.mjs), the same two tables.
-- src/blueprint/letter-mailing.mjs is the only writer.
--
-- WHAT CHANGES
--   1. blueprint_letter_mailing_envelopes.dispute_letter_id — the repair letter
--      (dispute_letters row) an envelope mails. NULL for a funding letter. It is
--      part of the envelope's frozen content, so it can never change.
--   2. One live paid envelope per repair letter, even when its file is
--      regenerated with new bytes (the content index of 546 keys on bytes).
--   3. The 546 guard accepts a repair letter: the saved HTML file of a
--      bureau-target dispute letter of the same client and the same bureau.
--      A funding letter is still the saved PDF and never carries a letter id.
--   4. The tracker: what the mail house reports after it accepted a letter —
--      handed to the post office, the expected delivery date, returned — each
--      date set once. Accepted (or still printing) is not mailed: mailed_at is
--      the date PostGrid reports processed_for_delivery, "handed off to the
--      local postal service" (Codex CX28). PostGrid never confirms delivery: its
--      "completed" means "most likely delivered", so it is stored as
--      expected_delivery_at and never called delivered (Codex CX26). The
--      bureau's 30 days start when the bureau gets the letter, so reply_due_at
--      is the expected delivery date + 30 days and stays empty until that date
--      is known (Codex CX27). Only an accepted envelope carries tracker facts.
--   5. A staff "clear stuck claim" cannot release a repair letter while a paid
--      Fundhub mailing is sending it or has mailed it. Same rule as 334: never
--      a second envelope.
--
-- SAFETY. Additive: eight nullable columns, five checks, two indexes, one
-- replaced function (546's, every existing rule kept word for word), one new
-- trigger. No row is rewritten. Mails nothing, charges nothing.

ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD COLUMN IF NOT EXISTS dispute_letter_id uuid REFERENCES public.dispute_letters(id),
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS imb_status text,
  ADD COLUMN IF NOT EXISTS mailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracked_at timestamptz;

-- PostGrid's own words (guides.postgrid.com, letters: retrieve). Anything else
-- is stored as nothing, never guessed into one of these.
ALTER TABLE public.blueprint_letter_mailing_envelopes
  DROP CONSTRAINT IF EXISTS blueprint_letter_mailing_envelopes_provider_status_ck;
ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD CONSTRAINT blueprint_letter_mailing_envelopes_provider_status_ck
  CHECK (provider_status IS NULL OR provider_status IN ('ready','printing','processed_for_delivery','completed','cancelled'));
ALTER TABLE public.blueprint_letter_mailing_envelopes
  DROP CONSTRAINT IF EXISTS blueprint_letter_mailing_envelopes_imb_status_ck;
ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD CONSTRAINT blueprint_letter_mailing_envelopes_imb_status_ck
  CHECK (imb_status IS NULL OR imb_status IN ('entered_mail_stream','out_for_delivery','returned_to_sender'));
ALTER TABLE public.blueprint_letter_mailing_envelopes
  DROP CONSTRAINT IF EXISTS blueprint_letter_mailing_envelopes_tracker_ck;
ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD CONSTRAINT blueprint_letter_mailing_envelopes_tracker_ck
  CHECK (state = 'accepted' OR (provider_status IS NULL AND imb_status IS NULL
    AND mailed_at IS NULL AND expected_delivery_at IS NULL AND returned_at IS NULL AND reply_due_at IS NULL AND tracked_at IS NULL));
-- Mailed only once PostGrid reports the handoff to the post office (CX28).
ALTER TABLE public.blueprint_letter_mailing_envelopes
  DROP CONSTRAINT IF EXISTS blueprint_letter_mailing_envelopes_mailed_after_handoff_ck;
ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD CONSTRAINT blueprint_letter_mailing_envelopes_mailed_after_handoff_ck
  CHECK (mailed_at IS NULL OR provider_status IN ('processed_for_delivery','completed'));
-- No reply date before the expected delivery date is known (CX27).
ALTER TABLE public.blueprint_letter_mailing_envelopes
  DROP CONSTRAINT IF EXISTS blueprint_letter_mailing_envelopes_reply_after_delivery_ck;
ALTER TABLE public.blueprint_letter_mailing_envelopes
  ADD CONSTRAINT blueprint_letter_mailing_envelopes_reply_after_delivery_ck
  CHECK (reply_due_at IS NULL OR (expected_delivery_at IS NOT NULL AND reply_due_at > expected_delivery_at));

CREATE UNIQUE INDEX IF NOT EXISTS blueprint_letter_mailing_one_repair_letter_send
  ON public.blueprint_letter_mailing_envelopes (dispute_letter_id)
  WHERE dispute_letter_id IS NOT NULL AND state IN ('sending','accepted','needs_review');
CREATE INDEX IF NOT EXISTS blueprint_letter_mailing_tracking
  ON public.blueprint_letter_mailing_envelopes (tracked_at NULLS FIRST, accepted_at)
  WHERE state = 'accepted' AND expected_delivery_at IS NULL AND returned_at IS NULL;

-- 546's guard, every rule kept. Changed only: the envelope's document may also
-- be a repair letter's saved HTML (with its letter id), dispute_letter_id joins
-- the frozen content, and tracker dates are set once.
CREATE OR REPLACE FUNCTION public.blueprint_letter_mailing_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='blueprint_letter_mailing_orders' THEN
    IF NOT EXISTS(SELECT 1 FROM public.paid_service_requests p WHERE p.id=NEW.id AND p.org_id=NEW.org_id
      AND p.client_id=NEW.client_id AND p.service_kind='letter_mailing' AND p.price_total_cents=9700 AND p.currency='USD') THEN
      RAISE EXCEPTION 'mailing order must match its exact scoped paid-service request' USING ERRCODE='23514';
    END IF;
    IF NEW.authorized_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.accounts a
      WHERE a.id=NEW.authorized_account_id AND a.org_id=NEW.org_id AND a.client_id=NEW.client_id AND a.kind='client' AND a.status='active') THEN
      RAISE EXCEPTION 'mailing authorization must belong to its client account' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id,NEW.org_id,NEW.client_id,NEW.quote_version,NEW.snapshot)
      IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.client_id,OLD.quote_version,OLD.snapshot) THEN
      RAISE EXCEPTION 'mailing quote and content are immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.authorized_at IS NOT NULL AND (NEW.authorized_at,NEW.authorized_account_id,NEW.authorization_text,NEW.confirmation_key)
      IS DISTINCT FROM (OLD.authorized_at,OLD.authorized_account_id,OLD.authorization_text,OLD.confirmation_key) THEN
      RAISE EXCEPTION 'mailing authorization is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.blueprint_letter_mailing_orders o
      JOIN public.documents d ON d.id=NEW.document_id AND d.org_id=o.org_id AND d.client_id=o.client_id
      JOIN public.document_versions v ON v.id=NEW.document_version_id AND v.document_id=d.id AND v.org_id=d.org_id
      WHERE o.id=NEW.order_id AND o.org_id=NEW.org_id AND o.client_id=NEW.client_id AND d.kind='deliverable'
      AND NEW.snapshot->>'subtype'=d.subtype
      AND d.metadata->>'bureau'=NEW.bureau
      AND v.checksum=NEW.checksum AND v.storage_key=NEW.snapshot->>'storageKey'
      AND NEW.snapshot->>'checksum'=NEW.checksum AND NEW.snapshot->>'versionId'=v.id::text
      AND NEW.snapshot->>'documentId'=d.id::text AND NEW.snapshot->>'bureau'=NEW.bureau
      AND (
        (d.subtype IN ('funding_inquiry_removal','funding_personal_info') AND v.mime_type='application/pdf'
          AND NEW.dispute_letter_id IS NULL)
        OR (d.subtype='metro2_dispute_letter_pack' AND v.mime_type='text/html'
          AND d.metadata->>'target'='bureau' AND NEW.dispute_letter_id IS NOT NULL
          AND d.metadata->>'letterId'=NEW.dispute_letter_id::text
          AND NEW.snapshot->>'letterId'=NEW.dispute_letter_id::text
          AND EXISTS(SELECT 1 FROM public.dispute_letters l WHERE l.id=NEW.dispute_letter_id
            AND l.org_id=NEW.org_id AND l.client_id=NEW.client_id AND l.bureau=NEW.bureau AND l.target='bureau'))
      )) THEN
      RAISE EXCEPTION 'mailing envelope must match its exact owned document version' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id,NEW.order_id,NEW.org_id,NEW.client_id,NEW.document_id,NEW.document_version_id,NEW.checksum,NEW.bureau,NEW.snapshot,NEW.dispute_letter_id)
      IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.org_id,OLD.client_id,OLD.document_id,OLD.document_version_id,OLD.checksum,OLD.bureau,OLD.snapshot,OLD.dispute_letter_id) THEN
      RAISE EXCEPTION 'mailing envelope content is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.claimed_at IS NOT NULL AND (NEW.claimed_at,NEW.claim_token)
      IS DISTINCT FROM (OLD.claimed_at,OLD.claim_token) THEN
      RAISE EXCEPTION 'mailing send claim may not be cleared or replaced' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND OLD.state='accepted' AND (NEW.state,NEW.provider_id,NEW.accepted_at)
      IS DISTINCT FROM (OLD.state,OLD.provider_id,OLD.accepted_at) THEN
      RAISE EXCEPTION 'accepted mailing is irreversible' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (
         (OLD.mailed_at IS NOT NULL AND NEW.mailed_at IS DISTINCT FROM OLD.mailed_at)
      OR (OLD.expected_delivery_at IS NOT NULL AND NEW.expected_delivery_at IS DISTINCT FROM OLD.expected_delivery_at)
      OR (OLD.returned_at IS NOT NULL AND NEW.returned_at IS DISTINCT FROM OLD.returned_at)
      OR (OLD.reply_due_at IS NOT NULL AND NEW.reply_due_at IS DISTINCT FROM OLD.reply_due_at)) THEN
      RAISE EXCEPTION 'mailing tracker dates are set once' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 5. A clear says "this letter did not go out". While a paid Fundhub mailing
-- is sending it or has mailed it, that is not true, so the database refuses
-- to store it. An envelope held for review is left to a person, exactly like a
-- stuck staff claim (333): they check PostGrid's own record first, and a letter
-- that provably never left can still be released.
CREATE OR REPLACE FUNCTION public.dispute_letter_paid_mailing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.send_claim_cleared_at IS NOT NULL
     AND NEW.send_claim_cleared_at IS DISTINCT FROM OLD.send_claim_cleared_at
     AND EXISTS(SELECT 1 FROM public.blueprint_letter_mailing_envelopes e
                 WHERE e.dispute_letter_id=NEW.id AND e.state IN ('sending','accepted')) THEN
    RAISE EXCEPTION 'a paid Fundhub mailing holds this letter' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dispute_letter_paid_mailing_guard ON public.dispute_letters;
CREATE TRIGGER dispute_letter_paid_mailing_guard BEFORE UPDATE OF send_claim_cleared_at ON public.dispute_letters
  FOR EACH ROW EXECUTE FUNCTION public.dispute_letter_paid_mailing_guard();
