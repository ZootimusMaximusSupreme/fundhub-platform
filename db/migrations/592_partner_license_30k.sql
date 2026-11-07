-- 592_partner_license_30k.sql
--
-- The partner licence's joining fee follows the catalogue: $30,000.
--
-- OWNER-SET 2026-11-07. Chris: "white label is 30k". src/config/offers.mjs
-- PARTNER_ENTRY.priceCents moved from 1000000 to 3000000, and the licence words
-- (seeded by 283_partner_license_template.sql) still said "You pay $10,000 to
-- join." src/contracts/partner-license-terms.test.mjs holds the two together:
-- the partner must sign for the number the catalogue charges.
--
-- WHAT CHANGES. Only that sentence, which is the one place the licence names the
-- joining fee's amount. Every other word, the blanks, the signature sentence and
-- the active flag (530 retired this template from new drafts) stay as they are.
--
-- GUARDED AND SAFE TO RUN TWICE. Only PARTNER-LICENSE rows whose body still
-- holds the $10,000 sentence are touched, so a second run, or a copy somebody
-- already rewrote on the Contracts screen, is left alone. Contracts already
-- drafted, sent or signed keep their own frozen rendered_body and body_sha
-- (124_contracts.sql, 125_contract_esign.sql); a template update never
-- reaches them.

UPDATE contract_templates
   SET body = replace(body, 'You pay $10,000 to join.', 'You pay $30,000 to join.'),
       updated_at = now()
 WHERE template_key = 'PARTNER-LICENSE'
   AND strpos(body, 'You pay $10,000 to join.') > 0;
