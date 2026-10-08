# Soft-pull approve door

Lane: the credit soft-pull approve screen only. Read only. Not wired into the shared pulse files.

`gapChecks(ctx)` in `src/pulse/coverage/gap-soft-pull.mjs` returns two rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it does | FAIL means |
|---|---|---|
| `soft-pull:approve-page` | GET `/app/soft-pull-approve.html` | The page is 404 or 500, or a 200 page is not the approve screen |
| `soft-pull:approve-read` | GET `/api/soft-pull-approve` with no link token | The read API is 404 or 500, or the JSON is not the approval read shape. A 400 or 401 with `ok: false` and an `error` string is a pass |

No fetch: both rows are `skip`.

## Not this lane

- Do not pull credit.
- Do not send bureau mail.
- Do not POST the approve route.
- Do not edit the approve page.
- Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
- Do not auto-fix.

## Test

`node --test src/pulse/coverage/gap-soft-pull.test.mjs`

Fake fetch. No live credit pull.
