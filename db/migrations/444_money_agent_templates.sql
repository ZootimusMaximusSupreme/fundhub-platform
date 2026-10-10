-- 444_money_agent_templates.sql — the three texts the money helper can send.
--
-- Used by src/finance/money-agent.mjs through sendTemplated (which only queues;
-- the dispatcher sends, behind dry-run, quiet hours and the opt-out read).
-- Finance OS tracks and reminds. It never moves money.
--
-- The ladder for one late payment (owner-set 2026-10-06):
--   due in 0-3 days    SMS-MONEY-AGENT-REMINDER   (Clarity Payments only — card
--                      reminders before the due date are SMS-FINANCE-OS-CARD-DUE,
--                      sent by src/workflows/finance-os-card-due-reminders.mjs)
--   1 day late         SMS-MONEY-AGENT-LATE-1
--   3 days late        SMS-MONEY-AGENT-LATE-2
--   7 days late        a task for the CSM. No more texts about that payment.
--
-- The {{money.*}} tags are filled by the money helper, not by the client record:
--   money.what           "Fundhub payment plan", "BNPL plan with Fundhub LLC",
--                        or the card's own name, e.g. "Business Amex card"
--   money.amount_phrase  " of $500.00", or empty when the amount is unknown
--   money.due            "Oct 2"
--
-- DO NOTHING on conflict: a company that already edited one of these keys in
-- the template editor keeps its own copy.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, t.template_key, 'sms', NULL::text, t.body, true
  FROM orgs o
 CROSS JOIN (VALUES
   ('SMS-MONEY-AGENT-REMINDER',
    $c$Fundhub reminder: your {{money.what}} payment{{money.amount_phrase}} is due {{money.due}}. Reply STOP to opt out.$c$),
   ('SMS-MONEY-AGENT-LATE-1',
    $c$Fundhub money helper: we have not seen your {{money.what}} payment{{money.amount_phrase}} that was due {{money.due}}. If you already paid, you can ignore this. Reply STOP to opt out.$c$),
   ('SMS-MONEY-AGENT-LATE-2',
    $c$Fundhub money helper: your {{money.what}} payment{{money.amount_phrase}} from {{money.due}} still shows as unpaid. If something is wrong, open your Money page and tap "Talk to a person". Reply STOP to opt out.$c$)
 ) AS t(template_key, body)
ON CONFLICT (org_id, template_key) DO NOTHING;
