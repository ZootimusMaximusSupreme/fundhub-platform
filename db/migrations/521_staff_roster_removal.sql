-- An owner can remove a former teammate from the live roster without erasing
-- call outcomes, commission history, or other records tied to their staff id.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;
