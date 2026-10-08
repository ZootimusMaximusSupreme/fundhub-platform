# Nurture heartbeat gaps

Lane: nurture only. Read only. One tripwire: Recon (AG-07). No second watcher.

These checks do not send a text or email. They do not turn outbound on or off.

Slice 16 already lists N-01 through N-06 and the next-step catch-up. It already says N-01, N-02, and N-03 are retired, and N-05 has no workflow file. This file does not score those again.

## Checks

Shape of each row: `id`, `status`, `detail`, `suggestedFix`. Status is PASS, FAIL, or skip.

1. `nurture:never-queued` — A lead or client hit a live nurture sequence (post-funding closeout, or a funded file that is still funded after the 180-day wait) and neither a text nor an email was queued. A closeout that is only the money-chain row (no closed stage) does not count. A funded file still inside the 180 days does not count. Demo files do not count.
2. `nurture:step-stuck` — A live nurture step is stuck. The row is still sending, or it is still queued while outbound is already on, or one channel was queued and the other never was. A queued row while outbound is paused is not a fail here.
3. `nurture:on-without-send` — A nurture sequence is turned on in the workflow file and that file does not write a send row. A sequence with an empty trigger, or `enabled: false`, is not turned on.

No database in the run: the first two checks skip. The code check still runs.

Grace before a miss counts: 15 minutes (3 times the 5-minute send schedule). The renewal wait is 180 days, then that same 15 minutes.

Test: `node --test src/pulse/coverage/gap-nurture.test.mjs`
