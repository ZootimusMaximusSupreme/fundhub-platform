-- 470_blueprint_decline_defense.sql — Capital Blueprint decline defense.
--
-- Blueprint launch, unit B1 (ops/workflows/blueprint-launch-2026-10-06.md, map
-- item 9). Owner-set offer (docs/finance/capital-blueprint-next-2026-09-29.md):
-- "Decline defense: When a bank declines, the system reads the reason and runs
-- the reconsideration on the ops side."
--
-- TWO TABLES.
--
--   blueprint_declines       one row per decline. At most one per application
--                            (the bank says no to an application once; what
--                            happens after is the outcome on the same row). A
--                            pasted letter with no application is still one row,
--                            and the same letter pasted twice is still one row
--                            (letter_hash).
--   blueprint_decline_steps  the reconsideration plan, one row per step, in
--                            order. Who does it (agent / ops / client), the words,
--                            and the SOURCE of the words.
--
-- THE RULES LIVE HERE, NOT IN THE SCREEN.
--
--   * A step with words must cite a source (blueprint_decline_steps_cited_ck).
--     A step no source covers is a BLANK: no words, no source, and a label that
--     says what the ops person has to write. Board rule: "never invent a bank
--     script, window, or amount — cite the repo source or make it staff-set."
--   * A blank cannot be marked done until somebody wrote it (…_blank_done_ck).
--   * A decline with no reason found is "needs a person" (…_needs_person_ck).
--   * The reason categories are a closed set (…_reasons_ck). The list and the
--     source of each one is written at the top of src/blueprint/decline-analyze.mjs.
--   * Re-apply later needs a re-apply date. An amount only rides on an approval,
--     and it is never zero: NULL is unknown and survives (CLAUDE.md §12).
--     Dollars, numeric(14,2), the same unit as applications.approved_amount.
--   * The call date (recon_on) and the re-apply date are STAFF-SET. Nothing in
--     the code picks a day.
--
-- Letter text is stored with the client's own numbers masked first (SSN shape,
-- long digit runs, a date of birth) — src/blueprint/decline-analyze.mjs
-- maskSensitive(). Capped at 20,000 characters.
--
-- Nothing in this feature deletes a row. The app gets SELECT, INSERT, UPDATE.

CREATE TABLE IF NOT EXISTS public.blueprint_declines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES orgs(id),
  client_id                uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  application_id           uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  lender_id                uuid REFERENCES public.lenders(id) ON DELETE SET NULL,
  bank                     text NOT NULL
                           CONSTRAINT blueprint_declines_bank_ck
                           CHECK (char_length(btrim(bank)) BETWEEN 1 AND 120),
  product                  text
                           CONSTRAINT blueprint_declines_product_ck
                           CHECK (product IS NULL OR char_length(product) <= 160),
  declined_on              date,
  bureaus_pulled           text[] NOT NULL DEFAULT '{}'::text[]
                           CONSTRAINT blueprint_declines_bureaus_ck
                           CHECK (bureaus_pulled <@ ARRAY['experian','equifax','transunion']::text[]),
  letter_text              text
                           CONSTRAINT blueprint_declines_letter_text_ck
                           CHECK (letter_text IS NULL OR char_length(letter_text) <= 20000),
  letter_hash              text
                           CONSTRAINT blueprint_declines_letter_hash_ck
                           CHECK (letter_hash IS NULL OR letter_hash ~ '^[0-9a-f]{64}$'),
  letter_document_id       uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  looks_like               text NOT NULL DEFAULT 'unclear'
                           CONSTRAINT blueprint_declines_looks_like_ck
                           CHECK (looks_like IN ('decline','approval','counteroffer','needs_info','unclear')),
  reason_categories        text[] NOT NULL DEFAULT '{}'::text[]
                           CONSTRAINT blueprint_declines_reasons_ck
                           CHECK (reason_categories <@ ARRAY[
                             'too_many_inquiries','high_utilization','accounts_with_balances',
                             'negative_items','short_history','too_many_new_accounts','credit_score',
                             'business_too_new','income_or_revenue','industry','could_not_verify',
                             'frozen_report','bank_relationship','same_bank_exposure'
                           ]::text[]),
  needs_person             boolean NOT NULL DEFAULT false,
  analysis                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  source                   text NOT NULL
                           CONSTRAINT blueprint_declines_source_ck
                           CHECK (source IN ('staff','client_paste')),
  recorded_by              text
                           CONSTRAINT blueprint_declines_recorded_by_ck
                           CHECK (recorded_by IS NULL OR char_length(recorded_by) <= 200),
  recon_on                 date,
  outcome                  text NOT NULL DEFAULT 'open'
                           CONSTRAINT blueprint_declines_outcome_ck
                           CHECK (outcome IN ('open','approved_on_recon','still_declined','reapply_later')),
  outcome_approved_amount  numeric(14,2)
                           CONSTRAINT blueprint_declines_amount_ck
                           CHECK (outcome_approved_amount IS NULL OR outcome_approved_amount > 0),
  reapply_on               date,
  outcome_notes            text
                           CONSTRAINT blueprint_declines_outcome_notes_ck
                           CHECK (outcome_notes IS NULL OR char_length(outcome_notes) <= 2000),
  outcome_by               text,
  outcome_at               timestamptz,
  task_id                  uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_declines_needs_person_ck
    CHECK (needs_person OR cardinality(reason_categories) > 0),
  CONSTRAINT blueprint_declines_reapply_ck
    CHECK (outcome <> 'reapply_later' OR reapply_on IS NOT NULL),
  CONSTRAINT blueprint_declines_amount_only_approved_ck
    CHECK (outcome_approved_amount IS NULL OR outcome = 'approved_on_recon'),
  CONSTRAINT blueprint_declines_outcome_stamp_ck
    CHECK (outcome = 'open' OR outcome_at IS NOT NULL)
);

-- One decline per application.
CREATE UNIQUE INDEX IF NOT EXISTS blueprint_declines_application_uniq
  ON public.blueprint_declines (application_id)
  WHERE application_id IS NOT NULL;

-- The same letter twice is the same decline.
CREATE UNIQUE INDEX IF NOT EXISTS blueprint_declines_letter_uniq
  ON public.blueprint_declines (client_id, letter_hash)
  WHERE letter_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS blueprint_declines_client_idx
  ON public.blueprint_declines (org_id, client_id, created_at DESC);

COMMENT ON TABLE public.blueprint_declines IS
  'Capital Blueprint decline defense — one row per bank decline: the letter, the reasons read from it, the reconsideration outcome. Staff-set call and re-apply dates.';
COMMENT ON COLUMN public.blueprint_declines.outcome_approved_amount IS
  'Dollars the bank approved on reconsideration. NULL = not told yet (never 0).';
COMMENT ON COLUMN public.blueprint_declines.recon_on IS
  'STAFF-SET day to call the bank''s reconsideration line. NULL = not set.';
COMMENT ON COLUMN public.blueprint_declines.reapply_on IS
  'STAFF-SET day to apply at this bank again. A note for the next funding sequence; it never sets that date.';

CREATE TABLE IF NOT EXISTS public.blueprint_decline_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  decline_id    uuid NOT NULL REFERENCES public.blueprint_declines(id) ON DELETE CASCADE,
  position      smallint NOT NULL
                CONSTRAINT blueprint_decline_steps_position_ck CHECK (position BETWEEN 1 AND 100),
  step_key      text NOT NULL
                CONSTRAINT blueprint_decline_steps_key_ck CHECK (step_key ~ '^[a-z0-9_:.-]{1,80}$'),
  who           text NOT NULL
                CONSTRAINT blueprint_decline_steps_who_ck CHECK (who IN ('agent','ops','client')),
  step_text     text
                CONSTRAINT blueprint_decline_steps_text_ck CHECK (step_text IS NULL OR char_length(step_text) BETWEEN 1 AND 600),
  client_text   text NOT NULL
                CONSTRAINT blueprint_decline_steps_client_text_ck CHECK (char_length(btrim(client_text)) BETWEEN 1 AND 400),
  source_kind   text
                CONSTRAINT blueprint_decline_steps_source_kind_ck
                CHECK (source_kind IS NULL OR source_kind IN ('notion','repo','book','letter','owner')),
  source_ref    text
                CONSTRAINT blueprint_decline_steps_source_ref_ck CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 400),
  is_blank      boolean NOT NULL DEFAULT false,
  blank_label   text
                CONSTRAINT blueprint_decline_steps_blank_label_ck CHECK (blank_label IS NULL OR char_length(blank_label) <= 300),
  status        text NOT NULL DEFAULT 'open'
                CONSTRAINT blueprint_decline_steps_status_ck CHECK (status IN ('open','done','skipped')),
  filled_text   text
                CONSTRAINT blueprint_decline_steps_filled_ck CHECK (filled_text IS NULL OR char_length(filled_text) <= 2000),
  done_at       timestamptz,
  done_by       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- A step with words cites where the words come from.
  CONSTRAINT blueprint_decline_steps_cited_ck
    CHECK (is_blank OR (step_text IS NOT NULL AND source_kind IS NOT NULL AND source_ref IS NOT NULL)),
  -- A blank has no invented words, no source, and says what has to be written.
  CONSTRAINT blueprint_decline_steps_blank_ck
    CHECK (NOT is_blank OR (step_text IS NULL AND source_kind IS NULL AND source_ref IS NULL AND blank_label IS NOT NULL)),
  -- A blank is done only once somebody wrote it.
  CONSTRAINT blueprint_decline_steps_blank_done_ck
    CHECK (NOT is_blank OR status <> 'done' OR filled_text IS NOT NULL),
  CONSTRAINT blueprint_decline_steps_done_stamp_ck
    CHECK (status = 'open' OR done_at IS NOT NULL),
  CONSTRAINT blueprint_decline_steps_unique UNIQUE (decline_id, step_key)
);

CREATE INDEX IF NOT EXISTS blueprint_decline_steps_decline_idx
  ON public.blueprint_decline_steps (decline_id, position);

COMMENT ON TABLE public.blueprint_decline_steps IS
  'Capital Blueprint decline defense — the reconsideration plan, one row per step. Every worded step cites its source; a step no source covers is a blank the ops person fills.';

-- Row-level security — the same shape 403 and 461 give the Blueprint tables.
ALTER TABLE public.blueprint_declines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_declines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_decline_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_decline_steps FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blueprint_declines'
       AND policyname = 'blueprint_declines_app_all'
  ) THEN
    CREATE POLICY blueprint_declines_app_all
      ON public.blueprint_declines
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'blueprint_decline_steps'
       AND policyname = 'blueprint_decline_steps_app_all'
  ) THEN
    CREATE POLICY blueprint_decline_steps_app_all
      ON public.blueprint_decline_steps
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_blueprint_declines_updated_at') THEN
      CREATE TRIGGER trg_blueprint_declines_updated_at
        BEFORE UPDATE ON public.blueprint_declines
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_blueprint_decline_steps_updated_at') THEN
      CREATE TRIGGER trg_blueprint_decline_steps_updated_at
        BEFORE UPDATE ON public.blueprint_decline_steps
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

-- Nothing in this feature deletes a row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.blueprint_declines TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.blueprint_decline_steps TO fundhub_app;
  END IF;
END $$;
