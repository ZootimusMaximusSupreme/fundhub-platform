# Closer gaps

Fundhub closer desk, Present, and closer context. Read only. One tripwire. No second watchdog. Do not start a call.

This lane does not repeat slice 27 (closer dashboard, Present, closer deck, and call outcome doors on the morning list) or slice 20 (the offer-bucket job). Bookings and recordings are another lane.

## Check

| id | Break | FAIL when |
|---|---|---|
| closer:held-disposition | Closer Dashboard or Present route is dead, or a held call's disposition never landed | The Closer Dashboard or Present page is not wired (file missing, shell bounce, Present no longer posts `log_disposition`, or a redirect steals `/app/closer-dashboard.html` or `/app/present.html`). Or a live client has a closer disposition (saved on the client, or a `call.completed` event with disposition `closer`) and no `call_outcomes` row. The closer context read (`fetchContext`) would have no recent call. Demo clients are left out. |

No database in the run: if both pages are wired, the check is `skip`. If a page route is dead, the check is `FAIL` even with no database.

The row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Present `log_disposition` as the one tripwire. That write is what puts the row in `call_outcomes`. This check does not add another watcher and does not start a call.

## Files

- `src/pulse/coverage/gap-closer.mjs`
- `src/pulse/coverage/gap-closer.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-closer.test.mjs`
