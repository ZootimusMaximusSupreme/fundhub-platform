# Client success gaps

Fundhub. Client success queue only. Read only. Do not text clients.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 30 already checks the owner desks, the sales manager desks, and whether the client success doors are on the morning list. This lane does not check those again.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-csm.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads |
|---|---|
| `csm:queue-api` | The client success queue door. The route must be wired. A GET that is not a normal answer (including 500) is a fail. When a database is in the run, the same queue read the API uses must succeed. |
| `csm:overdue-unassigned` | Open client success tasks whose due time has passed and nobody is assigned. Demo rows are left out. A task with no due time is not overdue. |
| `csm:missing-step` | The halfway accountability call. It must be wired to deposit paid, sale closed, and payment received. A client who paid and has no halfway call is a fail. |

## Rules kept

- Do not text clients.
- Read only. GET only. No POST.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.
- Owner desks from slice 30 were not checked again.

`ctx` is `{ db, orgId, fetchImpl, baseUrl, now, readText }`. No database skips the two row reads. No fetch skips the live queue call. A missing route still fails. A missing halfway step still fails.

## Files

- `src/pulse/coverage/gap-csm.mjs`
- `src/pulse/coverage/gap-csm.test.mjs`

## Test

`node --test src/pulse/coverage/gap-csm.test.mjs`

- tests 9
- pass 9
- fail 0
- skipped 0

Not wired into the shared pulse runner. That file was left alone.
