# F-04 funding approval notices — stale/terminal round refusal

**Owner:** fulfillment execution lane. **Production is LIVE; this patch is NOT deployed until protected merge and exact-SHA ship.** No live synthetic client, bank, bureau, message, payment or staff writes authorized. The independent front-house, A/R, Blueprint, and shared SOP-shortcut files are untouched.

## Repro and impact

F-04 `src/workflows/f-04-round-approvals.mjs` previously accepted any same-company existing client and positive `event.payload.approvedAmount`; it then queued approval email/SMS and set the client's next action to `Prepare Next Funding Round`. For a Card Stacking `round.approved` replay carrying an **old round number** or arriving after that round had been **funded, completed, closed or cancelled**, F-04 had no round lookup. F-05 Inquiry Cleanup already refused the same stale/terminal Card Stacking event. This created a **code-level contradiction:** inquiry cleanup stayed closed while the customer could receive a misleading approval notice and staff next-action overwrite. There is **no evidence of an affected production customer**.

## Narrow repair

- F-04 now calls the same-organization, same-client, latest-round `approvedCardStackingRound` gate already used by F-05 **before any email, SMS or custom-field update**. It refuses absent/malformed/fictitious round numbers, replay of earlier rounds, or latest terminal statuses. No new provider send path is added.
- F-05's existing terminal list now includes `completed` as well as `funded`, `closed`, `cancelled` and `canceled`. This also prevents inquiry mutation on a completed round.
- Event-ID message dedupe remains unchanged; legitimate latest `approved` Card Stacking rounds still send the two templated notifications. Existing non-Card Stacking provider events without a round identifier retain historical behavior until their separate source-authenticity mapping is verified.

| ID / synthetic action | Expected result | Verification status |
|---|---|---|
| F04-01 same-org client, latest active Card Stacking round 1, positive approved amount | Two queued templated messages, one staff next action, replay only one logical pair | **Pre-fix source allowed; new unit assertion — CI PENDING. Live delivery NOT LIVE PROVED.** |
| F04-02 round 1 approved, then round 2 started, delayed round 1 event | Reject with `stale_round_approval`, zero messages or staff update | **FAIL in pre-fix source; proposed code fix and focused unit/real PG tests — CI PENDING; live NOT LIVE PROVED.** |
| F04-03 current round funded/closed/completed/cancelled/canceled | Reject with `round_terminal`, no outgoing message/next-action overwrite | **FAIL in pre-fix source; proposed fix — CI PENDING; live NOT LIVE PROVED.** |
| F04-04 missing/malformed/fictitious Card Stacking round number | Reject with `invalid_round_number` or `funding_round_not_found`, no send | **FAIL in pre-fix source; proposed fix — CI PENDING; live NOT LIVE PROVED.** |
| F04-05 explicit cross-tenant client/round reference | Reject foreign client before notification; same-org round lookup cannot select another tenant | **New mocked unit and transaction-local real PG checks — CI PENDING; production role NOT LIVE PROVED.** |
| F04-06 legacy other-provider event without Card Stacking identity | Preserve previous acceptance path, do not invent provider round | **Unit regression added; separate provider paid-sale authenticity remains NOT LIVE PROVED.** |
| F04-07 staff/client pages, delivery receipts, mobile/reload/error/roles, approvals vs settled cash | Match verified lender response and client-visible truthful progress after deployment, with authorized read-only role/provider evidence | **NOT LIVE PROVED. No actual production provider sends or screen changes.** |

**Tests:** `src/workflows/f-04-current-round-notice.test.mjs` uses synthetic mock message queue and client fields. `src/workflows/f-04-current-round.pg.test.mjs` uses **only** GitHub Actions CI with loopback `/fundhub_ci`, temporary PostgreSQL round rows and rollback, no production access. Existing F-04/F-05 tests must still pass. All 14 required full CI checks must be green before merge; verify protected merge and Ship to live exact SHA, then independent read-only role/provider E2E. The unit mock does not establish actual SMS/email receipt.

**Remaining risk deliberately not claimed fixed:** F-04 still accepts a positive event amount rather than independently cross-checking its lender record; historical provider rails have no frozen sale/round association. A separately scoped source-provenance audit and real provider receipts are required; funding approval is not proof of funds deposited. A/R separately owns invoice/collections states.
