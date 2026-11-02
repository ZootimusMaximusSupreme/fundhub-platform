# Front-house UX acceptance backlog — safe staff Undo and SOP shortcut ownership (2026-10-29)

**Status:** design/source audit ONLY. No production writes, simulation, UI controls, schema changes, provider calls, or merge implied. This is a non-overlapping supplement to `ops/workflows/manual-e2e-2026-10-26.md` and the client-communications acceptance ledger. Those existing documents are currently touched by other open PRs, so do not overwrite them before their branches converge.

## Current implementation evidence — Setter Log Dial

- `public/app/setter-dashboard.html` has **Refresh queue** (`#setter-refresh`) and **Log dial** (`[data-action="log-dial"]`); Log dial calls `sendAction("log_dial", h)`, POST `/api/setter-dashboard`. A 2xx result redraws/loads the queue. The UI currently has **no working Undo control**; do not add a decorative arrow.
- `api/setter-dashboard.mjs` authenticates, restricts to `ROLE_SETS.SETTER`, validates client UUID, and forwards to `src/setter/dashboard.mjs::updateSetterHandoff`. The handler checks tenant and setter assignment before mutations.
- `updateSetterHandoff` reads `custom_fields.setter_handoff`, increments `call_attempts`, preserves first `dialed_at`, and increments `dial_attempt_days[Phoenix-day]`; `persistHandoff` uses `UPDATE clients ... jsonb_set(..., existing || patch)` restricted by `org_id` and `client_id`. Setter KPI `setterNumbers` derives Dials from that daily map/legacy count.
- **Design gap:** no persisted dial *event ID*, reversal audit entry, actor-bound operation identifier, version check, or undo endpoint exists in this path. A naive decrement can erase another employee's legitimate later attempt. A fast double-click is not protected by a durable idempotency key: the UI serializes busy requests by delayed replay rather than deduplicating them. These are source-level findings, **not claims of live-user reproduction**.
- **Source overlap:** active PRs #263 and #268 both edit `src/setter/dashboard.mjs` and tests. The shared staff header `public/app/shell.js` and Company Brain deep link are exclusively owned by the dedicated SOP task/PR #257. This backlog does **not** edit either area.

## Separate acceptance rows

| Surface/action | Owner | Status | Required end-to-end proof |
| --- | --- | --- | --- |
| Setter Dashboard > accidental Log dial > Undo | Front-of-house after #263/#268 converge | **PLANNED — NOT LIVE PROVED** | Same authorized setter and same org/client reverse exactly one persisted logical dial event, restore `call_attempts` and correct Phoenix-day KPI, preserve non-dial fields, and produce immutable original/reversal records. Persist after refresh/relogin. |
| Setter Dashboard > Refresh queue after dial/reversal | Front-of-house | **NOT LIVE PROVED** (source route exists) | Queue, selected lead, today's numbers and assignment remain consistent after normal and reversed dial; no lost checklist edits. |
| Setter Dashboard > double click, stale tab, concurrent users | Front-of-house after source ownership clears | **PLANNED — NOT LIVE PROVED** | One operation ID is processed once; two distinct real attempts stay separate; stale reversal returns 409/conflict without altering later data; retries are idempotent. |
| Setter Dashboard > tenant, role and audit boundaries | Front-of-house | **PLANNED — NOT LIVE PROVED** | Unauthorized role, another org, wrong client, or another employee cannot undo; authorized owner/admin policy explicitly checked; event and reversal retain actor/time/context. |
| Staff header > Company Brain document icon | Dedicated SOP agent PR #257 exclusively | **IN PROGRESS — NOT LIVE PROVED** | Right role-specific existing documents, correct org visibility, return to working file, desktop/mobile, empty/error states; **do not** duplicate this implementation. |
| Staff header > generic small back-arrow Undo | Front-of-house future phase, only after a supported action is functional | **PLANNED — NOT LIVE PROVED** | Enabled only with an eligible reversible action, keyboard/ARIA/mobile semantics, disabled/expired/error state and no fake navigation-only behavior. Shared-shell file ownership must first be cleared. |

## Safe reversible action design (phase 1: Log Dial only)

1. Add a **durable dial-action ledger** in a separate migration only after coordination with the active setter PR owners. Record `event_id`, `org_id`, `client_id`, `setter_staff_id`, UTC occurrence time, Phoenix-day attribution, original attempt, current reversal state, reversible deadline, and `actor_id`/reversal timestamp. A unique action/idempotency key must prevent browser retries becoming new dials. Do not erase historical events.
2. For a new Log dial, use an atomic transaction with row locking or an equivalent optimistic version guard. Check org/client/assignment within the write, insert the event once, and update only the validated counter/day values. Return the event ID and precise eligibility; retain a version identifier for safe later reversal.
3. For Undo, accept **only the specific event ID**. Verify the current authenticated org/client/assignee/actor authorization, ensure event is still reversible, and prove no conflicting newer state would be overwritten. Mark reversal once and atomically recompute or adjust the counter/day. Repeated Undo returns the same result without double decrement. Stale/concurrent reversals fail closed, with an actionable UI message.
4. Never offer Undo for an actual phone call, queued/sent SMS/email, externally delivered notification, charge, finance agreement, bureau pull, settlement, or other irreversible provider action. Reversing the *internal dial log* does not retract a real call.
5. Render a small accessible Undo arrow **near search** only when a particular eligible event is present; preserve Refresh queue. Do not place an always-enabled button in the global shell until a generic reversible-action registry exists. Design/ARIA and responsive layout must be tested for staff roles; customer portal must never see this staff action.

## Proof plan — isolated, not production

- Disposable GitHub Actions PostgreSQL with nonprivileged app-role and two orgs, two clients each; a pair of staff actors; fake clock crossing a Phoenix midnight; local browser with mocked API. NO real SMS, payment, calls, bureau, or production records.
- Explicit PASS/FAIL with artifacts for: log once; retry same id; duplicate-click; two distinct dials; same event Undo once/twice; expired Undo; changed checklist between action and reversal; concurrent second log; lost response then retry; wrong tenant/client/role; audit actor/time; KPI day and dial-to-book ratio; refresh, mobile, keyboard, loading/error; required safe no-undo for provider actions.
- Production acceptance remains **NOT LIVE PROVED** until read-only role screen and verified deployment show the expected results. No intentional test write on live data.

**Priority:** a later UX enhancement, not a precondition to claim separate high-priority customer-to-paid-fulfillment acceptance. Urgent booking, client isolation, payment truth, and client communication defects take precedence. Do not conflate a passing browser/unit suite with a real customer handoff.
