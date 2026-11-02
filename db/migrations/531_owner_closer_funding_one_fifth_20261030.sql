-- 531_owner_closer_funding_one_fifth_20261030.sql
--
-- OWNER-SET, effective 2026-10-30:
--   closer deposit_collected = one fifth (percent 20)
--   closer has no commission on the amount that funds
--
-- Does not edit 246 or 256. Those files are already applied.
-- One fifth of $30,000 collected is $6,000.00.
-- Supersedes the one-sixth (16.6667%) closer deposit rule from 256.
-- Closes the closer 0.25% of amount funded from 246.
-- The manager rates from 2026-08-20 stay. Downsell and upsell stay at 20% of paid_amount.
-- Clarity's about 15% financing cut is an owner fact in
-- .ai/rules/funding-deal-pay.md. It is not a commission_rules row.

DO $$
DECLARE
  v_start timestamptz := '2026-10-30T00:00:00Z';
  v_org uuid;
  v_product uuid;
BEGIN
  SELECT p.org_id, p.id
    INTO v_org, v_product
    FROM products p
    JOIN orgs o ON o.id = p.org_id AND o.is_default
   WHERE p.code = 'card-stacking-dfy'
   LIMIT 1;

  IF v_org IS NULL OR v_product IS NULL THEN
    RETURN;
  END IF;

  -- Same-day funding-deposit rows that are not one fifth do not stay live.
  UPDATE commission_rules
     SET active = false,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND sale_motion IS NULL
     AND effective_from = v_start
     AND effective_to IS NULL
     AND (calc_method <> 'percent' OR percent IS DISTINCT FROM 20.00);

  -- Close the one-sixth closer deposit rule, and any other still-open closer
  -- funding-deposit rule from before today. Do not touch downsell or upsell.
  UPDATE commission_rules
     SET effective_to = v_start,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'front_end'
     AND amount_basis = 'deposit_collected'
     AND sale_motion IS NULL
     AND active
     AND effective_to IS NULL
     AND effective_from < v_start;

  INSERT INTO commission_rules (
    org_id, name, description, basis, stacking, product_id, role,
    calc_method, percent, amount_basis, effective_from, active, notes
  )
  SELECT v_org, 'Closer — funding deposit', 'Owner-set closer share of a collected funding deposit.',
         'front_end', 'base', v_product, 'closer',
         'percent', 20.00, 'deposit_collected', v_start, true,
         'Owner-set 2026-10-30. One fifth. Supersedes the one-sixth closer deposit rule from 256. No closer commission on the amount funded.'
   WHERE NOT EXISTS (
     SELECT 1 FROM commission_rules
      WHERE org_id = v_org
        AND (product_id IS NULL OR product_id = v_product)
        AND role = 'closer'
        AND basis = 'front_end'
        AND amount_basis = 'deposit_collected'
        AND sale_motion IS NULL
        AND effective_from = v_start
        AND percent = 20.00
   );

  -- No closer commission on money that funds later.
  UPDATE commission_rules
     SET active = false,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'back_end'
     AND active
     AND effective_to IS NULL
     AND effective_from = v_start;

  UPDATE commission_rules
     SET effective_to = v_start,
         updated_at = now()
   WHERE org_id = v_org
     AND role = 'closer'
     AND basis = 'back_end'
     AND active
     AND effective_to IS NULL
     AND effective_from < v_start;
END $$;
