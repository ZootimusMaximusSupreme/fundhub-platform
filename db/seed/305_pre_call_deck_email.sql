-- BS-01's draft pre-call slideshow lesson. One template, with the title and
-- route selected from the saved survey or setter correction at each send.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT id, 'EMAIL-BS-DECK-LESSON', 'email', '{{deck_title}}',
  $c$Hi {{contact.first_name}},

Before your Fundhub call, take a look at this short lesson: {{deck_title}}

{{deck_url}}

We will use your own file on the call.

Chris at Fundhub

Unsubscribe: {{unsubscribe}}$c$, false
FROM orgs
ON CONFLICT (org_id, template_key) DO UPDATE SET
  channel = EXCLUDED.channel,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT id, 'SMS-BS-DECK', 'sms', NULL,
  $c$A short Fundhub lesson before your call: {{deck_title}} {{deck_url}}$c$, false
FROM orgs
ON CONFLICT (org_id, template_key) DO UPDATE SET
  channel = EXCLUDED.channel,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
