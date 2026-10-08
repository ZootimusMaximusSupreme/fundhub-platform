# Email that should go out and does not

Lane 4 of 20. The company is Fundhub.

This lane only reports email that was supposed to leave and did not.
It does not send email. It does not flip the outbound switch.
The tripwire is the morning pulse, Recon (AG-07). No second watchdog.

## Checks

Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| id | FAIL when |
|---|---|
| `email:queued-stuck` | An outbound email is still queued after 30 minutes. Email only. A stuck text does not fail this row. |
| `email:provider-fail` | An outbound email is marked failed in the last 3 days. A test address or a missing address does not count. |
| `email:magic-link-unqueued` | A sign-in link was issued in the last 24 hours and no `EMAIL-PORTAL-MAGIC-LINK` row was queued. |
| `email:morning-no-failure-check` | A morning job sends email and never reads whether it queued. |

No database, or no org: the first three are skip. The morning row still reads the files.

## Morning files

- `src/workflows/slo-infinite-drip.mjs` — 8:00 a.m. Arizona. It sends email and does not check the result. This row FAILs on the live files.
- `src/contracts/notify.mjs` — contract chase at 10:00 UTC. It records a skip when nothing was queued.
- `src/finance/document-vault-chase.mjs` — 9:45 a.m. Arizona. It reads the send result and records `send_failed`.

## Not this lane

Slice 12 watches whether the messaging sweepers are on the machine list. It does not read the queue.
Resend and Mailgun send the mail. This file does not call them.
`pipeline:outbound` counts every channel. The stuck check here is email only.

## Files

- `src/pulse/coverage/gap-email.mjs`
- `src/pulse/coverage/gap-email.test.mjs`

## Test

`node --test src/pulse/coverage/gap-email.test.mjs`

11 pass, 0 fail. Run on 2026-10-08.
