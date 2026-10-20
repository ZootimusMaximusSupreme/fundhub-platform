-- Owner-set 2026-10-20: Blueprint has no named human advisor. The AI coaches do
-- the touch-base and the Fundhub team handles questions and exceptions.
-- Changes only the two advisor sentences in 1.1 and 6.1 of the template for
-- future sends. Existing sent/signed contracts are untouched.
UPDATE contract_templates
   SET body = replace(replace(body,
         'A separately assigned human advisor answers program questions and handles exceptions and funding preparation.',
         'The Fundhub team answers program questions and handles exceptions and funding preparation.'),
         'Your assigned human advisor handles program questions, exceptions and funding preparation.',
         'The Fundhub team handles program questions, exceptions and funding preparation.'),
       updated_at = now()
 WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT';
