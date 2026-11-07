-- 575_plaid_institution_logos.sql — each bank's own logo, from Plaid, stored once per bank.
--
-- OWNER RULE (Chris, 2026-11-07): "MAKE SURE THE BANKS HAVE THE CORRESPONDING
-- BANK LOGO WITH IT, THATS A RULE. AND THEN YEAH THATLL BE FROM PLAID."
--
-- WHAT THIS HOLDS. One row per Plaid institution ("ins_56"). Plaid's
-- /institutions/get_by_id with options.include_optional_metadata=true answers
-- with the bank's logo (a base64 152x152 PNG, or null when Plaid has none), its
-- brand colour and its website. That answer is the same for every client who
-- banks there, so it is stored ONCE PER BANK, never per client and never per
-- login. plaid_items keeps pointing at the bank by plaid_institution_id.
--
-- NOT PERSONAL DATA. There is no org_id, no client_id and no account here: a
-- bank's public logo is not a fact about anyone. Who banks where stays on
-- plaid_items, which is org- and client-scoped as before. This table only
-- answers "what does ins_56 look like".
--
-- NULL MEANS PLAID HAS NONE (or we have not asked yet — logo_fetched_at says
-- which). A screen with a null logo shows the bank's name only. Nothing here
-- draws, guesses or invents a logo. src/banking/institution-logos.mjs falls back
-- to the bank book's own file (lenders.logo_path, migration 254) and then to null.
--
-- Written by src/banking/institution-logos.mjs when a login links or refreshes,
-- and by scripts/plaid-institution-logos-backfill.mjs for banks linked before
-- this table existed. Read only — no money moves anywhere near it.

CREATE TABLE IF NOT EXISTS public.plaid_institutions (
  plaid_institution_id text PRIMARY KEY
    CHECK (btrim(plaid_institution_id) <> '' AND length(plaid_institution_id) <= 100),

  -- Plaid's official name for the bank. NULL until Plaid has told us.
  name text CHECK (name IS NULL OR length(name) <= 300),

  -- The name with case, spaces and punctuation removed ("Bank of America" →
  -- "bankofamerica"), so a bank-book row and a Plaid bank can be matched by name
  -- when there is no id to match on. Computed by bankKey() in
  -- src/banking/institution-logos.mjs and stored, so both sides use one rule.
  name_key text CHECK (name_key IS NULL OR (name_key ~ '^[a-z0-9]+$' AND length(name_key) <= 300)),

  -- Plaid's base64 PNG, exactly as sent. NULL = Plaid has no logo for this bank.
  logo_base64 text CHECK (logo_base64 IS NULL OR (
    length(logo_base64) BETWEEN 12 AND 400000
    AND logo_base64 ~ '^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  )),

  -- "#1A2B3C". NULL when Plaid sent none.
  primary_color text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$'),

  -- The bank's website. http(s) only.
  url text CHECK (url IS NULL OR (length(url) <= 500 AND url ~* '^https?://[^[:space:]]+$')),

  -- When Plaid was last asked. A logo is re-read at most once a month per bank.
  logo_fetched_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The name match: "which Plaid bank is called this?"
CREATE INDEX IF NOT EXISTS idx_plaid_institutions_name_key
  ON public.plaid_institutions (name_key)
  WHERE name_key IS NOT NULL;

ALTER TABLE public.plaid_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_institutions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.plaid_institutions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE ALL ON public.plaid_institutions FROM fundhub_app;
    GRANT SELECT, INSERT ON public.plaid_institutions TO fundhub_app;
    GRANT UPDATE (name, name_key, logo_base64, primary_color, url, logo_fetched_at, updated_at)
      ON public.plaid_institutions TO fundhub_app;
    -- Public bank facts, no tenant column: every org reads the same row.
    CREATE POLICY plaid_institutions_app ON public.plaid_institutions TO fundhub_app
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.plaid_institutions IS
  'One row per Plaid institution: its own logo (base64 PNG, null when Plaid has none), primary_color and url. Stored once per bank, not per client. Owner rule 2026-11-07.';
