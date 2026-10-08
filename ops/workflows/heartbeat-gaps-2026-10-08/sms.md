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
| instant-watch:pipeline:outbound | src/pulse/instant-watch.mjs | The same queued count. It already texts. Do not text again. |
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
