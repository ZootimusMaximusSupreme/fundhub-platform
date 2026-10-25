---
description: Sims and Full E2E assume paid; skip ClickFunnels apply; never skip unpaid packs
alwaysApply: true
---

# Sims assume paid — skip ClickFunnels apply

**Owner law (2026-08-25):** When testing, running Full E2E, or minting sim files, do not skip the pack because nobody paid, and do not walk ClickFunnels apply.

## Law

1. **Do not skip deliverables because unpaid.** Issue the pack (UnderwriteIQ, letters, contracts, pay-link mint). **Assume paid.** Move to the next step in the sequence. Never charge a real card.
2. **Do not walk ClickFunnels apply.** It makes leads and fires the pixel. Owner said it works. Assume the funnel works. Law: no-test-data-on-production (`.ai/rules/no-test-data-on-production.md`) - no test rows and no test logins are left on production; tests run on scratch databases. The one carve-out: a Full End-To-End Audit that Chris orders by name may mint the plus-tag sim person on live while it runs, and the agent removes them right after with the guarded delete (allowed since 2026-10-24).
3. Law: agentic-audit-guardrails (`.ai/rules/agentic-audit-guardrails.md`) - no live credit pull unless he picked live, no paper mail, no personal prove phone on a sim.

## Examples

```text
❌ Skip UnderwriteIQ / letters / contract because the sim never paid.
✅ Issue the pack. Assume paid. Next step. Do not charge a card.

❌ Open apply.fundhub.ai and submit the funnel for the sim.
✅ Skip the apply. Funnel is owner-ok. Mint a plus-tag person on live only inside a Full End-To-End Audit Chris orders by name, then remove that person with the guarded delete.

❌ Live CRS on sandbox, paper mail, or his personal prove phone on a sim.
✅ Sample credit file. No bureau mail. Agent phone only.
```
