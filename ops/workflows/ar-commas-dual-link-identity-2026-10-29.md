# A/R adapter handoff: signed Commas reference versus checkout session identity

**Date:** 2026-10-29. **Owner:** A/R independent lane. **State:** FAIL SOURCE-REPRODUCED / PROPOSED REPAIR; NOT LIVE PROVED.

## Live-money risk isolated in source

`src/adapters/commas.mjs:loadPaymentLink` preferred any matching `payment_links.link_ref` without examining a simultaneously supplied `itemId` (stored as `commas_session_id`). Both references can individually resolve to valid but *different* buyer/sale/tenant checkout links. In that case `processCommasInboxRow` populated `paymentLinkId`, `saleId`, `purpose`, product and buyer from the first link, then emitted canonical `payment.received` and purchase events. This happens **before** the A/R receipt allocator's post-emission identity checks; a downstream guard alone is insufficient.

This is a deterministic code-path exposure, **not a confirmed production exploit or actual provider receipt**. `itemId` is sometimes a Commas product ID, not a checkout session; lack of a matching checkout session is normal and must not block legitimate payments. The safeguard rejects only two positively matched, contradictory link identities, not missing/unknown metadata.

## Narrow proposed behavior

- Query `link_ref` and `commas_session_id` independently. If BOTH identify links and their IDs differ, throw before canonical event emission so the durable signed webhook remains in the existing inbox failed/retry/manual-review path.
- If only one ID resolves, preserve legacy fallback. If both agree, use one verified link. Do not invent a buyer and do not send messages.
- Synthetic signed-webhook unit regression asserts the inbox stays failed with its original bytes, zero paid events emitted. Disposable PostgreSQL regression with `CI=true`, local loopback `/fundhub_ci`, plus-tag clients and transaction rollback tests conflict and compatible fallback. No provider calls.

## Coordination and outstanding gates

No edits to front-house `src/sales/call-outcomes.mjs` / PR #229 or fulfillment money-chain. A/R notified the front-house checkout lane on [PR #229 comment](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/229#issuecomment-6495373059), to include this as a correct-paid-handoff boundary. An isolated A/R adapter PR, full 14-job CI and protected merge are required before source repair is considered shipped. Actual signed Commas provider receipt, `commas_inbox` dead-letter/owner monitoring, production deploy SHA, buyer/tenant sale and billing UI are **NOT LIVE PROVED**. Reconcile this finding as A53 on the main A/R board once the separate A52 board PR is merged; do not edit the same active documentation file concurrently.
