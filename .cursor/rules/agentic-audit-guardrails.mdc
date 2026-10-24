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
- Never print secrets, SSN, full account numbers, or passwords in chat/boards

## Act-as-you limits

- Agent may: read prove Gmail, click portal/magic links, upload docs, sign **sim** contracts, text from the **agent** number
- Agent may not: change bank passwords, buy numbers without Chris, or treat “Gmail live” as full life-admin access outside Fundhub prove paths
- Full End-To-End Audit: always **5 sim files** (Funding / Repair / Combo / Inquiry / Course — different scenarios to try to break it) with **simulated credit files**; one scenario each walks that file’s event path — **not** a 5×5 cartesian unless the company-sim list says that (the original board is not in the repo); do not fork five copies of the same person. **ClickFunnels one-pass:** new plus-tag per funnel attempt — do not score a second pass on the same contact as a product FAIL.

## Audit vs fix

- Bare **audit** / “what’s broken” = read-only prove (`fundhub-auditor`), write findings to the board
- **Full End-To-End Audit** = send + walk + prove every live path in order (`.cursor/rules/full-end-to-end-audit.mdc`). Not a read-only glance. Beats CLAUDE.md §0 — no split until yes + live/sandbox. Gate first (run everything? CRS live or sandbox?). Then walk the **dictator checklist** (five horsemen, fulfillment, AI call, doc chase, FTC upload, Meet → `fetchContext`, beta every-button). Skip any of those = not e2e done. Then stop — do not fix in the same pass. Do not ask Chris to click. **ClickFunnels apply is owner-ok** — do not score, nag, or touch.
- **Fix** = only named holes after Chris says fix
- Never audit-and-fix in one pass; never “turn red green” by editing the test
- Load the matching skill via `audit-vs-fix-router.mdc` (`fundhub-auditor` / `fundhub-fixer` / `fundhub-builder` / UI / perf)

## Blast / automation safety

- Present / soft-pull / pay-link buttons: **one intentional click**, with idempotency checked
- Cap outbound SMS/email per run (e.g. max N messages) **unless** Chris said **Full End-To-End Audit** and answered **yes** to run everything — then do not cap; walk every live send on that path
- Live **CRS / bureau pull** only after he picked **live** on the Full End-To-End Audit gate (question 2). Sandbox = no live pull.
- Test/sim runs bypass quiet hours so fire can be proven. This never bypasses `texting-hours` for texts to Chris.
- Product is **live**; `INNGEST_EVENT_KEY` stays **on** — don’t flip live switches “for safety”

## Parallel agents

- Shared board only (`ops/workflows/…`)
- One lane per thread (Fund / Repair / DocGate / Inquiry / SM)
- Claim before work; no reminting shared people
- Cap concurrent agents (~5)

## Prove bar

- Script green ≠ done
- Live Playwright **100/100** when UI changed
- Then one **human-like** walk — the **agent** clicks the live page. For named live ships, do not ask Chris to “open X and confirm.”
- **Owner override (2026-08-25):** do not ask him to QA. Only if he *offers* a pass, then he does one.
- **Full End-To-End Audit exception:** Chris does **not** check Gmail, spam, or texts. The agent reads prove Gmail + the agent phone and writes the scorecard. Asking him to “check Updates / All Mail / your texts” is a FAIL.

## Doc Check specifically

- Variants must declare expected outcome (**accept** vs **request_more**) before run
- Wrong accept = FAIL
- Address on file must match the “good” pack before V1
