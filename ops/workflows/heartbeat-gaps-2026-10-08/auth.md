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
