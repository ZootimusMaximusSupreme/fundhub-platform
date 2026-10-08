# Partner training gaps

Fundhub. Partner training only. Read only.

Do not mark anyone certified. Do not edit the training page.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 22 and slice 31 already check that the training page and the training read are on the morning list. This lane does not check that list again.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-training.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads |
|---|---|
| `training:page` | The training page. It must still show a step and call the training read. A live open that is 404, or not the training page, is a fail. |
| `training:read-api` | GET `/api/read/partner-training`. The route must be wired. A GET that crashes or is missing is a fail. A 401 with no login is a pass. |
| `training:required-step` | The 13 required training steps. Each one must be in the list with a title a partner can read. A missing step or a blank title is a fail. |

## Rules kept

- Read only. GET only. No write.
- Do not mark anyone certified.
- One tripwire: existing Recon (AG-07). No second watchdog.
- The training page was not edited.
- The morning list from slice 22 and slice 31 was not checked again.

`ctx` is `{ db, orgId, fetchImpl, baseUrl, readText }`. No database skips the step read. No fetch skips the live page and the live read. A missing page still fails. A missing route still fails. A training read that drops the step title still fails.

## Files

- `src/pulse/coverage/gap-training.mjs`
- `src/pulse/coverage/gap-training.test.mjs`

## Test

`node --test src/pulse/coverage/gap-training.test.mjs`

- tests 15
- pass 15
- fail 0
- skipped 0

Not wired into the shared pulse runner. That file was left alone.
