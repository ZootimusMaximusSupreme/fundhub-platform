# Staff, roles, and hiring

Lane 15. Read only.

Did not invite a person. Did not change a job. Did not edit a page.

Recon (AG-07) is the only tripwire. This lane does not start a second watchdog.

This is not slice 11. That slice watches the hiring bench job and the outreach job.

This is not slice 30. That slice watches owner, sales manager, and CSM doors already on the morning list.

This is not the registry. The registry already pings every desk page, and the auth/invite, hiring/apply and hiring/candidates doors, for a plain up or down. Each row below reads one thing those pings cannot see.

## Four checks

Each row is `{ id, status, detail, suggestedFix }`.

Status is PASS, FAIL, or skip.

| id | What it reads | FAIL when |
|---|---|---|
| staff-invite-link | Invited staff and their invite links, in the database | A person is invited and has no link that is unused and not expired |
| role-gate | GET `/api/hiring/candidates` with a bad cookie (`fundhub_session=%zz`) | The gate answers anything but 401 or 403 |
| hiring-apply | GET `/api/hiring/apply` | It is not a 200 with `ok: true` and a `roles` list |
| role-desk | `/app/shell.js` (the `HOME` map), then each staff job's home desk | The app frame is missing, or a home desk does not load |

role-desk covers 8 staff jobs: owner, admin, funding advisor, closer, inquiry specialist, setter, sales manager, CSM. That is 6 desks, because owner, admin and setter share the pipeline.

The invite email keys (`RESEND_API_KEY`, `RESEND_FROM`) are not read here. The existing row `gap:auth-reset-mail` in `src/pulse/coverage/gap-auth.mjs` already reads them ("Reset and invite mail cannot go out"). It also ignores a masked key and checks for real Resend mail this week. A second row here would call one break twice.

Limit of role-gate: the bad cookie is turned away at the cookie reader with a 401, before the hiring role check runs. A crash inside the role check itself would not show here.

No check POSTs. No check calls invite or role change.

## Test

`node --test src/pulse/coverage/gap-staff.test.mjs`

Without a database: 13 tests, 13 pass, 0 fail. The 4 Postgres-engine tests skip (no `DATABASE_URL`).

With `DATABASE_URL`: 17 tests, 17 pass, 0 fail. Those 4 run the real invite SQL on made-up rows (a read-only SELECT, nothing stored).

## Review — Claude, 2026-10-08

What was wrong:

- `staff-invite-send` looked for a row in `messages`. The invite email never writes one. It goes out through Resend to the notify address, not to the login address. So the row could never pass once an invite was open. It would have said "the invite never sent" every time.
- The first fix swapped it for a check on the two Resend names. That was a copy. `gap:auth-reset-mail` (gap-auth) already reads the same two names, says the same thing, and is stricter: it ignores a masked key and looks for real Resend mail this week. If the key went missing, the morning would show two FAILs for one break. Here a masked key (`****`) still passed.
- `role-desk` was a copy of the registry. It opened 3 fixed desks and wanted a 2xx. The registry already does that for every desk.
- The old invite test returned canned rows whatever SQL was sent. The newer one still only replayed the logic in JS, so nothing failed if the SQL changed.

What changed:

- `staff-invite-send` is gone. The invite email keys are `gap:auth-reset-mail`'s job.
- `staff-invite-link` stays. It finds invited people who have no working link. They cannot log in and nobody would know. It now has 4 tests that run the real SQL on Postgres over made-up staff and link rows: live link, no link, expired, used, reset-only, old dead link plus new live link, other company, no company.
- `role-desk` reads the job-to-desk map from the live app frame. A renamed desk looks "up" in the registry, but the job would land on a 404. This catches that.
- `role-gate` and `hiring-apply` stay. The bad cookie only reaches the cookie reader here. The registry sends none. `hiring-apply` also checks the body, not just the status. The limit of `role-gate` is written above.
- Every row accepts `ctx.fetch` as well as `ctx.fetchImpl`.
- `ctx.env` is no longer used by this file.

Live result after (production, read only): prod 4 PASS, 0 FAIL, 0 skip. Staff-access run: same. Bare run (db only): 1 PASS, 3 skip, because the 3 web rows need `fetchImpl`, which the real pulse passes. No write was tried.

Broke one thing per run to prove each row can FAIL. On live data: hiring/candidates 500 gave FAIL, hiring/apply 404 gave FAIL, sales-floor desk 404 gave FAIL naming the sales manager. On the invite SQL, 7 wrong versions were tried in a scratch copy (wrong status, wrong link kind, used flipped, expiry flipped, link joined to nobody, company filter off, NOT EXISTS dropped). All 7 made the Postgres tests fail.

Tests: 13 pass without a database. 17 pass with one. 0 fail.

Known and left alone: an invite nobody opened for 7 days fails every morning until the person is invited again. That is true, so it stays. A database blip on the invite read is a FAIL, not a skip, so a broken read can never look healthy.

Not proved: whether Resend accepts the key. Nothing can prove that without sending.
