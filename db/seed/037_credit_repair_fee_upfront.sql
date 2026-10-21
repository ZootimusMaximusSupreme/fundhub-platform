-- 037_credit_repair_fee_upfront.sql (same change as migration 496, for a brand-new database)
--
-- Owner decision 2026-10-20 (Chris): the $1,000 Credit Repair Agreement is an
-- upfront agreement. The fee is charged when the client signs, the same way the
-- sales call collects it. Migration 493 carried Codex's draft line that the fee
-- "is not charged or received until all services ... have been fully performed",
-- which contradicted WHAT YOU PAY and the sales call. This swaps that one
-- sentence. The refund trigger (round one not sent the day they sign, or an
-- agreed round not done on schedule), the 3-business-day cancel and every other
-- word stay. Only an active wording that still holds the old sentence changes;
-- contracts already sent or signed are separate rows and are never touched.
-- Migration 496 makes the same change on a database that already has the wording.

UPDATE contract_templates
   SET body = replace(body,
         'The fee in WHAT YOU PAY below is not charged or received until all services specified in this agreement have been fully performed. If Fundhub does not send round one on the day you sign, or does not carry out an agreed round on the schedule in section 2, you may request return of any fee paid.',
         'The fee in WHAT YOU PAY below is charged when you sign this agreement. If Fundhub does not send round one on the day you sign, or does not carry out an agreed round on the schedule in section 2, you may request return of the fee you paid.'),
       updated_at = now()
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, 'is not charged or received until all services specified in this agreement have been fully performed') > 0;
