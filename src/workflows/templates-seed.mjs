// Known-real, audit-approved copy for message_templates — NOT auto-run anywhere
// (no boot file imports this). db/schema + db/seed/ are another session's territory
// (do not touch), so this stays as a plain, idempotent function in src/workflows/
// for whoever wires up the real seed step to call once against the live database.
//
// Unlike the N-series (where SMS is confirmed missing at the source, per Chris's own
// tracking note), these have real, already-approved content:
//  - F-03/F-04 SMS: workflow-coherence-audit.md "Ready-to-paste copy" section.
//  - F-07 SMS: same section (Funding Locked).
//  - AX-07 SMS: same section (Funding Paused / Blocker).
//  - Round Started SMS: Workflow-SMS-Fixes-Ready-to-Paste.md.
//  - F-03/F-04 email + F-07 email (FR22 "Total Funding Locked"): EMAIL-TEMPLATES-
//    SOURCE-OF-TRUTH.md (grepped for these specific keys only, per instructions —
//    this file was never read wholesale).
// Copy here is audit-scrubbed (opt-out present, no restricted wording), but
// compliance_passed is seeded false: owner decision 2026-08-04 — human approval
// in the template editor (migration 116) turns send on.

export const KNOWN_TEMPLATES = [
  {
    template_key: "SMS-ROUND-STARTED-NOTIFY",
    channel: "sms",
    body: "Hi {{contact.first_name}}, your FundHub capital round is officially underway — we're submitting now and will keep you posted at each step. Reply STOP to opt out."
  },
  {
    template_key: "SMS-F03-ROUND-SUBMITTED",
    channel: "sms",
    body: "Hey {{contact.first_name}} — quick update ✅ Your application Round {{custom_fields.funding_round_number}} is submitted. Now our partner banks review (usually 24–72 hours). We'll text you the moment there's movement. Reply STOP to opt out."
  },
  {
    template_key: "EMAIL-F03-ROUND-SUBMITTED",
    channel: "email",
    subject: "Funding Round {{custom_fields.funding_round_number}} has been submitted",
    body: "Hey {{contact.first_name}}, quick update — we've submitted Funding Round {{custom_fields.funding_round_number}} for your file. Lenders review the submission and return decisions on their timelines. If anything is needed to finalize this round we'll notify you as soon as it's requested. View Funding Round Status: {{CLIENT_PORTAL_URL}}"
  },
  {
    template_key: "SMS-F04-ROUND-APPROVALS",
    channel: "sms",
    body: "Hey {{contact.first_name}} — movement on Round {{custom_fields.funding_round_number}} ✅ We're reviewing partner bank decisions + terms now. We'll text your next step shortly. Reply STOP to opt out."
  },
  {
    template_key: "EMAIL-F04-ROUND-APPROVALS",
    channel: "email",
    subject: "Approvals are in for Funding Round {{custom_fields.funding_round_number}}",
    body: "Hey {{contact.first_name}}, approvals for Funding Round {{custom_fields.funding_round_number}} have started coming back and have been posted to your file. Review the approved offers, complete any lender verification steps if requested, and follow the activation/access instructions tied to each approval. View Approvals & Next Steps: {{CLIENT_PORTAL_URL}}"
  },
  {
    template_key: "SMS-F07-FUNDING-LOCKED",
    channel: "sms",
    body: "Huge update {{contact.first_name}} — your capital is locked in ✅ Your next steps just hit your email from hello@fundhub.ai. Open it now so we can keep momentum. If you don't see it, check Promotions/Spam. Reply STOP to opt out."
  },
  {
    template_key: "EMAIL-F07-FUNDING-LOCKED",
    channel: "email",
    subject: "You're locked in — your next steps are inside 🎉",
    body: "Hey {{contact.first_name}}, your total funding is locked. Total funding secured: ${{total_funding_locked}}. Do not activate any cards yet — we still need to finalize your post-funding instructions to protect your profile. Over the next few days we'll send activation & optimization instructions."
  },
  {
    template_key: "SMS-AX07-FUNDING-PAUSED",
    channel: "sms",
    body: "Hey {{contact.first_name}} — we've briefly paused your file for a quick review to keep your approvals on track. Our team is on it and will reach out shortly. Questions? Reply HELP. Reply STOP to opt out."
  },
  {
    template_key: "EMAIL-AX07-FUNDING-PAUSED",
    channel: "email",
    subject: "Funding paused — action needed",
    body: "Hi {{contact.first_name}}, we detected a new negative item on your credit report while your funding file is in progress. To protect approvals, we're pausing the funding sequence until this is handled. Next step: a quick call to approve the reduced-cost fix (${{contact.cf_negative_quote_amount}}) so we can continue."
  },
  {
    // Audit fix applied: {{booking_link}} -> {{contact.calendar_booking_link}}
    // (workflow-coherence-audit.md: "renders blank — non-standard field").
    template_key: "SMS-DPC05-NO-PROGRESS-72H",
    channel: "sms",
    body: "Hi {{contact.first_name}} — quick check-in. We haven't seen progress in 72 hours. Reply with what you're stuck on + your next step, or book here: {{contact.calendar_booking_link}}. Reply STOP to opt out."
  },
  {
    template_key: "EMAIL-DPC05-NO-PROGRESS-72H",
    channel: "email",
    subject: "No Progress for 72 Hours — Action Needed",
    body: "Hi {{contact.first_name}} — quick check-in. We haven't seen progress in 72 hours. Reply with what you're stuck on + your next step, or book here: {{contact.calendar_booking_link}}."
  },
  // Audit fix applied (workflow-coherence-audit.md): waits were 1 min for all
  // three — bumped to 30 min / 2 hr (the third wait is this workflow's own,
  // pre-exit check). The words match live seeds 301 and 305: no reply-to-confirm asks
  // (owner rule 2026-10-31, .ai/rules/confirm-on-the-calendar.md).
  {
    template_key: "SMS-AISET03-MSG1",
    channel: "sms",
    body: "Hey {{contact.first_name}}, it's Chris at Fundhub. Tried calling about your strategy call. To lock in your time, accept the calendar invite in your email. Need a new time? {{custom_values.booking_link}}\nReply STOP to opt out."
  },
  {
    template_key: "SMS-AISET03-MSG2",
    channel: "sms",
    body: "{{contact.first_name}}, one thing for your call: be at a computer, not your phone. We look at your credit together, and it won't move your score. Need a different time? {{custom_values.booking_link}}\nReply STOP to opt out."
  },
  {
    template_key: "SMS-AISET03-MSG3",
    channel: "sms",
    body: "Hey {{contact.first_name}}, last one from me today. If you haven't yet, accept the calendar invite in your email so your call is locked in. Time doesn't work anymore? No problem, grab another: {{custom_values.booking_link}}\nReply STOP to opt out."
  },
  {
    template_key: "SMS-AISET04-HANDOFF",
    channel: "sms",
    body: "Hey {{contact.first_name}}, it's Chris from Fundhub. Your call starts in 15 minutes. I've intro'd your advisor so you're not walking in cold — link: {{appointment.meeting_location}}. See you soon. Reply STOP to opt out."
  },
  {
    template_key: "SMS-BS01-01-BOOKED",
    channel: "sms",
    body: "Hey {{contact.first_name}}, it's Chris from Fundhub. You're booked — we'll text you again before the call. Need to move it? Just reply here. Reply STOP to opt out."
  },
  {
    template_key: "SMS-BS01-02-PRECALL",
    channel: "sms",
    body: "Hey {{contact.first_name}}, Chris from Fundhub here. Quick check-in before your call — reply if you have questions or need to reschedule. Looking forward to it. Reply STOP to opt out."
  },
  {
    template_key: "SMS-BS01-03-DAYOF",
    channel: "sms",
    body: "Hey {{contact.first_name}}, Fundhub — your call is coming up soon. Reply if you need anything before we start. Reply STOP to opt out."
  },
  {
    template_key: "SMS-S04-01-CONFIRM",
    channel: "sms",
    body: "You're booked, {{contact.first_name}}. {{appointment.start_time}} with a Fundhub funding advisor, about 20 minutes. Accept the calendar invite in your email to lock in your time, or move it here: {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-S04-02-REMIND-24H",
    channel: "sms",
    body: "{{contact.first_name}} — your Fundhub call is tomorrow, at {{appointment.start_time}}. Bring your business details; your advisor goes through your numbers with you live. If you haven't yet, accept the calendar invite in your email, or move it: {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-S04-03-REMIND-2H",
    channel: "sms",
    body: "{{contact.first_name}} — your Fundhub call is in about two hours, at {{appointment.start_time}}. Join with the link in your calendar invite, or move it: {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-NOBOOK-01",
    channel: "sms",
    body: "Hey {{contact.first_name}}, it's Chris from Fundhub. Your file is ready — grab a time so we can walk you through what it supports: {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-NOBOOK-02",
    channel: "sms",
    body: "Hey {{contact.first_name}}, Chris from Fundhub here. Still worth a look — same file, wrong order of apps is usually the ceiling. Book here: {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-NOBOOK-03",
    channel: "sms",
    body: "Last nudge from Chris at Fundhub, {{contact.first_name}}. Want help mapping your cleanest path? {{custom_values.booking_link}} Reply STOP to opt out."
  },
  {
    template_key: "SMS-DPC04-RESCHEDULE-REBOOKING",
    channel: "sms",
    body: "Hey {{contact.first_name}}, no worries about the reschedule! Here's the link to grab a new time that works better for you: {{calendar.booking_link}}. Looking forward to it! — Chris. Reply STOP to opt out."
  }
];

// seedKnownTemplates(db, orgId) — ON CONFLICT DO NOTHING so re-running is safe; does
// not overwrite anything Chris/the copy agent may already have edited in place.
export async function seedKnownTemplates(db, orgId) {
  for (const t of KNOWN_TEMPLATES) {
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (org_id, template_key) DO NOTHING`,
      [orgId, t.template_key, t.channel, t.subject || null, t.body]
    );
  }
}
