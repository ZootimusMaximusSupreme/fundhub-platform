# Fulfillment gaps — staff desks

Fundhub staff fulfillment only. Funding desk and credit repair desk: queue, next step, docs, apply. Not letter copy. Not inquiry.

Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not apply to a real lender. Do not upload.

This lane does not repeat slice 33. Slice 33 only checks that the desk doors, the catch-up job and a few event jobs are on the morning list.

## Checks

| id | Break | FAIL when |
|---|---|---|
| fulfillment:next-action | Repair file past the clock the code already defines, with no next step on the screen | A repair card (not demo) is past its clock in `src/repair/sla.mjs` (`isBreached`), and the Client Control Panel shows no next step for that client (blank, or "Not worked out yet"). Examples: analysis may sit 1 hour. Letters generated may sit 30 minutes. A bureau answer may sit 5 days after the due date. |
| fulfillment:api | Fulfillment read fails | The control panel read (`readClientStepRows` + `workOutClientStep`, the two calls `api/dashboard/client.mjs` makes) throws, finds no client, has no answer, or says "Not worked out yet" for any of the 5 most recently moved files on the funding or repair board. A file with a clean read and no step is not an API fault. |
| fulfillment:apply-blocked | Apply step blocked with no reason stored | An application is `Missing Docs` or `Action Required` and both the condition text and the decision note are blank. Or a proxy apply row is `failed` or `mismatch` with both error fields blank. Or a proxy apply row has sat on `verifying` for 10 minutes (the proxy code says nothing sweeps those, and such a row has no reason). |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

No database or no company id: all three are `skip`. No file on either board: `fulfillment:api` is a `skip`. A step that could not be read is a `skip` with the reason, never a PASS.

## Where the lines are

- Funding files with no next step are read by `funding:advisor-queue` in `gap-funding.mjs`. The code defines no funding clock except the 72-hour no-progress line, and that lane owns it. They are not read twice.
- The same late repair file can also show on `repair-letter-round` (letter engine did not finish). That is a different symptom: this check is about what staff are told to do.
- The doors for queue, next step, docs, repair cases and apply are already pinged each morning by the registry (`dashboard/clients`, `dashboard/client`, `read/funding-rounds`, `read/documents`, `read/repair-cases`, `repair/exceptions`, `applications`, `read/lender-matches`).

## Files

- `src/pulse/coverage/gap-fulfillment.mjs`
- `src/pulse/coverage/gap-fulfillment.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-fulfillment.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `fulfillment:api` pinged eight doors with no login. Every one answered 401. It said PASS ("not 500") but a 500 behind the login can never show that way. The registry already pings the same doors. It was a check that could not fail.
- `fulfillment:next-action` called a file "without a next step" when one saved field was blank. The screen works the step out from the whole file, so that proved nothing. It also used a 15 minute wait for funding files. The catch-up job never writes a blank step and never touches a file with no saved step, so 15 minutes was not a wait the code defines. The only clock the code defines for these files is the repair clock.
- The apply check missed the one stuck state the proxy code calls out: a row left on `verifying`.
- The tests drove the old logic. They are rewritten.

What changed: `fulfillment:api` now runs the real control panel read in this process for up to 5 desk files. `fulfillment:next-action` now reads only repair clocks and asks the screen's own work-out. `fulfillment:apply-blocked` also checks stuck `verifying` rows. No web calls remain in this file.

Live result after (read only, production database, plain role): 2 PASS, 1 FAIL, 0 skip. Staff role gives the same. With only `db, scope, now` all three skip, so the pulse has to pass `orgId`. It does.

The 1 FAIL is a real break, not a false alarm. See below.

Test result: 15 tests, 15 pass, 0 fail.

Real company break found: one paying repair client (client code FH-000507, id 64212914-1e0d-4ec1-bd6e-07fa156108b8) has sat in the `analysis` stage since 2026-10-05 15:08 UTC. The clock is 1 hour. They paid $1,000 for repair on 2026-09-17 and finished documents on 2026-09-22. No case, no dispute items and no letters exist for them. The Client Control Panel shows them no next step (not degraded, just empty). In all of production there are 0 dispute cases and 0 letters ever saved. Fix is the owner's: not done here.
