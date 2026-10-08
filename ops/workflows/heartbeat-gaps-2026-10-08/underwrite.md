# UnderwriteIQ and SLO pack gaps

Lane 20. Read only. Recon (AG-07) is the one tripwire. No second watchdog.

Slice 19 lists SLO job names. Slice 21 lists the underwrite door and the credit jobs. This file does not repeat those lists. It looks for four breaks:

| Check | FAIL when |
|---|---|
| `uw-paid-roadmap-no-pack` | A buyer paid the roadmap (`slo_` link, not a demo, status paid or a paid time), their credit pull finished after the payment (`analysis.completed`, older than 2 hours), and none of the four pack files is saved |
| `uw-letters-missing` | A credit file is in, and inquiries have no inquiry letter, or a dispute case has no letters |
| `uw-offer-fulfillment-failed` | The pack job is still failed in `failed_events`, or the client pack status is Delivery Failed — Retry |
| `uw-read-door` | The real `GET /api/read/underwrite` handler, run in this process on the newest real client with a stored credit file, throws or answers 500 |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

A read door that this run could not open (login seam answered 401, 403, 404, 400, or 503) is a `skip` with the status in the words. It is never a PASS. No real client with a stored credit file is a `skip`.

No credit pull. No charge. No page edits. No change to UnderwriteIQ math.

## Where the lines are

- `daily-pulse` already pings `/api/read/underwrite` with no login (check id `suggestions`) and counts 401 as fine. That tells us the route is wired. It cannot see a 500 behind the login. `uw-read-door` is the part it cannot see.
- A buyer who paid but has not filled the pull form has no pull yet. The pack is built after the pull, so that buyer is not a break here. `slo-paid-form-nudge` chases them.

## Prove

`node --test src/pulse/coverage/gap-underwrite.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `uw-read-door` made one web call with no login. That always answers 401. `daily-pulse` already does the exact same call and counts 401 as fine. So it was a copy, and it could never see a 500 behind the login. This is the exact break that hit before: the handler used a name that was not defined and every request died, while the route still answered 401.
- `uw-paid-roadmap-no-pack` went red for every buyer 2 hours after paying. But the pack is built after the buyer fills the pull form and the pull finishes. A buyer who has not filled the form yet is not a break. It was also stricter than the code on what "paid" means (the code accepts status paid or a paid time).
- The tests answered by regex and never ran the door.

What changed: `uw-read-door` now loads the real handler and runs it in this process for one real client. The only fake is the staff session lookup (one statement). Nothing is written and no login is made. A test runs the real `verifySession` against that stand-in, so if the login SQL changes the test fails. `uw-paid-roadmap-no-pack` now needs a finished pull after payment. Two more tests run the real handler on a thin file (answers 200) and with a throwing read (shows the break).

Live result after (read only, production database, plain role): 4 PASS, 0 FAIL, 0 skip. Staff role gives the same 4 PASS. With only `db, scope, now` the door check skips, because it needs a company id. The pulse passes one.

Why the PASS rows are true today: production has 0 paid roadmap buyers (15 roadmap links, all still `sent`), 1 real client with the pack saved, 0 open pack job failures, and 0 clients marked Delivery Failed. The door ran the real engine on a real file with 2 tradelines and answered 200.

Proof the paid-roadmap SQL can match real rows: I ran it read only with the roadmap filters swapped for a paid custom link and an impossible pack name. It returned the one real client with a pull after payment.

Test result: 16 tests, 16 pass, 0 fail.

Real company break found in this lane: none.
