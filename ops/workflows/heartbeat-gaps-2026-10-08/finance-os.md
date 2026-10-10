# Finance OS past the bank link

Date: 2026-10-08

Lane file: `src/pulse/coverage/gap-finance-os.mjs`

## What this check does

It picks one client who already has an active bank link. Then it opens seven read doors for that client. A door fails when the read answers 400 or higher, comes back with an error, or throws. A normal answer is a pass. No database, no org id, or no linked client, means skip (the line says which). The seven doors run side by side.

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

`node --test src/pulse/coverage/gap-finance-os.test.mjs` — 12 tests, 12 pass, 0 fail. Seven doors.

## Review — Claude, 2026-10-08

What was wrong:
- Each door was opened by importing its file from a path built when the check runs. The morning check runs inside the bundled Netlify function. That bundle only carries files the code names, so the handler files are not on disk. I built the lane the way the server ships it (one bundled file, no source tree beside it). Result with Cursor's version: 0 PASS, 7 FAIL, every door "Cannot find module .../api/money/credit.mjs". That is 7 red lines every morning for a screen that works.
- The doors ran one after another. Measured here at 12 to 20 seconds. Each lane is its own step and Netlify cuts a step at 26 seconds. A cut step becomes a skip, so the lane would quietly stop being coverage.
- The skip line said "no database" even when the org id was the missing part.

What changed:
- Every door now names its handler with a literal import (`load: () => import("../../../api/money/credit.mjs")`), so the bundler packs it. The old path import stays only as a fallback for a door with no loader.
- The seven doors run side by side. Rows keep the same order.
- The skip line says which piece is missing.
- 4 new tests. One of them has no stub: it goes through the real loader and the real handler for all seven doors, with a database that holds one client and nothing else, and wants seven PASS. A broken table (`crs_results`) must fail the credit door. That test is what catches a handler that stops loading.

What was checked and is fine:
- Plain role and staff role read the same rows on every query (81 queries, 0 differences). The doors are not blind.
- 0 writes, 0 outbound calls. The helper read uses the no-write helper payload.
- It uses one linked client (the newest). In production that is Chris's own Plaid sandbox client. It will rotate to a real client when one links.

Live result after (read only, production): prod 7 PASS / 0 FAIL / 0 skip. Same lane from a bundle with no source tree: 7 PASS (Cursor's version in the same bundle: 0 PASS / 7 FAIL).

Tests: `node --test src/pulse/coverage/gap-finance-os.test.mjs` runs 12 tests, 12 pass, 0 fail.
