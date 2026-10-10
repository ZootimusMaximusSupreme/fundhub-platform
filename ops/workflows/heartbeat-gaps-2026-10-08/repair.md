# Lane 10 — credit repair breakage

Fundhub. Read only. Not wired into the shared pulse files.

Slice `src/pulse/coverage/slice-15-repair.mjs` already lists repair jobs. This lane does not repeat that list.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-repair.mjs` returns two rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | FAIL means |
|---|---|
| `repair-case-stuck` | A dispute case is marked `stalled`. Or a repair card is past its clock (`src/repair/sla.mjs`) in a waiting stage: intake (3 days), awaiting documents (14 days), in transit (10 days), awaiting response (5 days after the bureau answer was due). |
| `repair-letter-round` | The letter engine did not finish. A card has sat in analysis past its 1 hour clock. Or an open case has dispute items and no letter after 30 minutes. Or a card says letters were made or ready to send and no letter exists. |

No database or no company id: both rows are `skip`. Demo clients are left out.

A letter row of any status counts as written. This check does not read letter words.

## Where the lines are

One stuck file is read once, not twice:

- `pipeline:repair` in the morning pulse (`src/pulse/pipeline-motion.mjs`) already reds any card in `stalled`, `letters_generated`, `ready_to_send` or `response_received`. This lane leaves those stage clocks to it. A test fails if that stage list changes.
- `fulfillment:next-action` (`gap-fulfillment.mjs`) reads the same late files for what the screen tells staff to do. That is a different symptom.

## Not this lane

- Do not rewrite a dispute letter that contradicts itself.
- Do not send bureau mail.
- Do not pull credit.
- Recon (AG-07) is the only tripwire. Do not add a second watchdog.
- Do not auto-fix.

## Test

`node --test src/pulse/coverage/gap-repair.test.mjs`

Fake database. No live credit pull.

## Review — Claude, 2026-10-08

What was wrong:
- `repair-case-stuck` only fired when a card sat on the literal `stalled` stage. Nothing moves a card there when its clock runs out. Only two events do (`repair.stalled`, `repair.analysis.empty`). The repair desk shows its "Stuck" chip from the clock, not from that stage. So the check said PASS while the desk said Stuck.
- A real paying client sat in `analysis` for 3 days (clock: 1 hour) with no case and no letters, and both rows said PASS. That was a lie.
- The card-on-`stalled` half was a copy of `pipeline:repair`.
- Stalled cases from demo clients would have rung the alarm. `dispute_cases` has no demo flag, so the read now joins the client.
- The open-case read had no wait, so a case caught mid-build could flash red.

What changed: both checks now read the same clocks the desk reads. `repair-case-stuck` reads stalled cases plus the waiting stages. `repair-letter-round` also reads analysis past its hour. The copy of `pipeline:repair` is gone. The tests now run the real clock code at each side of each line.

Live result after (read only, production database, plain role): 1 PASS, 1 FAIL, 0 skip. Staff role gives the same. With only `db, scope, now` both skip, so the pulse has to pass `orgId`. It does.

The 1 FAIL (`repair-letter-round`) is a real break, not a false alarm. Before this review the lane said 2 PASS.

Test result: 13 tests, 13 pass, 0 fail.

Real company break found: one paying repair client (client code FH-000507, id 64212914-1e0d-4ec1-bd6e-07fa156108b8) has sat in `analysis` since 2026-10-05 15:08 UTC. The clock is 1 hour. They paid $1,000 for repair on 2026-09-17 and finished documents on 2026-09-22. No case, no dispute items and no letters exist for them. In all of production there are 0 dispute cases and 0 letters ever saved. Fix is the owner's: not done here.
