# Calls and bookings

Lane 12 of 20. This lane only. Report only.

Recon (AG-07) on the daily pulse is the only tripwire. No second watchdog. No call is placed. No HTML is edited.

## Checks

Four checks. Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip.

| Check | Break | FAIL means |
|---|---|---|
| calls:booked-no-outcome | Booked call with no outcome | A booked or moved call ended (30 minutes ago or more, inside 14 days). It is not a no-show or a cancel. No call outcome names the booking, and the same client has no outcome logged from 2 hours before the call. |
| calls:calendar | Calendar page is not the calendar | `/app/calendar.html` answered 2xx but it is not the calendar page. A page that does not answer 2xx is already red as `reg:calendar`, so this row skips and says so. |
| calls:booking-webhook | Booking webhook not stored | A booking event, or a ClickFunnels appointment capture with an email, was accepted 10 minutes ago or more and no bookings row holds it. |
| calls:ai-dial-no-failure | AI call that should dial and has no dial row | A new booking should have made Josh (AG-04) dial, the wait is over, and there is no `outbound_calls` row and no failure row. |

Not a miss for the AI call: Josh is not live, the outbound fence is up (`MESSAGING_DRY_RUN`), the booking was cancelled, the client has no phone, the 15 minute wait is not over, or quiet hours (8pm to 8am Arizona) have not ended. A prove-sim email does not get the quiet-hours wait.

## Not here on purpose

- Held call with no tape. The daily pulse already runs `unrecorded` over `src/sales/unrecorded.mjs`. The first version of this lane called the same function and made a second red row for the same thing. It was removed.
- A calendar page that is down. `reg:calendar` already reds it.

## Files

- `src/pulse/coverage/gap-calls.mjs`
- `src/pulse/coverage/gap-calls.test.mjs`

Shared pulse files were not edited. No commit. No ship.

## Test

`node --test src/pulse/coverage/gap-calls.test.mjs`

## Review — Claude, 2026-10-08

**What was wrong**

- `calls:booked-no-outcome` could never fail. It only looked at clients whose `call_outcome` field was empty. The booking code sets that field to "booked" on every booking. So no real booking matched. I proved it: a booking that ended 2.5 hours ago with no outcome came back PASS.
- `calls:booking-webhook` had a ClickFunnels half that could never match. It searched the raw body for the word `bookingUid`. ClickFunnels never sends that word. It sends the call id at `data.id`.
- That check also cried wolf for three normal cases: a form booking that ClickFunnels re-keys to the call id, an interview booking (skipped on purpose), and a cancel (never makes a row).
- `calls:held-no-recording` was a copy of the daily pulse check `unrecorded`. Same function, same answer, two red rows.
- `calls:calendar` and the plain "page is down" part repeated `reg:calendar`.
- `calls:ai-dial-no-failure` would have cried wolf when a booking was cancelled, or when outbound is held by `MESSAGING_DRY_RUN`. It also missed a phone that is only on the booking. And it said "failure row" but no failure row is ever written for Josh: the voice call never throws, it just returns a status.
- The old tests handed back canned rows for every query. They never ran the SQL.

**What changed**

- Booked-no-outcome: the dead test is gone. An outcome counts when it names the booking or the same client logged one from 2 hours before the call.
- Booking webhook: the ClickFunnels half reads the call id at `data.id`. A row counts by booking id, by event id, or by same email and start time. Cancels, interviews, demo rows, and anything younger than 10 minutes are left out.
- Held-no-recording: removed. Calendar: now only asks "is this really the calendar".
- AI call: reads Josh's row and the fence first, leaves out cancelled bookings, takes the phone from the booking too. The detail now says "Josh (AG-04) is retired, so no AI call is expected" when that is the reason.
- Reads `ctx.fetchImpl`, then `ctx.fetch`. Reads `ctx.env` for the fence.
- Tests now include a block that runs the real SQL on Postgres over fixture rows (skips without `DATABASE_URL`).

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Prod mode: 4 PASS, 0 FAIL, 0 skip. Staff mode matches. No SQL errors. No writes.
- Why all PASS is honest today: Postgres shows 0 live rows in `bookings`, `call_outcomes` and `outbound_calls`. The database was reset. Josh (AG-04) is `retired`. So there is nothing to find. That is why I also ran the SQL on fixture rows.
- Fixture run on the real engine: 38 cases, all matched. A booking with no outcome is FAIL. An outcome by uid or by client passes. An old outcome does not hide a new call. A real ClickFunnels body with no event and no row is FAIL. A cancel, an interview, a demo row, and a young event are PASS. Josh live with no dial row is FAIL. A dial row, a failure row, a cancel, a held fence, a retired Josh, and quiet hours are PASS.
- Tests: 18 pass, 0 fail without a database. 25 pass, 0 fail with `DATABASE_URL` (7 more run the SQL on fixtures).

**Left for Chris (not a check problem)**

- Josh (AG-04) is `retired`. While he is, the AI-call row cannot find anything. When he goes live, `BLAND_API_KEY` and `MESSAGING_DRY_RUN=0` must both be set on the deployment, or no phone rings and nothing says why. This row will say so.
