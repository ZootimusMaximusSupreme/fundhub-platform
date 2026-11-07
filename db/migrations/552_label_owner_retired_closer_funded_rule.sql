-- Record the owner retirement already applied by migration 531. This changes
-- only the explanatory note; no rate, effective date, ledger, or payout changes.
UPDATE public.commission_rules AS r
   SET notes = r.notes || ' Owner-retired effective 2026-10-30 by migration 531; no closer commission on amount funded.',
       updated_at = now()
 WHERE r.id = '8c3a740b-a594-4705-aeee-8669d5fa258d'::uuid
   AND r.org_id = (SELECT id FROM public.orgs WHERE is_default ORDER BY created_at LIMIT 1)
   AND r.name = 'Closer — funded amount'
   AND r.role = 'closer'
   AND r.basis = 'back_end'
   AND r.amount_basis = 'amount_funded'
   AND r.effective_from = '2026-08-20T00:00:00Z'::timestamptz
   AND r.effective_to = '2026-10-30T00:00:00Z'::timestamptz
   AND r.active
   AND r.notes = 'Owner-set 2026-08-20.';
