# SMS that never goes out

Lane 3. Customer texts and staff texts. Read only. This check does not send a text.

breaks: 4
already watched: 4
new checks: 3

## Breaks

1. A text sits queued and due. Already watched.
2. A text was picked up and stuck on sending. New check.
3. The phone company said no (`failed`). New check.
4. A journey step that should text wrote no text row. New check.

The company outbound switch is not a finding. This check does not read it and does not say to change it.

## Already watched

These stay as they are. This lane does not add a second copy.

| Id | Where | What it already sees |
|---|---|---|
| pipeline:outbound | src/pulse/pipeline-motion.mjs | Queued outbound, texts included, older than 30 minutes |
| pipeline:outbound (sent by instant-watch) | src/pulse/instant-watch.mjs line 81 | The same queued count, same id. It already texts. Do not text again. |
| job:message-dispatch-sweeper | src/pulse/heartbeats.mjs | The customer dispatch clock ran |
| job:staff-message-sweeper | src/pulse/heartbeats.mjs | The staff dispatch clock ran |

Slice 12 already names `message-dispatch-sweeper`, `waypoint-nudge-sweeper`, and `commas-inbox-drain` for a machine row. It does not read text rows. Not copied here.

The sender already holds quiet hours, a dry run, and a gate block. A test-record refuse is not a phone-company failure. Those are not new checks.

One tripwire stays Recon. No second watchdog.

## New checks

`gapChecks` in `src/pulse/coverage/gap-sms.mjs`. Each row is `{ id, status, detail, suggestedFix }` with PASS, FAIL, or skip.

| Id | FAIL when |
|---|---|
| gap:sms-sending-stuck | A customer or staff text has been on sending for more than 15 minutes |
| gap:sms-provider-failed | A customer or staff text failed at the phone company in the last 7 days |
| gap:sms-journey-zero | One of the steps below is old enough, the template is approved, the person did not opt out, and there is still no text row |

Journey steps in the zero-row check:

- entry.captured → SMS-S00-WELCOME (one text per person)
- booking.created and booking.rescheduled → SMS-S04-01-CONFIRM
- round.started → SMS-ROUND-STARTED-NOTIFY
- round.approved → SMS-F04-ROUND-APPROVALS, only when the approved amount is above 0
- round.submitted → SMS-F03-ROUND-SUBMITTED, only when a round number is on the event
- deposit.paid → SMS-DOC-01-REQUEST (one text per person)

Reminders, no-answer cadences, and the staff booked-call alert (that switch defaults off) are not in this list. A queued text older than 30 minutes stays on pipeline:outbound.

## Prove

`node --test src/pulse/coverage/gap-sms.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:

- The "no text row" check could not fail for five of its six steps. It only looked at events that had a client id. Booking, deposit and round events never have one. They only carry an email. In the live data that was every one of them. So a missing booking text would have shown PASS forever.
- A read that threw took all three SMS checks down with it, and a count that came back blank read as zero (PASS).
- Nothing tested that the six steps still match the workflows that send them.
- The board named an id (`instant-watch:pipeline:outbound`) that does not exist. The real id is `pipeline:outbound`.

What changed (only the three SMS files):

- The journey check now finds the person by `client_id`, or by the email on the event (the same way the workflow does).
- One failed read is one skip row with the reason. A blank count is a skip, never a PASS.
- New tests: the email lookup, the six steps against the real workflow files, one failed read, a blank count, and the time cutoffs. 12 tests now.
- The old SQL fails the new email test. The new SQL passes it.

Live result after (read-only, production): prod 2 PASS / 1 FAIL / 0 skip. staff access gives the same numbers, so the check is not blind. 0 SQL errors, 0 writes.

The one FAIL is real, not a false alarm. A real lead (not a test record, no phone number) was captured on 2026-10-02 at 22:45 UTC. Two `entry.captured` events were written. No welcome text row and no welcome email row were ever written for that person. The welcome lock is empty, so the welcome workflow never ran for him. That day 48 capture events were written. 46 belong to people who got the welcome email. The other 2 are this lead. The check stays FAIL for 7 days.

Tests: `node --test src/pulse/coverage/gap-sms.test.mjs` = 12 pass, 0 fail, 0 skipped.

