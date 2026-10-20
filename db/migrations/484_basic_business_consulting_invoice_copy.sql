-- Apply the owner-set buyer-facing name to already-seeded invoice notices.
-- Keep the Commas product title separate: its approved safe-copy name is
-- "Consulting Services Completion". Only replace known legacy copy here so
-- edits made to other parts of a template are retained.

UPDATE message_templates
   SET subject = replace(
         subject,
         'Your invoice from {{invoice.company}} — {{invoice.amount}}',
         'Your {{invoice.kind}} invoice from {{invoice.company}} — {{invoice.amount}}'
       ),
       updated_at = now()
 WHERE template_key = 'INVOICE-SENT-EMAIL'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND strpos(subject, 'Your invoice from {{invoice.company}} — {{invoice.amount}}') > 0;

UPDATE message_templates
   SET body = replace(
         replace(body,
           'Round {{custom_fields.funding_round_number}} is complete and invoice',
           'Your basic business consulting fee invoice'),
         'is in your portal:',
         'is ready in your portal:'),
       updated_at = now()
 WHERE template_key = 'SMS-AR-01-FIRST-NOTICE'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND strpos(body, 'Round {{custom_fields.funding_round_number}} is complete and invoice') > 0;

UPDATE message_templates
   SET body = replace(
         body,
         'Invoice {{invoice_number}} for {{balance_due}} is still open.',
         'Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is still open.'),
       updated_at = now()
 WHERE template_key = 'SMS-AR-02-REMINDER'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND strpos(body, 'Invoice {{invoice_number}} for {{balance_due}} is still open.') > 0;

UPDATE message_templates
   SET body = replace(
         replace(body,
           'Final notice on invoice {{invoice_number}}',
           'Final notice on basic business consulting fee invoice {{invoice_number}}'),
         'Remaining rounds are on hold until it clears:',
         'Your next service step is on hold until it clears:'),
       updated_at = now()
 WHERE template_key = 'SMS-AR-03-FINAL-NOTICE'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND (strpos(body, 'Final notice on invoice {{invoice_number}}') > 0
        OR strpos(body, 'Remaining rounds are on hold until it clears:') > 0);

UPDATE message_templates
   SET subject = replace(
         subject,
         'Invoice {{invoice_number}} — Round {{custom_fields.funding_round_number}} complete',
         'basic business consulting fee invoice {{invoice_number}}'),
       body = replace(
         replace(body,
           'Round {{custom_fields.funding_round_number}} is complete. Invoice {{invoice_number}} is ready.',
           'Your basic business consulting fee invoice {{invoice_number}} is ready.'),
         'Per your agreement, each round is invoiced as it completes. Settling this keeps the next round on schedule.',
         'This is a separate invoice for completed consulting work. Settling it keeps your next service step on schedule.'),
       updated_at = now()
 WHERE template_key = 'EMAIL-AR-01-FIRST-NOTICE'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND (strpos(subject, 'Invoice {{invoice_number}} — Round {{custom_fields.funding_round_number}} complete') > 0
        OR strpos(body, 'Round {{custom_fields.funding_round_number}} is complete. Invoice {{invoice_number}} is ready.') > 0
        OR strpos(body, 'Per your agreement, each round is invoiced as it completes.') > 0);

UPDATE message_templates
   SET subject = replace(
         subject,
         'Invoice {{invoice_number}} is still open',
         'basic business consulting fee invoice {{invoice_number}} is still open'),
       body = replace(
         replace(body,
           'Invoice {{invoice_number}} for {{balance_due}} is still outstanding.',
           'Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is still outstanding.'),
         'The work on Round {{custom_fields.funding_round_number}} is done and delivered.',
         'The consulting work covered by this invoice is complete.'),
       updated_at = now()
 WHERE template_key = 'EMAIL-AR-02-REMINDER'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND (strpos(subject, 'Invoice {{invoice_number}} is still open') > 0
        OR strpos(body, 'Invoice {{invoice_number}} for {{balance_due}} is still outstanding.') > 0
        OR strpos(body, 'The work on Round {{custom_fields.funding_round_number}} is done and delivered.') > 0);

UPDATE message_templates
   SET subject = replace(
         subject,
         'Final notice — invoice {{invoice_number}}',
         'Final notice — basic business consulting fee invoice {{invoice_number}}'),
       body = replace(
         replace(body,
           'This is the final notice on invoice {{invoice_number}} for {{balance_due}}.',
           'This is the final notice on your basic business consulting fee invoice {{invoice_number}} for {{balance_due}}.'),
         'Your remaining funding rounds are on hold until this clears. That''s not a threat — it''s just how the agreement works. We invoice per completed round so neither side gets ahead of the other.',
         'Your next service step is on hold until this clears, as set out in your agreement. This invoice covers completed consulting work.'),
       updated_at = now()
 WHERE template_key = 'EMAIL-AR-03-FINAL-NOTICE'
   AND org_id IN (SELECT id FROM orgs WHERE slug = 'fundhub')
   AND (strpos(subject, 'Final notice — invoice {{invoice_number}}') > 0
        OR strpos(body, 'This is the final notice on invoice {{invoice_number}} for {{balance_due}}.') > 0
        OR strpos(body, 'Your remaining funding rounds are on hold until this clears.') > 0);

-- The original seed files are already marked applied in production. Insert
-- their approved copy here for the Fundhub org when a key is absent. Never
-- overwrite an existing edited or unapproved template on conflict.
WITH approved(template_key, channel, subject, body) AS (
  VALUES
    (
      'INVOICE-SENT-EMAIL', 'email',
      'Your {{invoice.kind}} invoice from {{invoice.company}} — {{invoice.amount}}',
      E'Hi {{contact.first_name}},\n\n' ||
      E'Here is your invoice from {{invoice.company}}.\n\n' ||
      E'What it is for: {{invoice.kind}}\n' ||
      E'Amount: {{invoice.amount}}\n' ||
      E'Due: {{invoice.due}}\n' ||
      E'Reference: {{invoice.reference}}\n\n' ||
      E'If you have already paid this, thank you — you can ignore this email.\n\n' ||
      E'If anything here does not look right, reply to this email and a person ' ||
      E'will get back to you.'
    ),
    (
      'SMS-AR-01-FIRST-NOTICE', 'sms', NULL::text,
      'Hey {{contact.first_name}}, Fundhub billing. Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is ready in your portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'
    ),
    (
      'SMS-AR-02-REMINDER', 'sms', NULL::text,
      'Hey {{contact.first_name}}, Fundhub billing. Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is still open. Pay or tell us a date: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'
    ),
    (
      'SMS-AR-03-FINAL-NOTICE', 'sms', NULL::text,
      'Hey {{contact.first_name}}, Fundhub billing. Final notice on basic business consulting fee invoice {{invoice_number}} for {{balance_due}}. Your next service step is on hold until it clears: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'
    ),
    (
      'EMAIL-AR-01-FIRST-NOTICE', 'email',
      'basic business consulting fee invoice {{invoice_number}}',
      $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Invoice ready</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your basic business consulting fee invoice {{invoice_number}} is ready.</p>
            <p style="margin:0 0 16px 0;">Amount due: {{balance_due}}</p>
            <p style="margin:0 0 16px 0;">Pay here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">This is a separate invoice for completed consulting work. Settling it keeps your next service step on schedule.</p>
            <p style="margin:0 0 16px 0;">Questions on anything in it — reply to this email.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub Billing</p>
            <p style="margin:0 0 16px 0;">fundhub.ai<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$
    ),
    (
      'EMAIL-AR-02-REMINDER', 'email',
      'basic business consulting fee invoice {{invoice_number}} is still open',
      $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Invoice is still open</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is still outstanding.</p>
            <p style="margin:0 0 16px 0;">The consulting work covered by this invoice is complete.</p>
            <p style="margin:0 0 16px 0;">Pay here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">If you need a few more days, reply with a date and we'll note it on your account. We just need to know where things stand.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub Billing</p>
            <p style="margin:0 0 16px 0;">fundhub.ai<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$
    ),
    (
      'EMAIL-AR-03-FINAL-NOTICE', 'email',
      'Final notice — basic business consulting fee invoice {{invoice_number}}',
      $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Final notice</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">This is the final notice on your basic business consulting fee invoice {{invoice_number}} for {{balance_due}}.</p>
            <p style="margin:0 0 16px 0;">Your next service step is on hold until this clears, as set out in your agreement. This invoice covers completed consulting work.</p>
            <p style="margin:0 0 16px 0;">Pay here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">If there's a reason this can't be paid right now, reply and tell us. We'd rather work out a date than let this sit.</p>
            <p style="margin:0 0 16px 0;">After this notice, the account moves to our automated collections process and no one here handles it directly.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub Billing</p>
            <p style="margin:0 0 16px 0;">fundhub.ai<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$
    )
)
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, a.template_key, a.channel, a.subject, a.body, true
  FROM orgs o
 CROSS JOIN approved a
 WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING;
