# F-08 post-funding monitoring — real 30-day advisor Calendar deadline

**Lane:** fulfillment execution only. Production is LIVE. This proposal does not change front-of-house, A/R, Blueprint, client-facing pages or SOP-shortcut-owned shell/header files. Never run synthetic customer, message or billing writes on live Supabase.

## Defect and boundary

`src/workflows/f-08-post-funding-monitoring.mjs` promises a "30-day check-in + prep for next wave" on `round.funded`, but previously calls `createTask` with **no `dueAt`**. The shared Calendar excludes undated tasks (same source restriction documented in F-01/F-09); therefore the funding advisor's 30-day follow-up may be absent from the Calendar even when an ordinary task row exists. This is a deterministic code-to-UI contract failure, **not** evidence an actual customer's advisor failed to follow up.

Fix: add a due date 30 × 24 hours after the first successful handling of each funded event. Keep the same `funding_advisor` role, event-ID task dedupe, and cross-tenant `findClient` ownership gate. A replay must not move the first due date; a genuinely new funded round still needs its own 30-day task. Do not update historical undated production tasks automatically — that requires separate read-only inventory and a reviewed remediation.

| Individual action | Exact expected result | Status / proof gate |
|---|---|---|
| F-08-A normal paid funded event | One same-org/client `tasks` row; `assignee_role=funding_advisor`, `due_at=first handled + 30d`, Calendar includes it | **FAIL pre-fix source**: `due_at=NULL`. **Proposed repair, NOT LIVE PROVED**. New unit and isolated PostgreSQL assertions, full PR CI pending. |
| F-08-B same `round.funded` event replayed after 12 days | Exactly one task, first due date unchanged | **NOT LIVE PROVED**. `f-08-post-funding-monitoring.test.mjs` and `f-08-calendar.pg.test.mjs` exercise fake and disposable real-PG task rows. |
| F-08-C second independently funded round event | Separate follow-up task for the same client, due 30 days after its own handling | **NOT LIVE PROVED**. Distinct event IDs tested; no synthetic provider, bank or customer activity. |
| F-08-D event targets client owned by a different organization | Refuse before creating any task; foreign record unchanged | **NOT LIVE PROVED**. Existing owned-client lookup plus new mocked and real-PG negative tests. |
| F-08-E incomplete/no funding source IDs, spoofed status, cancelled/refunded round | Must not create a false funding follow-up; verify current round and paid sale | **NOT LIVE PROVED / separate source-gate review**. This due-date-only patch does not pretend to prove external `round.funded` provenance. |
| F-08-F staff Calendar/queue/mobile/reload and 30-day completion | Correct owner task appears and persists, no cross-org view, completion saved | **NOT LIVE PROVED**. A test assertion on `tasks.due_at` is not a live Calendar or actual advisor-action receipt. |
| F-08-G provider/bureau/payment and client notification | No unintended messages, fees or bureau pull; source event consistent with confirmed approvals rather than cash estimates | **NOT LIVE PROVED**. No live external actions authorized in this audit. |

**Regression:** New `src/workflows/f-08-calendar.pg.test.mjs` refuses any database other than `CI=true` + loopback host + exact `/fundhub_ci`, uses temporary tables and rolls back. Unit tests mock event bus/db. Require all 14 GitHub PR-head checks green, GitHub-protected merge without bypass, main CI, exact-SHA deployment and independent authorized read-only role/provider receipts before updating live acceptance.

**Open work:** Integrate this evidence into `ops/workflows/fulfillment-execution-e2e-2026-10-28.md` only after its separate active PR #247 resolves; never race-edit that canonical file. No owner completion SMS. Fulfillment overall stays OPEN.

### Replay race return-value proof — 2026-10-29

During branch review, F-08's old separate `SELECT` plus `await createTask(...); return {created:true}` was found to misreport concurrent duplicate deliveries. `createTask` already implements the same event-ID key and an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING id`; a race loser rightly returns `{created:false, reason:"duplicate_race"}`. F-08 now returns that actual result rather than claiming the task was created. No historical customer task is altered. Unit and real disposable PostgreSQL replay tests assert `task.created === false` and retention of the initial deadline. This is code/test coverage on the PR branch, **not production or provider proof**; the fresh PR head still requires all 14 successful checks.
