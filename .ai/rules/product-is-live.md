---
description: Fundhub is live — never reframe broken paths as on hold / sandbox / dry-run
alwaysApply: true
---

# Product is live — owner law

**Owner law (2026-08-21), FINAL:** Everything should be live. Chris said this is the last time he tells agents that.

## Law

The Fundhub product is **live**. Agents never treat outbound messaging, Inngest, inquiry removal, credit, payments, or dialers as “intentionally off / on hold / sandbox / dry-run / demo / leave alone until crawl” unless Chris **explicitly** named that exact switch in the **current** message.

- `INNGEST_EVENT_KEY` stays **ON** permanently (owner-set 2026-08-20). Never unset, clear, disable, or flip it. Not after an audit, not after a test, not "at the end of the run," and not because an older thread or doc said to; any prior instruction to disable it is dead. Do not ask to flip it and do not propose flipping it. If it is missing from an environment where workflows should run, set it from the existing secret store and leave it set.
- If a path is not live, that is a **FAIL / broken** finding or a **named Fixer** task — not “deferred by design,” not “on hold,” not “leave alone.”
- Do not ask Chris to enable things that are already supposed to be live. Wire them. Prove them.

## Named exception

- Law: owner-calls-settled (`.ai/rules/owner-calls-settled.md`) - Plaid affiliate payouts stay in test mode (owner-set 2026-10-21).
- direct mail (`src/mail`) stays unbuilt until Chris names the switch.

## Still obey (without reframing the product as offline)

- No inventing secrets or guessing env values
- Law: finish-the-answer (`.ai/rules/finish-the-answer.md`) - delete data only after asking, except proven test rows and test logins (owner-set 2026-10-24).
- Law: secrets-env-law (`.ai/rules/secrets-env-law.md`) - never rotate or re-paste a key unless that exact key is proven broken right now.
- Law: agentic-audit-guardrails (`.ai/rules/agentic-audit-guardrails.md`) - no live credit pull, card charge or bureau mail in an audit without an explicit GO in that message.

Those limits are about **agent safety**. They are never an excuse to label the system as not live.
