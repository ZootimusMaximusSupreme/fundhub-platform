# Staff, roles, and hiring

Lane 15. Read only.

Did not invite a person. Did not change a job. Did not edit a page.

Recon (AG-07) is the only tripwire. This lane does not start a second watchdog.

This is not slice 11. That slice watches the hiring bench job and the outreach job.

This is not slice 30. That slice watches owner, sales manager, and CSM doors already on the morning list.

## Four checks

Each row is `{ id, status, detail, suggestedFix }`.

Status is PASS, FAIL, or skip.

| id | What it reads | FAIL when |
|---|---|---|
| staff-invite-send | Open staff invites vs an outbound email row | Someone is invited and no email row exists |
| role-gate | GET `/api/hiring/candidates` with a junk cookie | The gate answers 500 |
| hiring-apply | GET `/api/hiring/apply` | The public apply door is not a 200 role list |
| role-desk | Closer, funding advisor, and specialist home desks | A desk that role must open answers 404 |

The closer desk is `/app/closer-dashboard.html`.

The funding advisor desk is `/app/client-control-panel.html`.

The specialist desk is `/app/inquiry-remover.html`.

No check POSTs. No check calls invite or role change.

## Test

`node --test src/pulse/coverage/gap-staff.test.mjs`

9 tests. 9 pass. 0 fail.
