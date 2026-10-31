# FundHub SMS Templates — Current (pulled 2026-08-05)

26 standalone templates. All compliant: prohibited-wording scrubbed, "Reply STOP to opt out." on every template.

## SMS-BLK-01-NEW-NEGATIVE-PAUSED

Hey {{contact.first_name}}, it's Josh from Fundhub. We spotted a change on your financial profile, so we've paused capital temporarily to protect your approvals. I'm reviewing now and will reach out if your timeline or costs need adjusting. Questions? Just reply here. Reply STOP to opt out.
## SMS-BS01-01-CONFIRMATION-HUB

Hey {{contact.first_name}}, it's Josh from Fundhub. Your Confirmation Hub is ready. Watch these quick videos before our call so we can move fast: {{custom_values.confirmation_hub_link}} Reply CONFIRM when done. Questions? Just reply here. Reply STOP to opt out.
## SMS-BS01-02-PRECALL-NUDGE

Hey {{contact.first_name}}, Josh from Fundhub here. Quick pre-call step: watch this 2-min Confirmation Hub video so your call is more productive: {{custom_values.confirmation_hub_link}} Reply CONFIRM when you've watched it. Reply STOP to opt out.
## SMS-F02-01-PORTAL-ID

Hey {{contact.first_name}}, it's Josh from Fundhub. We still need your ID and portal step completed to move your file forward. 60-sec walkthrough: {{custom_values.onboarding_walkthrough_link}} Finish here: {{custom_values.portal_link}} Stuck? Just reply here. Reply STOP to opt out.
## SMS-F02-02-PORTAL-ID-FOLLOWUP

Hey {{contact.first_name}}, Josh again. Your ID and portal step are still open and your file is waiting on them. Finish here: {{custom_values.portal_link}} 2-min walkthrough: {{custom_values.portal_id_walkthrough_video_link}} If anything is confusing, just reply and we'll guide you.
— Josh at Fundhub. Reply STOP to opt out.
## SMS-F03-01-ROUND-SUBMITTED

Update from Josh, {{contact.first_name}}: Round {{custom_fields.funding_round_number}} has been submitted. Partner banks usually review within 24 to 72 hours, sometimes longer. I'll text you the moment there's movement. What happens next: {{custom_values.funding_round_next_steps_video_link}}
— Josh at Fundhub. Reply STOP to opt out.
## SMS-F04-01-ROUND-MOVEMENT

Update from Josh, {{contact.first_name}}: we have movement on Round {{custom_fields.funding_round_number}}. We're reviewing partner bank decisions and terms now. 60-sec explainer: {{custom_values.funding_round_next_steps_video_link}} We'll text your next step shortly.
— Josh at Fundhub. Reply STOP to opt out.
## SMS-F06-01-MISSING-DOCS

Hey {{contact.first_name}}, it's Josh from Fundhub. A partner bank needs one more item to keep your round moving: {{custom_fields.funding_condition_description}} Upload here: {{custom_values.docs_upload_link}} Questions? Just reply. Reply STOP to opt out.
## SMS-F07-01-LOC

Big update, {{contact.first_name}}: your capital is locked in. Your next steps just landed in your email from hello@fundhub.ai. Open it now so we keep momentum. Don't see it? Search Fundhub and check Promotions or Spam, or just reply here.
— Josh at Fundhub. Reply STOP to opt out.
## SMS-F10-01-INBOX-READY

Hey {{contact.first_name}}, it's Josh from Fundhub. Your dedicated Capital Inbox is set up: {{custom_fields.funding_email_forwarding_address}} If a bank asks where to send updates, use that address. If bank emails hit your personal inbox, forward them there. We monitor it and guide you step by step. Reply STOP to opt out.
## SMS-R00-01-REPAIR-ROUND-SENT

Hey {{contact.first_name}}, it's Josh from Fundhub. Profile optimization Round {{custom_fields.repair_round_number}} just went out. Agencies typically receive correction requests in 5 to 7 business days, with portal updates in about 30 days. What happens next: {{custom_values.cr_expectations_video_link}} Questions? Just reply. Reply STOP to opt out.
## SMS-R12-01-UPGRADE-INVITE

Hey {{contact.first_name}}, it's Josh from Fundhub. Your profile optimization is in motion. When you're ready, the next step is a capital game plan call where we map your cleanest approval path, best banks first, no wasted inquiries. Book here: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-R13-01-WELCOME-TO-FUNDING

Welcome to Capital, {{contact.first_name}}. It's Fundhub. Step 1 takes 2 minutes: complete your Capital Intake here: {{custom_values.portal_link}} From there we guide you step by step and keep you posted by text.
— Josh at Fundhub. Reply STOP to opt out.
## SMS-S04-01-CONFIRM

Hey {{contact.first_name}}, it's Josh from Fundhub. You're booked for {{appointment.start_time}}. Reply CONFIRM so we know you're set. Reschedule: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-S04-02-REMIND-24H

Fundhub reminder, {{contact.first_name}}: your call is tomorrow at {{appointment.start_time}}. Reply CONFIRM if you're still good. Reschedule: {{custom_values.booking_link}}
— Josh at Fundhub. Reply STOP to opt out.
## SMS-S04-03-REMIND-2H

Fundhub reminder, {{contact.first_name}}: your call starts at {{appointment.start_time}}. Reply CONFIRM if you're good to go. Reschedule: {{custom_values.booking_link}}
— Josh at Fundhub. Reply STOP to opt out.
## SMS-S05-01-NOSHOW

Hey {{contact.first_name}}, it's Josh from Fundhub. Looks like we missed you today. No stress. Grab a new time here: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-S05-02-NOSHOW-NUDGE

Hey {{contact.first_name}}, Fundhub checking in. Still want help getting this handled? Book a time here: {{custom_values.booking_link}}
— Josh at Fundhub. Reply STOP to opt out.
## SMS-C06-DECLINE

Hey {{contact.first_name}}, it's Josh from Fundhub. We finished reviewing your profile and capital isn't the right move today — approvals right now would be small and expensive, and we won't put you in that spot. The good news: we know exactly what's holding it back and it's fixable. Your advisor is sending the details to your email now. Questions? Just reply here. Reply STOP to opt out.
## SMS-DS01-REPAIR-REFERRAL

Hey {{contact.first_name}}, it's Josh from Fundhub. Based on your review, profile optimization is the step that unlocks your funding — we've mapped exactly what needs to move and in what order. Details are in your email. When you're ready, your advisor can get you started today: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-S05A-NOSHOW-RECOVERY

{{contact.first_name}}, it's Fundhub — looks like we missed each other on your call. Nothing is lost and nothing is closed. Grab a new time whenever suits: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-N01-COLD-NURTURE

Hey {{contact.first_name}}, Josh from Fundhub here. Most owners we talk to assume their credit profile is the problem. Usually it's the order they applied in. Same file, different sequence, very different result. If you want to see what yours actually supports: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-N02-WARM-NURTURE

Hey {{contact.first_name}}, it's Josh from Fundhub. You looked at funding with us a while back. Profiles move — and so do the banks. What your file supported then isn't what it supports now. Worth a fresh look: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-N03-HOT-NURTURE

Hey {{contact.first_name}}, Fundhub. You were one step from moving on your funding and it stalled out. Your analysis is still on file and still good. Want to pick it back up? {{custom_values.booking_link}}
— Josh at Fundhub. Reply STOP to opt out.
## SMS-N04-POST-FUNDING

Hey {{contact.first_name}}, it's Josh from Fundhub. Checking in now that your capital's in place — how's the deployment going? When you're ready to look at the next round, your file is already built and the second pass moves faster. Just reply here or grab time: {{custom_values.booking_link}} Reply STOP to opt out.
## SMS-N06-RENEWAL

Hey {{contact.first_name}}, Josh from Fundhub here. Your profile has had time to season since your last round, which usually means a higher ceiling this time. We can re-run it and tell you where you'd land: {{custom_values.booking_link}} Reply STOP to opt out.
