---
description: Full End-To-End Audit — walk every live path in order; agent proves mail, SMS, and on-screen data
alwaysApply: true
---

# Full End-To-End Audit

**Owner law (2026-08-25):** When Chris says **Full End-To-End Audit** (or full e2e audit / full end to end), this door wins. It is not a read-only code audit. It is not “build a screen instead.”

**CLAUDE.md §0 override:** When this trigger fires, do **not** run CLAUDE.md §0 in this turn. No workflow table. No copy-paste prompts. No “which one you are taking.” No shared-board split. Ask the two gate questions (exact wording below) and STOP. After he answers yes + live/sandbox, THEN §0 may split the run if needed. The gate always comes first.

Bare “audit” / “what’s broken” stays `fundhub-auditor` (read-only). See `audit-vs-fix-router.mdc`.

## Gate — ask, then stop

Do **not** start the run in the same turn. Ask both. Wait.

1. **Run everything?** Use this wording: “You asked for a Full End-To-End Audit. That means five sim files (different client scenarios) through every live path, in order: every offer, SMS, email, button, API, journey, fulfillment, uploads. I read Gmail and the agent phone. You do not check inboxes. Want me to run that now?”
2. **CRS / bureau money — live or sandbox?** This is the $32 credit pull. He cares about stacking live pulls. Other money (pay links, invoices): mint and send; do **not** charge his real card unless he names that.

Wait for yes + live/sandbox. Then run.

## After yes — what “everything” means

**Five horsemen** (default — not one empty file). Different client scenarios to try to break it, from the historical company-sim list (the original board is not in the repo): **Funding**, **Repair**, **Combo**, **Inquiry**, **Course**. Law: agentic-audit-guardrails (`.ai/rules/agentic-audit-guardrails.md`) - sims use plus-tag emails and the one agent phone, never Chris's personal prove phone. Do not mint five copies of the same person. Law: no-test-data-on-production (`.ai/rules/no-test-data-on-production.md`) - no test rows and no test logins are left on production; tests run on scratch databases. The one carve-out: a Full End-To-End Audit that Chris orders by name may make these sim people on live while it runs, and the agent removes them right after with the guarded delete (allowed since 2026-10-24).

Build **sample CRS + sample businesses** on those five so letters, Present / Underwrite snapshot, dash, and suggestions have data to read. Sandbox CRS still means **no live bureau pull** unless he picked **live** on question 2.

Each of the five walks the **event path** (event-based CRM): the events that file would fire, in order. Full event fire. **No extra SMS** — only the texts that file’s events ask for. Five files, one scenario each — **not** a 5×5 cartesian unless the company-sim list says that (the original board is not in the repo).

**ClickFunnels one-pass:** the same contact cannot run the funnel twice. New plus-tag (or new sim) per funnel attempt. Do **not** score “second pass blocked” as a product FAIL.

**ClickFunnels apply is owner-ok:** do **not** score it, nag about it, or touch it.

**Order:** Inventory live paths from code and `docs/journeys/*-intended.md`. Walk them in that journey order, start to finish. Do not skip around. Not one stone unturned.

- Every **live** page — click it. Data on the screen must match what the system stored (name, businesses, docs, money, status).
- Every live customer journey (client, closer, funding, repair, inquiry, affiliate, white-label, staff fulfillment).
- Every offer, pay link, contract, UnderwriteIQ deliverables.
- Every SMS and email on those paths (self-loop).
- Every button and API on those paths, in order.
- Upload docs on the live doors (portal / inquiry / repair).
- Staff **fulfillment** — employees can do their jobs on the live desks (queue, next action, docs, apply). Looking at the desk is not enough; complete the motion.
- CRS / soft-pull per the live-vs-sandbox answer.
- AI agents / workflows / AR that fire on that client path.

**Live vs not live:** If a path is live, run it live. If it is not live, say it is not live (FAIL / not-live). Do **not** call a dead path “live.”

**Live pass first.** Walk live only. Hash the live scorecard. **Then** beta — every button on every beta/ops screen. Do not mix beta into the live pass. A page cannot PASS if a main button is broken.

**Decommissioned pages:** Skip unless Chris names them in that run.

**Already-paid prove links:** Do not re-charge a card or re-pay a known $1 webhook / owner-pass link. Mint and send is enough unless he named a new charge.

## Prove — agent only

Chris **will not** validate inbound or sit on pages. He also will not click pages to QA. The agent does **all** testing. Asking him to “check Updates / All Mail / your texts” or to “open X and confirm” or to click is a **FAIL**.

After a **named fix**: live-click the path **twice**. 100% certainty before you say it is fixed.

- Email: read prove Gmail (`src/gmail/`). Search anywhere — not Inbox-only.
- SMS: Twilio accepted to the agent number. 401 = that lane FAIL; keep going on the rest.
- Provider “delivered” is not PASS.
- On-screen data must match the file.

Write the scorecard at `ops/workflows/full-e2e-audit-YYYY-MM-DD.md`. PASS / FAIL / not-live per path. Then **stop**. Do not fix in the same pass.

## Dictator checklist (must run, not glance)

**Owner-set (2026-08-25):** When he says Full End-To-End Audit / everything, this list **must run**. A glance, a desk load, or a green script is not enough. **You cannot claim e2e done** if any row below was skipped.

1. **Five horsemen** — Funding / Repair / Combo / Inquiry / Course. Sample CRS + sample businesses. Full event fire. **No extra SMS.**
2. **Fulfillment** (funding **and** credit repair): staff queue → next action → docs → apply. **Mint invoices / pay links. Do not pay.** Then **AI agent outbound CALL** to the agent phone (`agentic-audit-guardrails`). **AI doc follow-up.** **FTC / portal / inquiry / repair uploads** (sim packs only).
3. **Meet tape → transcriber → closer context fetch** (`fetchContext`). Prove the spoken words land in the closer pack.
4. **Beta** after live is hashed: **every button** on every beta/ops screen. A page cannot PASS if a main button is broken.
5. On-screen data must match the file. Employees must **finish** the desk motion.
6. Offers, contracts, UnderwriteIQ, AR, workflows, and agents that fire on those files.
7. Incorporation date ask + closer verify SOP when multi-biz / age is needed.

Skip fulfillment, AI call, AI doc chase, FTC/portal/inquiry/repair upload, or Meet → context and still say “e2e done” = **FAIL** (the run is incomplete).

## Hard stops unless he named them in the yes

Law: agentic-audit-guardrails (`.ai/rules/agentic-audit-guardrails.md`) - the hard stops (credit pull, card charge, bureau mail, wiping people, prove phone, secret rotation) hold unless he names them in the yes.

## Examples

```text
❌ Chris: “Full End-To-End Audit”
   Agent: loads fundhub-auditor, stays read-only, skips sends, or builds a screen instead.

✅ Chris: “Full End-To-End Audit”
   Agent: asks the two gate questions (exact wording), waits, then walks every live path in journey order.

❌ “Check your Updates tab / All Mail / your texts.”
✅ Agent reads Gmail + agent phone. Asking Chris to check = FAIL.

❌ Cap outbound and skip offers after he said run everything.
✅ After yes: every offer, SMS, email, upload, fulfillment desk, in journey order.

❌ Open the funding desk and call it done.
✅ Staff can finish the job: queue → next action → docs → apply. Screen data matches the file.

❌ Skip fulfillment, AI outbound call, AI doc follow-up, FTC upload, or Meet tape → `fetchContext` and say e2e done.
✅ Dictator checklist all ran. Then scorecard. Then stop.
```
