-- 471_file_protection_alerts.sql — the four alerts that protect a client's file
-- and actually go out: pay before the statement closes, promo ending, cash
-- cushion, new credit.
--
-- Capital Blueprint 48-hour launch, unit B2 (ops/workflows/blueprint-launch-2026-10-06.md,
-- items 11-14). Offer (owner-set 2026-09-29): docs/finance/capital-blueprint-next-2026-09-29.md.
-- Contract for the screen: docs/finance/file-protection-alerts.md.
--
-- Four things in one file, all additive. Re-running it is a no-op.
--
--   1. account_statement_cycles gains the promo columns.
--   2. file_protection_settings — one row per client: which alert kinds are on.
--   3. file_protection_alerts   — one row per alert that went out. This is what
--      makes every alert fire once, and what the screen lists.
--   4. Four SMS templates, seeded the way 433 and 444 seed theirs.
--
--
-- *** 1. WHERE A PROMO LIVES: account_statement_cycles. NO NEW TABLE. ***
--
-- A promo needs an end date and a rate, per card. The card is a bank_accounts
-- row (account_type 'credit'), and the billing terms of that card already live in
-- one row per account: account_statement_cycles (097) — close day, due day, the
-- minimum, the regular APR. 097's own header says why the rate sits there: "a rate
-- belongs with the billing terms it is charged under". A promo rate and its end
-- date are billing terms. Same table, four nullable columns.
--
-- REJECTED:
--   client_cards (076) — the old "no promo columns" skip reason in
--     src/workflows/blueprint-finance-os-alerts.mjs named this table. That was the
--     wrong table. 076's header: "a tradeline is a card the client HAS, a
--     client_card is a card the client PAYS US WITH" — a token of the payment
--     instrument Fundhub charges. It has nothing to do with the cards a client
--     owes on.
--   bank_accounts — it is what the bank says, refreshed from the bank. A promo end
--     date is not something a bank sends us (Plaid reads no such field), so it is
--     typed in by the client or staff and does not belong beside provider data.
--   a card_promos table — would hold the same account id and the same kind of
--     fact, and every reader would need a second join. It would allow two promos
--     on one card (a purchase promo and a balance-transfer promo). The offer says
--     one promo end per card, so that is what is stored. If a card ever needs two,
--     that is a new table and a new migration, not a reason to build it now.
--
-- THE PLAID REFRESH CANNOT WIPE IT. saveStatementCycle (src/banking/accounts.mjs)
-- upserts with ON CONFLICT (bank_account_id) DO UPDATE and sets only the columns
-- it names. It never names these four, so the daily liabilities read leaves a
-- typed-in promo exactly where it was.
--
-- The four columns live or die together (account_statement_cycles_promo_ck): no
-- end date means no rate, no source and no stamp; an end date always says who set
-- it and when. The rate is a FRACTION 0..1, like `apr` next to it (0 = a 0% promo).
--
--
-- *** 3. WHAT A ROW IN file_protection_alerts MEANS ***
--
-- A row is written only when something was delivered: a text was queued (a
-- message id) or, for new credit on a Blueprint file, a CSM task was opened.
-- A text that could not be queued (the client opted out, the template is not
-- approved) writes nothing, so the next daily pass tries again while the window is
-- still open.
--
-- dedupe_key is what makes each alert fire once. It is built only from facts that
-- do not move, so a retried job, a second scheduler or tomorrow's pass all find
-- the key already there:
--   payment_timing  fpa:pay:<account>:<statement close date>        one per card per cycle
--   promo_end       fpa:promo:<account>:<promo end date>:<60|30|7>  one per card per threshold
--   cash_reserve    fpa:cash:<client>:<personal|business>:<n>       n-th drop of that cash
--   new_credit      fpa:new:acct:<account>  or  fpa:new:pull:<pull id>
-- The same key is sendTemplated's eventId, so the queued text is deduped a second
-- way by messages.provider_ref (CLAUDE.md §12).
--
-- CASH CUSHION RE-ARMS. A cash_reserve row stays open (cleared_at NULL) while the
-- cash is still below six months of minimums. The daily pass sets cleared_at the
-- day the cash recovers. The partial unique index below allows ONE open row per
-- client per cash kind, so a second drop can only alert after the first recovered.
--
-- The money-handling rules of the screens apply here too: cash is never added
-- across personal and business (cash_kind is one or the other, never a total).
--
-- message_id is a soft link — no foreign key — so a message that is ever erased
-- cannot block the cascade or break the text-has-a-message check. bank_account_id
-- and task_id are real links that SET NULL, so an alert outlives a closed account.


-- ---------------------------------------------------------------------------
-- 1. promo tracking
-- ---------------------------------------------------------------------------
ALTER TABLE account_statement_cycles
  ADD COLUMN IF NOT EXISTS promo_ends_on date,
  ADD COLUMN IF NOT EXISTS promo_apr     numeric(6,5),
  ADD COLUMN IF NOT EXISTS promo_source  text,
  ADD COLUMN IF NOT EXISTS promo_set_at  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_statement_cycles_promo_ck') THEN
    ALTER TABLE account_statement_cycles
      ADD CONSTRAINT account_statement_cycles_promo_ck CHECK (
        (promo_ends_on IS NULL AND promo_apr IS NULL AND promo_source IS NULL AND promo_set_at IS NULL)
        OR (promo_ends_on IS NOT NULL
            AND promo_source IS NOT NULL AND promo_source IN ('client', 'staff')
            AND promo_set_at IS NOT NULL
            AND (promo_apr IS NULL OR (promo_apr >= 0 AND promo_apr <= 1)))
      );
  END IF;
END $$;

COMMENT ON COLUMN account_statement_cycles.promo_ends_on IS
  'Last day of the card''s promo rate. Typed in by the client or staff (Plaid sends no such date). NULL = no promo on file.';
COMMENT ON COLUMN account_statement_cycles.promo_apr IS
  'The promo rate as a fraction 0..1 (0 = a 0% promo). NULL = rate not given.';


-- ---------------------------------------------------------------------------
-- 2. which alert kinds are on, per client
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_protection_settings (
  client_id       uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES orgs(id),
  -- Each kind is its own column so the database, not the screen, says what exists.
  payment_timing  boolean NOT NULL DEFAULT true,
  promo_end       boolean NOT NULL DEFAULT true,
  cash_reserve    boolean NOT NULL DEFAULT true,
  new_credit      boolean NOT NULL DEFAULT true,
  updated_by_kind text NOT NULL DEFAULT 'client' CHECK (updated_by_kind IN ('client', 'staff')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- 3. the alerts that went out
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_protection_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind            text NOT NULL
    CHECK (kind IN ('payment_timing', 'promo_end', 'cash_reserve', 'new_credit')),
  -- The card (or the new account). NULL for a cash alert or a credit-pull alert.
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  subject_label   text,
  -- promo_end: 60 / 30 / 7 days. payment_timing: days before the close the
  -- reminder was set for. cash_reserve: months of minimums (6). Else NULL.
  threshold       integer CHECK (threshold IS NULL OR threshold > 0),
  -- The date the alert is about: the statement close, or the promo end.
  due_on          date,
  -- cash_reserve only: whose cash. One kind or the other — never a total.
  cash_kind       text CHECK (cash_kind IS NULL OR cash_kind IN ('personal', 'business')),
  -- The sentence the client was told (the text minus the opt-out line).
  body            text NOT NULL CHECK (length(btrim(body)) > 0),
  -- 'text'      a text was queued; message_id is its messages row.
  -- 'task_only' no text could go (opted out), but a CSM task was opened.
  delivery        text NOT NULL CHECK (delivery IN ('text', 'task_only')),
  message_id      uuid,
  task_id         uuid REFERENCES tasks(id) ON DELETE SET NULL,
  -- When it was queued. The provider's own send time is on the messages row.
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- cash_reserve only: the day the cash recovered and the alert re-armed.
  cleared_at      timestamptz,
  dedupe_key      text NOT NULL CHECK (length(btrim(dedupe_key)) > 0),
  -- The numbers the sentence was built from, frozen at the moment it went out.
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT file_protection_alerts_text_has_message_ck
    CHECK ((delivery = 'text') = (message_id IS NOT NULL)),
  CONSTRAINT file_protection_alerts_promo_ck
    CHECK (kind <> 'promo_end'
           OR (threshold IS NOT NULL AND threshold IN (60, 30, 7) AND due_on IS NOT NULL)),
  CONSTRAINT file_protection_alerts_timing_ck
    CHECK (kind <> 'payment_timing' OR due_on IS NOT NULL),
  CONSTRAINT file_protection_alerts_cash_ck
    CHECK ((kind = 'cash_reserve') = (cash_kind IS NOT NULL)),
  CONSTRAINT file_protection_alerts_cleared_ck
    CHECK (cleared_at IS NULL OR kind = 'cash_reserve')
);

-- THE ONCE-ONLY GUARD. A second insert of the same alert writes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS file_protection_alerts_dedupe_uniq
  ON file_protection_alerts (org_id, dedupe_key);

-- ONE OPEN CASH ALERT PER CLIENT PER CASH KIND. A new one needs the last to have
-- recovered (cleared_at set) first.
CREATE UNIQUE INDEX IF NOT EXISTS file_protection_alerts_one_open_reserve
  ON file_protection_alerts (client_id, cash_kind)
  WHERE kind = 'cash_reserve' AND cleared_at IS NULL;

-- The screen's list: newest first for one client.
CREATE INDEX IF NOT EXISTS file_protection_alerts_client_idx
  ON file_protection_alerts (org_id, client_id, sent_at DESC);


-- Row-level security — the same shape money_agent_tasks carries (464): ENABLE +
-- FORCE + one permissive policy. Isolation lives in the app layer, which binds
-- org_id and client_id into every read and write.
ALTER TABLE public.file_protection_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_protection_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.file_protection_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_protection_alerts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'file_protection_settings' AND policyname = 'file_protection_settings_app_all') THEN
    CREATE POLICY file_protection_settings_app_all ON public.file_protection_settings USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'file_protection_alerts' AND policyname = 'file_protection_alerts_app_all') THEN
    CREATE POLICY file_protection_alerts_app_all ON public.file_protection_alerts USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.file_protection_settings TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.file_protection_alerts TO fundhub_app;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 4. the four texts
-- ---------------------------------------------------------------------------
-- Used by src/finance/file-alerts/run.mjs through sendTemplated, which only
-- queues; the dispatcher sends, behind dry-run, quiet hours and the opt-out read.
-- Finance OS and the Capital Blueprint tell and remind. They never move money.
--
-- The {{alert.*}} tags are filled by that job, not by the client record
-- (src/finance/file-alerts/*.mjs — each planner returns the same sentence as
-- `body`, and a test renders these templates against it so the two cannot drift):
--   pay before close  alert.card    "Business Amex ending 4404"
--                     alert.when    "before Oct 15", or "today (Oct 15)"
--                     alert.detail  " Balance now $5,400.00 (22% of your limit). Pay about $2,900 to get under 10%."
--   promo ends        alert.card    as above
--                     alert.date    "Dec 6"
--                     alert.days    "in 60 days"
--                     alert.detail  " You still owe $3,000.00. Pay about $1,500 a month for the next 2 months to clear it in time."
--   cash cushion      alert.cash    "personal" or "business"
--                     alert.cash_amount, alert.need  "$4,210.55", "$5,700.00"
--                     alert.months  "6"
--   new credit        alert.what    "a new card showed up on your linked accounts: Chase Freedom ending 4321"
--
-- Owner-set naming (2026-10-06): never "round two" — it is "the next funding sequence".
--
-- DO NOTHING on conflict: a company that already edited one of these keys in the
-- template editor keeps its own copy.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, t.template_key, 'sms', NULL::text, t.body, true
  FROM orgs o
 CROSS JOIN (VALUES
   ('SMS-FILE-PROTECT-PAY-BEFORE-CLOSE',
    $c$Fundhub reminder: pay your {{alert.card}} down {{alert.when}}. That is the day it reports to the bureaus.{{alert.detail}} Reply STOP to opt out.$c$),
   ('SMS-FILE-PROTECT-PROMO-END',
    $c$Fundhub reminder: the promo rate on your {{alert.card}} ends {{alert.date}} ({{alert.days}}).{{alert.detail}} Reply STOP to opt out.$c$),
   ('SMS-FILE-PROTECT-CASH-RESERVE',
    $c$Fundhub alert: your {{alert.cash}} cash is {{alert.cash_amount}}. {{alert.months}} months of your {{alert.cash}} minimum payments is {{alert.need}}. A missed payment can hurt your file before your next funding sequence. Reply STOP to opt out.$c$),
   ('SMS-FILE-PROTECT-NEW-CREDIT',
    $c$Fundhub alert: {{alert.what}}. New credit can push back your next funding sequence. If this is not yours, reply and tell us. Reply STOP to opt out.$c$)
 ) AS t(template_key, body)
ON CONFLICT (org_id, template_key) DO NOTHING;
