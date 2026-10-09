# Email that should go out and does not

Lane 4 of 20. The company is Fundhub.

This lane only reports email that was supposed to leave and did not.
It does not send email. It does not flip the outbound switch.
The tripwire is the morning pulse, Recon (AG-07). No second watchdog.

## Checks

Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| id | FAIL when |
|---|---|
| `email:sending-stuck` | An outbound email has been on `sending` for more than 15 minutes. The dispatcher picked it up and never wrote a result. |
| `email:provider-fail` | An outbound email failed or bounced in the last 3 days. A test address or a missing address does not count. |
| `email:magic-link-unqueued` | A short-lived sign-in link was issued in the last 24 hours and no `EMAIL-PORTAL-MAGIC-LINK` row was queued. |
| `email:drip-step-no-email` | A person is on the roadmap drip and their step number is higher than the number of drip emails they have. |
| `email:morning-no-failure-check` | A morning job sends email and never reads whether it queued. Reads the source files. It looks in the checkout, then the deployed function folder, then the working folder. A skip only where no folder has `src/`. |

No database, or no org: the first four are skip. The morning row still reads the files.

Queued email stuck past 30 minutes is not here. `pipeline:outbound` already counts it (every channel, email included).

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

See the review below for the current count.

## Review — Claude, 2026-10-08

What was wrong:

- `email:queued-stuck` was a copy of `pipeline:outbound`. Same 30 minutes, same table. It could never say anything the pulse did not already say. Replaced by `email:sending-stuck`, which sees what the pulse cannot: email picked up and never finished. Nothing in the code puts a `sending` row back.
- `email:provider-fail` skipped every `bounced` email (8 in the database) because it demanded error text. It also dropped any failed row with a blank error. Now it counts both.
- `email:magic-link-unqueued` would have shouted at every booking. The booking confirm path issues a 365 day link and does not queue a sign-in email, on purpose (the link rides inside the confirm email). The check now reads only links that live an hour or less. A null client no longer matches a null client.
- `email:morning-no-failure-check` reads source files from disk. A deployed function does not carry `src/`. There, every morning file would read as "could not be read" and the row would be a false FAIL every day. Now an unreadable file is a skip with the reason.
- A blank count read as zero (PASS). Now it is a skip.
- The morning row could only look at code. The break it points at is real, so I added a row that reads the result in the database (`email:drip-step-no-email`).

Live result after (read-only, production): prod 3 PASS / 2 FAIL / 0 skip. Staff access gives the same, so the checks are not blind. 0 SQL errors, 0 writes.

The two FAILs are the same real break, seen two ways:

- The roadmap drip (8:00 a.m. Arizona) steps a person forward even when no email is queued. It also calls `sendTemplated` with no event id, so the message key is `workflow:<template>:null`. That key is the same for everyone. The second person to reach a step dedupes into the first person's row and gets nothing. In the database: one person has 4 drip emails (steps 1 to 4). Another real lead is on step 3 with 0 drip emails and 0 welcome emails ever.
- `email:morning-no-failure-check` (only where the source file is on disk) says the same thing from the code side.

Tests: `node --test src/pulse/coverage/gap-email.test.mjs` = 17 pass, 0 fail, 0 skipped.

### Second look — Claude, 2026-10-08 (a checker found more)

What was still wrong, and what changed:

- **The morning row could only skip on the live site.** It looked for `src/` three folders above its own file. On the live site the lane is packed into one file at `netlify/functions/`, so that path lands outside the package. The files were never found, even though they are in the package. I opened the live package (`.netlify/functions/api.zip`, built 16:37 today). It holds `src/workflows/slo-infinite-drip.mjs`, `src/contracts/notify.mjs` and `src/finance/document-vault-chase.mjs`. Now the row looks in the checkout, then two folders above the packed file, then `LAMBDA_TASK_ROOT`, then the working folder. First folder that has the file wins.
- **Proof it works there.** I packed the new lane the way the live site does, put the three real files from the live package next to it, and ran it from an unrelated folder. The old lane: skip, "not on disk". The new lane: FAIL on `slo-infinite-drip.mjs`, which is the real break. The other two files read fine and pass.
- That means the contract chase and the vault chase are now watched on the live site too, not only the drip.
- **Test gap closed.** The old stuck-email test said it read email only. The renamed one lost that. It is back: email only, outbound only, never SMS or queued.

New tests (nothing removed): the folders it looks in; files found under a live-style folder with a PASS and a FAIL; a folder with no `src/` is a skip with the reason.

Judged small, left alone: a bounce to one of our own test mailboxes (7 of the 8 old bounces) will show red for 3 days. A bounce on our own domain can also be a real mail problem, so I did not hide it. The word list in the morning check (`.sent`, `notQueued`, and so on) is loose. It passes any file that mentions one of those words. Both are low.

Live result now (read-only, production): prod 3 PASS / 2 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes. The 2 FAILs are still one real break seen two ways: the drip (database view and code view). On the live site both views now show.

Tests: `node --test src/pulse/coverage/gap-email.test.mjs` = 21 pass, 0 fail, 0 skipped.
