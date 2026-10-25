# Josh setter (AI-SET-01) — owner law 2026-08-15

## Script law
Josh calls ~5 seconds after calendar booking. He is a **setter only**.

- Data = **application / live survey answers only** (`cf_svy_*` from homepage survey).
- **Never** UnderwriteIQ results, pre-approval $, pulled FICO, tradelines, utilization, letter packs.
- Frame: Advisor pulls credit **live on the Strategy Session**.
- Source script: `vendor/inquiry-remover/src/agents/setter-prompt.js` (rewritten 2026-08-15).
- AI-SET-01 wire (`booking.created` → Bland dial) may still be missing; script is saved even if auto-dial is not wired yet.

## Survey fields Josh may use
funding_target_amount, planned_use, money_change_now, self_reported_fico (band only), has_business, business_revenue, revenue_verifiable, annual_income_range, income_verifiable, available_capital + first_name, appointment_time, closer_name.

## Context accumulation (owner-set)
Context Fetcher / agent context has **unlimited client context** as the journey progresses. Every conversation, message, call, survey answer, and CRM event is saved/logged. Later agents must use the growing dossier (pains, problems, history) — not pretend they only know the current turn. Do not rebuild context as empty between agents.