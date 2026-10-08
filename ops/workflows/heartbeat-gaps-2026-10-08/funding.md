# Funding desk gaps

Lane 11. Report only. Read only.

Recon (AG-07) on the morning pulse is the one tripwire. `daily-pulse` already reads it (check id `recon`). This file does not read Recon again and does not add a second watcher.

## What it looks at

1. A funding round that is still open and has not moved in 72 hours. A move is the round row or any bank row on it.
2. The lender list is empty. If the book file is here, the FAIL says how many banks it holds. If the book file is not on this host, it is still a FAIL.
3. A bank row has sat on Apply for 72 hours with no submit date.
4. A funding file has waited 72 hours in an advisor queue stage and the Client Control Panel shows it no next step (blank, or "Not worked out yet").

72 hours is the same no-progress line DPC-05 and the `pipeline:clients` check already use.

## What it does not look at

- Slice 14: the eleven funding job ids F-01 to F-11.
- Slice 28: the funding desk doors and the next-step catch-up job.
- The morning registry pings `applications`, `read/funding-rounds`, `dashboard/clients`, `dashboard/client` and `read/lender-matches` every day. A route that is not wired is red there. This file does not ping them again.
- Repair files with no next step. `fulfillment:next-action` reads those.

This file does not send a lender application. It does not change a page. It does not write.

## Check shape

Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| id | FAIL means |
|---|---|
| funding:round-stuck | An open round, and every bank row on it, is older than 72 hours |
| funding:lender-book | The lender list has no banks |
| funding:submit-path | A bank row sat on Apply 72 hours with no submit date |
| funding:advisor-queue | A funding file waited 72 hours and the screen shows no next step |

No database or no company id means skip. A lender list that is empty while the book file is here and has no rows is a skip. A waiting file whose step could not be read is a skip with the reason. That is never a PASS.

## Prove

`node --test src/pulse/coverage/gap-funding.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `funding:recon` ran the same Recon read that `daily-pulse` already runs. It was a copy, and not a funding break. Removed.
- `funding:submit-path` read the text of `netlify/functions/api.mjs` to see if the route was wired. That file is not in the live bundle, so on the live site it would have said "not wired" every morning. The registry already pings that route. Removed that half.
- `funding:round-stuck` only looked at the round row. Moving a bank row does not touch the round row. A round staff were working all day would have gone red after 72 hours. It now counts a bank row move as a move.
- `funding:lender-book` was a skip when the book file was not on the host. On the live site the file is never there. So an empty lender list could never go red. It is a FAIL now.
- `funding:advisor-queue` called a file "without a next step" when one saved field was blank. The screen works the step out from the whole file, so a blank saved field proves nothing. It now reads the same step the Client Control Panel shows.
- The tests used a fake database that answered by table name. They did not check the question asked. They now check the questions and the answers.

What changed: four checks, not five. All in `gap-funding.mjs` and `gap-funding.test.mjs`.

Live result after (read only, production database, plain role): 4 PASS, 0 FAIL, 0 skip. Staff role gives the same 4 PASS. With only `db, scope, now` (no company id) all four skip, so the pulse has to pass `orgId`. It does.

Why PASS is true today: production has 0 funding rounds, 0 bank rows, and 0 cards on the funding board. There is nothing to be stuck. The lender list holds 1106 banks.

Proof the FAIL path works on real data: I pointed the queue question at the repair board for one run (read only). The one real waiting file came back as FAIL: "screen shows no next step".

Test result: 14 tests, 14 pass, 0 fail.

Real company break found in this lane: none.
