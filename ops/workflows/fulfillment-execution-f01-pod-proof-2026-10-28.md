# Fulfillment F-01 — advisor pod assignment regression, 2026-10-28

**Lane:** fulfillment execution only. Parent acceptance matrix: [fulfillment-execution-e2e-2026-10-28.md](fulfillment-execution-e2e-2026-10-28.md). Separate evidence supplement: the parent board is being edited by fulfillment PR #192, while #193 has its own F-05 supplement. Do not overwrite either active PR.

## Reproduced code defect and exact effect

When no advisor pod is assigned, F-01 listens to `round.started`. The original `createPodTask` deduplicated `tasks.body` against the **event ID** and created a new `funding_advisor` task titled "Assign pod roles for funding client" for each **different** round event. Round 1 and round 2 carry different event IDs, so a client still waiting for one pod could accumulate duplicate work. The helper also returned `created:true` after ignoring `createTask`'s `created:false` on an insert race. The same event's replay was already covered; distinct events were not.

## Exact isolated repair and tests

- Keep the existing 24-hour task due date, role and title, and the existing owned-client guard in `handle`. Change only the pod task's uniqueness key to `pod-assignment:<orgId>:<clientId>`; use `createTask`'s `ON CONFLICT DO NOTHING` and return its true creation outcome. Do not introduce a new task for each funding round.
- Mock regression: first and second `round.started` events with different IDs for one client, plus three concurrent different events; assert one task and exactly one `created:true`.
- Real SQL regression: `src/workflows/f-01-pod-task-idempotency.pg.test.mjs`, strict localhost CI/test/scratch URL, transaction-local TEMP tasks table, rollback on all paths, same/different tenant fixtures. Never a production connection.
- Existing `src/workflows/f-01-funding-intake.test.mjs` covers stale credit recommendation with verified funding purchase, wrong-org client refusal, assigned pod no task, same-event replay. `src/handlers/purchase-routing.pg.test.mjs` covers paid deposit → funding board → advisor task, in disposable CI only.

| Acceptance | Expected | Current verdict |
|---|---|---|
| F-01/A: funding round 1, no pod | One dated funding-advisor pod task, tagged client | **NOT LIVE PROVED** — CI evidence required, no production role read |
| F-01/B: round 2 while pod still absent | Same task; not two identical assignment jobs | **FAIL in pre-fix source** — key was per event; fix + regression submitted |
| F-01/C: concurrent distinct round events | One database task and one `created:true`; no false success | **NOT LIVE PROVED** — real Postgres CI regression required |
| F-01/D: foreign-org round | No task or client mutation | **NOT LIVE PROVED** — existing unit regression; role proof required |
| F-01/E: pod already assigned | No new task | **NOT LIVE PROVED** — existing unit regression |
| F-01/F: task marked done without real pod assignment | Clear reopening/escalation rule without infinite duplicate reminders | **NOT LIVE PROVED** — requires product decision, not changed here |
| F-01/G: owner/advisor Calendar queue | One task visible to correct role, persists after reload | **NOT LIVE PROVED** — actual role browser/provider evidence missing |

## Validation and boundaries

This PR has no payment, billing, invoice, client-facing page, bureau, messaging or provider modifications. No live Supabase data touched. Run focused plus required full CI, check that Postgres test **ran, not skipped**, and merge only after required checks pass and GitHub permits. Deployment and real client/provider evidence are separate gates; this board must not be used to claim full fulfillment execution complete.
