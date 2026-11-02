-- Keep the historical wording and signed copies, but remove these two retired
-- programs from the choices for new agreement drafts.
UPDATE contract_templates
   SET active = false, updated_at = now()
 WHERE template_key IN ('FUNDING-MASTERY-AGREEMENT', 'PARTNER-LICENSE')
   AND active = true;
