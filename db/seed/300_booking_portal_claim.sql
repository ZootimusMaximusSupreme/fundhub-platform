-- A booked client opens a lasting portal entry page. The sign-in email it
-- requests is short-lived, but this first-party entry link never goes stale.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'SMS-S04-01-CONFIRM', 'sms', NULL,
  $copy$You're booked, {{contact.first_name}}. {{appointment.start_time}} with a Fundhub funding advisor, about 20 minutes. Set up your Fundhub portal account and confirm your call here: {{portal_claim.url}}. Need to move it? {{custom_values.booking_link}} Reply STOP to opt out.$copy$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

UPDATE message_templates
   SET body = replace(
         replace(body,
           '<strong>2. Confirm your call.</strong> Sign in and press Confirm my call. If you use Android or a computer, you can open your account in the <a href="{{web_portal.url}}" style="color:#1D4ED8;">Fundhub web portal</a>.',
           '<strong>2. Open your account.</strong> Use the lasting link below to set up your portal and confirm your call. It works on iPhone, Android, or a computer.'),
         'Confirm my call</a>', 'Set up my portal and confirm my call</a>'),
       updated_at = now()
 WHERE template_key = 'EMAIL-S04-01-CONFIRM'
   AND channel = 'email';
