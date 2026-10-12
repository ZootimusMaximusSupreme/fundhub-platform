# Heartbeat architecture talk — 2026-10-11

## Task list

| Topic | Owner | Status |
|---|---|---|
| Current shape | This session | done |
| Reuse map | This session | done |
| Tuesday target shape | This session | done |

## Scope

Architecture discussion only. No product code changes.

## Plain-language architecture

The system has four layers:

1. **Inventory:** registry rows, scheduled job rows, send paths, and the literal coverage-module list say what exists.
2. **Questions:** each `gap-*.mjs` lane asks business questions and returns PASS, FAIL, or skip.
3. **Clocks:** the daily pulse, hourly beats, and five-minute watcher decide when those questions run.
4. **Truth and reporting:** tripwires, self-audit, run receipts, and the morning brief decide whether the answer is honest and tell Chris.

That shared skeleton is good. The large part is inside the individual business lanes, where SQL, timing rules, row formatting, and test fixtures repeat.

## Reuse that is safe

- One shared result builder for `id`, `status`, `detail`, `suggestedFix`, and optional customer wording.
- One shared policy/constants area for time windows that truly mean the same thing.
- Shared read helpers for common patterns: newest row, stuck row, missing receipt, and company-scoped reads.
- Small data-driven definitions for simple lists of settings, buttons, keys, or doors.
- One test helper for PASS/FAIL/skip shape and read-only behavior.

## Reuse that is unsafe

- One giant generic checker that hides the business question.
- One shared SQL query for unrelated domains.
- Moving all timing values into one file when the timing belongs to a product workflow.
- Making every lane look identical when the difference is the reason the check is valuable.

## Tuesday target

Before adding hundreds of checks, choose a small reusable pattern, convert one money lane as a pilot, run the full proof, and only then use that pattern for the next lanes. Keep each business question visible and keep the shared code limited to mechanics.
