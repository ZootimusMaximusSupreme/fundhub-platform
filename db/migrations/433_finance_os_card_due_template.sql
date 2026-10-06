-- 433_finance_os_card_due_template.sql — the text Finance OS sends when a credit
-- card payment is coming due.
--
-- Used by src/workflows/finance-os-card-due-reminders.mjs through sendTemplated.
-- One text per card per due date, 0-3 days out, only when no payment is on file
-- since the last statement. Finance OS tracks and reminds. It never moves money.
--
-- The three {{card.*}} tags are filled by that workflow, not by the client
-- record (src/banking/card-due-reminders.mjs planCardDue):
--   card.name          the card's own name, e.g. "Business Amex"
--   card.amount_phrase " of $135.00", or empty when the minimum is unknown
--   card.due_phrase    "Oct 21", or "today, Oct 21" on the due day
--
-- Renders as: "Fundhub reminder: your Business Amex payment of $135.00 is due
-- Oct 21. Reply STOP to opt out."
--
-- DO NOTHING on conflict: if a company already has this key (edited in the
-- template editor), its copy stays exactly as it is.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id,
       'SMS-FINANCE-OS-CARD-DUE',
       'sms',
       NULL::text,
       $c$Fundhub reminder: your {{card.name}} payment{{card.amount_phrase}} is due {{card.due_phrase}}. Reply STOP to opt out.$c$,
       true
  FROM orgs o
ON CONFLICT (org_id, template_key) DO NOTHING;
