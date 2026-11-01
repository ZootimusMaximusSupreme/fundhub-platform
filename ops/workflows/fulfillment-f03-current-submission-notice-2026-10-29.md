# Fulfillment F-03 — stale Card Stacking submission notices (2026-10-29)

**Lane:** independent fulfillment execution only. **Production is LIVE.**
**Proposed isolated patch:** `audit/fulfillment-f03-current-submission-20261029`.
**Core board:** [fulfillment-execution-e2e-2026-10-28.md](fulfillment-execution-e2e-2026-10-28.md) (owned by evidence PR #247 while active).
**Verdict:** **FAIL — source-reproduced pre-fix guard omission**, **NOT LIVE PROVED — impact on any actual customer, deployed code, and provider delivery**.

## Finding: event text was trusted as current truth

`src/workflows/f-03-round-submitted.mjs` previously required only that an existing client match `event.orgId` and the event carry a non-null `roundNumber` before sending `EMAIL-F03-ROUND-SUBMITTED` / `SMS-F03-ROUND-SUBMITTED` and setting `employee_next_action=Remove Inquiries`. It did **not** check that the client's own current `funding_rounds` record matched the submitted number, that it was nonterminal, or that the current own-org Card Stacking card still occupied `round_submitted`. An old `round.submitted` event after a newer round, or after card advancement/funding/cancellation, could therefore announce stale information and overwrite the advisor's current work. This is a **code-level risk**, **not proof of any live incident**.

Exact code reproduction before patch: call F-03 `handle` with an existing own-org client, `event.name="round.submitted"`, and `payload={rail:"card_stacking",source:"card_stacking",roundNumber:1}` after funding round 2 exists or round 1 has been funded, with email/SMS templates mocked. The original logic only tested the truthiness of the number and reached both send calls. F-05 and the pending F-04 safety PR #273 already recognize analogous stale-round approval risks; this PR is a distinct workflow/file.

## Narrow proposed correction

For canonical **Card Stacking** submissions, before any message, tag, or staff next-action write:

1. Resolve an existing own-organization client; refuse unknown/foreign identities without creating a client.
2. Require a positive, safe-integer `roundNumber`; read latest round by `org_id + client_id`. Refuse absent, older, or fictitious rounds.
3. Refuse terminal statuses (`funded`, `closed`, `completed`, `cancelled`/`canceled`).
4. Join own-tenant pipeline + stage + card to require current `funding_card_stacking/round_submitted`; refuse a card already moved to `approved`, `funded`, `closed`, or missing.
5. On a verified current submission, leave template send, message dedupe by event ID, and next-action update unchanged.
6. For non-Card-Stacking legacy provider events, preserve the old path **without inventing a verified identity**; mark such delivery **NOT LIVE PROVED**.

**Scope limits:** F-03 only and its tests/evidence. No sales, accounting, client-facing page, SOP shortcut, Blueprint, provider adapter, or shared front-of-house files changed. Inngest event execution is not transactional with an external provider send: races *after* the verification SELECT cannot yet be called fully prevented in production.

## Acceptance probes — exact verdicts

| Scenario/action | Status | Evidence / required next proof |
|---|---|---|
| Existing client; own org; current submitted round; correct email/SMS and staff action | **NOT LIVE PROVED** | New `f-03-round-submitted.test.mjs` fake scenario and disposable PG gate test committed; require focused/full CI, exact deployed revision, then authorized read-only messages/portal/role evidence |
| Same event replay produces no second outbound message | **NOT LIVE PROVED** | Synthetic event-ID mocked message assertions added; real provider receipts unavailable |
| Old round 1 submitted after round 2 starts | **FAIL (pre-fix source)**; patched **NOT LIVE PROVED** | Test asserts `stale_round_submission` and zero mocked sends |
| Funded/closed/completed/cancelled round submission | **FAIL (pre-fix source)**; patched **NOT LIVE PROVED** | Five fake statuses and PG verification before any provider mock |
| Card already advanced (approved/funded/closed/apply_now) or removed | **FAIL (pre-fix source)**; patched **NOT LIVE PROVED** | Five fake stage states and real throwaway PG card/pipeline join |
| Foreign tenant, unknown client or foreign-only round | **NOT LIVE PROVED** | Same-organization resolver and real PG foreign-org round/card fixtures; require live read-only role proof |
| Invalid round numbers and wrong event name | **NOT LIVE PROVED** | Dedicated synthetic negative-path assertions |
| Legacy provider without canonical round identity | **NOT LIVE PROVED** | Preserves path until receipt/authenticity contracts can be independently validated |
| E2E verified purchase → current round → actual message provider → client's portal → staff action | **NOT LIVE PROVED** | Must match sale, actual event/recipient, provider receipt, stored status, and role screen on production read-only |
| Production exact-SHA ship and regressions | **NOT LIVE PROVED** | No merge until all **14/14 required PR-head checks green** and GitHub permits protected merge without bypass; then exact-SHA ship and role/provider read-only retest |

## Safe testing and release

Synthetic unit fixtures use `pgFake` only. The real-PG test opens a connection only when `DATABASE_URL` targets loopback and a test/scratch/_ci database, creates **TEMP** tables inside a transaction, and always **ROLLBACK**s. No live customer creation, production writes, charges, bureau pulls, texts, email, bank applications, or secrets. Do not describe this proof as provider E2E. Maintain the independent acceptance matrix and record exact commit/test/ship URLs after GitHub CI finishes. Do not edit ongoing SOP shortcut or other agents' active files.
