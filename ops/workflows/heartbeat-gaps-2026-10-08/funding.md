# Funding desk gaps

Lane 11. Report only. Read only.

Recon (AG-07) on the morning pulse is the one tripwire. `daily-pulse` already reads it (check id `recon`). This file does not read Recon again and does not add a second watcher.

## What it looks at

1. A funding round that is still open and has not moved in 72 hours. A move is the round row or any bank row on it.
2. The lender list is empty. If the book file is here, the FAIL says how many banks it holds. If the book file is not on this host, it is still a FAIL.
3. The applications door. The real handler runs inside the pulse (GET only, read only) for one real client. A crash behind the login is a FAIL.
4. A bank row has sat on Apply for 72 hours with no submit date.
5. A funding file has waited 72 hours in an advisor queue stage and the Client Control Panel shows it no next step (blank, or "Not worked out yet"). The FAIL line names the stage, so a file waiting on a bank can be told from a file nobody is working.

72 hours is the same no-progress line DPC-05 and the `pipeline:clients` check already use.

## What it does not look at

- Slice 14: the eleven funding job ids F-01 to F-11.
- Slice 28: the funding desk doors and the next-step catch-up job.
- The morning registry and slice 28 knock on `applications`, `read/funding-rounds`, `dashboard/clients`, `dashboard/client` and `read/lender-matches` every day with no login. A route that is not wired is red there. A 401 counts as up. This file does not knock again. It only opens the `applications` door the other way, with a staff stand-in, to see a crash behind the login.
- Repair files with no next step. `fulfillment:next-action` reads those.

This file does not send a lender application. It does not change a page. It does not write. The door is opened with GET only. The write side of that door (POST, which saves a bank decision) is never run from here, because it would write.

## Check shape

Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| id | FAIL means |
|---|---|
| funding:round-stuck | An open round, and every bank row on it, is older than 72 hours |
| funding:lender-book | The lender list has no banks |
| funding:apply-door | The applications door crashed or answered 500 for a staff member, or would not load |
| funding:submit-path | A bank row sat on Apply 72 hours with no submit date |
| funding:advisor-queue | A funding file waited 72 hours and the screen shows no next step |

No database or no company id means skip. A lender list that is empty while the book file is here and has no rows is a skip. A waiting file whose step could not be read is a skip with the reason. A door this run could not open (401, 403, 400, or the login lookup) is a skip with the reason. No real client to open it for is a skip. None of those is ever a PASS.

Total: 5 checks.

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

## Review 2 — Claude, 2026-10-08

A second checker looked at the first review. Four notes. Here is what I did with each.

1. `funding:submit-path` no longer looked at the submit door (medium). Fixed.
   - The checker was right. The registry and slice 28 knock on `applications` with no login. A stranger always gets 401, and 401 counts as up. So a crash behind the login would show nothing.
   - New check `funding:apply-door` runs the real `applications` handler inside the pulse, for one real client, GET only. The only fake is the one login lookup, so no session is written and no login is made. Every other statement goes to the real database.
   - A crash or a 500 is a FAIL. A 401, 403 or 400 is a skip with the reason. It is never a PASS.
   - `funding:submit-path` stays for stale Apply rows.
   - The POST side of that door saves a bank decision. It is not run from here.
2. `funding:advisor-queue` could be a false alarm (low). Kept as is. Added the stage to the FAIL line.
   - I ran the real step code to check. A funding file in `round_submitted` or `action_required` with an open blocker or an unfinished document packet shows no next step. A clean file in those stages shows "Ready to Fund". `approved` shows "Prepare Next Round". `apply_now` shows "Apply for Funding".
   - So a file waiting on a bank with a blocker will go red after 72 hours.
   - The owner named this break: "advisor queue with no next action for a file that has been waiting". The screen showing "No step applies" over open work is the same defect the repair side fixed (Hole 7 in `next-action.mjs`). So it is a true report, not a false alarm.
   - The stage in the line lets Chris tell a bank wait from a file nobody is working.
   - Production has 0 funding cards, so this cannot fire today.
3. `funding:round-stuck` PASS words read backwards (low). Fixed. It now says: no open funding round has sat still for 72 hours or more.
4. Two old tests were removed in the first review (low). Judged fine. No code change.
   - They tested the Recon copy and the text search of `api.mjs`. Both behaviors are gone on purpose.
   - The guards live on in the new tests: no Recon id, no read of `agents`, no `netlify/functions/api.mjs` text, no `fetch(`.

Tests: 23 tests, 23 pass, 0 fail, 0 skipped (it was 14). New tests run the real login check against the stand-in, the real handler for a 200 and a 401, and a real handler with a broken read (FAIL). I broke the code 14 different ways in a copy of the repo. All 14 broke a test.

Also green: run-slices, modules, registry and pipeline-motion tests (50 of 50 with this file). `npm run lint` parses clean. A fresh bundle of the coverage files carries the handler and ran this lane against production: 5 PASS, 0 writes.

Live result after (read only, production database, plain role): 5 PASS, 0 FAIL, 0 skip. Staff role gives the same 5 PASS. With only `db, scope, now` (no company id) all five skip, so the pulse has to pass `orgId`. It does.

What is real today: the door ran on a real client and answered 200. The lender list holds 1106 banks. The other three PASS are true but empty (0 funding rounds, 0 bank rows, 0 funding cards).

Real company break found in this lane: none.
