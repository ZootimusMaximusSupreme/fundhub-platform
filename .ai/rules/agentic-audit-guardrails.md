---
description: Hard stops and fences for full agentic company audits (sim + prove)
alwaysApply: true
---

# Agentic audit guardrails

**Owner-approved (2026-08-24, doc-gate session):** Fences for a full agentic company audit (act-as-client + staff + docs + mail + phone). Reinforces existing owner laws; does not replace `CLAUDE.md` or the audit/fix skills.

Sims / Full E2E: assume paid and skip ClickFunnels apply — see `sim-assume-paid.mdc`.

## Hard stops (never without an explicit “GO” in that message)

- Live **credit Pull**
- Real **card charge**
- Real **bureau mail / PostGrid**
- Wipe anything that isn’t clearly **demo**
- Open forbidden files (e.g. `9af65808`)
- Put Chris’s **personal prove phone** on a sim client
- Rotate / re-paste secrets unless that exact key just failed live

## Identity & privacy

- **Plus-tag emails only** for sim people (`+sim-…@`)
- One dedicated **agent phone** for inbound/outbound sim (`661-605-4248`), never the personal prove line for blasts
- Raw ID/SSN/bank stay in **gitignored** folders; only blurred packs in evidence when sharing
- Never use a real client or a real client's file for a sim, a roleplay or an agent test.
- Never print secrets, SSN, full account numbers, or passwords in chat/boards

## Act-as-you limits

- Agent may: read prove Gmail, click portal/magic links, upload docs, sign **sim** contracts, text from the **agent** number
- Agent may not: change bank passwords, buy numbers without Chris, or treat “Gmail live” as full life-admin access outside Fundhub prove paths
- Law: full-end-to-end-audit (`.ai/rules/full-end-to-end-audit.md`) - always five sim files, one scenario each, no 5x5 grid; the ClickFunnels one-pass rule means a new plus-tag per funnel attempt.

## Audit vs fix

- Law: audit-vs-fix-router (`.ai/rules/audit-vs-fix-router.md`) - audit and fix are two doors; a bare audit is read-only; a Full End-To-End Audit follows its own rule; fix only what Chris names.
- Never “turn red green” by editing the test.

## Blast / automation safety

- Present / soft-pull / pay-link buttons: **one intentional click**, with idempotency checked
- Cap outbound SMS/email per run (e.g. max N messages) **unless** Chris said **Full End-To-End Audit** and answered **yes** to run everything — then do not cap; walk every live send on that path
- Live **CRS / bureau pull** only after he picked **live** on the Full End-To-End Audit gate (question 2). Sandbox = no live pull.
- Test/sim runs bypass quiet hours so fire can be proven. This never bypasses `texting-hours` for texts to Chris.
- Law: product-is-live (`.ai/rules/product-is-live.md`) - INNGEST_EVENT_KEY stays on; never flip a live switch for safety.

## Parallel agents

- Shared board only (`ops/workflows/…`)
- One lane per thread (Fund / Repair / DocGate / Inquiry / SM)
- Claim before work; no reminting shared people
- Cap concurrent agents (~5)

## Prove bar

- Law: test-means-human-click (`.ai/rules/test-means-human-click.md`) - a green script is not done; live Playwright to 100/100, then the agent clicks the live page; Chris does no QA unless he offers.
- Law: full-end-to-end-audit (`.ai/rules/full-end-to-end-audit.md`) - in a Full End-To-End Audit the agent reads Gmail and the agent phone; asking Chris to check mail or texts is a FAIL.

## Doc Check specifically

- Variants must declare expected outcome (**accept** vs **request_more**) before run
- Wrong accept = FAIL
- Address on file must match the “good” pack before V1
