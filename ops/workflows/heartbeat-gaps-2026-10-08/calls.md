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

## Tier 1 — Claude, 2026-10-09

One new check: `calls:booked-no-join-link`. It is the fifth row in this lane.

**The question.** Does a booked customer have a way to join the call?

**What I found in the real data.**

- ClickFunnels books the calls. Its booking message has no field for a join link. Our code sets the link to empty on every booking it takes.
- I looked at all 24 real calls in the event history (test addresses taken out). Not one has a link on the event.
- The bookings table is empty (it was reset). No task holds a link either.
- The 15-minute text sends the customer to the portal sign-in page where the link should be.
- So the closer's Join Call button on the calendar is always off, and the customer never gets a link from us.

**What turns it red (two ways, one row).**

1. A real booked call is still ahead (or began in the last 2 hours) and no link is on the event, the bookings row, or the closer's task. The row names the next call, with the email masked.
2. The feed itself. If none of the newest 5 real bookings carries a link (and there are at least 3), the next booking will not have one either. This one goes red before a customer is hurt.

Left out on purpose: demo events, cancelled calls, calls moved to a new time, interviews, test addresses (company domain, example domains, e2e / sim / test words, the fhtest tag, and any address with a +tag), and calls that began more than 2 hours ago or are more than 45 days out. One call that ClickFunnels reports under two ids counts once.

**What I changed from the plan.** The plan also said "red if any active closer has an empty `staff.meeting_url`". I dropped that half. That field is a standing room that only hiring interviews read (`src/hiring/booking.mjs`). Nothing sends a sales-call customer to it, and no screen sets it. An empty one cannot stop a customer from joining a call, so it would be a false alarm. All 4 active closers have it empty today. That is a hiring gap, and `v_hiring_host_gaps` already lists it.

**Live result (read only, as the pulse role, today).**

- Prod mode: `calls:booked-no-join-link` is **FAIL**. Detail: 0 of the newest 5 real bookings carried a join link. The other 4 rows in the lane still PASS.
- Staff mode gives the same answer. Bare mode (no company id) skips, like the other rows.
- Run time 1.4 s. 3 queries. 0 SQL errors. 0 writes. GET only (the calendar page).
- This is a red on day one. That is the finding, not a bug in the check. It stays red until a booking carries a link, or until Chris decides the link reaches customers another way.

**Proof it can go red on a real call ahead.** I ran the same check as of earlier dates, on the real August history, read only:

| As of | Result |
|---|---|
| 2026-08-13 10:00 UTC | FAIL, 3 booked calls ahead with no link |
| 2026-08-14 12:00 UTC | FAIL, 6 booked calls ahead with no link |
| 2026-08-22 12:00 UTC | FAIL, 3 booked calls ahead with no link |
| 2026-08-26 00:00 UTC | FAIL, nothing ahead, the feed row is red |

**Tests.** `node --test src/pulse/coverage/gap-calls.test.mjs`

- Without a database: 28 pass, 0 fail.
- With `DATABASE_URL` (read only, SELECT over fixture rows): 38 pass, 0 fail, 0 skipped. 3 of the 10 engine tests are new, and they run this check's own SQL.
- New FAIL and PASS cases: link on the event, the bookings row, or the task; junk text is not a link; cancelled; moved; same-email cancel; started 1 hour vs 3 hours ago; 44 vs 46 days out; test addresses; interview; two ids for one call; feed with 0 of 5, 1 of 5, under 3, and a link only on an older booking; a failed read is skip.
- I broke the code on purpose 18 ways (link test, cancel, move, feed rule, test addresses, saved links, window sizes, a failed read passing, and more). The tests caught all 18. File restored after.
- I changed two old assertions only because the lane now has 5 rows, not 4: the row count in `index()` and in the first test. Nothing was deleted, skipped or weakened.

**Not done by me (not my files).** `src/pulse/tripwires.mjs` (the map) and `src/pulse/coverage/INDEX.md` need the new id added by Claude. `gap-calls.mjs` was already on the `modules.mjs` list. I did not run `npm run pulse:prove`. Two other tests fail today for other lanes: `modules.test.mjs` (handoff, keys, leads, outside-inngest not listed yet) and `no-unfenced-transmit.test.mjs` (`gap-keys.mjs`, `funnel-doors.mjs`, `instant-watch.mjs`).

## Tier 1 fix round — Claude, 2026-10-09 (checker issue on `calls:booked-no-join-link`)

**What the checker found (medium).** The red could clear by itself. The feed check only read bookings from the last 120 days. Nothing in the product changes with time. But once the August bookings were older than 120 days, the check read zero bookings and turned green. It even said "fewer than 3 real bookings so far" while 24 were on file. I agree. It was a real hole.

**What I changed (one check, one file).**

- The feed check now judges the newest 5 real bookings at any age. There is no look-back window. The event read has no start date now, only "up to now", newest first, same 1500 cap.
- When the feed is red, the row now says how old the newest real booking is. Example: "the newest real booking was made 47 days ago". So a red that has sat for months says so.
- Same rule for a call that is still ahead: a booking made long ago for a call coming up is still judged.
- Nothing else in the lane was touched.

**Proof on the real data (read only, same pulse role, GET only).** I asked the same question as of dates after the August bookings aged out. With the old code the checker saw FAIL on 2026-12-15, then green (wrong) on 2026-12-21 and 2027-01-15. With the new code:

| As of | After the fix |
|---|---|
| 2026-10-09 (today) | FAIL, newest booking 47 days old |
| 2026-12-15 | FAIL, 114 days old |
| 2026-12-21 | FAIL, 120 days old |
| 2027-01-15 | FAIL, 145 days old |
| 2027-10-09 | FAIL, 412 days old |
| 2028-10-09 | FAIL, 778 days old |

The August dates still behave as before: 08-13 FAIL (3 ahead), 08-14 FAIL (6 ahead), 08-22 FAIL (3 ahead), 08-26 FAIL (feed only).

**Live run today (`gap-live calls`).** prod mode 4 PASS / 1 FAIL / 0 skip, staff mode the same, bare mode skips all 5 like the other rows. The FAIL is still this check. Run time 1.7 s. The event read returned 50 rows, which is all the booking history there is. 0 SQL errors, 0 write attempts, one GET (the calendar page).

**Tests.** `node --test src/pulse/coverage/gap-calls.test.mjs`

- Without a database: 29 pass, 0 fail (was 28).
- With `DATABASE_URL` (read only, SELECT over fixture rows): 40 pass, 0 fail, 0 skipped (was 38).
- 3 new tests. One checks the red does not fade at 0, 1, 48, 150 and 900 days, and that the age words are right. One runs the real SQL on the Postgres engine with bookings made 200 and 900 days ago. One checks the SQL has no start date.
- 2 old assertions changed, and I want that said plainly. Both pinned the 120-day window, which was the bug. (1) The SQL test used to expect a 120-day start date in the query. It now expects none. (2) An engine test said "a booking made 130 days ago is not a miss". That is only true if the call is long over. It now checks that case (still PASS), and a new engine case checks the other one: a booking made 130 days ago for a call still ahead is a miss (FAIL). Nothing deleted, skipped or weakened.
- I broke the code on purpose 9 more ways: put the 120-day window back in the SQL, put it back in the code, age taken from the oldest booking, age text removed, hours counted as days, "1 days" wording, feed never red, feed ignored when old, old call ahead ignored. The tests caught all 9. File restored byte for byte.
- `npm run lint`: 3142 files parse clean.

**Still true.** This is a standing red. It stays red until a booking carries a join link, or until Chris decides the link reaches customers another way (the ClickFunnels confirmation). The check cannot see that.
