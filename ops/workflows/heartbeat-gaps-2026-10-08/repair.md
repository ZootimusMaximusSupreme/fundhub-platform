# Lane 10 — credit repair breakage

Company: Fundhub. Read only. Not wired into the shared pulse files.

Slice `src/pulse/coverage/slice-15-repair.mjs` already lists repair jobs. This lane does not repeat that list.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-repair.mjs` returns two rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | FAIL means |
|---|---|
| `repair-case-stuck` | A repair case is `stalled`, or the repair card on the optimization pipeline is on `stalled`. |
| `repair-letter-round` | An open case has dispute items and no letter, or the card says letters were made / ready to send and no letter row exists. |

No database or no company id: both rows are `skip`.

A letter row of any status counts as written. This check does not read letter words.

## Not this lane

- Do not rewrite a dispute letter that contradicts itself.
- Do not send bureau mail.
- Do not pull credit.
- Recon (AG-07) is the only tripwire. Do not add a second watchdog.
- Do not auto-fix.

## Test

`node --test src/pulse/coverage/gap-repair.test.mjs`

Fake database. No live credit pull.

Result: 7 tests, 7 pass, 0 fail.
