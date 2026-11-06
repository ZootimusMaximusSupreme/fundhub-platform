BEGIN;

-- Historical inline checkouts retain their original validation. New configured
-- prices freeze their mode with the plan ID before any provider POST, so a
-- mutable remote title cannot change which fixed-price checks apply.
ALTER TABLE public.payment_links ADD COLUMN whop_existing_plan boolean NOT NULL DEFAULT false
  CHECK (NOT whop_existing_plan OR (
    provider IS NOT DISTINCT FROM 'whop' AND whop_metadata_version = 2 AND whop_plan_id IS NOT NULL
  ));

CREATE TRIGGER whop_link_plan_mode_immutable BEFORE UPDATE OF whop_existing_plan
ON public.payment_links FOR EACH ROW
WHEN (OLD.whop_existing_plan IS DISTINCT FROM NEW.whop_existing_plan)
EXECUTE FUNCTION public.whop_checkout_metadata_immutable();

COMMIT;
