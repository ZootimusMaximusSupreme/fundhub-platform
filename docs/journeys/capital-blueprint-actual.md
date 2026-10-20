# Capital Blueprint — actual (2026-10-20 repair candidate)

This records repository behavior and safe fixture proof. It is not a live purchase or release claim. Intended source: `capital-blueprint-intended.md`.

- CB-01: existing Present price/provider controls carry validated whole-dollar $5,000–$10,000 Blueprint amounts through `api/closer-deck.mjs` and `sendDeckPayLink`. Other offers retain catalog prices.
- CB-02: shared contract sender forwards a price snapshot. Contract drafts validate/store `_blueprint_amount_cents` and `package_fee`; save/preview/send preserve it. Custom-price sends refuse old fixed-price templates. Migration483 parameterizes two fee clauses; draft migration485 brings three scope clauses into line with the 12-month program. Neither changes previously sent/signed rows.
- CB-03: both provider checkout paths require the latest sent/viewed/signed Blueprint agreement at the exact price with matching frozen hash. Whop reserves the local order before its provider call and verifies returned checkout and variant identity before returning a URL.
- CB-04: `/api/webhooks/whop-billing` verifies account and raw-body signature, saves a durable inbox receipt, and returns. The two minute clocks process exact-match receipts into canonical payment events. Inbox retries, duplicate-event handler replay and provider GET reconciliation recover interrupted work. Failed/unmatched receipts grant no access. Real provider/DB proof remains pending.
- CB-05/06: `fetchContext` reads saved cross-channel messages and call history, Blueprint purchase/access/agreement, assigned human advisor, tasks, proof and open checklist step. SMS runtime and staff Bland calls use that reader. Bland completed calls preserve words, summary and recording on a scoped voice message; late transcripts enrich that same row without firing call workflows again. No new contact schedule or live agent prompt was activated.
- CB-07: advisor assignment still uses the existing purchase hook and `assigned_csm_staff_id`. Context displays only an active non-demo human staff row; absence remains unknown/unassigned. No production assignment was made or verified.
- CB-08: Closer Dashboard and Present render the same saved context. Fixture browser proof covers both at1440px/390px, matching $7,500 agreement/send/pay requests, Whop choice, first-click agreement, touch targets and scrolling to the last saved task.
- CB-09: the annual-period monthly-refresh defect remains open. This repair does not enable paid/live credit pulls or invent a year-two fee.
- CB-10: new deep Whop inbox/access checks are loaded by the pulse and tied to the new scheduled job. The existing generic paid-without-entitlement checks remain.

Evidence: `ops/workflows/build-evidence/blueprint-price-context-2026-10-20/` (marked fixture drafts), focused unit tests, and the PostgreSQL test `src/payments/whop-blueprint.pg.test.mjs` (requires a safe local scratch/CI database; not run against production).
