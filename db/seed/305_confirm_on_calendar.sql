-- 305_confirm_on_calendar.sql
--
-- A seed, not a migration, for the same reason as 301: it must run after the
-- seeds that write these template rows on a new database.
--
-- OWNER RULE (Chris, 2026-10-31): no message asks a lead to reply to confirm.
-- "We don't care if they say yes. We want them to perform an action." Saying
-- CONFIRM in a text and confirming the call are two different things. The one
-- action is accepting the calendar invite in their email: the booking already
-- sends a real invite with the guest and the meeting link
-- (public/funnel/thankyou-sort.js), and the setter script ends with "They accept
-- the calendar invite before you hang up" (docs/sops/weekend-2026-10-24/02-setter.md).
-- No "for compliance" lines either. Rule: .ai/rules/confirm-on-the-calendar.md.
-- src/messaging/no-reply-to-confirm.pg.test.mjs fails if any template asks again.
--
-- Code that reads a reply is unchanged: a reply still stops a chase and still gets
-- answered. Only the asks go.
--
-- 1. Seven texts, rewritten whole and signed Chris (no Josh, owner order
--    2026-10-31). The no-Josh branch (seed 303) leaves these five keys to this file:
--    SMS-S04-01-CONFIRM, SMS-S04-02-REMIND-24H, SMS-S04-03-REMIND-2H,
--    SMS-BS01-01-CONFIRMATION-HUB, SMS-BS01-02-PRECALL-NUDGE; the two AI-SET-03
--    texts are seed 301's words with the YES asks taken out. The two BS-01 texts are
--    on the heartbeat's list of templates nothing sends today
--    (src/pulse/coverage/msg-dead-templates.mjs); their words change anyway.
-- 2. The booking confirmation email: its "we'll text you to confirm" line.
-- 3. Seven older emails that nothing sends (the same dead list): their reply
--    CONFIRM and compliance lines.

-- 1. The texts.
UPDATE message_templates AS t
   SET body              = v.body,
       compliance_passed = true,
       approved_by       = NULL,
       approved_at       = NULL,
       approved_body_sha = NULL,
       updated_at        = now()
  FROM (VALUES
  ('SMS-S04-01-CONFIRM',
$c$Hey {{contact.first_name}}, it's Chris with Fundhub. You're booked for {{appointment.start_time}}. Accept the calendar invite in your email to lock in your time. Can't make it? Move it here: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),
  ('SMS-S04-02-REMIND-24H',
$c$Fundhub reminder, {{contact.first_name}}: your call is tomorrow at {{appointment.start_time}}. If you haven't yet, accept the calendar invite in your email. Need a new time? {{custom_values.booking_link}}
- Chris at Fundhub. Reply STOP to opt out.$c$),
  ('SMS-S04-03-REMIND-2H',
$c$Fundhub reminder, {{contact.first_name}}: your call starts at {{appointment.start_time}}. The meeting link is in your calendar invite. Need a new time? {{custom_values.booking_link}}
- Chris at Fundhub. Reply STOP to opt out.$c$),
  ('SMS-AISET03-MSG1',
$c$Hey {{contact.first_name}}, it's Chris at Fundhub. Tried calling about your strategy call. To lock in your time, accept the calendar invite in your email. Need a new time? {{custom_values.booking_link}}
Reply STOP to opt out.$c$),
  ('SMS-AISET03-MSG3',
$c$Hey {{contact.first_name}}, last one from me today. If you haven't yet, accept the calendar invite in your email so your call is locked in. Time doesn't work anymore? No problem, grab another: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),
  ('SMS-BS01-01-CONFIRMATION-HUB',
$c$Hey {{contact.first_name}}, it's Chris from Fundhub. Your Confirmation Hub is ready. Watch these quick videos before our call so we can move fast: {{custom_values.confirmation_hub_link}} Questions? Just reply here. Reply STOP to opt out.$c$),
  ('SMS-BS01-02-PRECALL-NUDGE',
$c$Hey {{contact.first_name}}, Chris from Fundhub here. Quick pre-call step: watch this Confirmation Hub video so your call is more productive: {{custom_values.confirmation_hub_link}} Reply STOP to opt out.$c$)
) AS v(template_key, body)
 WHERE t.template_key = v.template_key;

-- 2. The booking confirmation email (seed 298's line).
UPDATE message_templates
   SET body = replace(body,
         'We''ll text you to confirm your call and be in touch before it starts. Reply to our text if you have questions.',
         'Accept the calendar invite in your email to lock in your time. We''ll be in touch before it starts.'),
       updated_at = now()
 WHERE template_key = 'EMAIL-S04-01-CONFIRM'
   AND body LIKE '%We''ll text you to confirm your call%';

-- 3. Older emails nothing sends: the reply CONFIRM asks and the compliance lines.
UPDATE message_templates
   SET body = regexp_replace(
                regexp_replace(
                  regexp_replace(body,
                    '(For compliance and scheduling, |\(and for compliance\),? ?| ?\(we track confirmations for compliance\))', '', 'g'),
                  '(hit )?reply( with)?:? “CONFIRM”', 'accept the calendar invite in your email', 'gi'),
                'Reply “RESCHEDULE” to lock in a new time', 'Pick a new time here', 'g'),
       updated_at = now()
 WHERE template_key IN ('C3', 'FC2', 'FC3', 'RC1', 'RC2', 'S-04', 'S-05 No-Show Recovery')
   AND (body ~* 'reply( with)?:? “(CONFIRM|RESCHEDULE)”' OR body ~* 'for compliance');
