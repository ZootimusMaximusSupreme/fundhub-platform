-- Acknowledge a booked client's YES/CONFIRM reply with the next call time.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'SMS-S04-CONFIRM-ACK', 'sms', NULL,
  'You''re set for {{appointment.start_time}}. We look forward to speaking with you. Reply here if you have questions. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
