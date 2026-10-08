# Nurture heartbeat gaps

Lane: nurture only. Read only. One tripwire: Recon (AG-07). No second watcher.

These checks do not send a text or email. They do not turn outbound on or off.

Slice 16 already lists N-01 through N-06 and the next-step catch-up. It already says N-01, N-02, and N-03 are retired, and N-05 has no workflow file. This file does not score those again.

## Checks

Shape of each row: `id`, `status`, `detail`, `suggestedFix`. Status is PASS, FAIL, or skip.

1. `nurture:never-queued` — A lead or client hit a live nurture sequence (post-funding closeout, or a funded file that is still funded after the 180-day wait) and neither a text nor an email was queued. A closeout that is only the money-chain row (no closed stage) does not count. A funded file still inside the 180 days does not count. Demo files do not count.
2. `nurture:step-stuck` — A live nurture step is stuck. The row is still sending, or it is still queued while outbound is already on, or one channel was queued and the other never was. A queued row while outbound is paused is not a fail here.
3. `nurture:on-without-send` — A nurture sequence is turned on in the workflow file and that file does not write a send row. A sequence with an empty trigger, or `enabled: false`, is not turned on.

No database in the run: the first two checks skip. The code check still runs. Which sequences are on is read from the loaded workflow modules (no file on disk needed). Tests can hand in `readText` to read source text instead.

Grace before a miss counts: 15 minutes (3 times the 5-minute send schedule). The renewal wait is 180 days, then that same 15 minutes.

Test: `node --test src/pulse/coverage/gap-nurture.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:

- `nurture:never-queued` could never FAIL. It joined the event to a client by `client_id`. Closeout and funded events never have one (0 of 5 and 0 of 4 in the live data). They only carry an email. So the join matched nothing. Now it finds the person by `client_id` or by the email on the event, the same way the workflow does.
- It had no start date. One old event with no message would have shouted forever. Now each branch looks back 7 days only.
- `nurture:step-stuck` would have called every person who opted out of texts a stuck pair (the email was queued, the text correctly was not). Opted-out people are now skipped on the text half. It also got the 7 day limit.
- Every row depended on reading the workflow `.mjs` files off disk. A deployed function does not carry `src/`. There, all three rows would have been a false FAIL every morning ("could not read"). Now the live list comes from the loaded workflow modules (id, enabled, triggers, and the handler code). A test proves the module list equals the source-file list.
- A count that did not come back read as zero (PASS). Now it is a skip.
- With a database but no company, the skip said "no database". It now says "no company".

What did not change, on purpose:

- The "still sending" and "still queued" parts of `nurture:step-stuck` overlap with `pipeline:outbound` (queued past 30 minutes) and the new `gap:sms-sending-stuck` and `email:sending-stuck`. They only have a tighter 15 minute clock for nurture messages. I left them. Existing tests name them. The half-pair part is the one nobody else sees.
- Both live sequences (N-04 post-funding, N-06 renewal) have never produced a message in the database. Every round event in the data is a demo record, so no real person has hit them yet. The check cannot be proven on live rows today. It is proven with a read-only run that ignores the demo flag: the old SQL found 0 on the 2026-09-19 window, the new SQL found 2.

Live result after (read-only, production): prod 3 PASS / 0 FAIL / 0 skip. Staff access gives the same, so the checks are not blind. 0 SQL errors, 0 writes.

Tests: `node --test src/pulse/coverage/gap-nurture.test.mjs` = 18 pass, 0 fail, 0 skipped.

