-- Booked-call lessons use one approved template per channel. The deck URL and
-- short lesson summary come from the lane-selected, fixed slug in BS-01.
-- Preserve any existing owner-edited template; a missing or unapproved row
-- keeps the legacy pre-call email path in place.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'EMAIL-BS-DECK-LESSON', 'email', '{{deck_title}}',
$body$Hey {{contact.first_name}},

{{deck_intro}}

Open the short, clickable lesson: {{deck_url}}

On our call, we will apply it to your own file.

Fundhub

{{unsubscribe}}$body$, true
FROM orgs o
ON CONFLICT (org_id, template_key) DO NOTHING;

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'SMS-BS-DECK', 'sms', NULL,
$body$Fundhub: {{deck_title}}. View: {{deck_url}} Reply STOP to opt out.$body$, true
FROM orgs o
ON CONFLICT (org_id, template_key) DO NOTHING;
