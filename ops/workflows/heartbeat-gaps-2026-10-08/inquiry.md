# Lane 19 — inquiry removal gaps

Read only. Report only. Company name is Fundhub.

Slice 29 already checks that the specialist doors and jobs are on the morning list. This lane does not repeat that list.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-inquiry.mjs` returns 5 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads |
|---|---|
| `inquiry:case-stuck` | Open inquiry cases with no update for 72 hours, or a call that was due and never started. Demo and test clients are left out. |
| `inquiry:letter-round` | A funding round that still has open inquiries and has no letter draft and no letter already sent. |
| `inquiry:specialist-api` | GET `/api/read/inquiry-cases` and GET `/api/inquiry?action=cases`. A 500 is a fail. |
| `inquiry:upload-door` | GET `/app/client-portal.html` and look for the `inquiry_doc` upload box. |
| `recon` | One read of AG-07 Recon on daily-pulse. |

## Rules kept

- No bureau mail.
- No real ID upload.
- GET only. No POST.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.

`ctx` is `{ db, orgId, fetchImpl, baseUrl, now }`. No database skips the three reads. No fetch skips the two doors.

## Test

`node --test src/pulse/coverage/gap-inquiry.test.mjs`

- tests 9
- pass 9
- fail 0
- skipped 0

Not wired into the shared pulse runner. That file was left alone.
