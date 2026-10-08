# Lane 13 — contracts and e-sign

Read only. Report only. This lane does not sign a contract and does not edit a page.

Tripwire is Recon (AG-07) on the daily pulse. No second watchdog.

## Not repeated

`src/pulse/coverage/slice-10-contracts.mjs` already watches two things:

- The contract chaser has no machine row.
- The sign door is not on the morning ping list.

This lane does not score those again. The sign door is left off the ping list on purpose. A GET with no token answers 404. That 404 is the closed door. It is not a break.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-contracts.mjs` returns 5 rows. Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | FAIL means |
|---|---|
| `contracts:sent-unsignable` | A contract was sent or viewed, and the client still cannot sign it. No frozen copy, words that do not match, a missing PDF, or nobody whose turn it is. |
| `contracts:sign-route` | The sign route is missing from the route map, or a GET with no token answers something other than 404 (500, 405, 200, or no answer). A 404 is PASS. |
| `contracts:signed-not-stored` | Status is signed, and the signed file was not saved. |
| `contracts:template-missing` | A live offer has no active contract template. |
| `contracts:tripwire` | Recon (AG-07) is missing, or it is not live on the daily pulse. |

No database: the four reads are `skip`. The sign-route check can still pass from the route map, and it does not call the site unless `fetchImpl` is passed.

Live offer templates this lane expects: `CAPITAL-BLUEPRINT-AGREEMENT`, `CREDIT-REPAIR-AGREEMENT`, `FUNDING-AGREEMENT`, `FUNDING-MASTERY-AGREEMENT`, `REPAIR-AND-FUNDING-AGREEMENT`, `REPAIR-TRIAL-AGREEMENT`, `SOFT-PULL-CONSENT`. Offers with no contract key are not required.

## Test

`node --test src/pulse/coverage/gap-contracts.test.mjs`

10 pass, 0 fail. Fake database only. No live sign. No page edit.
