# Payments gaps — lane 8

Fundhub money movement only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. No card charge. No new Commas product.

This lane does not repeat slice 18 (billing sweeper and checkout-expiry sweeper) or slice 10 (contract chaser and the sign door).

## Checks

| id | Break | FAIL when |
|---|---|---|
| payments:invoice-stuck | Invoice stuck | Dunning state does not match the money (`status_reconciled` is false), or a paid pay link still sits on an open invoice. Demo rows are left out. |
| payments:pay-link-webhook | Pay link paid, link never settled | A non-demo link is still `created` or `sent` and money has reached it in one of two ways. (1) A `payment.succeeded` row in `commas_inbox`, processed more than 3 minutes ago, carries the link ref (the webhook was recorded, the link was not settled). (2) A succeeded non-demo payment from the same client, after the link was minted, for the same amount in cents as the link, that did not come through any other link of ours. Simulated receipts (`sim-pay-`) are counted and named in the line, not a FAIL. A webhook that never arrived leaves no row anywhere, so this check cannot see it (see the second pass below). |
| payments:paid-no-entitlement | Payment succeeded, entitlement missing | A succeeded non-demo transaction (older than 3 minutes) resolves to a product that has a `product_entitlements` row, and no `entitlements` row exists for that payment and that code. A revoked grant still counts as recorded. Unmapped products are not this break. Simulated receipts (`provider_ref` starts `sim-pay-`) are counted and named in the line, but are not a FAIL. |
| payments:commas-webhook-route | Commas webhook route dead | The real webhook router (called in process, unsigned empty post, closed database) does not answer 401 for `commas`; or the source files are readable and say the route is gone; or the site answers a GET on `/api/webhooks/commas` with anything but 405. Files that cannot be opened (the Netlify bundle has none) are not a FAIL. A site that cannot be reached, or does not answer in 8 seconds, is a skip. The 405 only proves the `webhooks/` prefix is mounted; the 401 from the router is what proves Commas. |

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

Live result after the first pass (read only, production): prod 3 PASS / 1 FAIL / 0 skip. Cursor's version in a bundle with no source tree: 2 PASS / 2 FAIL (the route check read "dead" because the source files are not there, plus the 8 test receipts). The one FAIL that first pass kept was a FALSE ALARM. It is withdrawn in the second pass below.

First pass left this uncovered: two Finance OS e2e links (`pl_588...`, `pl_21f1...`, created 2026-10-07 07:05) have a processed `payment.succeeded` inbox row but still sit at `created`. The second pass below now reads that shape. These two are simulated receipts, so they are named in the line and are not a FAIL.

Invoices: there are 0 rows in `invoices` in production today, so the invoice check passes with nothing to look at. Its SQL runs clean against the real view. It will start to mean something when invoices exist.

### Second pass — Claude, 2026-10-08 (after the checker)

What was wrong:
- The one FAIL left in the first pass was a false alarm. Pay link `0d3adf9b` is a $297 link. The payment it matched was Chris's own $1.00 prove payment (`pl_prove_chris_1`). The check matched any money from the same client, so $1 on a $297 link lit it red. The first pass called that a real break. It was not. No customer money is stuck. That claim is withdrawn.
- The check also could not fire for the break it was built for. It only fired when a client paid some other way. A webhook that was recorded but never settled the link (`payment.succeeded` in the inbox, link still open) gave a clean PASS.
- The site GET had no timeout. A hung site could have cost the whole lane its step.
- Board mistakes: the link is $297, not $32. The overlap note below was lost.

What changed:
- Money must now match the link amount in cents. Run on production with the match removed, the old shape finds 1. With it, 0.
- New first read: a processed `payment.succeeded` inbox row that carries the link ref while the link is still `created` or `sent`. Simulated receipts (`sim-pay-`) are named and left out of the FAIL. Two Finance OS e2e links (`pl_58889...`, `pl_21f12...`) sit in exactly that state today and show up in the line as "2 open links with a simulated receipt left out".
- A payment through this link's own ref now counts. Only a DIFFERENT link of ours clears a payment.
- The site GET stops after 8 seconds and then skips with the reason. The PASS line now says the 405 proves the `webhooks/` prefix, not Commas.

What this lane cannot see, on purpose: "pay link minted, the webhook never arrived". Commas sends each webhook once and never retries. If it is lost, nothing is written anywhere in our database, so there is nothing to read. `src/payments/commas-api.mjs` says this at the top and has no list endpoint to go look. The check watches the two shapes that do leave a trace. It does not claim the third.

Overlaps for the final pass to keep one of each (not deleted here, other lanes are not mine):
- `payments:paid-no-entitlement` reads the same break as `portal-paid-entitlement` in `gap-portal.mjs` (paid, mapped product, no entitlement). Different test-money rules: `sim-pay-` receipts here, `+walk` and `+sim` email tags there. Both PASS today.
- `payments:commas-webhook-route` repeats what `webhooks:commas` in `gap-webhooks.mjs` does (router probe plus a GET). The lane prompt named it, so it stays until the final pass picks one.

Live result after (read only, production): prod 4 PASS / 0 FAIL / 0 skip. staffdb 4/0/0. Plain and staff roles read the same rows. 0 SQL errors, 0 write attempts. A bare run (no org id, what the slice runner passes today) is 1 PASS / 3 skip, as designed.

Tests: `node --test src/pulse/coverage/gap-payments.test.mjs` is 18 tests, 18 pass with no database. With `DATABASE_URL` set it is 70 tests, 70 pass: the extra 52 run the three money SQL statements for real on made-up tables (a `WITH` that swaps in small fake tables, so no real table is touched). I broke the SQL on purpose 16 ways (amount match, other-link test, grace both ways, sim split, status, event type, client match and more). Every one failed at least one test. The one thing swapped out is the product resolver function, which a `WITH` cannot replace. It is named in the test.
