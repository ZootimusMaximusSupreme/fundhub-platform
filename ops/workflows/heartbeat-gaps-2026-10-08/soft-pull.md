# Soft-pull approve door

Lane: the credit soft-pull approve screen only. Read only. Not wired into the shared pulse files.

`gapChecks(ctx)` in `src/pulse/coverage/gap-soft-pull.mjs` returns three rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

The plain up/down ping of both doors is already `reg:soft-pull-approve.html` and `reg:soft-pull-approve` in the registry. These rows add what that ping cannot see.

| id | What it does | FAIL means |
|---|---|---|
| `soft-pull:approve-page` | GET `/app/soft-pull-approve.html` | The page is 404 or 500, or a 200 page is not the approve screen (it does not call the read route) |
| `soft-pull:approve-read` | GET `/api/soft-pull-approve` with no link token | The read API is 404 or 500, or the JSON is not the approval read shape. A 400 or 401 with `ok: false` and an `error` string is a pass. That answer comes before any database read |
| `soft-pull:approve-signed-read` | The real handler, run in-process, GET only, with a link signed for the newest real client | The read that follows a good link does not come back with the words, the price and the consent state. That is the database half the unsigned GET never reaches. Also fails when `DOCUMENT_URL_SECRET` is missing, because then no approval link can be sent |

No fetch: the two GET rows are `skip`. No database or company: the signed row is `skip`.

## Not this lane

- Do not pull credit.
- Do not send bureau mail.
- Do not POST the approve route.
- Do not edit the approve page.
- Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
- Do not auto-fix.

## Test

`node --test src/pulse/coverage/gap-soft-pull.test.mjs`

Fake fetch. No live credit pull. The signed-read tests run the real handler with a made-up database.
