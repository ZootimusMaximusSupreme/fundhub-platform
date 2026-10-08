# Finance OS past the bank link

Date: 2026-10-08

Lane file: `src/pulse/coverage/gap-finance-os.mjs`

## What this check does

It picks one client who already has an active bank link. Then it opens seven read doors for that client. A door fails when the read answers 400 or higher, comes back with an error, or throws. A normal answer is a pass. No database, or no linked client, means skip.

| Check | Page | Read |
|---|---|---|
| finance-os:credit | /app/money-credit.html | GET /api/money/credit |
| finance-os:plan | /app/money-plan.html | GET /api/money/plan |
| finance-os:declines | /app/money-declines.html | GET /api/blueprint/declines |
| finance-os:vault | /app/money-vault.html | GET /api/money/vault |
| finance-os:transfers | /app/money-transfers.html | GET /api/money/transfers |
| finance-os:payments | /app/money-payments.html | GET /api/money/payments |
| finance-os:helper | /app/money-helper.html | GET /api/money/helper |

The helper read uses the same selects the page uses. It does not answer queued turns, so this check does not write.

## What this check leaves alone

Plaid items and empty accounts are another lane. This file only uses an active link to pick the client. It does not call Plaid. It does not move money.

`src/pulse/coverage/slice-07-finance.mjs` already names the six Finance OS jobs. This file does not repeat those jobs.

## Tripwire

Recon (AG-07) is the one tripwire. This file only reports. It does not add another watcher.

## Shape

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

## Test

`node --test src/pulse/coverage/gap-finance-os.test.mjs` — 8 tests, 8 pass, 0 fail. Seven doors.
