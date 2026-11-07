-- 587_business_fuel_cards.sql — business gas and fuel cards as business
-- primaries. Finance OS wave 4, unit GAS (ops/workflows/finance-os-wave4-brief.txt):
-- "list them in the business plan ONLY from cards in the bank book or lenders
-- data (if none exist, add an empty staff-set list and report it; never invent
-- a card). Track them like other cards with phone alerts, and add the risk line
-- 'Miss a payment and it hurts your business credit.'"
--
-- Two tables. Additive. Re-running it is a no-op.
--
-- 1. business_fuel_cards — the staff-set list. Every row points at a real row
--    of the bank book (`lenders`); a card that is not in the bank book cannot
--    be on the list. No category in the bank book says "fuel card", so a person
--    sets the list; nothing is guessed from a name at run time.
--
--    THE ONE CARD FOUND. The lenders data holds exactly one gas-brand card:
--    CHEVRON (lenders 87d7af03-247d-4f79-8f5c-f0e1c8adc144, OnlineBizCC, from
--    the Carl Barton 0% APR business card database 2026-09-18; bureaus TU and
--    D&B/SBFE; logo /assets/lenders/chevron.png). Searched 2026-11-07: the live
--    book copy ops/workflows/giovanni-banks-2026-10-24-before.csv (1,106 rows),
--    docs/legacy-strong/lenders-legacy-strong.csv and the Carl Barton files.
--    It was hidden from the bank list by Giovanni's list (504); it is listed
--    here as a gas card, not as a bank. The insert below adds it only where
--    that exact row exists, so a fresh database (no lender rows) stays empty.
--
-- 2. business_fuel_card_accounts — which of the client's tracked cards is a
--    gas card from the list, and for which business. The card itself is an
--    ordinary hand-entered card (src/finance/money-accounts.mjs addHandAccount)
--    with its due day, so it gets the same phone alerts as every other card.
--    One tracked card per list card per business.

-- ---------------------------------------------------------------------------
-- 1. business_fuel_cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_fuel_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  lender_id        uuid NOT NULL REFERENCES lenders(id),
  active           boolean NOT NULL DEFAULT true,
  set_by           text NOT NULL CHECK (set_by IN ('staff', 'migration')),
  set_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  note             text CHECK (note IS NULL OR length(note) <= 500),
  set_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lender_id)
);

ALTER TABLE public.business_fuel_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_fuel_cards FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'business_fuel_cards' AND policyname = 'business_fuel_cards_app_all') THEN
    CREATE POLICY business_fuel_cards_app_all ON public.business_fuel_cards USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. business_fuel_card_accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_fuel_card_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES orgs(id),
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  fuel_card_id     uuid NOT NULL REFERENCES business_fuel_cards(id) ON DELETE CASCADE,
  bank_account_id  uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id)
);

CREATE INDEX IF NOT EXISTS business_fuel_card_accounts_client_idx
  ON business_fuel_card_accounts (org_id, client_id);

ALTER TABLE public.business_fuel_card_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_fuel_card_accounts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'business_fuel_card_accounts' AND policyname = 'business_fuel_card_accounts_app_all') THEN
    CREATE POLICY business_fuel_card_accounts_app_all ON public.business_fuel_card_accounts USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.business_fuel_cards TO fundhub_app;
    GRANT SELECT, INSERT ON public.business_fuel_card_accounts TO fundhub_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. the one card found in the lenders data, where that row exists
-- ---------------------------------------------------------------------------
INSERT INTO business_fuel_cards (org_id, lender_id, set_by, note)
SELECT l.org_id, l.id, 'migration',
       'Found in the lenders data 2026-11-07: CHEVRON, from the Carl Barton 0% APR business card database (2026-09-18).'
  FROM lenders l
 WHERE l.id = '87d7af03-247d-4f79-8f5c-f0e1c8adc144'::uuid
   AND upper(btrim(l.name)) = 'CHEVRON'
ON CONFLICT (org_id, lender_id) DO NOTHING;

COMMENT ON TABLE business_fuel_cards IS
  'Business gas and fuel cards shown as business primaries: a staff-set list of bank-book (lenders) rows. Never a card that is not in the bank book.';
COMMENT ON TABLE business_fuel_card_accounts IS
  'Which tracked hand-entered card is a gas card from business_fuel_cards, and for which business. The card is an ordinary card with a due day, so it gets the same phone alerts.';
