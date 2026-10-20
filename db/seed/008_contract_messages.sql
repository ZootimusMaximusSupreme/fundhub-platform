-- 008_contract_messages.sql — the two emails the contract feature sends.
--
-- WHY THESE ARE TEMPLATES AND NOT STRINGS IN CODE. Same reason every other piece
-- of copy in this platform is a row: changing the wording must never need a
-- developer. These two are editable from public/app/template-editor.html like
-- the other 176, and the send path reads them at send time.
--
-- compliance_passed IS TRUE, and that is the same treatment every seeded
-- template gets — the flag records that the copy shipped reviewed, with
-- approved_by NULL because no person clicked approve (116_template_approval.sql
-- explains why NULL is the honest value there rather than a backfilled name).
-- Editing either one through the editor clears the flag, and the send then
-- reports `template_not_approved` and skips the email until somebody re-approves
-- it. The contract still sends; only the email waits.
--
-- WHAT THEY DELIBERATELY DO NOT SAY. No promise about funding, no claim about a
-- credit outcome, no deadline that is not real. A contract notification is a
-- delivery notice, not a marketing message.
--
-- MERGE TAGS. `contact.first_name` and `contract.*` are supplied by
-- signerContext() in src/contracts/notify.mjs — NOT by clientContext(), because
-- a signer may be a counterparty who is not a client at all.
--
-- IDEMPOTENT (Rule 9): ON CONFLICT DO NOTHING, so a re-run cannot duplicate or
-- overwrite wording somebody has since edited.

DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped contract message seed: no org with slug fundhub';
    RETURN;
  END IF;

  INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
  VALUES (
    v_org,
    'CONTRACT-SEND-EMAIL',
    'email',
    'Please sign: {{contract.title}}',
    E'Hi {{contact.first_name}},\n\n' ||
    E'{{contract.sender}} has sent you a document to sign: {{contract.title}}.\n\n' ||
    E'Open it here:\n{{contract.link}}\n\n' ||
    E'The link is just for you — please do not forward it. It works for 30 days.\n\n' ||
    E'You will be able to read the whole document before you sign anything. ' ||
    E'When you sign, a copy is saved with the date and time, and you can come ' ||
    E'back to the same link to read it again whenever you like.\n\n' ||
    E'If you were not expecting this, or something does not look right, reply to ' ||
    E'this email and a person will get back to you.',
    true
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
  VALUES (
    v_org,
    'CONTRACT-REMIND-EMAIL',
    'email',
    'Still waiting on your signature: {{contract.title}}',
    E'Hi {{contact.first_name}},\n\n' ||
    E'This is a reminder about {{contract.title}}, which is still waiting for ' ||
    E'your signature.\n\n' ||
    E'Open it here:\n{{contract.link}}\n\n' ||
    E'It only takes a minute. If you have decided not to sign, there is a button ' ||
    E'on that page to say so — that is genuinely fine, and it stops these ' ||
    E'reminders.\n\n' ||
    E'If you have any questions about the document, reply to this email and a ' ||
    E'person will get back to you.',
    true
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'contract message templates seeded (or already present) for org %', v_org;
END $$;

-- ---------------------------------------------------------------------------
-- The invoice email.
--
-- Added here rather than in a new seed file because it is the same act: copy
-- this platform sends that had nowhere to live. `invoices.status = 'sent'` has
-- existed since 017 and nothing has ever emailed one, so every invoice the
-- workflows have raised has been silent.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing. It states an amount
-- and a due date, and makes no claim about credit outcomes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN RETURN; END IF;

  INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
  VALUES (
    v_org,
    'INVOICE-SENT-EMAIL',
    'email',
    'Your {{invoice.kind}} invoice from {{invoice.company}} — {{invoice.amount}}',
    E'Hi {{contact.first_name}},\n\n' ||
    E'Here is your invoice from {{invoice.company}}.\n\n' ||
    E'What it is for: {{invoice.kind}}\n' ||
    E'Amount: {{invoice.amount}}\n' ||
    E'Due: {{invoice.due}}\n' ||
    E'Reference: {{invoice.reference}}\n\n' ||
    E'If you have already paid this, thank you — you can ignore this email.\n\n' ||
    E'If anything here does not look right, reply to this email and a person ' ||
    E'will get back to you.',
    true
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'invoice email template seeded (or already present) for org %', v_org;
END $$;
