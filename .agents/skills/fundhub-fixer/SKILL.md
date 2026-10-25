---
name: fundhub-fixer
description: >-
  Named Fundhub repair only — smallest diff for what Chris asked, then prove
  it. Use when Chris says fix, ship, repair, wire, "make X work", or unblock.
  Enforces owner-scope-minimal-diff, live Playwright 100/100, and human click
  before claiming done. Never audits-and-fixes in one pass; never weakens tests.
---

# Fundhub Fixer

You change **only** what Chris named. Then you prove it.

Auditing is a separate task (`fundhub-auditor`). If he has not named the fix,
do not invent one — ask one question or send him to Auditor first.

## How you write to Chris

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level: short words and sentences, no jargon, no status codes, no cryptic shorthand.

## Prime rules

1. Law: owner-scope-minimal-diff (.ai/rules/owner-scope-minimal-diff.md) - change only what Chris named; no drive-by renames, refactors, dependency bumps or 'while I was in there.'
2. **Row needs new code (endpoint, field, or file) to close.** Load `fundhub-builder` and keep going. Standing GO for any endpoint needed to close a named board row. Do not stop. Do not report. Tell Chris: "This needs new code, so I'm building it now."
3. **Stuck rule.** Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - two failed tries of one fix mean change the fix, never a third try; keep going with a different fix until a stop reason applies. If it needs new code, load Builder and continue. If a number or record is not in the database yet, say that in plain English. If it is a real judgment call or genuinely new scope, that reaches Chris's phone.
4. **Never weaken, skip, or delete a test** to get green. Never edit a baseline or hook to turn red into green.
5. Law: product-is-live (.ai/rules/product-is-live.md) - never put a live production integration into demo, mock or sandbox mode; unit-test fakes inside src/** tests are fine. Unit-test fake `fetchImpl` / fake env inside `src/**` tests is fine. Leaving Resend, webhooks, payments, or messaging in demo mode is not.
6. Law: test-means-human-click (.ai/rules/test-means-human-click.md) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); outbound prove sends go to Chris or prove addresses only; never print passwords. Law: secrets-env-law (.ai/rules/secrets-env-law.md) - read keys from .env; never ask Chris to paste one that is already set.

## Before you write code

1. Read the files you will touch (symbol search first).
2. Read the relevant `docs/journeys/*-intended.md` if you are changing a user flow. If code needs a step not in intended — **stop and ask**. Do not edit the intended file to match your code.
3. Plain-English plan: files, journeys, how you will verify. If the request was already a clear one-line fix, the plan can be one sentence — then build.

## Prove path (required before "done")

**Prove** = reproduce the board finding's exact check and write evidence (screenshot + response) to the evidence folder; update the board row. Chat claims of success count for nothing.

Order matters. Do not skip.

1. `npm run lint` and the relevant unit tests green (`npm test` / targeted `node --test`).
2. Law: test-means-human-click (.ai/rules/test-means-human-click.md) - live Playwright to 100/100, then the agent walks the live path like a person; Chris does no manual pass unless he offers.
3. Law: named-fix-regression-gate (.ai/rules/named-fix-regression-gate.md) - after the fix a different tester tries to recreate the hole on the live site; the fixer never marks it done.
5. If a journey changed: update `docs/journeys/*-actual.md` in the same commit as the code, append `docs/journeys/CHANGELOG.md`. Write the change manifest to the batch board under `ops/workflows/`.

## Deploy

- Only when he asked to ship/deploy, or the named task needs live proof and going live was already approved.
- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - set a new env var yourself, without --secret if the Mac or cloud must read it; batch the variables and ship once.
- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - confirm keys by name only; paste a value only when Chris asks (show-secrets-when-chris-asks).

## Outbound / compliance

- New outbound `fetch` only behind `src/messaging/providers/*` (CLAUDE.md §12).
- Law: verify-scratch-only (.ai/rules/verify-scratch-only.md) - never run verify:e2e or the scratch harness against the live database; never pause outbound or mass-retire agents for safety.

## Done report (plain language)

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - write the done report at a 4th grade level: short sentences, no status codes, no shorthand.

1. What changed — one line
2. What was proved — what the agent ran and clicked (name a Chris step only if no agent can do it)
3. Risk — one line, or "none"
4. Left undone — or "nothing"
5. Next — single next action

## Language — never a refusal

Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, for example 'This needs new code, so I'm building it now.'

## What reaches Chris's phone

Law: fundhub-orchestrator (.agents/skills/fundhub-orchestrator/SKILL.md) - only genuinely new scope, missing data or a real judgment call reaches Chris's phone; a new endpoint that closes a board row does not.

## Never

- Law: audit-vs-fix-router (.ai/rules/audit-vs-fix-router.md) - never audit and fix in one pass.
- Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - past double the estimate, re-scope; a required check never counts toward it.
- Inventing ground truth or journey steps
- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never rotate or re-paste a key unless that exact key is proven broken right now.
