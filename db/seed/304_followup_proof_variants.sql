-- 304_followup_proof_variants.sql
--
-- A seed, not a migration, for the same reason as 301: it must run after the
-- seeds that write these template families on a new database.
--
-- Version B of the four second-touch follow-ups, for the first message test
-- (board: ops/workflows/backend-selling-lanes-2026-10-30.md, section 6e; owner GO
-- 2026-10-31, "Get it all done."). Each B is its version A word for word, plus one
-- real client win. So the test measures one thing: real proof, or no proof.
-- No text carries the come-back link (seed 302, independent review 2026-10-31):
-- SMS-S02-RESUME-2-B points to the email, exactly as its version A does.
-- src/messaging/experiments.mjs sends B to half the people (a fixed coin flip per
-- person) and falls back to A when a B row is missing, a draft or not passed.
--
--   SMS-S02-RESUME-2-B, EMAIL-S02-RESUME-2-B   stopped the survey partway, second
--                                              message. Goal: they finish the survey.
--   SMS-NOBOOK-02-B, EMAIL-NOBOOK-02-B         finished, no call booked, second message.
--                                              Goal: they book a call.
--
-- Where every fact comes from. Nothing is invented.
--   marketing/testimonials/testimonials.json, status "approved":
--     colin2  Colin Schmidt, business owner. Reached an 840 credit score, then got
--             around $225,000 in funding for one of his companies. Video
--             https://fundhub.ai/funnel/slo-testimonial-colin2.mp4, poster
--             https://fundhub.ai/funnel/slo-testimonial-colin2-poster.jpg.
--     gene    Gene, owner of three LLCs. Scores from the low 600s to 810, about
--             $420,000 in business funding over three years. Video
--             https://fundhub.ai/funnel/slo-testimonial-gene.mp4, poster
--             https://fundhub.ai/funnel/slo-testimonial-gene-poster.jpg.
--   Each chase gets a different client, so a person in both chases never reads
--   the same story twice. Sarah is left out: she is on the sales team and is not
--   approved yet.
-- Written with Copybot in Chris's voice, the same pass as 301.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, v.template_key, v.channel, v.subject, v.body, true
  FROM orgs o
 CROSS JOIN (VALUES
  ('SMS-S02-RESUME-2-B', 'sms', NULL::text,
$c$Morning {{contact.first_name}}. You're {{survey_taps_left}} from booking your Fundhub call. Stuck on the credit score one? A best guess is fine. We check the real one together when we talk. Our client Colin took his score to 840 and got about $225,000 in funding. The link in today's email picks up where you stopped.
- Chris
Reply STOP to opt out.$c$),

  ('EMAIL-S02-RESUME-2-B', 'email', 'Why we look before you apply',
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
            <p style="margin:0 0 16px 0;">Colin Schmidt is one of our clients. He got his credit score to 840. Then he got about $225,000 in funding for one of his companies. Here he is telling it:</p>
            <p style="margin:0 0 16px 0;"><a href="https://fundhub.ai/funnel/slo-testimonial-colin2.mp4" style="text-decoration:none;"><img src="https://fundhub.ai/funnel/slo-testimonial-colin2-poster.jpg" width="220" alt="Colin Schmidt, business owner: around $225,000 in funding" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></p>
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

  ('SMS-NOBOOK-02-B', 'sms', NULL::text,
$c$Hey {{contact.first_name}}, quick one. On the call we spot what a bank would say no to on your file, before you apply. Our client Gene went from the low 600s to 810, then got about $420,000 in funding over three years. Grab a time: {{custom_values.booking_link}}
Reply STOP to opt out.$c$),

  ('EMAIL-NOBOOK-02-B', 'email', 'Here''s how the call goes',
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
            <p style="margin:0 0 16px 0;">Gene is a client of ours. He owns three LLCs. His scores were in the low 600s, and he got them up to 810. Over three years, he brought in about $420,000 in business funding. Hear it from him:</p>
            <p style="margin:0 0 16px 0;"><a href="https://fundhub.ai/funnel/slo-testimonial-gene.mp4" style="text-decoration:none;"><img src="https://fundhub.ai/funnel/slo-testimonial-gene-poster.jpg" width="220" alt="Gene, owner of three LLCs: about $420,000 over three years" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a></p>
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
</html>$html$)
) AS v(template_key, channel, subject, body)
ON CONFLICT (org_id, template_key) DO NOTHING;
