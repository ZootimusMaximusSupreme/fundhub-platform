-- 495_affiliate_payout_rail.sql — affiliate payout tracking through Plaid.
--
-- Owner ask, 2026-10-20 (board ops/workflows/affiliate-payout-plaid-2026-10-20.md):
-- "affiliate payout tracking must be built and finished 100%, and it runs through
-- Plaid as an integration we build." Chris answered "no preference" on how Plaid
-- is used, so the picks below are agent-set and recorded on the board.
--
-- WHAT 033 ALREADY HAD. affiliate_payouts (pending|held|processing|paid|void),
-- its lines, the double-pay guard and the license gate. What it did not have is
-- any way to get a run PAID, or any record of where the money went. Nothing in
-- the repo moved a run past pending/held.
--
-- WHAT THIS ADDS
--   1. affiliate_payout_accounts — the affiliate's own bank, linked through Plaid
--      Link (product "transfer"). The access token is stored encrypted, bound to
--      Plaid's item id, exactly like plaid_items (080). One active account each.
--   2. Payout tracking columns on affiliate_payouts: the due day, who approved,
--      which bank it went to, and the Plaid transfer id + status.
--   3. Three database rules:
--        * PAID NEEDS PROOF. A run cannot become paid without a method and a
--          reference (a Plaid transfer id, an ACH trace, a cheque number).
--        * TEST MONEY NEVER PAYS A REAL PERSON. A Plaid transfer made on the
--          sandbox host can settle a run only for a demo affiliate. A real
--          affiliate's run marked paid by Plaid must have gone through production.
--        * THE TAX GATE MOVES INTO THE DATABASE. 033 enforced the license gate
--          here and left the tax half to JavaScript; processing/paid now needs
--          tax_form_received_at too.
--   4. When a run is paid, its referrals are marked paid (033 named that status
--      and nothing ever wrote it).
--
-- PAID WHEN IT CLEARS (owner-set 2026-10-20, Chris): "Paid them out immediately
-- upon receiving the money. Once it clears, we just pay it." The autopay job
-- (src/affiliates/payout-rail.mjs runAutopay) builds a run per earned
-- commission and writes due_on = the day after it cleared.
--
-- DUE DAY DEFAULT for a run written without one (the older monthly backstop
-- run, affiliate-payout-run 0 3 1 * *): period_end + 14 days, the 15th of the
-- month after the month earned.
--
-- THIS MOVES NO MONEY. It adds tables, columns and rules. No run changes status.

-- ---------------------------------------------------------------------------
-- 1. The affiliate's bank
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_payout_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES orgs(id),
  affiliate_id           uuid NOT NULL REFERENCES affiliates(id),
  provider               text NOT NULL DEFAULT 'plaid' CHECK (provider IN ('plaid')),
  -- The Plaid host the link was made on. A sandbox link is test data and can
  -- never receive a real payout (see section 3).
  environment            text NOT NULL CHECK (environment IN ('sandbox', 'development', 'production')),
  plaid_item_id          text NOT NULL,
  plaid_account_id       text NOT NULL,
  -- AES-256-GCM ciphertext from src/banking/plaid.mjs encryptPlaidToken, with
  -- plaid_item_id as the bound data. Never the plaintext.
  encrypted_access_token text NOT NULL,
  institution_name       text,
  account_name           text,
  account_mask           text,
  account_subtype        text,
  --   active   — where the next payout goes
  --   replaced — an older link the affiliate swapped out
  --   revoked  — turned off by the affiliate or staff
  status                 text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'replaced', 'revoked')),
  -- The affiliate finishing Plaid Link is the consent. Stamped by the writer.
  consent_granted_at     timestamptz NOT NULL,
  linked_by              text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_accounts_one_active
  ON affiliate_payout_accounts (affiliate_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_accounts_plaid_uniq
  ON affiliate_payout_accounts (org_id, plaid_item_id, plaid_account_id);
CREATE INDEX IF NOT EXISTS affiliate_payout_accounts_org_idx
  ON affiliate_payout_accounts (org_id, affiliate_id);

-- ---------------------------------------------------------------------------
-- 2. Tracking columns on the payout run
-- ---------------------------------------------------------------------------
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS due_on date;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS payout_account_id uuid
  REFERENCES affiliate_payout_accounts(id);
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS rail_environment text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS plaid_authorization_id text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS plaid_transfer_id text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS plaid_transfer_status text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS rail_failure text;
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS rail_synced_at timestamptz;
-- Each send attempt gets its own Plaid idempotency key (ap:<payout id>:<n>), so a
-- retry after a failed transfer is a new authorization, not a replay of the dead one.
ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS rail_attempts integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_payouts_rail_env_ck') THEN
    ALTER TABLE affiliate_payouts ADD CONSTRAINT affiliate_payouts_rail_env_ck
      CHECK (rail_environment IS NULL OR rail_environment IN ('sandbox', 'production'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payouts_plaid_transfer_uniq
  ON affiliate_payouts (plaid_transfer_id) WHERE plaid_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS affiliate_payouts_due_idx
  ON affiliate_payouts (org_id, due_on) WHERE status IN ('pending', 'held', 'processing');

-- The due day for every run already on file. Same rule as new runs.
UPDATE affiliate_payouts
   SET due_on = ((period_end AT TIME ZONE 'UTC')::date + 14)
 WHERE due_on IS NULL;

-- ---------------------------------------------------------------------------
-- 3. The rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate_payouts_rail_guard() RETURNS trigger AS $$
DECLARE aff record;
BEGIN
  IF NEW.due_on IS NULL THEN
    NEW.due_on := ((NEW.period_end AT TIME ZONE 'UTC')::date + 14);
  END IF;

  IF NEW.status IN ('processing', 'paid')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    SELECT a.tax_form_received_at, COALESCE(a.is_demo, false) AS is_demo
      INTO aff FROM affiliates a WHERE a.id = NEW.affiliate_id;
    IF aff.tax_form_received_at IS NULL THEN
      RAISE EXCEPTION
        'affiliate_payouts %: affiliate % has no tax form on file — payouts accrue but do not release',
        COALESCE(NEW.id::text, '(new)'), NEW.affiliate_id;
    END IF;

    IF NEW.status = 'paid' THEN
      IF NEW.method IS NULL OR btrim(NEW.method) = ''
         OR COALESCE(NULLIF(btrim(NEW.external_ref), ''), NEW.plaid_transfer_id) IS NULL THEN
        RAISE EXCEPTION
          'affiliate_payouts %: paid needs a method and a reference (Plaid transfer id, ACH trace or cheque number)',
          COALESCE(NEW.id::text, '(new)');
      END IF;
      IF NEW.method = 'plaid_transfer' THEN
        IF NEW.plaid_transfer_id IS NULL
           OR NEW.plaid_transfer_status IS NULL
           OR NEW.plaid_transfer_status NOT IN ('settled', 'funds_available') THEN
          RAISE EXCEPTION
            'affiliate_payouts %: a Plaid payout is paid only once Plaid says the transfer settled (now %)',
            COALESCE(NEW.id::text, '(new)'), COALESCE(NEW.plaid_transfer_status, 'none');
        END IF;
        IF COALESCE(NEW.rail_environment, '') <> 'production' AND NOT aff.is_demo THEN
          RAISE EXCEPTION
            'affiliate_payouts %: a Plaid sandbox transfer is test money and cannot pay a real affiliate',
            COALESCE(NEW.id::text, '(new)');
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payouts_rail_guard ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_rail_guard
  BEFORE INSERT OR UPDATE ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION affiliate_payouts_rail_guard();

-- ---------------------------------------------------------------------------
-- 4. A paid run marks its referrals paid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate_payouts_settle_referrals() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE affiliate_referrals r
       SET status = 'paid', updated_at = now()
      FROM affiliate_payout_lines l
     WHERE l.payout_id = NEW.id
       AND l.kind = 'commission'
       AND r.id = l.referral_id
       AND r.status = 'converted';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_affiliate_payouts_settle_referrals ON affiliate_payouts;
CREATE TRIGGER trg_affiliate_payouts_settle_referrals
  AFTER INSERT OR UPDATE OF status ON affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION affiliate_payouts_settle_referrals();

-- ---------------------------------------------------------------------------
-- 5. Row security and grants — the 466 shape. No deletes: a bank link is
--    replaced or revoked, never erased, so a paid run can always say where its
--    money went.
-- ---------------------------------------------------------------------------
ALTER TABLE public.affiliate_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_payout_accounts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'affiliate_payout_accounts'
                  AND policyname = 'affiliate_payout_accounts_app_all') THEN
    CREATE POLICY affiliate_payout_accounts_app_all ON public.affiliate_payout_accounts
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE DELETE, TRUNCATE ON public.affiliate_payout_accounts FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.affiliate_payout_accounts TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE affiliate_payout_accounts IS
  'An affiliate''s own bank, linked through Plaid Link (product transfer). One active row each. Token encrypted, bound to plaid_item_id. 495.';
COMMENT ON COLUMN affiliate_payouts.due_on IS
  'Day the run must be sent by. Autopay: the day after the client payment cleared (owner-set 2026-10-20). Default when unset: period_end + 14. 495.';
