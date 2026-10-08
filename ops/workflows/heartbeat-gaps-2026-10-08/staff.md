# Staff, roles, and hiring

Lane 15. Read only.

Did not invite a person. Did not change a job. Did not edit a page.

Recon (AG-07) is the only tripwire. This lane does not start a second watchdog.

This is not slice 11. That slice watches the hiring bench job and the outreach job.

This is not slice 30. That slice watches owner, sales manager, and CSM doors already on the morning list.

This is not the registry. The registry already pings every desk page, and the auth/invite, hiring/apply and hiring/candidates doors, for a plain up or down. Each row below reads one thing those pings cannot see.

## Five checks

Each row is `{ id, status, detail, suggestedFix }`.

Status is PASS, FAIL, or skip.

| id | What it reads | FAIL when |
|---|---|---|
| staff-invite-send | The pulse's own env for the two names the invite email needs (`RESEND_API_KEY`, `RESEND_FROM`). Names only, never values. | Either name is empty |
| staff-invite-link | Invited staff and their invite links, in the database | A person is invited and has no link that is unused and not expired |
| role-gate | GET `/api/hiring/candidates` with a bad cookie (`fundhub_session=%zz`) | The gate answers anything but 401 or 403 |
| hiring-apply | GET `/api/hiring/apply` | It is not a 200 with `ok: true` and a `roles` list |
| role-desk | `/app/shell.js` (the `HOME` map), then each staff job's home desk | The app frame is missing, or a home desk does not load |

role-desk covers 8 staff jobs: owner, admin, funding advisor, closer, inquiry specialist, setter, sales manager, CSM. That is 6 desks, because owner, admin and setter share the pipeline.

No check POSTs. No check calls invite or role change.

## Test

`node --test src/pulse/coverage/gap-staff.test.mjs`

13 tests. 13 pass. 0 fail.

## Review — Claude, 2026-10-08

What was wrong:

- `staff-invite-send` looked for a row in `messages`. The invite email never writes one. It goes out through Resend to the notify address, not to the login address. So the row could never pass once an invite was open. It would have said "the invite never sent" every time. Today it only skipped, because no invite was open.
- `role-desk` was a copy of the registry. It opened 3 fixed desks and wanted a 2xx. The registry already does that for every desk.
- The old invite test returned canned rows whatever SQL was sent.

What changed:

- `staff-invite-send` now checks the email can leave at all: both Resend names are set. It cannot prove Resend takes the key.
- `staff-invite-link` is new. It finds invited people who have no working link. They cannot log in and nobody would know.
- `role-desk` now reads the job-to-desk map from the live app frame. A renamed desk still looks "up" in the registry, but the job would land on a 404. This catches that.
- `role-gate` and `hiring-apply` stay as they were. The bad cookie only reaches the cookie reader here. The registry sends none. `hiring-apply` also checks the body, not just the status.
- Every row now accepts `ctx.fetch` as well as `ctx.fetchImpl`.

Live result after (production, read only): prod 5 PASS, 0 FAIL, 0 skip. Staff-access run: same. No write was tried.

Broke one thing per run on the live data to prove each row can FAIL: hiring/candidates answers 500 gave FAIL. hiring/apply 404 gave FAIL. Sales-floor desk 404 gave FAIL naming the sales manager. Missing `RESEND_API_KEY` gave FAIL. The invite-link query was run on made-up rows in a read-only transaction: 4 invited, 3 stuck, as expected.

Tests: 13 pass, 0 fail.

Not proved: whether Resend accepts the key. Nothing can prove that without sending.
