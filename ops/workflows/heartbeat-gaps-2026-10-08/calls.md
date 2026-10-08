# Calls, bookings, and recordings

Lane 12 of 20. This lane only. Report only.

Recon (AG-07) on the daily pulse is the only tripwire. No second watchdog. No call is placed. No HTML is edited.

## Checks

Five checks. Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| Check | Break | FAIL means |
|---|---|---|
| calls:booked-no-outcome | Booked call with no outcome | A booked or moved call ended (30 minutes past its time, last 14 days) and nobody logged an outcome. |
| calls:held-no-recording | Held call with no recording | A held sales call has no tape. This calls `listUnrecordedCalls` in `src/sales/unrecorded.mjs`. It does not copy that check. |
| calls:calendar | Calendar page dead | GET `/app/calendar.html` did not come back as the calendar page. |
| calls:booking-webhook | Booking webhook not stored | A booking webhook was accepted (event or ClickFunnels capture) and no bookings row has that id. |
| calls:ai-dial-no-failure | AI call that should dial and has no failure row | A new booking should have made Josh (AG-04) dial, the wait is over, and there is no dial row and no failure row. This check does not place a call. |

A setter that is turned off does not have to dial. A call still inside quiet hours (8pm–8am Arizona) is not late yet. A prove-sim email does not get that wait.

## Files

- `src/pulse/coverage/gap-calls.mjs`
- `src/pulse/coverage/gap-calls.test.mjs`

Shared pulse files were not edited. No commit. No ship.

## Test

`node --test src/pulse/coverage/gap-calls.test.mjs`
