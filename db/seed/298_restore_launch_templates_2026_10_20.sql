-- seed/298_restore_launch_templates_2026_10_20.sql
--
-- PUTS BACK FIVE MESSAGES THAT TESTS DELETED FROM THE LIVE DATABASE.
--
-- Between 2026-10-11 and 2026-10-12 a test suite ran against production and
-- deleted these rows from the Fundhub company (found 2026-10-13; see
-- ops/workflows/claude-test-pr41-2026-10-13.md). Since then a new lead gets no
-- welcome text or email, a booking gets no confirm email, a document request
-- text cannot go out, and a contract goes out with no email. The hourly pulse
-- is red on it: beats email-path and text-path, step template-ready.
--
--   EMAIL-S00-WELCOME     first written in seed/013
--   EMAIL-S04-01-CONFIRM  seed/012, with the portal link seed/016 added
--   CONTRACT-SEND-EMAIL   seed/008
--   SMS-S00-WELCOME       seed/013, rewritten by seed/295 (the 295 words win)
--   SMS-DOC-01-REQUEST    seed/013
--
-- THE WORDS ARE NOT NEW. Each body and subject below is the last approved
-- version in the repo, copied byte for byte. The welcome text, welcome email
-- and booking confirm email that went out before the delete (2026-10-10) carry
-- exactly these words. src/messaging/restore-launch-templates.pg.test.mjs
-- deletes the rows inside a transaction, runs this file, and checks every
-- byte against what seeds 008, 012, 013, 016 and 295 produce.
--
-- WHY A NEW FILE. Those seeds are recorded as applied on live, so running them
-- again does nothing, and editing them would be a silent no-op (CLAUDE.md
-- section 12). This file is the superseding copy.
--
-- WHY db/seed AND THE NUMBER 298. db/migrate.mjs runs schema, then migrations,
-- then seed, each in name order. 298 sorts after every other seed, so on a
-- fresh database the original seeds write these rows first and this file then
-- finds them there and does nothing. The words come out the same either way.
--
-- SAFE TO RUN AGAIN. ON CONFLICT DO NOTHING: a row that is there, even one a
-- person has since edited, is never touched. Only the Fundhub company is
-- written, because that is the only company that ever had these rows (seed/008
-- wrote the contract email for slug 'fundhub' only, and the second company has
-- no message rows at all).
--
-- compliance_passed is true with approved_by NULL: the same standing every
-- seeded template has (migrations/116_template_approval.sql).

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, k.template_key, k.channel, k.subject, k.body, true
  FROM orgs o
 CROSS JOIN (VALUES
  ('EMAIL-S00-WELCOME', 'email',
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
</html>$html$),

  ('EMAIL-S04-01-CONFIRM', 'email',
   'You''re booked — {{appointment.start_time}}',
   $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your Fundhub call is confirmed</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;"><strong>You're booked.</strong> Here are the details:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px 0;border:1px solid #E4E4E7;">
              <tr>
                <td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#52525B;width:120px;">When</td>
                <td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181B;"><strong>{{appointment.start_time}}</strong></td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#52525B;border-top:1px solid #E4E4E7;">Where</td>
                <td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181B;border-top:1px solid #E4E4E7;">{{appointment.meeting_location}}</td>
              </tr>
            </table>
            <p style="margin:0 0 16px 0;">Here is your link to sign in to your Fundhub portal:</p>
            <p style="margin:0 0 16px 0;"><a href="{{magic_link.url}}" style="color:#1D4ED8;">{{magic_link.url}}</a></p>
            <p style="margin:0 0 16px 0;">A member of the Fundhub team will walk you through your file and the options it supports. Nothing to prepare — just be somewhere you can talk.</p>
            <p style="margin:0 0 16px 0;">Need a different time? <a href="{{custom_values.booking_link}}" style="color:#1D4ED8;">Reschedule here</a>.</p>
            <p style="margin:0 0 8px 0;">See you then,<br>The Fundhub Team</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$html$),

  ('CONTRACT-SEND-EMAIL', 'email',
   'Please sign: {{contract.title}}',
   E'Hi {{contact.first_name}},\n\n' ||
   E'{{contract.sender}} has sent you a document to sign: {{contract.title}}.\n\n' ||
   E'Open it here:\n{{contract.link}}\n\n' ||
   E'The link is just for you — please do not forward it. It works for 30 days.\n\n' ||
   E'You will be able to read the whole document before you sign anything. ' ||
   E'When you sign, a copy is saved with the date and time, and you can come ' ||
   E'back to the same link to read it again whenever you like.\n\n' ||
   E'If you were not expecting this, or something does not look right, reply to ' ||
   E'this email and a person will get back to you.'),

  ('SMS-S00-WELCOME', 'sms', NULL,
   $c$Hi {{contact.first_name}} — Josh at Fundhub. Your application is in. Nothing is reviewed yet; that happens live with an advisor on your call. Pick a time here: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  ('SMS-DOC-01-REQUEST', 'sms', NULL,
   'Hey {{contact.first_name}}, Fundhub. Before we can start, we need a few documents from you. Upload them here: {{CLIENT_PORTAL_URL}} Or just reply to this text with photos. Reply STOP to opt out.')
 ) AS k(template_key, channel, subject, body)
 WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING;
