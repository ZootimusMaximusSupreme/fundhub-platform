# Handoff heartbeat gaps

Lane: handoff only. Read only. One tripwire stays Recon (AG-07). No second watcher.

New lane, created 2026-10-09. Files: `src/pulse/coverage/gap-handoff.mjs`, `src/pulse/coverage/gap-handoff.test.mjs`, this board.

Why it exists: an event gets saved (a lead signs up, a lead leaves an email, a call is booked, a call ends) and the job that should answer it never writes a message. Those jobs run only on Inngest. They leave no row of their own. Their slice rows say "not checked". So this lane reads the effect: the message or task that should be there.

These checks do not send a text or an email. They do not touch the outbound switch. A message that was written and then failed or bounced is not this lane. Email and SMS lanes own that.

## Checks

Shape of each row: `id`, `status`, `detail`, `suggestedFix`. Status is PASS, FAIL, or skip. Each check has two or three branches. The row says which branch is red.

1. `handoff:lead-first-touches-missing` — Did a new lead get the first emails?
   - Welcome: a real `entry.captured` over 30 minutes old, and the person never got `EMAIL-S00-WELCOME`. (The welcome goes once per person, so a welcome from any earlier day counts.)
   - Nudge: over 25 minutes old, no `survey.submitted` within 25 minutes, and no `EMAIL-S02-FINISH-APPLICATION`.
   - Chase: `survey.submitted` over 2.5 hours old, no booking, and no `EMAIL-NOBOOK-01`.
2. `handoff:contact-no-followup` — Did someone leave their email on /roadmap and nobody followed up?
   - First note: a real `slo.contact_started` over 30 minutes old, not paid, and the person never got a `GENUINE` (or first-five, gift, coupon) message. The note goes once per person, so a note from any earlier day counts. (`/roadmap` saves one contact row per email per day.)
   - $197 offer: over 25 hours old, got the first note, did not reply, did not pay, and no `EMAIL-SLO-197` or `SMS-SLO-197`.
3. `handoff:booking-no-confirm` — Did a booked customer get the confirm email with the portal link?
   - A real `booking.created` or `booking.rescheduled` over 20 minutes old, and no `EMAIL-S04-01-CONFIRM`. The detail says how many also got no confirm text.
4. `handoff:reminder-missing` — Did the reminder texts go out before the call?
   - 24 hour: the call is under 22 hours away (or started in the last 72 hours), it was booked 25+ hours ahead, and no `SMS-S04-02-REMIND-24H`.
   - 2 hour: the call is under 110 minutes away (or started in the last 72 hours), it was booked 130+ minutes ahead, and no `SMS-S04-03-REMIND-2H`.
   - Left out: cancelled, moved, opted out of texts.
5. `handoff:call-outcome-no-followup` — After the call, did the customer get the next thing?
   - No-show: a real `booking.noshow` over 20 minutes old and no `EMAIL-S05A-NOSHOW-RECOVERY`.
   - Offer: a closer `call.completed` over 30 minutes old with an offer picked, and no `EMAIL-OFFER-*` ever. (Funding Mastery counts only after it is paid. The workflow waits for that.)
   - Declined: any `call.completed` whose outcome is `declined`, over 30 minutes old, and no task made after it. In real life this is the Bland AI call. A closer call can never end `declined`. The workflow (s-08) looks at the outcome alone, so this check does too.

Who is left out of all five: demo events, demo clients, test or company addresses (`fundhub.ai`, `example.*`, an `e2e`, `sim` or `test` word before the @, or a `+fhtest` tag), and anyone who is do-not-contact on both email and text. This is the same rule the workflows use (`src/slo/visitor.mjs`). A test checks they agree.

Read window: 7 days back. Reminders also look at calls that started in the last 72 hours, so a daily run still sees them.

No database in the run: all five skip. No company handed in: the lane looks up the default company once, and if that fails all five skip. A branch it cannot read is a skip, never a PASS. A branch that is red stays FAIL even if another branch could not be read.

Which workflow files each check copies (a test reads them and fails if a template key or a wait drifts): `s-00-welcome`, `s-02-incomplete-survey-nudge`, `s-nobook-chase`, `slo-genuine-followup`, `slo-no-reply-197`, `s-04b-booking-reminders`, `s-05a-no-show-recovery`, `s-offer-bucket`, `s-08-post-call-funding-declined`. Nothing is read from disk at run time.

Test: `node --test src/pulse/coverage/gap-handoff.test.mjs`
Live: `node --env-file=<repo>/.env <scratchpad>/gap-live.mjs handoff`

## Tier 1 — Claude, 2026-10-09

### What was built

Five checks, 11 reads, one extra read only when a row goes red (it names a template that is missing, not approved, or still draft copy). The lane runs in about 2 seconds on live. The limit is 20.

### Live result (read only, real database, `fundhub_app` role)

Ran early on 2026-10-09 (UTC). Same answer as staff and with the bare context. 0 SQL errors. 0 write attempts. No web calls.

| Check | Live | Why |
|---|---|---|
| `handoff:lead-first-touches-missing` | **FAIL** | Real break. One lead, `FH-000532`, signed up on 10-02 at 22:45 UTC (a `/roadmap` lead, ClickFunnels posted `entry.captured` twice). He got no `EMAIL-S00-WELCOME` and no `EMAIL-S02-FINISH-APPLICATION`. `s00_welcome_sent_at` is empty. `s-00-welcome.mjs` has no rule that skips `/roadmap` leads, so the welcome was meant to go. He did get the two `/roadmap` emails (first note, $197). |
| `handoff:contact-no-followup` | PASS | Only one real-looking contact is inside the 7 days (10-02 22:43 UTC, the same person as above). He got the first note and the $197 offer. The other two real-looking contacts (Dennis on 10-01, Chris's own test on 09-29) are older than the window. |
| `handoff:booking-no-confirm` | PASS | No real booking since 09-04. Nothing to read. |
| `handoff:reminder-missing` | PASS | No real booking with a call date in the window. |
| `handoff:call-outcome-no-followup` | PASS | No real no-show or closer call. Every closer `call.completed` and every `booking.noshow` on live is a demo or a test. |

The red on `FH-000532` clears on 10-09 at 22:45 UTC with no fix, because the window is 7 days. The 6 a.m. run on 10-09 is the last one that shows it.

Why the welcome never went is not known from the database. The event is saved. No run left a row. That is the same shape as the "hand-off to Inngest is lost" hole (`emit` in `src/events/bus.mjs` sends without waiting and swallows errors). The fix text points there first.

### Can each one go red? (proof)

1. **Made-up rows on the real database, 90 scenarios, 0 wrong.** This was a scratch script. It now lives in the repo as `src/pulse/coverage/gap-handoff.pg.test.mjs` (see the fix round below). It runs the real SQL inside `BEGIN READ ONLY` with the real tables swapped for made-up rows. Every check flips RED when the bad case exists and flips back to GREEN when the message, the booking, the reply, the payment or the task is added. It also proves the people who are left out stay out: test address, demo, do-not-contact on both, cancelled, moved, opted out, paid in time, replied.
2. **SQL breaks caught.** I broke the SQL 9 ways (welcome needs a message after the lead, repeat rule removed, survey slack, paid slack, `sim` removed from the test words, 25 hour booked-ahead margin removed, 72 hour look-back cut, offer lock ignored, demo client not excluded). The scenarios caught all 9.
3. **Code breaks caught.** I broke the code 12 ways (grace time, ignore red branches, unread count as zero, error as PASS, ignore the staff scope, template key typo, drop the opt-out clause, drop a test domain, window 7 to 14 days, FAIL with no fix, wrong reminder key, broken plural). The unit tests caught all 12.
4. **Real history with a wider window.** Same code, real rows, `now` moved back:
   - `now` 10-04: welcome and nudge go red for `FH-000532` (38 hours old).
   - `now` 08-16: 23 leads with no welcome, 8 with no nudge, 3 with no never-booked chase, and 18 bookings with no confirm email (all 18 also with no text). Message history from August is gone, so every August lead reads as untouched. That is why the window is 7 days.
   - `now` 08-23: 8 leads, 6, 1, and 8 bookings.
5. **Not provable on real history.** Reminders and call-outcome have no real case on live (no real booking since 09-04, no real closer call, no real no-show). Their red path is proved only by the made-up rows in item 1.

### Test result

`node --test src/pulse/coverage/gap-handoff.test.mjs` = 31 pass, 0 fail, 0 skipped (29 at first build, 2 added in the fix round below).

Includes a PASS test and a FAIL test for each check, the skip rules, the clocks (exact cutoffs), the placeholder count of every query, a check that no other lane uses these ids, a check that nothing is read from disk or fetched at run time, and the cross-check against the workflow files.

`modules.test.mjs` fails until `gap-handoff.mjs` is added to `GAP_FILES` in `src/pulse/coverage/modules.mjs` (between `gap-funnels.mjs` and `gap-inquiry.mjs`). I did not touch that file. Claude adds it.

### Where I changed the plan, and why

- **Booking confirm is red on the EMAIL alone**, not "email and text both missing". The email carries the portal link and the workflow always writes it (it does not check do-not-contact). A missing email with the text present is a customer who cannot get in. `gap:sms-journey-zero` already watches the text. The detail says how many got no text either.
- **Welcome counts a welcome from any day.** The workflow sends it once per person (a lock). "A welcome after this event" would call a returning lead a miss.
- **Nudge and never-booked chase skip a repeat post.** ClickFunnels posts one webhook per survey screen. A repeat inside 6 hours is saved and starts no run (`isRepeatFunnelPost`). It is not a miss. The nudge also counts a survey that lands within 25 minutes as "finished", the way the workflow does at minute 20.
- **Never-booked chase waits 2.5 hours**, not 2. The workflow sleeps 2 hours. The extra 30 minutes keeps a run in flight from reading as a miss.
- **A booking made up to 2 hours 10 minutes after the survey** stops the chase. A later booking does not, because message 1 had already gone.
- **The $197 branch only reads people who got the first note.** No first note is the other branch. A reply (or a coupon text) stops the offer, so those people are left out. I read the coupon text as well as the `slo_replied_at` flag, because Chris's own file shows a reply with the flag cleared.
- **Offer email and declined task are two branches**, not one "email and no task" test. The offer email is only due when an offer was picked. The task is only due on a declined call. Each one copies its own workflow gate.
- **Reminders also read calls that started in the last 72 hours.** The run is daily. A 22 hour window alone would miss a call that began between two runs.
- **A failed read is a skip**, not a FAIL. Other lanes use FAIL. The build rule here is skip with the reason.

### Not built

Nothing from the plan was left out.

### Wiring Claude still owes

1. Add the file to `GAP_FILES` in `modules.mjs` (the test above fails until then).
2. Name the five ids in `src/pulse/tripwires.mjs` for the workflows they cover:
   - `handoff:lead-first-touches-missing` — s-00-welcome, s-02-incomplete-survey-nudge, s-nobook-chase
   - `handoff:contact-no-followup` — slo-genuine-followup, slo-no-reply-197
   - `handoff:booking-no-confirm` and `handoff:reminder-missing` — s-04b-booking-reminders
   - `handoff:call-outcome-no-followup` — s-05a-no-show-recovery, s-offer-bucket, s-08-post-call-funding-declined
3. `npm run pulse:prove` was not run. The lane has no imports, so it adds nothing to the bundle. It needs the `modules.mjs` line first.

## Fix round — Claude, 2026-10-09 (checker found 3 problems)

A second reader checked this lane. It found 3 medium problems. All 3 were real. All 3 are fixed. No check id changed. The wiring owed to Claude (below) did not change.

### 1. Declined-call task could never go red (fixed)

- **What was wrong.** The declined branch only read calls marked `closer`. A closer call can never end `declined`. The only call that ends `declined` is the Bland AI call, and its mark is `declined`, not `closer`. So the branch read nothing, ever. The PASS line said "every declined call got a task", which was not true.
- **What it asks now.** Did any call that ended `declined` (any kind of call) get a follow-up task after it? This is what s-08 does: it looks at the outcome and nothing else.
- **Proof.** A Bland-shaped declined call with no task is now RED. With a task made after the call it is GREEN. Not declined, demo, 10 minutes old, no client: GREEN. The offer-email branch still reads closer calls only and does not read the Bland call.
- **Wording changed** (so the tests changed too): "ended a call as declined (outcome "declined", any kind of call) and no follow-up task was made".

### 2. First note: false red when the same person comes back on a later day (fixed)

- **What was wrong.** `/roadmap` saves one contact row per email per day. The first note goes once per person. A second-day row correctly gets no note, but the check called that a miss. It stayed red for up to 7 days.
- **What it asks now.** Has this person ever got the first note (or the first-five, gift or coupon message)? A note from any day counts, the same way the welcome check works.
- **Proof.** Contacted on two days, first note sent after day one only: GREEN (was RED). Contact today, note sent 20 days ago: GREEN. Two contact days and no note ever: RED, counted once. The $197 branch still wants the note after its own row, and two contact days with a 197 sent: GREEN. Two contact days and no 197: RED, counted once.

### 3. Tests did not guard the SQL (fixed)

- **What was wrong.** Every pass or fail test used a fake database with canned counts. They proved the words and the status, not the SQL. Someone could flip a rule in the SQL and all 29 tests still passed. The real proof lived in a scratch folder.
- **What was added.** `src/pulse/coverage/gap-handoff.pg.test.mjs`. It runs every query of this lane on a real Postgres, inside `BEGIN READ ONLY`, with the real tables replaced by made-up rows. No real row is read. Nothing is written (the test itself proves the database refuses a write). It skips without `DATABASE_URL`, like every other `.pg.test.mjs` here.
- **Count.** 12 tests, 110 made-up-person scenarios, all pass. That is the 90 from before, plus new ones for the two fixes above, the template lookup, and more edge cases (another company's event, an inbound message, a client with no row, an old task).
- **Two small tests in the fake-database file** (`gap-handoff.test.mjs`) now guard the two fixes without a database: the first-note branch must not use "after this row", and the declined branch must read the outcome and not the closer mark. They also read s-08, the Bland adapter and the closer outcome list, so they fail if those change under us.

### Can the new test go red? (proof)

I broke the lane's SQL 29 ways in scratch copies and ran the new test against each. It caught 29 of 29. The list includes: the old pre-fix file (5 scenarios fail: 2 first-note, 3 Bland declined), welcome `NOT` removed, `>=` flipped to `<=`, declined word broken, closer mark put back on the declined read, any old task counts, first note back to "after this row", booked-ahead rule removed, 72 hour look-back cut, opt-out channel wrong, cancelled no longer stops a reminder, repeat window cut, demo event not left out, `sim` removed from the test words, paid slack flipped, confirm reads the text key, confirm text count flipped, never-booked booking check removed, nudge survey check removed, reply flag removed, coupon-text check removed, Funding Mastery wait removed, both-channels opt-out removed, template approval always true, offer once-per-client lock ignored, no-show key typo.

### Numbers (all seen on 2026-10-09)

- Lane unit test: `node --test src/pulse/coverage/gap-handoff.test.mjs` = 31 pass, 0 fail, 0 skipped.
- Real-database test: `node --env-file=.env --test src/pulse/coverage/gap-handoff.pg.test.mjs` = 122 pass (12 tests + 110 scenarios), 0 fail, 0 skipped, about 6 seconds. With no database it is 12 skipped, 0 fail.
- Live lane run (read only, real data, `fundhub_app`): prod, staff and bare modes each 4 PASS, 1 FAIL, 0 skip. About 1.7 seconds per mode (limit 20). 0 SQL errors, 0 write attempts, 0 web calls. The one FAIL is the same real break as before (`FH-000532`, no welcome and no nudge).
- Real history replayed with the clock moved back (10-04 and 10-09 01:00 UTC): contact and call-outcome stay PASS. The fixes cause no new false red on real data. (There is no real repeat contact and no real Bland declined call on live; the only declined call is a demo one.)
- All pulse tests (`src/pulse/*.test.mjs` and `src/pulse/coverage/*.test.mjs`, no database in the shell): 1497 tests, 1456 pass, 2 fail, 39 skipped. The 2 fails are "a gap file is on disk and not on the GAP_FILES list" (modules.test, run-slices.test). They name `gap-handoff.mjs` and two files from sibling lanes. They clear when Claude adds the literal import lines to `modules.mjs`.
- `npm run lint`: 3140 files parse clean.

### Left as it was (not a checker finding)

The declined branch still counts "any task made after the call" for that client. It does not insist on the exact s-08 task, because no s-08 task exists on live yet to prove the match key against. Say the word if you want it tightened later.
