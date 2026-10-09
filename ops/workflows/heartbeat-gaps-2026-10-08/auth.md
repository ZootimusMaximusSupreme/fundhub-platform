# Login and session — heartbeat gaps

Lane: login and session only. Morning pulse. Report only.

Recon stays the one tripwire. Check id: `recon` in the daily pulse. These checks do not text anyone. They do not start a second watcher.

A slice row in `slice-01-auth.mjs` is a note. It is not a live pass. The live door pings are `login` and the `reg:` rows below.

## Counts

- Breaks: 18
- Already watched: 11
- Missing: 7
- New checks: 5

## Already watched

| Break | Check id |
|---|---|
| Staff login page has no sign-in form | `login` |
| Staff login page does not answer | `reg:login` |
| Staff login API answers 500 | `reg:auth/login` |
| Client magic-link page does not answer | `reg:portal-login` |
| Magic-link request API answers 500 | `reg:auth/magic-link` |
| Magic-link verify API answers 500 | `reg:auth/magic-link-verify` |
| Session API answers 500 on a plain GET | `reg:auth/session` |
| Password reset API answers 500 | `reg:auth/reset` |
| Reset password page does not answer | `reg:reset-password` |
| Portal link API answers 500 | `reg:auth/send-portal-link` |
| Logout API answers 500 | `reg:auth/logout` |

A plain GET on the login API does not try a password. A plain GET on session does not read a session row. A 405 on logout, reset, magic link, and portal link still counts as up. That is why the gaps below exist.

## Missing

| Break | New check id |
|---|---|
| People cannot sign in. No active staff password, or many staff emails failed and none succeeded in 24 hours. | `gap:auth-staff-login` |
| A short magic link was issued and no email was queued. The sign-in template is missing or cannot send. | `gap:auth-magic-link-dead` |
| A portal link was issued and no email was queued. Same mail path as the magic link. | `gap:auth-magic-link-dead` |
| Session tables cannot be read the way the real session check reads them, so it would 500. | `gap:auth-session-read` |
| Logout cannot see the staff or client session row it must revoke. | `gap:auth-session-read` |
| A staff sign-in said yes and no session was made. A magic link was spent and no session was made. | `gap:auth-signin-no-session` |
| Password reset mail cannot go out (Resend is not set up). | `gap:auth-reset-mail` |

Reset and invite mail do not use the message queue. They go straight to Resend, so the database never sees them. `gap:auth-reset-mail` can only prove the setup, not each send.

Booking confirm links last about a year and do not use this email. The dead-link check ignores those.

No database in the run: each new check returns `skip`. It does not pretend the lane passed.

## Files

- `src/pulse/coverage/gap-auth.mjs`
- `src/pulse/coverage/gap-auth.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- The reset check could not work. Reset mail does not use the message queue. It goes straight to Resend. So the database never sees it. All 5 past staff resets would have turned the morning red. It also called 5 affiliate resets fine because the word "reset" sat in an unrelated email.
- The login check counted client, affiliate and partner sign-ins as "failed". The one sign-in form tries staff first. Each client sign-in leaves a failed staff try first. A busy client day with no staff login looked like a login storm.
- The session check only read one column. It could not see a dropped column. It could not see a missing write grant (this is how login broke before).
- A count that never came back was read as 0. That is a calm day, and it is a lie.
- Nobody watched "sign-in said yes and no session was made". That is a 500 the person sees and nothing else records.

What changed:
- `gap:auth-reset-queue` is now `gap:auth-reset-mail`. It proves what can be proved: the reset table reads, and `RESEND_API_KEY` and `RESEND_FROM` are real (not empty, not a `****` mask). It never prints a value. If this run holds a masked copy but Resend sent mail in the last 7 days, it says skip, not FAIL.
- `gap:auth-staff-login` counts only real staff emails now.
- `gap:auth-session-read` reads the same columns the real session check reads, and asks the database if the app can write the 7 sign-in tables.
- New `gap:auth-signin-no-session`: staff sign-ins and spent magic links in the last 24 hours that left no session. A suspended account does not count.
- The sign-in template is read for the org that sends it.
- A null or blank count is "no answer" now.

Proof:
- Every SQL was run on the live database inside a read-only transaction, with the real tables swapped for made-up rows. Each one failed when it should and passed when it should. Client-only day: old SQL said 7 failed, new SQL says 0.
- Tests: 15 before, 38 after the first review, 44 after the second. 0 fail, 0 skipped.
- Live, prod mode: 4 PASS, 0 FAIL, 1 skip. The skip is `gap:auth-reset-mail`. This laptop's `.env` holds a masked `RESEND_API_KEY`. In the live site Resend delivered 14 emails in the last 7 days, so the real key works. With a real-looking key the same run is 5 PASS, 0 FAIL, 0 skip.

Not a break, checked: 0 sign-ins in 24 hours is because the last one was 25 hours ago. Plain and staff views of every table agree.

Leftover (not touched): a reset or invite email leaves no record of whether Resend took it. A person who asks for a reset and gets nothing leaves no trace.
Overlap: `gap-email.mjs` also checks "magic link issued, no email queued". Two red rows would show for one break.

### Second pass — Claude, 2026-10-08 (later)

What was wrong:
- The first review's edits (the write-grant check and 4 tests) had been put in a stash. They never reached the file the live site runs. The live file could only prove the app can READ the sign-in tables. A missing write grant is how login broke before. That is back in the file now.
- On the live server, a masked or empty `RESEND_API_KEY` would only say skip when Resend had sent anything in the last 7 days. It also said "the live key works". That is not proof. On the server the key IS the live key.
- 4 tests were hollow. Moving the storm line to 500 failed emails, or the 24 hour window to 240 hours, or the 3 minute grace to 0, left every test green.

What changed:
- `gap:auth-reset-mail`: on the live server (Lambda or Netlify env), a masked or empty key or from address is a FAIL, even if Resend sent mail earlier this week. Off the server (a laptop) it is still a skip, and the words no longer claim the live key works. They give the number of sends and nothing more.
- Tests now pin the storm line (5 failures, 2 emails) as plain numbers. They pin every time window in the SQL as text: 24 hours, 3 minute grace, 1 and 2 minute session match, 2 minute email grace, 7 days of Resend mail. 6 new tests.

Overlap, decided: both rows stay on purpose. `gap:auth-magic-link-dead` also proves the sign-in template can send, for the org that sends it. Its "link had no email" half is the same break as `email:magic-link-unqueued` in `gap-email.mjs`. If both go red it is one break. `email.md` is not this lane's file, so it was not touched.

Still true, not a bug: reset and invite mail leave no record. A bad but real-looking key passes. The check proves the setup, not each send.

Proof, second pass:
- Tests: 44 pass, 0 fail, 0 skipped.
- 22 deliberate breaks of this file: all 22 caught. The 4 that survived before are caught now.
- Live, prod mode: 4 PASS, 0 FAIL, 1 skip. Same in the staff view and the bare view. 0 SQL errors, 0 writes. The skip is this laptop's masked key. On the live server the same run would be a FAIL if the key were masked.
