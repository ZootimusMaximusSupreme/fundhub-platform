# Payments gaps — lane 8

Fundhub money movement only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. No card charge. No new Commas product.

This lane does not repeat slice 18 (billing sweeper and checkout-expiry sweeper) or slice 10 (contract chaser and the sign door).

## Checks

| id | Break | FAIL when |
|---|---|---|
| payments:invoice-stuck | Invoice stuck | Dunning state does not match the money (`status_reconciled` is false), or a paid pay link still sits on an open invoice. Demo rows are left out. |
| payments:pay-link-webhook | Pay link minted, webhook never recorded | A non-demo link is still `created` or `sent`, older than 3 minutes (3 times the one-minute inbox sweeper), a succeeded payment exists for that client after the link, `commas_session_id` is empty, and no `commas_inbox` row contains the link ref. |
| payments:paid-no-entitlement | Payment succeeded, entitlement missing | A succeeded transaction resolves to a product that has a `product_entitlements` row, and no `entitlements` row exists for that payment and that code. A revoked grant still counts as recorded. Unmapped products are not this break. |
| payments:commas-webhook-route | Commas webhook route dead | The `webhooks/` prefix, `handleCommasWebhook`, or the webhook entry file is missing. This check reads files. It does not GET the webhook. |

No database in the run: the three money checks are `skip`. The route check still runs.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

## Files

- `src/pulse/coverage/gap-payments.mjs`
- `src/pulse/coverage/gap-payments.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-payments.test.mjs`
