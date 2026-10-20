# Capital Blueprint — intended

Owner instructions: Chris's 2026-10-20 request in the $5,000–$10,000 readiness chat. This records requested behavior before the repair; it does not claim that behavior is implemented or live.

## Offer and roles

- The closer selects one exact whole-dollar price from $5,000 through $10,000, default $5,000. Product remains `consulting-package`, offer `UWIQ_DELIVERABLES`, provider title `Consulting Services Package`.
- Owner confirmed 2026-10-20: every allowed price buys the same 12-month package; the closer chooses the price. Higher prices do not create extra service tiers.
- The offer includes 12 months. Owner confirmed 2026-10-20: service ends unless the client separately agrees to renew; no automatic renewal or charge.
- The AI accountability coach reads and maintains the client's progress and conversation context. The human CSM is the assigned advisor; client-facing language is "advisor". An AI identity must never be presented as the assigned human.
- Routine check-ins can use SMS and Bland calls. Existing opt-outs, quiet hours, contact caps, approved prompts and outbound settings still apply. A queued send is not a delivered message or completed call.
- Owner confirmed 2026-10-20: communication is agentic. The coach uses saved client context and current replies to choose its next question or permitted action, rather than blindly sending a fixed campaign. After two actually sent Blueprint text reminders remain unanswered on the same open step, the next eligible run can start one contextual Bland call. A reply, changed/completed step, ended access or contact hold cancels the old escalation; queued/failed texts do not count. Existing quiet hours and contact caps decide the next eligible run, with no new delay invented.
- The offer guides the client toward being fundable. It does not promise a funding amount or a funding approval.

## Required sequence and observable result

| Step | Requested behavior | Observable result |
|---|---|---|
| CB-01 | Closer chooses the exact price and Commas pay-in-full or Whop financing. | Server accepts only allowed Blueprint amount/provider; other offers retain their current rules. |
| CB-02 | Create the Blueprint contract using that price. | Draft and sent document retain the same validated price. A template that still says fixed $5,000 cannot send a custom-price agreement. Existing signed agreements remain unchanged. |
| CB-03 | Create the chosen provider's checkout for the same client, company, product and price. | Saved local payment link matches provider checkout identity and exact USD amount; caller cannot substitute a provider title. |
| CB-04 | A confirmed payment opens Blueprint access. | Verified exact-match receipt produces one canonical payment, transaction and entitlement. Failed/unmatched receipts grant nothing; retries cannot duplicate a purchase. |
| CB-05 | Keep one durable client record across AI and staff work. | Checklist/proof state, messages, calls, transcripts, notes, tasks, contracts and payment status retain company/client identity and are available to the shared context reader. |
| CB-06 | Coach follows the real current step across agentic texts, replies and calls. | SMS/call context includes the saved open step and prior conversation. The AI selects a grounded question or permitted action, and reports only saved action outcomes. Two sent unanswered Blueprint texts on the same step can lead to one eligible contextual Bland call; failed/queued texts never trigger it and a reply or step change cancels the stale escalation. Reminders can refer to calls, deposits and letter tasks only when those tasks exist; proof-required steps do not close on a promise. |
| CB-07 | A human advisor is assigned and handles exceptions. | A real staff assignment is stored separately from the AI identity; an absent assignment is shown honestly. STOP/exception/closing-prep work reaches the assigned human queue under existing rules. |
| CB-08 | Closer dashboard and Present show the same file context. | Both surfaces read the canonical client record, including Blueprint price/access, contract status, current step, recent conversation/call notes and advisor. No separate browser-only history is the source of truth. |
| CB-09 | Provide the offer's monthly credit refresh during the included year. | Separate eligible monthly requests and provider results update the plan/letters. The known annual-period defect remains open until repaired and proved; this chat's initial request was to explain it, not silently enable live pulls. |
| CB-10 | Detect missing purchase/delivery work. | Payment inbox and paid-without-access checks go red on failed or overdue saved results; health or page-load success alone is insufficient. |

## Publication and external proof

Repository repairs and safe test fixtures do not create live charges, credit pulls or customer calls. Publishing a changed customer page and controlled live-dollar/provider proof remain explicit separate actions. Availability requires evidence of the deployed customer result.
