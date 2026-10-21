-- seed/299_restore_u02_pack_email_2026_10_20.sql
--
-- PUTS BACK THE PACK-READY EMAIL THAT TESTS DELETED FROM THE LIVE DATABASE.
--
-- EMAIL-U02-ANALYZER-FUNDING-DELIVERY is the email a buyer gets when their
-- UnderwriteIQ pack (audit, letters, roadmap, lender list) is saved. It is
-- queued by src/workflows/slo-pack-delivery.mjs and by the closer deck's send
-- letters button (src/sales/closer-deck.mjs). It was first written by
-- seed/009_u02_funding_delivery_template.sql (applied on live 2026-08-16).
--
-- Read live 2026-10-20, read only: the Fundhub company has no row for this key.
-- It went in the same 2026-10-11/12 test run on production that deleted the
-- five launch messages seed/298 puts back. Since then sendTemplated refuses the
-- pack email for every buyer, and the morning pulse is red on it
-- (gap-underwrite:uw-pack-email-not-queued, "has no row").
--
-- THE WORDS ARE NOT NEW. Subject and body are seed/009's, copied byte for byte.
-- src/messaging/restore-u02-pack-email.pg.test.mjs deletes the row inside a
-- transaction, runs this file, and checks every byte against what seed/009 wrote.
--
-- WHY A NEW FILE. seed/009 is recorded as applied on live, so running it again
-- does nothing, and editing it would be a silent no-op (CLAUDE.md section 12).
--
-- WHY 299. db/migrate.mjs runs seeds in name order. 299 sorts after every other
-- seed (298 is the five launch messages), so on a fresh database seed/009 writes
-- the row first and this file finds it there and does nothing.
--
-- SAFE TO RUN AGAIN. ON CONFLICT DO NOTHING: a row that is there, even one a
-- person has since edited, is never touched. Only the Fundhub company is
-- written; it is the company the pack path and the pulse read.
--
-- compliance_passed is true with approved_by NULL: the same standing seed/009
-- gave it and every seeded template has (migrations/116_template_approval.sql).

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-U02-ANALYZER-FUNDING-DELIVERY',
  'email',
  'Your Fundhub file is complete — audit, letters, roadmap, and portal access inside',
  $html$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your Fundhub file is complete</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hey {{contact.first_name}},</p>
            <p style="margin:0 0 16px 0;"><strong>Your UnderwriteIQ audit is done.</strong></p>
            <p style="margin:0 0 16px 0;">This isn't a credit report with some highlighting on it. Your file was pulled from all three bureaus and run through UnderwriteIQ — our own underwriting engine — which reads it the way a lender's system reads it, then models what changes when each item moves. Every document below came out of that analysis. Nothing in this pack is boilerplate.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>1. Your Credit Analysis Report</strong></p>
            <p style="margin:0 0 16px 0;">The full read on your file. What's helping you, what's costing you, and exactly which items are standing between you and an approval right now.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>2. Your Cleanup Letters — 9 total, ready to send</strong></p>
            <p style="margin:0 0 8px 0;">Built line by line off your report, not pulled off a shelf. Personal info corrections, inquiry removals, and formal disputes, split by bureau:</p>
            <p style="margin:0 0 4px 0;">Experian — personal info, inquiries, accounts</p>
            <p style="margin:0 0 4px 0;">Equifax — personal info, inquiries, accounts</p>
            <p style="margin:0 0 16px 0;">TransUnion — personal info, inquiries, accounts</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>3. Your 6-Month Optimization Roadmap</strong></p>
            <p style="margin:0 0 16px 0;">The actual sequence. What to do in week one, what to do in month two, and what has to be true before you apply for anything. Most "game plans" are three bullets and a sales pitch. This one has dates on it.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>4. Your Lender Match List</strong></p>
            <p style="margin:0 0 16px 0;">The specific lenders and products your file lines up with, plus the approval criteria for each — so you know what you're walking into before you apply.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>5. Your Capital Readiness Summary</strong></p>
            <p style="margin:0 0 16px 0;">Where you stand today, what you're realistically approved for right now, and what that number becomes once the roadmap is executed.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>Why this looks different from anything else you've been sent</strong></p>
            <p style="margin:0 0 16px 0;">Most funding companies are a spreadsheet and a guy. They eyeball your report, run your name through a lender list they bought, and send you a PDF that says "improve your utilization."</p>
            <p style="margin:0 0 16px 0;"><strong>We built the engine.</strong></p>
            <p style="margin:0 0 16px 0;">UnderwriteIQ parses every tradeline, inquiry, and data field on your file, cross-references it against live approval criteria from the lenders we actually work with, and models the outcome of each move before you make it. Machine learning ranks which actions produce the biggest fundability gain per week of effort — because the order you do things in matters more than the things themselves. Then a real underwriter reviews the output before it reaches you.</p>
            <p style="margin:0 0 16px 0;">That's why your roadmap has dates on it. That's why your lender list has your name attached to it instead of being a generic top-20. And that's why your dispute letters cite the specific reporting violations on your file rather than "please verify this account."</p>
            <p style="margin:0 0 16px 0;">Software this specific doesn't exist anywhere else in this industry. We know, because we tried to buy it before we built it.</p>

            <p style="margin:24px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.4;color:#0A0A0A;"><strong>And your course access</strong></p>
            <p style="margin:0 0 20px 0;">Every deliverable above has a walkthrough waiting in your portal. Short modules showing you exactly how to execute each piece — how to send the letters, how to sequence applications, how to move fastest without tanking your file. The documents tell you what. The course shows you how.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:4px 28px 24px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" bgcolor="#0A0A0A" style="background-color:#0A0A0A;border-radius:6px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{portal_login_url}}" style="height:48px;v-text-anchor:middle;width:540px;" arcsize="8%" stroke="f" fillcolor="#0A0A0A">
                    <w:anchorlock/>
                    <center style="color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">Access Your Portal →</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-- -->
                  <a href="{{portal_login_url}}"
                     style="display:block;width:100%;box-sizing:border-box;background-color:#0A0A0A;border-radius:6px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:48px;min-height:48px;text-align:center;text-decoration:none;padding:0 16px;">
                    Access Your Portal →
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">First time in? Create your login using this email address. Already set up? Log in and everything's in your dashboard.</p>
            <p style="margin:0 0 16px 0;">Start here: open the Capital Readiness Summary, then watch Module 1. That's your first 20 minutes.</p>
            <p style="margin:0 0 24px 0;">Anything in the pack you want walked through — reply to this email.</p>
            <p style="margin:0 0 4px 0;">— The Fundhub Team</p>
            <p style="margin:0;color:#52525B;font-size:14px;">Fundhub.ai • Funding Intelligence for Entrepreneurs</p>
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
WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING;
