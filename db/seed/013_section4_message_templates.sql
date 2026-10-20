-- 013_section4_message_templates.sql
-- Section 4 of docs/workflows/build-spec-2026-08-22.md.
-- 29 templates from docs/workflows/missing-copy-2026-08-22.md.
-- Copy is owner-approved. compliance_passed = true. Do not rewrite bodies.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, k.template_key, 'sms', NULL, k.body, true
FROM orgs o
CROSS JOIN (VALUES
  ('SMS-S00-WELCOME',
   'Hey {{contact.first_name}}, it''s Fundhub. Got your info. Next step is a quick call so we can show you what your profile actually supports: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-S05A-NOSHOW-02',
   'Hey {{contact.first_name}}, Fundhub again. We held your spot and your analysis is still sitting here. Pick a new time and we''ll go through it: {{reschedule_link}} Reply STOP to opt out.'),
  ('SMS-S05A-NOSHOW-03',
   'Hey {{contact.first_name}}, quick one. Do you still want to go through your funding analysis, or should we shelve it? Either answer is fine — just let us know. {{reschedule_link}} Reply STOP to opt out.'),
  ('SMS-S05A-NOSHOW-04',
   'Hey {{contact.first_name}}, Fundhub. Closing your file for now. Your analysis stays saved — if the timing changes, book anytime: {{reschedule_link}} Reply STOP to opt out.'),
  ('SMS-DOC-01-REQUEST',
   'Hey {{contact.first_name}}, Fundhub. Before we can start, we need a few documents from you. Upload them here: {{CLIENT_PORTAL_URL}} Or just reply to this text with photos. Reply STOP to opt out.'),
  ('SMS-DOC-02-REQUEST-MORE',
   'Hey {{contact.first_name}}, Fundhub. Got your upload — one thing needs fixing before we can move forward. Details in your portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'),
  ('SMS-DOC-03-APPROVED',
   'Hey {{contact.first_name}}, documents approved. We''re optimizing your profile now and your specialist will start Round 1 shortly. Reply STOP to opt out.'),
  ('SMS-AR-01-FIRST-NOTICE',
   'Hey {{contact.first_name}}, Fundhub billing. Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is ready in your portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'),
  ('SMS-AR-02-REMINDER',
   'Hey {{contact.first_name}}, Fundhub billing. Your basic business consulting fee invoice {{invoice_number}} for {{balance_due}} is still open. Pay or tell us a date: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.'),
  ('SMS-AR-03-FINAL-NOTICE',
   'Hey {{contact.first_name}}, Fundhub billing. Final notice on basic business consulting fee invoice {{invoice_number}} for {{balance_due}}. Your next service step is on hold until it clears: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.')
) AS k(template_key, body)
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S00-WELCOME
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S00-WELCOME',
  'email',
  'You''re in — here''s what happens next',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>You're in</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">You're in. Here's how this works.</p>
            <p style="margin:0 0 16px 0;">Fundhub looks at your credit profile the way a lender does — structure, timing, and sequence, not just the score. Then we tell you what's realistically fundable right now and what needs to be fixed first.</p>
            <p style="margin:0 0 16px 0;">Two steps from here:</p>
            <p style="margin:0 0 16px 0;">1. Finish your application so we can see the full picture<br>
            2. Book a call so we can walk you through what it means</p>
            <p style="margin:0 0 16px 0;">Start here: {{custom_values.booking_link}}</p>
            <p style="margin:0 0 16px 0;">If you already did both — nothing to do. We'll be in touch.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-NOBOOK-01
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-NOBOOK-01',
  'email',
  'Your file is ready — the call isn''t booked yet',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your file is ready</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your application is in and we can see your profile.</p>
            <p style="margin:0 0 16px 0;">What we can't do is tell you what it means until we get you on a call. That's the part where we go through what's fundable now, what isn't, and what order to do things in.</p>
            <p style="margin:0 0 16px 0;">It takes about 30 minutes.</p>
            <p style="margin:0 0 16px 0;">Grab a time: {{custom_values.booking_link}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-NOBOOK-02
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-NOBOOK-02',
  'email',
  'The order matters more than the score',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>The order matters</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">One thing we see constantly: two people with nearly identical profiles get completely different results.</p>
            <p style="margin:0 0 16px 0;">Usually it comes down to sequence — which applications went out, in what order, how close together, and what was on the file at the time.</p>
            <p style="margin:0 0 16px 0;">That's what the call covers. Your file, your sequence, what to do first.</p>
            <p style="margin:0 0 16px 0;">{{custom_values.booking_link}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-NOBOOK-03
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-NOBOOK-03',
  'email',
  'Closing this out unless you want the call',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Closing this out</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Last note from me on this.</p>
            <p style="margin:0 0 16px 0;">Your application is still on file. If you want us to walk you through it, the calendar is open. If the timing isn't right, no problem — it'll be here when it is.</p>
            <p style="margin:0 0 16px 0;">{{custom_values.booking_link}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S05A-NOSHOW-02
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S05A-NOSHOW-02',
  'email',
  'Still holding your analysis',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Still holding your analysis</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">We missed you yesterday. Your file is still here and nothing's changed on our end.</p>
            <p style="margin:0 0 16px 0;">Pick a time that actually works and we'll go through it:<br>
            {{reschedule_link}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S05A-NOSHOW-03
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S05A-NOSHOW-03',
  'email',
  'Do you still want this?',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Do you still want this?</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Straight question: do you still want to go through your analysis, or has the timing changed?</p>
            <p style="margin:0 0 16px 0;">Either answer works. We just don't want to keep reaching out if you're not in a position to move on it right now.</p>
            <p style="margin:0 0 16px 0;">If you are: {{reschedule_link}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S05A-NOSHOW-04
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S05A-NOSHOW-04',
  'email',
  'Closing your file for now',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Closing your file for now</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">We're closing this out for now.</p>
            <p style="margin:0 0 16px 0;">Your analysis stays saved in your portal — nothing gets deleted. If the timing changes, the calendar's always open.</p>
            <p style="margin:0 0 16px 0;">{{reschedule_link}}</p>
            <p style="margin:0 0 16px 0;">Good luck out there.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-SOFT-PULL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-SOFT-PULL',
  'email',
  'Your UnderwriteIQ assessment is running',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your UnderwriteIQ assessment is running</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Payment received. Your UnderwriteIQ assessment is running now.</p>
            <p style="margin:0 0 16px 0;">This pulls your profile the way an underwriter sees it — structure, utilization, inquiry spacing, and what's actually driving decisions on your file.</p>
            <p style="margin:0 0 16px 0;">Results land in your portal: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">Your advisor will walk you through what it means.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-FUNDING-DFY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-FUNDING-DFY',
  'email',
  'You''re set up — here''s what we need from you',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>You're set up</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">You're in. Here's what happens now.</p>
            <p style="margin:0 0 16px 0;">Before we can start submitting, we need your documents uploaded and approved. That's a hard gate — nothing moves until it clears.</p>
            <p style="margin:0 0 16px 0;">Upload here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">Once your documents are approved:</p>
            <p style="margin:0 0 16px 0;">1. We optimize your profile<br>
            2. Your specialist starts Round 1<br>
            3. You get a text when applications go out<br>
            4. We clean up the resulting inquiries<br>
            5. Repeat across the remaining rounds</p>
            <p style="margin:0 0 16px 0;">You'll hear from us at every step. Reply to this email or text us if anything is unclear.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-REPAIR-DFY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-REPAIR-DFY',
  'email',
  'Your repair file is open',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your repair file is open</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your repair file is open.</p>
            <p style="margin:0 0 16px 0;">We work in rounds. Each round we identify what's disputable, send the letters, wait for the bureaus to respond, then reassess based on what came back.</p>
            <p style="margin:0 0 16px 0;">Your portal shows every item, every letter, and every response as it lands:<br>
            {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">Bureaus set their own timelines, so the pace isn't ours to control. What we control is that nothing sits idle.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-REPAIR-TRIAL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-REPAIR-TRIAL',
  'email',
  'Your first repair round is starting',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your first repair round is starting</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your test round is starting.</p>
            <p style="margin:0 0 16px 0;">This is one full round, done for you — we identify what's disputable, send the letters, and show you exactly what comes back from the bureaus.</p>
            <p style="margin:0 0 16px 0;">Track it here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">When the round closes, we'll go through the results with you and you can decide whether to keep going.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-UWIQ-DELIVERABLES
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-UWIQ-DELIVERABLES',
  'email',
  'Your deliverables package is being built',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your deliverables package is being built</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">We're building your package now. Here's what's in it:</p>
            <p style="margin:0 0 16px 0;">• Credit Analysis Report<br>
            • Dispute Letter Pack<br>
            • Credit Optimization Roadmap<br>
            • Funding Snapshot<br>
            • Bank &amp; Lender Match List<br>
            • How To Use This mini course</p>
            <p style="margin:0 0 16px 0;">Everything lands in your portal as it's finished: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">The mini course explains how to actually use the rest of it. Start there when it arrives.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-FUNDING-MASTERY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-FUNDING-MASTERY',
  'email',
  'Funding Mastery — you''re enrolled',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Funding Mastery — you're enrolled</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">You're enrolled. Full course is unlocked in your portal right now:<br>
            {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">This is the whole system, A to Z — profile structure, lender sequencing, inquiry spacing, timing, and the order operations actually need to happen in.</p>
            <p style="margin:0 0 16px 0;">Work through it in order. The sequence is the point.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-OFFER-NONE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-OFFER-NONE',
  'email',
  'Where things stand',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Where things stand</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Thanks for the call.</p>
            <p style="margin:0 0 16px 0;">Based on what we went through, there isn't a package we'd put you in right now. We'd rather tell you that than sell you something that won't move the needle.</p>
            <p style="margin:0 0 16px 0;">Your analysis stays in your portal: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">Profiles change. When yours does, come back and we'll take another look.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-DOC-01-REQUEST
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DOC-01-REQUEST',
  'email',
  'Documents needed before we can start',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Documents needed before we can start</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">One thing standing between you and Round 1: documents.</p>
            <p style="margin:0 0 16px 0;">We need these before anything moves:</p>
            <p style="margin:0 0 16px 0;">• Government-issued photo ID<br>
            • Proof of address<br>
            • Articles of organization or incorporation, if you have an entity</p>
            <p style="margin:0 0 16px 0;">Two ways to send them:</p>
            <p style="margin:0 0 16px 0;">1. Upload in your portal: {{CLIENT_PORTAL_URL}}<br>
            2. Text photos directly to this number</p>
            <p style="margin:0 0 16px 0;">Our system reviews them as soon as they land and tells you immediately if anything is unclear or needs a retake.</p>
            <p style="margin:0 0 16px 0;">Nothing starts until these clear — so the sooner they're in, the sooner you're moving.</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-DOC-03-APPROVED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DOC-03-APPROVED',
  'email',
  'Documents approved — you''re moving',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Documents approved — you're moving</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your documents cleared.</p>
            <p style="margin:0 0 16px 0;">Next: we optimize your profile, then your specialist starts Round 1. You'll get a text the moment applications go out.</p>
            <p style="margin:0 0 16px 0;">Track everything here: {{CLIENT_PORTAL_URL}}</p>
            <p style="margin:0 0 16px 0;">{{sender_name}}<br>
            Fundhub</p>
            <p style="margin:0 0 16px 0;">fundhub.ai • Funding Intelligence for Entrepreneurs<br>
            {{unsubscribe}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-AR-01-FIRST-NOTICE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-AR-01-FIRST-NOTICE',
  'email',
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
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-AR-02-REMINDER
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-AR-02-REMINDER',
  'email',
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
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-AR-03-FINAL-NOTICE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-AR-03-FINAL-NOTICE',
  'email',
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
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
