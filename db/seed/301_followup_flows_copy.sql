-- 301_followup_flows_copy.sql
--
-- A seed, not a migration, on purpose: seeds 013, 015 and 295 write these same
-- template rows and run after every migration on a new database, so a migration
-- would lose to them there. Numbered after 300 so it runs last. On production
-- the older seeds ran long ago and this one runs once.
--
-- The words for the follow-ups from lead to booked call (board:
-- ops/workflows/backend-selling-lanes-2026-10-30.md, section 6d). Draft 2, written
-- 2026-10-31 with Copybot (marketing/copy-skills/copybot/: owner-voice.md,
-- chris-voice-profile.md and marketing/ads/VOICE.md first; then workflows,
-- modules, headline-and-lead, readability, copy-booster and techniques). Chris on
-- draft 1: it parroted the ads and did not sound like a normal person. So:
--   - Each message is one person texting another about this exact moment: they
--     stopped partway, it is the next morning, the setter just missed them.
--   - Personalization, Copybot's way (tie it to the person's real situation, not
--     only the name): the come-back flow says which question they stopped on
--     ({{survey_stopped_at}}) and how many taps are left ({{survey_taps_left}}).
--     S-02 fills both from the answers saved on the client.
--   - No line repeats the ads or the VSL: no 5-word run is shared with
--     marketing/ads/scripts/, marketing/vsl/, CONTROLS.md or POST-BOOKING-15.md.
--
-- 20 templates:
--   SMS-S00-WELCOME, EMAIL-S00-WELCOME      rewritten. Sent the moment someone types
--                                           their name, email and phone on /apply.
--                                           They have NOT finished, so nothing says
--                                           "your application is in".
--   SMS/EMAIL-S02-RESUME-1..3               new. Stopped partway: about 20 minutes
--                                           later, 9 a.m. the next day, the day after.
--   SMS-AISET03-MSG1..3                     rewritten. The setter called someone WITH a
--                                           call booked and missed them. No Josh.
--   SMS-AISET03-OPTIN-1..3                  new. Same, for someone with NO call booked.
--   SMS/EMAIL-NOBOOK-01..03                 rewritten. Finished the survey, no time picked:
--                                           2 hours, 24 hours and 72 hours later. They
--                                           still signed as Josh and repeated the ads.
--
-- Where every fact comes from. Nothing is invented, and there are no prices.
--   The /apply page (marketing/landing-pages/apply-survey.html): "No credit pull to
--     apply"; a best guess is fine on the score question; "Your advisor will have
--     these answers before your call"; the call is on Google Meet and takes about
--     30 minutes; one tap moves each question on; the resume link opens the first
--     unanswered question with the saved answers filled in.
--   The setter SOP (docs/sops/weekend-2026-10-24/02-setter.md): setters text as
--     "Chris at Fundhub" ("Just tried you about your strategy call"); "Be at a
--     computer"; the credit is pulled with them on the call and "your score does not
--     move"; the call note is "so you two can start fast".
--   Chris's own words (board 6a-2, copybot chris-voice-profile.md): "We're not going
--     to send you to apply if you're not going to get approved"; "We diagnose and
--     tell you exactly what to do"; the red flag that gets you denied is caught
--     first; "You will be taken care of".
--
-- Checks run on every message before this file was written (lead chat, 2026-10-31):
-- Flesch reading ease 89 to 105 (about 5th grade); no might/maybe/could/probably,
-- no "number", no "CRS", no Social Security, no prices, no em dashes or curly
-- quotes; Fundhub spelled right; every text ends "Reply STOP to opt out." and fits
-- in 2 text segments with a 72-character link; no 5-word run shared between two
-- messages except the stopped-at question in the touch-1 text and email.
--
-- What this file does:
--   1. INSERT the 9 new templates for every org, approved. ON CONFLICT DO NOTHING: a
--      row that already exists, edited or not, is never touched.
--   2. UPDATE the 11 rewritten templates for every org: new body (and subject for the
--      emails), approved. The sign-off columns (approved_by, approved_at,
--      approved_body_sha) are cleared on those rows, because whatever a person signed
--      off was the old words (116_template_approval.sql); a stale hash would also
--      turn the pulse's "template-copy:seed-vs-live-drift" check red.
--   Writing a template sends nothing. Safe to run twice: the insert skips existing
--   rows and the update writes the same words.

-- 1. Nine new templates.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, v.template_key, v.channel, v.subject, v.body, true
  FROM orgs o
 CROSS JOIN (VALUES
  -- SMS-S02-RESUME-1: About 20 minutes after they stop (drip hours, 9 a.m. to 5 p.m. Arizona).
  ('SMS-S02-RESUME-1', 'sms', NULL::text,
$c$Hey {{contact.first_name}}, looks like you got pulled away. No worries. You stopped at {{survey_stopped_at}}. {{survey_taps_left}} and you can grab a time: {{survey_resume_link}}
- Chris, Fundhub
Reply STOP to opt out.$c$),

  -- EMAIL-S02-RESUME-1: About 20 minutes after they stop (drip hours).
  ('EMAIL-S02-RESUME-1', 'email', 'You stopped at {{survey_stopped_at}}',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Pick up where you stopped</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Your answers are saved. No starting over.</p>
            <p style="margin:0 0 16px 0;">Here's why it's worth it. Your advisor sees your goal, your business and your credit before you meet. So you two can start fast.</p>
            <p style="margin:0 0 16px 0;">The button below picks up at {{survey_stopped_at}}.</p>
            <p style="margin:0 0 16px 0;"><a href="{{survey_resume_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Pick up where I stopped</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{survey_resume_link}}" style="color:#1D4ED8;">{{survey_resume_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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

  -- SMS-S02-RESUME-2: 9 a.m. Arizona the next day (drip hours).
  ('SMS-S02-RESUME-2', 'sms', NULL::text,
$c$Morning {{contact.first_name}}. You're {{survey_taps_left}} from booking your Fundhub call. Stuck on the credit score one? A best guess is fine. We check the real one together when we talk: {{survey_resume_link}}
- Chris
Reply STOP to opt out.$c$),

  -- EMAIL-S02-RESUME-2: 9 a.m. Arizona the next day (drip hours).
  ('EMAIL-S02-RESUME-2', 'email', 'Why we look before you apply',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Why we look before you apply</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Here's how funding usually goes. You apply, you wait, and then the bank tells you yes or no.</p>
            <p style="margin:0 0 16px 0;">We flip that. Before you apply anywhere, we read your file with you and find anything that would get you a no. Then we show you how to deal with it.</p>
            <p style="margin:0 0 16px 0;">We won't send you to apply at a bank that's going to turn you down.</p>
            <p style="margin:0 0 16px 0;">That starts with your questions. You're {{survey_taps_left}} away.</p>
            <p style="margin:0 0 16px 0;"><a href="{{survey_resume_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Finish my questions</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{survey_resume_link}}" style="color:#1D4ED8;">{{survey_resume_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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

  -- SMS-S02-RESUME-3: 9 a.m. Arizona the day after (drip hours). The last one.
  ('SMS-S02-RESUME-3', 'sms', NULL::text,
$c$Hey {{contact.first_name}}, this is my last nudge about your Fundhub questions. If the timing's off, all good. Your link still drops you right back where you were: {{survey_resume_link}}
- Chris
Reply STOP to opt out.$c$),

  -- EMAIL-S02-RESUME-3: 9 a.m. Arizona the day after (drip hours). The last one.
  ('EMAIL-S02-RESUME-3', 'email', 'Last note from me about this',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Last note from me about this</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">I'll keep this short.</p>
            <p style="margin:0 0 16px 0;">You started your Fundhub questions a couple of days ago and never got to the end. Totally fine. Life gets busy.</p>
            <p style="margin:0 0 16px 0;">I won't keep emailing you about it. If funding is still on your list, it's {{survey_taps_left}}, then you pick a call time.</p>
            <p style="margin:0 0 16px 0;">On that call, you learn what your file needs first.</p>
            <p style="margin:0 0 16px 0;"><a href="{{survey_resume_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Finish my questions</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{survey_resume_link}}" style="color:#1D4ED8;">{{survey_resume_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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

  -- SMS-AISET03-OPTIN-1: Right after the setter's missed call, no call booked (drip hours).
  ('SMS-AISET03-OPTIN-1', 'sms', NULL::text,
$c$Hey {{contact.first_name}}, Chris at Fundhub here. Tried calling to get you on the calendar and missed you. Grab whatever time works best: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- SMS-AISET03-OPTIN-2: 30 minutes later (drip hours).
  ('SMS-AISET03-OPTIN-2', 'sms', NULL::text,
$c${{contact.first_name}}, here's what the call looks like: about 30 minutes on Google Meet with one of our advisors. We open up your file together, and you leave knowing your next move. Pick a time: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- SMS-AISET03-OPTIN-3: 2 hours after that (drip hours).
  ('SMS-AISET03-OPTIN-3', 'sms', NULL::text,
$c$Hey {{contact.first_name}}, that's it from me today. Whenever you want to talk funding, grab a time and we'll handle the rest: {{custom_values.booking_link}}
Reply STOP to opt out.$c$)
) AS v(template_key, channel, subject, body)
ON CONFLICT (org_id, template_key) DO NOTHING;

-- 2. Eleven rewritten templates.
UPDATE message_templates AS t
   SET subject           = v.subject,
       body              = v.body,
       compliance_passed = true,
       approved_by       = NULL,
       approved_at       = NULL,
       approved_body_sha = NULL,
       updated_at        = now()
  FROM (VALUES
  -- SMS-S00-WELCOME: Right away, any hour, the moment they type their name, email and phone.
  ('SMS-S00-WELCOME', NULL::text,
$c$Hey {{contact.first_name}}, it's Chris with Fundhub. Got your info, thank you. The rest is quick taps, then you grab a time to talk. Get pulled away? This link saves your spot: {{survey_resume_link}}
Reply STOP to opt out.$c$),

  -- EMAIL-S00-WELCOME: Right away, any hour, same moment.
  ('EMAIL-S00-WELCOME', 'Got your info. Here''s what happens next',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>What happens next</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Chris here. Thanks for reaching out to Fundhub.</p>
            <p style="margin:0 0 16px 0;">Here's how this goes:</p>
            <p style="margin:0 0 16px 0;"><strong>1. Answer the questions.</strong> There's no credit pull to apply.</p>
            <p style="margin:0 0 16px 0;"><strong>2. Pick a time that works for you.</strong></p>
            <p style="margin:0 0 16px 0;"><strong>3. Get on Google Meet with us for about 30 minutes.</strong> We go over your file together and tell you straight what to do with it.</p>
            <p style="margin:0 0 16px 0;">Your advisor reads your answers before the call, so you don't start from zero.</p>
            <p style="margin:0 0 16px 0;">Got pulled away before you finished? This button opens your questions right where you left off.</p>
            <p style="margin:0 0 16px 0;"><a href="{{survey_resume_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Finish my questions</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{survey_resume_link}}" style="color:#1D4ED8;">{{survey_resume_link}}</a></p>
            <p style="margin:0 0 16px 0;">Talk soon,<br>
            Chris<br>
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

  -- SMS-AISET03-MSG1: Right after the setter's missed call, call booked (drip hours).
  ('SMS-AISET03-MSG1', NULL::text,
$c$Hey {{contact.first_name}}, it's Chris at Fundhub. Tried calling about your strategy call. Still good for that time? Reply YES and you're set, or pick a new time: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- SMS-AISET03-MSG2: 30 minutes later (drip hours).
  ('SMS-AISET03-MSG2', NULL::text,
$c${{contact.first_name}}, one thing for your call: be at a computer, not your phone. We look at your credit together, and it won't move your score. Need a different time? {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- SMS-AISET03-MSG3: 2 hours after that (drip hours).
  ('SMS-AISET03-MSG3', NULL::text,
$c$Hey {{contact.first_name}}, last one from me today. Text YES so I know you're still on for your call. Time doesn't work anymore? No problem, grab another: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- SMS-NOBOOK-01: 2 hours after the survey is finished, or 9 a.m. Arizona (drip hours).
  ('SMS-NOBOOK-01', NULL::text,
$c${{contact.first_name}}, Chris from Fundhub here. You finished your questions but didn't grab a time yet. Your answers are in, so the call goes straight to your file. Pick a time: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- EMAIL-NOBOOK-01: Same moment as SMS-NOBOOK-01.
  ('EMAIL-NOBOOK-01', 'Your answers are in. One step left',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>One step left</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Thanks for finishing your questions. That was the long part.</p>
            <p style="margin:0 0 16px 0;">The last step is picking a time. Your answers are already in front of your advisor, so the whole call goes to your file.</p>
            <p style="margin:0 0 16px 0;"><a href="{{custom_values.booking_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Pick my time</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{custom_values.booking_link}}" style="color:#1D4ED8;">{{custom_values.booking_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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

  -- SMS-NOBOOK-02: 24 hours after message 1 (drip hours).
  ('SMS-NOBOOK-02', NULL::text,
$c$Hey {{contact.first_name}}, quick one. On the call we spot what a bank would say no to on your file, before you apply. Grab a time: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  -- EMAIL-NOBOOK-02: Same moment as SMS-NOBOOK-02.
  ('EMAIL-NOBOOK-02', 'Here''s how the call goes',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Here's how the call goes</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">Here's the call, start to finish:</p>
            <p style="margin:0 0 16px 0;"><strong>1. We check your credit while you're on the call.</strong> Your score stays put.</p>
            <p style="margin:0 0 16px 0;"><strong>2. We look at your file like a bank would.</strong> If something on it would get you denied, you hear it from us first.</p>
            <p style="margin:0 0 16px 0;"><strong>3. You leave knowing what to do first,</strong> and which banks fit your file.</p>
            <p style="margin:0 0 16px 0;">It all happens on Google Meet, in about 30 minutes.</p>
            <p style="margin:0 0 16px 0;"><a href="{{custom_values.booking_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Pick my time</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{custom_values.booking_link}}" style="color:#1D4ED8;">{{custom_values.booking_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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

  -- SMS-NOBOOK-03: 72 hours after message 2 (drip hours). The last one.
  ('SMS-NOBOOK-03', NULL::text,
$c$Hey {{contact.first_name}}, I'll leave it here. Your answers are still saved. If you want the call, the calendar is right here: {{custom_values.booking_link}} If not, no hard feelings.
Reply STOP to opt out.$c$),

  -- EMAIL-NOBOOK-03: Same moment as SMS-NOBOOK-03.
  ('EMAIL-NOBOOK-03', 'I''ll stop here',
$html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>I'll stop here</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;">I've reached out a couple of times about your call, and I don't want to crowd your inbox. So this is my last email about it.</p>
            <p style="margin:0 0 16px 0;">Your answers are saved. If you still want help getting funded, the calendar is below.</p>
            <p style="margin:0 0 16px 0;"><a href="{{custom_values.booking_link}}" style="display:inline-block;padding:12px 20px;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;">Pick my time</a></p>
            <p style="margin:0 0 16px 0;font-size:14px;color:#52525B;">Or open this link: <a href="{{custom_values.booking_link}}" style="color:#1D4ED8;">{{custom_values.booking_link}}</a></p>
            <p style="margin:0 0 16px 0;">Chris<br>
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
</html>$html$)
) AS v(template_key, subject, body)
 WHERE t.template_key = v.template_key;
