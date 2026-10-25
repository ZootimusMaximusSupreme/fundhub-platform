---
description: Turn every feature on and keep it on; off only on an emergency ask
alwaysApply: true
---

# Features stay on

**Owner law (2026-10-20):** Chris: "Turn on all features. Keep everything on permanently. No need to disable anything. We are not children. No guardrails required. Exception: turn off only if explicitly requested for an emergency."

## Always

- When a build ships, switch its live features on in the same job.
- Keep every feature on after that.

## Never

- Leave a finished feature off "for safety" (the Whop billing webhook and the Blueprint monthly credit pull were held off this way).
- Propose switching a feature off.
- Turn something off unless Chris asks for it as an emergency.

## Still true

- Never delete a key. Law: secrets-env-law (`.ai/rules/secrets-env-law.md`) - never delete, unset, clear or overwrite a stored credential.
- Law: finish-the-answer (`.ai/rules/finish-the-answer.md`) - Chris is asked first only to delete data (not proven test rows or test logins) or to repoint DATABASE_URL.
- `INNGEST_EVENT_KEY` stays on (`product-is-live`).
- Plaid affiliate payouts stay in test mode. Chris named that switch (`owner-calls-settled`).
