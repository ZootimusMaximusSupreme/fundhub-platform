-- 035_client_agreement_consent_clauses.sql
--
-- The fresh-database half of db/migrations/492_client_agreement_consent_clauses.sql.
-- The runner applies migrations and THEN seeds. On a fresh database the Funding
-- Agreement (seed 007) and the Capital Academy agreement (seed 021) are created
-- by seeds, after 492 has already run and matched nothing, so the same
-- statements run here once more. On an existing database 492 already added the
-- section and these statements skip (they only touch a wording that lacks the
-- recording sentence). Owner decision 2026-10-20: the signed contract is the
-- consent. Words: src/contracts/consent-clauses.mjs.

UPDATE contract_templates
   SET body = replace(body, '

SIGNATURES
', '

CALLS, AI AND YOUR STORY

Recorded calls. Calls between you and Fundhub may be recorded and kept. Fundhub uses the recordings to keep an accurate record of what was said, to deliver and check its service, and to train its team.

Artificial intelligence. Fundhub uses artificial intelligence (AI) in its service. AI tools analyze your credit file, your funding file and the documents you give us. AI agents work on your file. AI may call you and text you for Fundhub, within your contact preferences.

Your words in our marketing. Fundhub may use your words, your results and your testimonial in its marketing and advertising. That includes what you say on a recorded call or video, your name, your voice and your picture, on its website, on social media and in paid ads.

By signing, you agree to all three: recorded calls, the use of AI by Fundhub, and the use of your words, results and testimonial in Fundhub marketing.

SIGNATURES
'),
       updated_at = now()
 WHERE template_key = 'FUNDING-AGREEMENT'
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
UPDATE contract_templates
   SET body = replace(body, '
Acknowledgement
By signing, you confirm', '
16. Calls, AI and your story
16.1 Recorded calls. Calls between you and Fundhub may be recorded and kept. Fundhub uses the recordings to keep an accurate record of what was said, to deliver and check its service, and to train its team.
16.2 Artificial intelligence. Fundhub uses artificial intelligence (AI) in its service. AI tools analyze your credit file, your funding file and the documents you give us. AI agents work on your file. AI may call you and text you for Fundhub, within your contact preferences.
16.3 Your words in our marketing. Fundhub may use your words, your results and your testimonial in its marketing and advertising. That includes what you say on a recorded call or video, your name, your voice and your picture, on its website, on social media and in paid ads.
16.4 By signing, you agree to all three: recorded calls, the use of AI by Fundhub, and the use of your words, results and testimonial in Fundhub marketing.
Acknowledgement
By signing, you confirm'),
       updated_at = now()
 WHERE template_key = 'FUNDING-MASTERY-AGREEMENT'
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;

-- Safety net: a wording whose anchor line was edited away still gets the clause,
-- at the end of its words, so no client agreement is left without it.
UPDATE contract_templates
   SET body = body || chr(10) || chr(10) || 'CALLS, AI AND YOUR STORY

Recorded calls. Calls between you and Fundhub may be recorded and kept. Fundhub uses the recordings to keep an accurate record of what was said, to deliver and check its service, and to train its team.

Artificial intelligence. Fundhub uses artificial intelligence (AI) in its service. AI tools analyze your credit file, your funding file and the documents you give us. AI agents work on your file. AI may call you and text you for Fundhub, within your contact preferences.

Your words in our marketing. Fundhub may use your words, your results and your testimonial in its marketing and advertising. That includes what you say on a recorded call or video, your name, your voice and your picture, on its website, on social media and in paid ads.

By signing, you agree to all three: recorded calls, the use of AI by Fundhub, and the use of your words, results and testimonial in Fundhub marketing.',
       updated_at = now()
 WHERE template_key IN ('FUNDING-AGREEMENT', 'FUNDING-MASTERY-AGREEMENT')
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
