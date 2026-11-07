-- 577_apply_gate_overrides.sql — Finance OS apply gate (wave 3, unit L4).
--
-- Board: ops/workflows/finance-os-cfo-build-2026-11-06.txt, OWNER CALLS part 3
-- (Chris, 2026-11-07): "Application limits: the bank book's Bank of America
-- '2 cards in 30 days' is guidance, not a hard block. With a large deposit at
-- Bank of America, 4 cards in 1 day is possible ('just depends'). Show the
-- book's limit; staff decide."
--
-- The apply gate (src/finance/apply-gate.mjs) reads each bank's stated
-- approval limit from the bank book and counts the client's own approvals at
-- that bank. When the count reaches the book's number, the bank reads "Wait"
-- and the client sees "Your Fundhub team decides." This table is where staff
-- write that decision down: "allow more here" (allow_more = true) or "stop
-- allowing more" (allow_more = false).
--
-- WHAT IT NEVER DOES. An override only lifts the bank book's application
-- limit for one bank. It never opens the gate itself: UnderwriteIQ must still
-- say fundable, inquiries must still be clean, and the bank account must still
-- be seasoned. It moves no money and applies for nothing.
--
-- APPEND ONLY. The newest row per client + bank is the decision. Nothing
-- changes or removes a row; staff "stop allowing more" by adding a new row.

CREATE TABLE IF NOT EXISTS public.apply_gate_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_key    text NOT NULL
              CONSTRAINT apply_gate_overrides_bank_key_ck
              CHECK (bank_key = lower(btrim(bank_key)) AND char_length(bank_key) BETWEEN 1 AND 120),
  bank_name   text NOT NULL
              CONSTRAINT apply_gate_overrides_bank_name_ck
              CHECK (char_length(btrim(bank_name)) BETWEEN 1 AND 120),
  allow_more  boolean NOT NULL,
  note        text
              CONSTRAINT apply_gate_overrides_note_ck
              CHECK (note IS NULL OR char_length(note) <= 500),
  set_by      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apply_gate_overrides_client_bank_idx
  ON public.apply_gate_overrides (org_id, client_id, bank_key, created_at DESC);

COMMENT ON TABLE public.apply_gate_overrides IS
  'Finance OS apply gate: staff decisions that lift a bank book application limit for one client at one bank. Append only; the newest row per client + bank wins. Never opens the gate itself.';
COMMENT ON COLUMN public.apply_gate_overrides.allow_more IS
  'true = staff allow more applications at this bank than the bank book states; false = back to the book''s limit.';
COMMENT ON COLUMN public.apply_gate_overrides.set_by IS
  'The staff member who wrote the decision (staff.id), when the session carried one.';

-- Row-level security — the same shape 461 gives the bank tracker rows. Every
-- query in the app carries org_id and client_id.
ALTER TABLE public.apply_gate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apply_gate_overrides FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'apply_gate_overrides'
       AND policyname = 'apply_gate_overrides_app_all'
  ) THEN
    CREATE POLICY apply_gate_overrides_app_all
      ON public.apply_gate_overrides
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Append only: the app may read and add a decision, never change or remove one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT ON public.apply_gate_overrides TO fundhub_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON public.apply_gate_overrides FROM fundhub_app;
  END IF;
END $$;
