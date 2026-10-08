# Sales manager gaps

Fundhub. Sales manager view only. Team numbers, show rate, close rate, and the floor.

Read only. No page was edited.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 20 already lists the sales jobs (s-00 through s-08). This lane does not check those again.

Another lane owns the closer desk and call recordings. This lane does not open that desk and does not read tapes.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-sales-manager.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads | FAIL when |
|---|---|---|
| `sales-manager:read-api` | GET `/api/read/sales-floor` and GET `/api/read/my-numbers` | The route is not wired, or the read answers 500 (or any other bad status). A normal lock-out (401 or 403) is a pass. |
| `sales-manager:totals` | Team cash, show rate, and close rate for this month | Those totals cannot be read. A zero month is still a pass. |
| `sales-manager:dropped-closer` | Closers who took a deposit or cash, against the floor rollup | A closer who belongs on the floor has sales, and the rollup leaves them off. Practice names and demo people are left out. |

## Rules kept

- Read only. GET only. No POST.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.
- Slice 20 jobs were not checked again.
- The closer desk and call recordings were not checked.

`ctx` is `{ db, orgId, fetchImpl, baseUrl, now, readText }`. No database skips the two row reads. No fetch skips the live read call. A missing route still fails.

## Files

- `src/pulse/coverage/gap-sales-manager.mjs`
- `src/pulse/coverage/gap-sales-manager.test.mjs`

## Test

`node --test src/pulse/coverage/gap-sales-manager.test.mjs`

- tests 11
- pass 11
- fail 0
- skipped 0

Not wired into the shared pulse runner. That file was left alone.
