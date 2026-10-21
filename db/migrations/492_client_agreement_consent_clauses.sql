-- 492_client_agreement_consent_clauses.sql
--
-- Owner decision 2026-10-20 (ops/workflows/set-a-fix-2026-10-20.md, items 29/30):
-- no separate consent step. The signed contract IS the consent. Every client
-- agreement must say that (a) calls may be recorded, (b) Fundhub uses AI (AI
-- analysis of the file, AI agents, AI calls and texts), and (c) Fundhub may use
-- the client's words, results and testimonials in its marketing.
--
-- What this file does: adds ONE new section with those three clauses to each of
-- the six client agreements the closer's deck can send. The capitals-headed
-- agreements get "CALLS, AI AND YOUR STORY" just above SIGNATURES. The two
-- executed documents (Capital Blueprint, Capital Academy) get a numbered
-- section 16 just above their Acknowledgement. No other word changes.
--
-- What it never does: touch a contract already sent, viewed or signed. Those
-- hold their own frozen copy (contracts.rendered_body), fingerprinted at send;
-- this file updates only contract_templates. Staff, partner and soft-pull
-- wordings are not client service agreements and are left alone.
--
-- Idempotent: each statement skips a wording that already carries the
-- recording sentence. Source of the words: src/contracts/consent-clauses.mjs;
-- src/contracts/consent-clauses.test.mjs fails if this file drifts from it.
-- db/seed/035_client_agreement_consent_clauses.sql repeats the two statements
-- whose rows a fresh database only gets from the seeds (which run after
-- migrations).

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
 WHERE template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
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
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
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
 WHERE template_key = 'REPAIR-AND-FUNDING-AGREEMENT'
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
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
 WHERE template_key = 'REPAIR-TRIAL-AGREEMENT'
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
 WHERE template_key IN ('CAPITAL-BLUEPRINT-AGREEMENT', 'CREDIT-REPAIR-AGREEMENT', 'FUNDING-AGREEMENT', 'FUNDING-MASTERY-AGREEMENT', 'REPAIR-AND-FUNDING-AGREEMENT', 'REPAIR-TRIAL-AGREEMENT')
   AND strpos(body, 'Calls between you and Fundhub may be recorded and kept.') = 0;
