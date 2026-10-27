-- 012_s04_booking_confirm_email.sql
-- S-04 "Appointment Confirmation" — the one immediate booking-confirm EMAIL.
-- Owner decision 2026-08-22 (booked-stage journey order): on booking.created a
-- contact gets exactly one confirm text (SMS-S04-01-CONFIRM), the Josh AI dial
-- (ai-set-01-josh-setter), and this one email. The duplicate booked text
-- (SMS-BS01-01-BOOKED) is no longer sent by any workflow.
--
-- Copy is written fresh here. The GHL-era S-04 body carried Analyzer wording and
-- was never wired; nothing from it is reused. No approval/amount claims, no
-- guarantees — confirmation of a scheduled call only.
-- Key matches EMAIL_CONFIRM in src/workflows/s-04b-booking-reminders.mjs.
-- Merge tags: {{contact.first_name}}, {{appointment.start_time}},
--             {{appointment.meeting_location}}, {{custom_values.booking_link}},
--             {{magic_link.url}} (365-day single-use booking token)

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S04-01-CONFIRM',
  'email',
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
</html>$html$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
