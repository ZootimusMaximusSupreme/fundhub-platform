-- seed/299_restore_lead_chase_templates_2026_10_20.sql
--
-- PUTS BACK SEVEN NEW-LEAD MESSAGES THAT TESTS DELETED FROM THE LIVE DATABASE.
--
-- The same test run that ran against production on 2026-10-11/12 and deleted the
-- five launch messages seed/298 puts back also deleted these seven from the
-- Fundhub company. Since then a lead who stops halfway through the application
-- gets no "finish what you started" email (s-02-incomplete-survey-nudge), and a
-- lead who applies and never books gets none of the never-booked chase: three
-- texts and three emails over five days (s-nobook-chase). The morning pulse row
-- handoff:lead-first-touches-missing names both.
--
--   EMAIL-S02-FINISH-APPLICATION  seed/015
--   EMAIL-NOBOOK-01               seed/013, subject renamed by seed/295 (the 295 subject wins)
--   EMAIL-NOBOOK-02               seed/013
--   EMAIL-NOBOOK-03               seed/013
--   SMS-NOBOOK-01                 seed/011, rewritten by seed/295 (the 295 words win)
--   SMS-NOBOOK-02                 seed/011, rewritten by seed/295 (the 295 words win)
--   SMS-NOBOOK-03                 seed/011, rewritten by seed/295 (the 295 words win)
--
-- THE WORDS ARE NOT NEW. Each subject and body below is the last approved
-- version in the repo, copied byte for byte. Every fixed line of each one is in
-- the last message of that template that went out before the delete (2026-09-27
-- to 2026-10-05, checked read-only on 2026-10-20), and every subject matches.
-- src/messaging/restore-lead-chase-templates.test.mjs holds every byte to seeds
-- 013, 015 and 295; restore-lead-chase-templates.pg.test.mjs deletes the rows
-- inside a transaction, runs this file and compares what comes back.
--
-- WHY A NEW FILE. Those seeds are recorded as applied on live, so running them
-- again does nothing, and editing them would be a silent no-op (CLAUDE.md
-- section 12). This file is the superseding copy. 299 sorts after every other
-- seed, so on a fresh database the original seeds write these rows first and
-- this file then finds them there and does nothing.
--
-- SAFE TO RUN AGAIN. ON CONFLICT DO NOTHING: a row that is there, even one a
-- person has since edited, is never touched. Only the Fundhub company is
-- written, the only company that ever had these rows (the second company has
-- no message rows at all).
--
-- compliance_passed is true with approved_by NULL: the same standing every
-- seeded template has (migrations/116_template_approval.sql).

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, k.template_key, k.channel, k.subject, k.body, true
  FROM orgs o
 CROSS JOIN (VALUES
  ('EMAIL-S02-FINISH-APPLICATION', 'email', $r299$You were halfway through — finish what you started$r299$,
   $r299$Hey {{contact.first_name}},

I saw you start on Fundhub and then stop before finishing. That happens — life gets loud.

That form is what we use to map what funding looks realistic for you, or what to fix first if you're not fundable yet.

Finish here while it's fresh:
{{custom_values.booking_link}}

Talk soon,
Fundhub$r299$),

  ('EMAIL-NOBOOK-01', 'email', $r299$Your application is in — the call isn't booked yet$r299$,
   $r299$<!DOCTYPE html>
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
</html>$r299$),

  ('EMAIL-NOBOOK-02', 'email', $r299$The order matters more than the score$r299$,
   $r299$<!DOCTYPE html>
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
</html>$r299$),

  ('EMAIL-NOBOOK-03', 'email', $r299$Closing this out unless you want the call$r299$,
   $r299$<!DOCTYPE html>
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
</html>$r299$),

  ('SMS-NOBOOK-01', 'sms', NULL::text,
   $r299${{contact.first_name}}, it's Josh at Fundhub. Your application is in, but there's no call on the calendar yet — and the call is where an advisor goes through your options with you. Pick a time: {{custom_values.booking_link}} Reply STOP to opt out.$r299$),

  ('SMS-NOBOOK-02', 'sms', NULL::text,
   $r299${{contact.first_name}} — Josh at Fundhub again. Still nothing on the calendar. It's about 20 minutes with an advisor and you'll leave knowing where you stand. {{custom_values.booking_link}} Reply STOP to opt out.$r299$),

  ('SMS-NOBOOK-03', 'sms', NULL::text,
   $r299$Last one from me, {{contact.first_name}} — Josh at Fundhub. If now isn't the time, no problem, your application stays saved. If it is, the calendar is here: {{custom_values.booking_link}} Reply STOP to opt out.$r299$)
 ) AS k(template_key, channel, subject, body)
 WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING;
