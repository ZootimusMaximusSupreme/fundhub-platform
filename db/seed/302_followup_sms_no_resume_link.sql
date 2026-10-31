-- 302_followup_sms_no_resume_link.sql
--
-- A seed, not a migration, for the same reason as 301: it must run after the seeds
-- that write these template rows on a new database.
--
-- WHY (independent review, 2026-10-31, P1). The come-back link
-- ({{survey_resume_link}}, src/survey/resume-link.mjs) is a bearer link: whoever has
-- it opens the person's saved answers and contact details at
-- /api/public/survey-resume. The public /apply form takes an existing lead's email
-- with a different phone, and that phone goes on the record. So a text can reach
-- someone who is not the lead. The email address is the lead's identity (clients
-- are matched on it), so an email reaches the owner.
--
-- So the link goes in email only. A text never carries it: the texts below point to
-- the email instead, sendTemplated drops the tag from every text
-- (src/workflows/messaging.mjs), and a test fails if any text template names it
-- (src/survey/resume-link-sms.pg.test.mjs).
--
-- EVERY ROW HERE WORKS WITH THE CODE BEFORE AND AFTER THIS CHANGE. On 2026-10-31
-- seed 301 reached the live database and the ship was stopped before the code
-- deployed: the live code never fills {{survey_resume_link}}, so the welcome text
-- would have ended in a blank link. Part 1 is the bridge applied to the live
-- database by hand that day (same words); here it runs on any database that still
-- has 301's welcome, and changes nothing where the bridge already ran.
--   1. SMS-S00-WELCOME, EMAIL-S00-WELCOME: no tag. The email button opens /apply.
--   2. SMS-S02-RESUME-1..3: the link sentence points to the email of the same touch,
--      which goes out at the same moment and carries the link. Only rows that still
--      hold 301's words are changed. The rest of each text is 301's, word for word.
-- The come-back emails (EMAIL-S02-RESUME-1..3) keep the link.

-- 1. The welcome text and email.
UPDATE message_templates
   SET body = replace(body,
         'Get pulled away? This link saves your spot: {{survey_resume_link}}',
         'Get pulled away? The link in my email takes you back to your questions.'),
       updated_at = now()
 WHERE template_key = 'SMS-S00-WELCOME'
   AND body LIKE '%This link saves your spot: {{survey_resume_link}}%';

UPDATE message_templates
   SET body = replace(replace(body,
         'This button opens your questions right where you left off.',
         'This button takes you back to your questions.'),
         '{{survey_resume_link}}', 'https://apply.fundhub.ai/apply'),
       updated_at = now()
 WHERE template_key = 'EMAIL-S00-WELCOME'
   AND body LIKE '%{{survey_resume_link}}%';

-- 2. The come-back texts.
UPDATE message_templates AS t
   SET body              = v.body,
       compliance_passed = true,
       approved_by       = NULL,
       approved_at       = NULL,
       approved_body_sha = NULL,
       updated_at        = now()
  FROM (VALUES
  ('SMS-S02-RESUME-1',
$c$Hey {{contact.first_name}}, looks like you got pulled away. No worries. You stopped at {{survey_stopped_at}}. {{survey_taps_left}} and you can grab a time. The link in my email takes you right back there.
- Chris, Fundhub
Reply STOP to opt out.$c$),

  ('SMS-S02-RESUME-2',
$c$Morning {{contact.first_name}}. You're {{survey_taps_left}} from booking your Fundhub call. Stuck on the credit score one? A best guess is fine. We check the real one together when we talk. The link in today's email picks up where you stopped.
- Chris
Reply STOP to opt out.$c$),

  ('SMS-S02-RESUME-3',
$c$Hey {{contact.first_name}}, this is my last nudge about your Fundhub questions. If the timing's off, all good. The link in my email still drops you right back where you were.
- Chris
Reply STOP to opt out.$c$)
) AS v(template_key, body)
 WHERE t.template_key = v.template_key
   AND t.body LIKE '%{{survey_resume_link}}%';
