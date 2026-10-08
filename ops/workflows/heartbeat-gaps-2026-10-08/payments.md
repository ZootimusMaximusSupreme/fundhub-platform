# Payments gaps — lane 8

Fundhub money movement only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. No card charge. No new Commas product.

This lane does not repeat slice 18 (billing sweeper and checkout-expiry sweeper) or slice 10 (contract chaser and the sign door).

## Checks

| id | Break | FAIL when |
|---|---|---|
| payments:invoice-stuck | Invoice stuck | Dunning state does not match the money (`status_reconciled` is false), or a paid pay link still sits on an open invoice. Demo rows are left out. |
| payments:pay-link-webhook | Pay link minted, payment landed, link never settled | A non-demo link is still `created` or `sent`, a succeeded non-demo payment exists for that client after the link (older than 3 minutes), that payment did not come through any link of ours (its `raw_payload.ref` is not a `payment_links.link_ref`), and no `commas_inbox` row contains the link ref. |
| payments:paid-no-entitlement | Payment succeeded, entitlement missing | A succeeded non-demo transaction (older than 3 minutes) resolves to a product that has a `product_entitlements` row, and no `entitlements` row exists for that payment and that code. A revoked grant still counts as recorded. Unmapped products are not this break. Simulated receipts (`provider_ref` starts `sim-pay-`) are counted and named in the line, but are not a FAIL. |
| payments:commas-webhook-route | Commas webhook route dead | The real webhook router (called in process, unsigned empty post, closed database) does not answer 401 for `commas`; or the source files are readable and say the route is gone; or the site answers a GET on `/api/webhooks/commas` with anything but 405. Files that cannot be opened (the Netlify bundle has none) are not a FAIL. A site that cannot be reached is a skip. |

No database or no org id in the run: the three money checks are `skip`, and the line says which. The route check still runs.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

## Files

- `src/pulse/coverage/gap-payments.mjs`
- `src/pulse/coverage/gap-payments.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-payments.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- The pay link check asked for `commas_session_id` to be empty. Every link we mint through Commas gets that id on day one. All 23 links in production have it. So the check could never fail. That filter is gone.
- The route check read source files. The morning check runs inside the bundled Netlify function, which has no source tree. It would have read "dead" every morning when it was not. It now calls the real webhook router in process (unsigned, empty body, a database that refuses every read, a throwaway key). A good door answers 401. A missing one answers 404. It also does one GET on the site: 405 means the `webhooks/` prefix is mounted, 404 means it is not.
- The entitlement check failed on 8 payments. All 8 are simulated receipts (`sim-pay-` ids, Chris's `walk-` and `sim-` test clients, no card charged). That is test money, not a customer. They are now counted in the line and left out of the FAIL.
- The skip line said "no database" even when the org id was the missing piece. It now says which.
- Payments got a 3 minute grace, so a receipt still being processed at 6 a.m. is not a break.

What changed: `gap-payments.mjs` (pay link query, entitlement query, route check, skip lines), 7 new tests in `gap-payments.test.mjs`. No old test was touched. The board table above was updated to match.

Live result after (read only, production): prod 3 PASS / 1 FAIL / 0 skip. Same lane from a bundle with no source tree beside it (how the server ships it): 3 PASS / 1 FAIL. Cursor's version in that bundle: 2 PASS / 2 FAIL (the route check read "dead" because the source files are not there, plus the 8 test receipts). The one FAIL is real: pay link `0d3adf9b` (a $32 diagnostic link, status `sent`) is still open. On 2026-10-07 at 07:06 UTC a real $1.00 payment (`ORD-MA94-BBWM-4QFP`, Chris's own email) landed with the ref `pl_prove_chris_1`, which is not a link of ours. The money is in `transactions`. The link was never settled. Fix is Chris's: void or mark that link. The check is not changed to hide it.

Not covered, written down so nobody thinks it is: two Finance OS e2e links (`pl_588...`, `pl_21f1...`, created 2026-10-07 07:05) have a processed `payment.succeeded` inbox row but still sit at `created`. That is "webhook recorded, link not settled". It is a different break from "webhook never recorded", it is on test clients, and it is left alone.

Invoices: there are 0 rows in `invoices` in production today, so the invoice check passes with nothing to look at. Its SQL runs clean against the real view. It will start to mean something when invoices exist.

Tests: `node --test src/pulse/coverage/gap-payments.test.mjs` runs 14 tests, 14 pass, 0 fail.
