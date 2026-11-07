-- 584_whop_memberships.sql — the Whop plans a client pays Fundhub, read from Whop.
--
-- Finance OS unit W (board ops/workflows/finance-os-cfo-build-2026-11-06.txt, owner ask
-- 2026-11-07): Chris asked to track "all the other ones that I offer over at" Whop like the
-- Clarity plans on Payments, with a phone alert before each payment.
--
-- WHAT THIS HOLDS. One row per Whop membership (mem_...) on Fundhub's own Whop account
-- (WHOP_ACCOUNT_ID) that is tied to one client. Written only by syncWhopMemberships in
-- src/finance/whop-plans.mjs, a daily read of the Whop API (GET only, no checkout, no
-- charge, no change at Whop). Each column is a fact Whop states on the membership, read
-- under Api-Version-Date 2026-11-06 (src/messaging/providers/whop-memberships.mjs).
--
-- NO EMAIL, NO NAME, NO PHONE, NO CARD IS STORED. The buyer's email is read in memory to
-- find the client and then dropped.
--
-- HOW A MEMBERSHIP IS TIED TO A CLIENT (matched_by). Never guessed:
--   fundhub_checkout  the membership carries the metadata Fundhub's own checkout wrote
--                     (fh_org_id + fh_client_id; Whop copies a checkout's metadata to the
--                     membership it creates) and that client is in that org.
--   email             the Whop member's email equals the email of exactly ONE real client
--                     of Fundhub's default org (the org that owns this Whop account).
-- A membership that matches nobody, or two clients, is not stored. A row whose match is
-- later lost keeps its history and gets unlinked_at; every read skips it.
--
-- MONEY IS INTEGER CENTS. NULL means unknown — a price Whop did not send, or one that is
-- not in US dollars — never 0.
--
-- DATES. period_end_on is current_period_end as an Arizona calendar day (America/Phoenix,
-- UTC-7 all year: the clock every Fundhub schedule runs on). It is the day Whop next
-- charges a renewing plan, or the day a canceled one ends. Which of the two it is comes
-- from status and cancel_at_period_end, read with it.

CREATE TABLE IF NOT EXISTS public.whop_memberships (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES orgs(id),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  whop_membership_id      text NOT NULL CHECK (whop_membership_id ~ '^mem_[A-Za-z0-9]{1,64}$'),
  whop_account_id         text CHECK (whop_account_id IS NULL OR whop_account_id ~ '^biz_[A-Za-z0-9]{1,64}$'),
  whop_product_id         text CHECK (whop_product_id IS NULL OR whop_product_id ~ '^prod_[A-Za-z0-9]{1,64}$'),
  whop_variant_id         text CHECK (whop_variant_id IS NULL OR whop_variant_id ~ '^plan_[A-Za-z0-9]{1,64}$'),
  -- What the client bought, as Whop names the product.
  product_title           text CHECK (product_title IS NULL OR length(btrim(product_title)) BETWEEN 1 AND 200),

  status                  text NOT NULL
    CHECK (status IN ('trialing', 'active', 'past_due', 'completed', 'canceled', 'expired', 'unresolved')),
  -- What the next renewal charges, after any promo code that still applies. NULL for a
  -- plan that does not renew, or a price that is not in US dollars.
  renewal_cents           bigint CHECK (renewal_cents IS NULL OR renewal_cents >= 0),
  renewal_currency        text CHECK (renewal_currency IS NULL OR renewal_currency ~ '^[a-z]{3}$'),
  billing_period_days     integer CHECK (billing_period_days IS NULL OR billing_period_days BETWEEN 1 AND 3660),
  -- Split pay: how many payments Whop needs, and how many it has counted so far.
  split_pay_required      integer CHECK (split_pay_required IS NULL OR split_pay_required BETWEEN 1 AND 1000),
  split_pay_paid          integer CHECK (split_pay_paid IS NULL OR split_pay_paid BETWEEN 0 AND 1000),
  collection_method       text CHECK (collection_method IS NULL OR collection_method IN ('charge_automatically', 'send_invoice')),
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  current_period_end      timestamptz,
  period_end_on           date,
  canceled_at             timestamptz,
  expires_at              timestamptz,

  matched_by              text NOT NULL CHECK (matched_by IN ('fundhub_checkout', 'email')),
  whop_created_at         timestamptz,
  whop_updated_at         timestamptz,
  -- When this row last agreed with Whop.
  synced_at               timestamptz NOT NULL DEFAULT now(),
  unlinked_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whop_memberships_org_membership_uniq UNIQUE (org_id, whop_membership_id),
  CONSTRAINT whop_memberships_split_ck
    CHECK (split_pay_paid IS NULL OR split_pay_required IS NULL OR split_pay_paid <= split_pay_required)
);

CREATE INDEX IF NOT EXISTS whop_memberships_client_idx
  ON public.whop_memberships (org_id, client_id)
  WHERE unlinked_at IS NULL;
-- The daily phone-alert pass and its check read the plans that charge soon.
CREATE INDEX IF NOT EXISTS whop_memberships_due_idx
  ON public.whop_memberships (org_id, period_end_on)
  WHERE unlinked_at IS NULL AND status IN ('trialing', 'active', 'past_due');

ALTER TABLE public.whop_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whop_memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whop_memberships FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE ALL ON public.whop_memberships FROM fundhub_app;
    GRANT SELECT, INSERT ON public.whop_memberships TO fundhub_app;
    GRANT UPDATE (client_id, whop_account_id, whop_product_id, whop_variant_id, product_title, status,
                  renewal_cents, renewal_currency, billing_period_days, split_pay_required, split_pay_paid,
                  collection_method, cancel_at_period_end, current_period_end, period_end_on, canceled_at,
                  expires_at, matched_by, whop_created_at, whop_updated_at, synced_at, unlinked_at, updated_at)
      ON public.whop_memberships TO fundhub_app;
    -- Tenant scope is in every query (org_id + client_id), as on clarity_payments (443).
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'whop_memberships' AND policyname = 'whop_memberships_app') THEN
      CREATE POLICY whop_memberships_app ON public.whop_memberships TO fundhub_app
        USING (true) WITH CHECK (true);
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.whop_memberships IS
  'Whop plans a client pays Fundhub, one row per Whop membership tied to one client (checkout metadata or one exact email). Facts from the Whop API only; no email, name, phone or card. Unit W, 2026-11-07.';
