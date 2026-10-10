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

## Tier 1 — Claude, 2026-10-09

Five new checks on the message queue. They cover text and email. They live in `src/pulse/coverage/gap-sms.mjs` next to the three `gap:sms-*` checks. `gapChecks` now returns 8 rows: the 3 sms rows first, then the 5 `gap:msg-*` rows. All reads. This lane does not send. The old 15 tests still pass. Only the row-count helper in the test file changed, so it counts 8 rows instead of 3.

### What each check asks

| Id | Question | Red when | Live today |
|---|---|---|---|
| `gap:msg-sent-no-receipt` | Did a text or email go out and never get a receipt? | A text or email has sat on `sent` for over 24 hours (last 30 days, test traffic left out). | **RED.** 2 emails (AF1, to one affiliate address, both 09-21). The oldest is 17 days old. 5 more were test-client messages and are now left out (see the fix round below). |
| `gap:msg-approved-template-bad-copy` | Is a message we marked ready still full of placeholder words? | A template marked ready (`compliance_passed`) has "lorem ipsum" or a `[DRAFT` mark in the body or subject. These are the exact two patterns the sender's copy guard uses. | **RED.** 15 templates. 14 are lorem ipsum (the `BS-REPAIR` grid and the two 72-hour emails). 1 is `S-02`, which has a `[DRAFT — KILLED]` mark but is still marked ready. |
| `gap:msg-blocked-by-sender` | Did our own safety gate stop a customer message? | Any customer message made in the last 14 days has status `blocked`. The detail counts why and which template. A STOP (`opted_out`), a test address like example.com, and a test client are left out, because that is the system working or it is not a customer. | Green. Nothing in 14 days. With a 60 day window it finds the 5 old blocks (4 `CONTRACT-SEND-EMAIL`, 1 `AF1`, all `recipient_unknown`). |
| `gap:msg-inbound-unmatched` | Did a customer reply get lost, or land with no name on it? | Any one of three things in the last 7 days. (1) A reply reached our door and no message was saved after 15 minutes. (2) A reply came from a phone number that is a saved client, and it was saved with no client. (3) At least 3 saved replies and over half have no client. | Green. 0 real replies in 7 days. See "The plan was wrong here" below. |
| `gap:msg-failed-no-address` | Did a message fail because we had nowhere to send it? | A customer message failed in the last 7 days with the "the client has no phone or email to send to" error. This is the exact line the two failure checks leave out on purpose. | Green. The only one in 14 days was 10-01 (`SMS-S00-WELCOME`), and that client is a test client (`cfextract+...@example.com`), so it is now left out. |

### The plan was wrong here (said so on purpose)

The plan said `gap:msg-inbound-unmatched` is red today: "164 of 165 inbound texts have no client and no number". That is not customers. I read the door events.

- 280 of the 283 inbound events are **our own sending number texting our own test line**. Our own text comes back through our own door. They are not customer replies. Their `from` is our number.
- There is only 1 real customer reply in the whole history. It was matched to its client.
- `to_address` is **always empty** on an inbound row. The reply handler never writes it. So "no saved sender number" would be red forever and tell us nothing. I did not use it.

So the check leaves out any sender that is one of our own lines. A number that has ever been the "to" of an inbound event is ours. Then it asks the three real questions. Without this the check would be red every day on test traffic and would hide a real break.

Two more changes to the plan:

- The inbound check now starts from the door (the `message.inbound` event) and looks for the saved message with the same `sid`. That catches a reply that was never saved at all, which the plan did not cover. Two old events show it can happen (an MMS on 08-24 and a bare event on 09-19), but both came from our own test line, so they are left out today.
- `gap:msg-blocked-by-sender` also reads `last_error`, not just `blocked_reason`. The sender writes the copy-guard reasons (`draft_template`, `placeholder_copy`) into `last_error`.

### Red paths I proved

Run read-only on production as the app role (`BEGIN READ ONLY`, rolled back). The real SQL from the file was run. Made-up rows were added inside the same read-only query with a CTE that shadows the table. No write was possible.

- **sent-no-receipt:** real data gives 2 emails (it gave 7 before the test filter was added). Narrow the window to 5 days and it gives 0. Made-up rows: an email 3 days old counts, a text 26 hours old counts. A demo row, a voice row, a 2 hour old text, a delivered email and a 40 day old text do not.
- **bad-copy:** real data gives 15 (14 lorem, 1 draft). Made-up rows: lorem in the body and `[DRAFT` in the subject count. A not-approved template, plain Latin words ("dolor sit amet"), the word DRAFT with no bracket, and `[DRAFTED]` do not. A clean list gives 0.
- **blocked:** 14 days gives 0. 60 days gives the 4 real old blocks (it gave 5 before the test filter; the fifth was an AF1 email sent to the test address `e2e+aff-click17@fundhub.ai`, with no client). Made-up rows: `recipient_unknown` and `placeholder_copy` count. A STOP, a test address, a demo row, a 30 day old block and a sent row do not.
- **inbound-unmatched:** made-up door events gave own 1, real 6, saved 3, lost 1, unlinked 2, matchable 1, exactly as planned. When the client is created after the text, matchable goes to 0 (a lead who texts first and applies later is not a break). A demo event, an email event, an event with no `sid`, and an event older than 7 days are not counted. On real history over 90 days: 281 of our own texts left out, 1 real reply, saved and linked.
- **failed-no-address:** 7 days gives 0. 14 days gave one row (`SMS-S00-WELCOME`, text) before the test filter; that row is a test client, so 14 days now gives 0 too. The red path is the made-up rows below, not that row. Made-up rows: a missing phone and a missing email count. A different error, a demo row, a queued row and a 20 day old row do not.

### Live result (read-only, production, 2026-10-09)

`node --env-file=.env <scratchpad>/gap-live.mjs sms`

- prod: 5 PASS / 3 FAIL / 0 skip. Staff access: 5 PASS / 3 FAIL / 0 skip. Same numbers, so the checks are not blind under row security.
- 0 SQL errors, 0 writes. About 1.1 seconds for the whole lane, far under the 20 second limit.
- The 3 FAIL are `gap:sms-journey-zero` (the real lead from 10-02, from the older review above), `gap:msg-sent-no-receipt` (2 emails, after the fix round) and `gap:msg-approved-template-bad-copy`. All three are real, not false alarms.
- Reading `ctx` bare (no company), all 8 rows skip with the reason. Same as every other lane.

### Tests

`node --test src/pulse/coverage/gap-sms.test.mjs` = 61 pass, 0 fail, 0 skipped. That is the 15 old tests, 27 from the first build, and 19 from the fix round below.

Each check has a PASS test and a FAIL test. There are also tests that hold the SQL to the rules above, and tests that the patterns still match the sender (`dispatch.mjs`, `draft-guard.mjs`), the gate (`gate.mjs`), the test-address line (`providers/resend.mjs`) and the no-address line, which the sms and email failure checks both drop. If the sender changes any of them, a test fails.

I broke the code 14 ways on a scratch copy to check the tests would notice: a loosened share rule, a dropped test-address filter, a flipped age test, an ignored lost reply, a dropped "client existed first" rule, a dropped STOP filter, a draft pattern with no word edge, a dropped demo filter, a bad-copy check that always passes, own lines not left out, a blocked read that misses the copy guards, a narrowed no-address pattern, a read error that turns into PASS, and a check that reads voice calls. The first run caught 13. The 14th (a blocked read that throws and turns into PASS) was missed, so I added a test for it. All 14 are caught now. That was not enough: an independent check found 9 more breaks the tests let through. See the fix round below.

### Things to know

- `S-02` is a retired template (`[DRAFT — KILLED] S-02 retired ... Do not approve or send`) that is still marked ready. It keeps `gap:msg-approved-template-bad-copy` red even after the 14 lorem templates are fixed, until `compliance_passed` is switched off on it. I did not change it (owner hard lock, no product or data fixes).
- The 14 `BS-REPAIR` and 72-hour templates: the sender's guard blocks them, so a repair or funding customer who reaches that step gets no email. That is the finding.
- I did not run `npm run pulse:prove`. It builds the whole Netlify bundle, and other lanes are mid-edit. This lane was already on the `modules.mjs` list, so no list change is needed for it. `modules.test.mjs` and `run-slices.test.mjs` fail right now because of other lanes' new files (`gap-handoff`, `gap-keys`, `gap-leads`) that are not on the list yet.

## Tier 1 fix round — Claude, 2026-10-09

An independent checker read the first build and found 3 medium problems. All 3 were right. Fixed here. Only this lane's 3 files changed.

### 1. Test traffic was not really left out (checker was right)

The first build said "test traffic left out" on the message reads. It only left out the `is_demo` flag. Most test clients are not flagged: on production, 55 of 61 clients have a test-style address and 52 of those are not flagged `is_demo`. So 5 of the 7 red "no receipt" messages were test clients (`e2e+...@fundhub.ai`, `+sim-11@gmail.com`).

Now all three message reads (`sent-no-receipt`, `blocked-by-sender`, `failed-no-address`) leave out:

- a message flagged demo
- a message whose client is flagged demo, or flagged synthetic, or has a test address
- a message sent to a test address (a message can go to a different address than the client's saved one: one magic-link email went to `...-dana@` for client `...-ada@`)

The test address pattern is `TEST_ADDRESS_RE`. It is the shared test-client pattern (`gap-consent.mjs`) plus `^(e2e|demo|test)\+`. Same shape as `gap-payments.mjs`. A drift test holds the first part to `gap-consent.mjs`. It goes to the database as the last query parameter, like the sibling lanes.

Live result after the fix (read-only, production):

- `gap:msg-sent-no-receipt`: 7 down to **2** (2 emails, AF1, both sent 09-21 to one affiliate address). Still RED, and that red is real: receipts normally arrive (10 other AF1 emails were delivered between 09-17 and 10-07), so these 2 are missing one. It ages out of the 30 day window on 10-21.
- `gap:msg-failed-no-address`: stays green. The 10-01 `SMS-S00-WELCOME` row the first build used as its proof is a test client (`cfextract+...@example.com`). It would have turned this red for 7 days after any test run. It is now left out.
- `gap:msg-blocked-by-sender`: stays green. Of the 5 old `recipient_unknown` blocks (60 days), the AF1 one was sent to the test address `e2e+aff-click17@fundhub.ai` (no client), so the new address test leaves it out. 4 `CONTRACT-SEND-EMAIL` blocks remain in history.

Red path for the filter, run read-only as the app role (`BEGIN READ ONLY`, rolled back, the real SQL from the file, made-up messages and clients inside a CTE). 17 cases on each of the 3 reads, 51 runs, 0 wrong. Counted: a real client, a real client with an SMS to a phone number, a client on a real `fundhub.ai` address, a `synthetic: "false"` client, no client with a real affiliate address, no client with no address. Left out: a client at `e2e+...@fundhub.ai`, `+sim-11@gmail.com`, `cfextract+...@example.com`, `@host.test`, `test+crs@fundhub.ai`, a demo client with a real looking address, a synthetic client with a real looking address, a demo message, a real client messaged at an `e2e+` address, no client messaged at `demo+...` and at `@example.com`.

### 2. The same filter on the other two reads (checker was right)

Done in the same change. `blocked-by-sender` and `failed-no-address` use the same filter as `sent-no-receipt`, from one shared helper. A phone-less test client no longer turns `failed-no-address` red for 7 days.

### 3. The tests did not pin the reply SQL (checker was right)

The first build broke the lane 14 ways. The checker broke it 33 ways and 9 got through. The 9 were: the own-line filter missing from four counts (lost, saved, unlinked, matchable), no company filter on clients inside matchable, no `outbound` filter on the blocked read and on the no-address read, no subject test in the bad-copy WHERE, and no `LIMIT 100`.

All 9 are now caught. New tests:

- each of the five reads, word for word. These are the exact texts that were run against production. White space is ignored. To change a read on purpose, re-run the red-path proof, then update the text in the test. There is no database in this suite, so this is how a changed AND, `<`, number or dropped filter gets noticed.
- clause by clause tests that say why each part matters: every count except "own" leaves out our own lines, each count keeps its full rule, every table in the reply read is held to the one company, outbound only on the three message reads, the four tests inside the bad-copy WHERE, the row caps.
- the words and numbers around them: day and hour edges for "how old is the oldest" (2 days exactly, 1 ms short, 1 hour, 1 ms short), future time, zero-count rows, names cut at 60 characters in all three lists, top 4 shown then "N more", ties in alphabetical order, 5 names then "and N more", 1 text from our own lines, a query that returns nothing, a database error cut to 160 characters.
- the test address pattern: 16 test addresses it must match and 11 real ones it must not (including a phone number and `a@example.com.au`).

One small code change to make a test possible: a row with a zero count no longer shows as a piece of the blocked lists (`tally`). The SQL never returns a zero group, so nothing changes in production. The unused default `max = 5` on `tally` was removed.

Proof that the tests hold, run on a hermetic copy of `src/` (nothing touched the real files):

- 30 named breaks, all caught: the checker's 9, 17 on the new test filter (each piece of the filter, each piece of the pattern, each parameter not passed), and 4 older ones.
- A line-by-line run: every line of the new part of `gap-sms.mjs` was changed one way at a time (line removed, AND to OR, `<` to `>`, NOT removed, IS NULL flipped, numbers plus and minus one, `outbound` to `inbound`, true to false, `~*` to `!~*`, and so on). 738 broken versions. 122 did not parse and were thrown out. Of the 616 that parse: 612 caught, 4 let through. The 4 cannot change what the check says: (1) a guard for a bad date in the age helper that no caller can reach, (2) `Math.max(0` against `Math.max(1` in the same helper (both give "0 hours"), (3) and (4) the size of -1 and 1 in a sort that only uses their sign.

### Tests

`node --test src/pulse/coverage/gap-sms.test.mjs` = 61 pass, 0 fail, 0 skipped, 0 cancelled.

### Live result after the fix round (read-only, production, 2026-10-09)

`node --env-file=.env <scratchpad>/gap-live.mjs sms`: prod 5 PASS / 3 FAIL / 0 skip. Staff access 5 PASS / 3 FAIL / 0 skip. 0 SQL errors, 0 writes, 0 fetches. About 1.2 seconds for the lane. The 3 FAIL: `gap:sms-journey-zero`, `gap:msg-sent-no-receipt` (2), `gap:msg-approved-template-bad-copy` (15).

### Left undone

- `S-02` and the 14 lorem templates are unchanged (owner hard lock).
- Not run: `npm run pulse:prove` (builds the whole bundle while other lanes are mid-edit).
- The red-path scripts live in the session scratchpad, not in the repo (this lane may only change its 3 files).

