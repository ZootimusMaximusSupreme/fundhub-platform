# Partner training gaps

Fundhub. Partner training only. Read only.

Do not mark anyone certified. Do not edit the training page.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 22 and slice 31 already check that the training page and the training read are on the morning list. The registry already pings both for a plain up or down. This lane does not repeat that. It reads what those pings cannot see.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-training.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads | FAIL when |
|---|---|---|
| `training:page` | GET `/app/partner-training.html` and GET `/app/partner-training.js` over the web | The page is not a 2xx, or has no step list, or the script no longer calls the training read or no longer prints a step title |
| `training:read-api` | The real training read (`trainingViewFor`, the code behind `GET /api/read/partner-training`), run in process for a partner id that does not exist, under the staff scope | The read throws, or comes back without the 13 steps and 4 gates |
| `training:required-step` | `training_modules` and `training_gates` in the database | One of the 13 steps or 4 gates is missing or has a blank title |

## Rules kept

- Read only. GET only. No write.
- Do not mark anyone certified. The read uses an id no partner has.
- One tripwire: existing Recon (AG-07). No second watchdog.
- The training page was not edited.
- `ctx` is `{ db, scope, orgId, fetchImpl, baseUrl }`. No database skips two rows. No fetch skips the page row.

## Files

- `src/pulse/coverage/gap-training.mjs`
- `src/pulse/coverage/gap-training.test.mjs`

## Test

`node --test src/pulse/coverage/gap-training.test.mjs`

- tests 8
- pass 8
- fail 0
- skipped 0

This lane did not touch the shared pulse runner. `src/pulse/coverage/modules.mjs` lists the lane, so the morning pulse runs it.

## Review — Claude, 2026-10-08

What was wrong:

- All three rows read repo files off the disk: the page, the route file, the progress file. The morning pulse runs inside a Netlify function. That function is one bundled file, `netlify/functions/api.mjs` (8 MB in a local build, and all four lanes in this group are inside it). In that file `import.meta.url` is the bundle, so the old `../../..` lands one folder above the app, not on the repo. The page, the route file and the progress file would not be found. Every row would have failed each morning with "could not be read". It passed on the Mac only because the Mac has the repo. Proof: the old file was run with no repo files beside it, and a healthy site and database. All 3 rows came back FAIL with "ENOENT: no such file or directory".
- `training:read-api` was a copy of the registry ping. A 401 only proves the sign-in is in front of the read. It does not prove the read works.
- The step check covered the 13 steps but not the 4 gates. "No gate, no selling" is the rule, so a missing gate matters.

What changed:

- The page is now read over the web, with its script. The data is read from the database. No file reads.
- `training:read-api` now runs the real read in process. A renamed column now shows as FAIL. A 401 could never show that.
- `training:required-step` now covers the 4 gates too.
- The old test that checks the repo files are wired stays, as a CI test only. The pulse does not use it.

Live result after (production, read only): prod 3 PASS, 0 FAIL, 0 skip. Staff-access run: same. No write was tried.

Broke one thing per run on the live data to prove each row can FAIL: page script loses the read call gave FAIL. Step m7 gone gave FAIL. Gate G2 title blank gave FAIL. A renamed column under the read gave FAIL.

Tests: 8 pass, 0 fail. The old file had 15 tests. They were folded into 8 that cover the same cases plus the gates, the crash, and the no-disk rule.
