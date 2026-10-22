-- 503 — bank outreach, manual first (owner, 2026-10-21): "We start manually, we move to AI ...
-- You can't just ask lenders for data points; the goal is to warm them up ... I was hoping we could
-- hop on a call so I can ask about the data points." Build spec: docs/specs/bank-outreach-manual-first-2026-10-21.md.
--
-- Two things, both words only:
--   1. EMAIL-BANK-OUTREACH-1, -2 and -3 (seeded by 495 asking a banker for three data points) are
--      rewritten as warm-up notes that ask for a call and never ask for data. A rep sends the first
--      one by hand from their own email (the screen fills it from this copy); the automatic emails
--      still use the same three keys and still need approval, so {{outreach.footer}} stays last.
--      Only a row that is still unapproved AND still holds the exact 495 words changes. A row a
--      person edited or approved is never touched.
--   2. SMS-BANK-OUTREACH-1: the text a rep sends by hand from their own phone. It ends with the
--      opt-out words. No message leaves Fundhub's servers for it.
--
-- Nothing here approves copy, turns on sending or starts the reply agent.

UPDATE message_templates t
   SET subject = v.subject, body = v.body, updated_at = now()
  FROM (VALUES
    ('EMAIL-BANK-OUTREACH-1',
$old$Hi {{banker.first_name}},

Fundhub works with business owners and individuals in {{bank.state_name}} who need credit cards, lines of credit and loans. We want to send them to {{bank.name}}.

Every client we send is pre-verified with top-tier underwriting before they apply, so your team gets clean, complete files.

To match the right clients to you, we need three answers:
1. Which products you offer (cards, lines of credit, loans; we do not send mortgages)
2. What you approve and how you approve it
3. Where clients apply (an online link or a paper application)

Reply to this email and we start matching clients to you.

Fundhub Bank Partnerships

{{outreach.footer}}$old$,
'A quick call about {{bank.name}}',
$new$Hi {{banker.first_name}},

I'm {{rep.name}} with Fundhub. We have clients in {{bank.state_name}} who need credit cards, lines of credit and loans, and I want to send them to {{bank.name}}.

Are you free for a quick call this week? I want to learn what your team looks for in a client. That way, when I send you someone, they already fit what you do.

Reply with a day and time that work for you, or the best number to reach you.

{{rep.name}}
Fundhub

{{outreach.footer}}$new$),
    ('EMAIL-BANK-OUTREACH-2',
$old$Hi {{banker.first_name}},

A quick follow-up on sending pre-verified clients to {{bank.name}}.

The fastest start is three facts: your minimum credit score, the credit bureau you pull, and your application link. With those, we route matching clients to you.

If someone else at {{bank.name}} works with referral partners, reply with their name and we will reach out to them.

Fundhub Bank Partnerships

{{outreach.footer}}$old$,
'Following up on a call about {{bank.name}}',
$new$Hi {{banker.first_name}},

I'm following up on my note about {{bank.name}}. I still have clients in {{bank.state_name}} I want to send your way, and a short call is the best way for me to learn what your team likes to see.

What day this week works for you?

{{rep.name}}
Fundhub

{{outreach.footer}}$new$),
    ('EMAIL-BANK-OUTREACH-3',
$old$Hi {{banker.first_name}},

This is our last email about sending clients to {{bank.name}}.

If the timing is wrong, reply "later" and we will check back next quarter. If you want the clients, reply with your application link and we take it from there.

Fundhub Bank Partnerships

{{outreach.footer}}$old$,
'One last note about {{bank.name}}',
$new$Hi {{banker.first_name}},

This is my last note for now. I want to send {{bank.name}} clients in {{bank.state_name}}, and a short call lets me learn what fits your team.

If the timing is not right, reply "later" and I check back next quarter. If it is right, reply with a time and I call you.

{{rep.name}}
Fundhub

{{outreach.footer}}$new$)
  ) AS v(template_key, old_body, subject, body)
 WHERE t.template_key = v.template_key
   AND t.channel = 'email'
   AND t.compliance_passed = false
   AND t.body = v.old_body;

-- Guarded like 495's seeds: only where the company table and its slug exist (the disposable test
-- schema has no slug, so it skips). Unapproved on purpose; approval is a separate owner action.
DO $$
BEGIN
  IF to_regclass('message_templates') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orgs' AND column_name = 'slug' AND table_schema = current_schema()) THEN
    EXECUTE $seed$
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'SMS-BANK-OUTREACH-1', 'sms', NULL,
$c$Hi {{banker.first_name}}, this is {{rep.name}} with Fundhub. I have clients in {{bank.state_name}} who need credit cards, lines of credit and loans, and I want to send them to {{bank.name}}. Do you have 10 minutes this week for a quick call? Reply STOP to opt out.$c$, false
  FROM orgs o
 WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING
    $seed$;
  END IF;
END $$;
