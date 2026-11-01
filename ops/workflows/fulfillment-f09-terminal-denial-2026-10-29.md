# F-09: terminal bank denial must not reopen completed funding work — 2026-10-29

**Scope:** independent fulfillment execution, F-09 only; front-house, A/R ledger and F-07 fee-source PR #232 remain separate. Owner confirms production is LIVE. This branch is a proposed change only; no deployment, customer mutation, bank sends, credit pulls, payment or provider operation occurred here.

## Acceptance trace / precise proof status

| Control | Source-level reproduction and expected result | Result / gate |
|---|---|---|
| F-09T-A previous completed round receives late `mail.response=DENIED` | Pre-fix `denialDecision` selects newest `funding_rounds.id` without checking status. If tracked apps are all Denied, F-09 writes `Internal Review`, adds `ops:action-required` and enqueues a no-path task even when newest round status is `funded`/`closed`/`cancelled`. | **FAIL pre-fix source** (deterministic code path, NOT an observed customer occurrence). New test checks no hold/task for funded/closed/cancelled/canceled/completed. **NOT LIVE PROVED** until CI, permitted merge, deploy, staff and provider read-only evidence. |
| F-09T-B status changes to funded between SELECT and UPDATE | A stale selection must not write `hold_reason` once round is terminal. | Proposed atomic `UPDATE ... AND LOWER(status) NOT IN (...)` guard; isolated fake and disposable GitHub Actions PostgreSQL test. **NOT LIVE PROVED** pending complete CI. |
| F-09T-C current open round truly has all bank applications saved Denied | Open current round gets hold and *one* advisor review, task role `funding_advisor` and a real due date (Calendar excludes undated tasks). Replay/second DENIED email must not duplicate. | Pre-existing positive/replay tests plus new due-date assertion, CI pending. No real advisor Calendar/portal receipt: **NOT LIVE PROVED**. |
| F-09T-D not all denied, missing round/apps, foreign org, old round denied vs new pending | No hold or task, preserve current credit state. | Existing synthetic tests plus real Postgres `fundhub_ci` transaction-local TEMP tables/ROLLBACK. **NOT LIVE PROVED** externally. |

**CI safety:** Real PostgreSQL test refuses non-loopback or non-test/scratch databases; all fixtures run transactionally with ROLLBACK. Never run production writes. Required before any merge: 14/14 checks including blocking disposable PostgreSQL and browser, no bypass, exact deployed release hash and read-only live role verification. No owner completion SMS. Full paid-sale through advisor/client/provider proof remains OPEN.

**Related outstanding:** [#232](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/232) still owns F-07 fee-source validation; [#239](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/239) is front-house Money Vault browser-test repair; [#247](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/247) owns pending documentation update to the canonical fulfillment board. Do not overwrite those active files. Integrate this row into `ops/workflows/fulfillment-execution-e2e-2026-10-28.md` only after the board PR resolves without concurrent edits.
