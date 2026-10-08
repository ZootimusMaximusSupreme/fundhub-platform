# Owner tools

Lane only. Read only. One tripwire: Recon (AG-07) on the morning pulse. No second watchdog.

Did not change brand assets. Did not start a teleprompter session. Did not edit a page.

These tools are not on the other gap lanes. Galaxy here is the staff Galaxy, not Partner Galaxy. Slice 30 only checks that Ops Admin is on the morning list. Slice 31 only checks that Creative Factory is on that list. This file opens the page and the read.

## Seven checks

Each row is `{ id, status, detail, suggestedFix }`.

Status is PASS, FAIL, or skip.

| id | Desk | Read | FAIL when |
|---|---|---|---|
| owner-tools:galaxy | `/app/galaxy.html` | GET `/api/read/company-activity` | Desk 404, or the read answers 500 |
| owner-tools:ops-admin | `/app/ops-admin.html` | GET `/api/read/ops-pulse` | Desk 404, or the read answers 500 |
| owner-tools:teleprompter | `/app/teleprompter.html` | GET `/api/marketing/shoot` | Desk 404, or the read answers 500 |
| owner-tools:brand-studio | `/app/brand-studio.html` | GET `/api/org-brand` | Desk 404, or the read answers 500 |
| owner-tools:content-admin | `/app/content-admin.html` | GET `/api/content/tiles` | Desk 404, or the read answers 500 |
| owner-tools:creative-factory | `/app/creative-factory.html` | GET `/api/creative/jobs` | Desk 404, or the read answers 500 |
| owner-tools:journeys | `/app/journeys.html` | GET `/api/journeys` | Desk 404, or the read answers 500 |

A missing fetch skips the row. A 401 on a read is a calm refusal, so that row can still pass. No check uses POST or PUT. Brand Studio is not saved. The teleprompter is not started. The journeys editor is not run.

## Files

- `src/pulse/coverage/gap-owner-tools.mjs`
- `src/pulse/coverage/gap-owner-tools.test.mjs`

## Test

`node --test src/pulse/coverage/gap-owner-tools.test.mjs`

8 tests. 8 pass. 0 fail.
