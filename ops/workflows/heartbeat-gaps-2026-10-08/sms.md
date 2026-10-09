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
| pipeline:outbound (sent by instant-watch) | src/pulse/instant-watch.mjs line 81 | The same queued count, same id, sent as its own instant text. It already texts. Do not text again. That is 3 different ids in 4 rows. |
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

### Second look — Claude, 2026-10-08 (a checker found more)

What was still wrong, and what changed:

- **Test traffic made the "no text row" check go red.** It did not skip demo events. Journey runs and seeds never get a text row. On 2026-09-21 all 135 flagged events were demo. On 2026-09-24 all 62 were. Now it skips demo events and demo clients, the same way the nurture check does. Proved on live data as of past days: 135 flags became 0, and the real lead from 2026-10-02 is still flagged.
- **"The client has no phone to send to" was counted as the phone company saying no.** That is a hole in the client record, not a provider failure. The only failed text in the database was exactly that one, and it held the check red for 7 days. Now that line is skipped. A real rejection or "gave up after N tries" still counts. The email check already did the same.
- **The inventory had a made-up id.** The code still said `instant-watch:pipeline:outbound`. The real id is `pipeline:outbound`. Fixed in the code. There are 3 different ids in 4 rows, because instant-watch sends the same id as its own text.

New tests (nothing removed): the demo filter is on the event and on the client and sits before the message lookup; the no-phone line is skipped and a real failure still shows FAIL; both reads stay SMS only.

Left alone, on purpose: the tests still check the SQL by its text, because there is no database in the test suite. The live proof above is where the SQL itself was run.

Live result now (read-only, production): prod 2 PASS / 1 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes. The 1 FAIL is the same real lead (no welcome text, no welcome email, welcome lock empty). It ages out after 7 days.

Tests: `node --test src/pulse/coverage/gap-sms.test.mjs` = 15 pass, 0 fail, 0 skipped.
