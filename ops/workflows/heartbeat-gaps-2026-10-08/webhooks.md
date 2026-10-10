# Webhook doors

Lane: inbound webhooks only. Twilio status, Commas (Fanbasis), ClickFunnels, and calendar booking.

Calendar bookings come in on the ClickFunnels webhook. There is no second booking door.

## What this check does

Two probes per door. It does not send a webhook. It does not replay a payment.

1. A GET to the live site. 401 or 405 means the webhook function is up. 404 means the whole `/api/webhooks/` prefix is gone. Anything else is a fail.
2. The webhook router, called inside the pulse. Empty body, no signature, no secrets, and a database that refuses every query. A mounted provider answers 401. A provider the router does not know answers 404. That 404 is the "door is missing" signal.

Why two: the live handler answers 405 to a GET before it reads the provider name. `GET /api/webhooks/does-not-exist-xyz` is 405 too. So the GET alone can never say a door is missing.

Then it reads the database. It counts Commas inbox rows the sweeper will never pick up again: status failed at all 10 tries, or status processing at 10 tries and older than 15 minutes. Twilio status and ClickFunnels do not keep a failed queue. They answer inside the request.

## Checks

| id | what |
| --- | --- |
| webhooks:twilio-status | live GET + router, provider `twilio-status` |
| webhooks:commas | live GET + router, provider `commas` |
| webhooks:clickfunnels | live GET + router, provider `clickfunnels` |
| webhooks:calendar-booking | same ClickFunnels door (booking posts land there) |
| webhooks:stuck-failed | commas_inbox failed, or processing and old, at the sweeper limit |

No fetch in the run skips the four doors. No database skips the stuck-row read. A skip is not a pass.

## One tripwire

Recon (AG-07) is the one tripwire. This check does not add a watcher. It does not restart the sweeper. It does not POST. It does not replay a payment.

## Files

- src/pulse/coverage/gap-webhooks.mjs
- src/pulse/coverage/gap-webhooks.test.mjs

## Review — Claude, 2026-10-08

What was wrong:

- The four door checks could never FAIL. I sent the same GET to `/api/webhooks/does-not-exist-xyz` on the live site. It answered 405, the same as the real doors. A missing door and a real door looked the same. Add the router probe above and a missing provider comes back 404.
- The stuck-row read missed a row left on `processing` at the 10 try limit. The sweeper never claims it again, and it was not counted because its status is not `failed`.
- A test banned the router from this file outright. That kept the check blind. I replaced the blanket ban with a narrow one: the router is named once, and the only call uses an empty body, no headers, no secrets, and a database that throws. The other bans (the Commas handler, the inbox worker, drain) stay.

Live result after (read-only, production): prod 5 PASS / 0 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes, only GET left the machine.

Proof the door check can fail: the real router answers 401 for all three providers and 404 for a provider that is not there. A test pins both. The stuck SQL was also run on a copy that pretends `done` is failed. It counted 36, so the columns and tests match real rows. There are no stuck rows today.

Not done, left for the owner to name (hard lock): other doors the router serves (Twilio inbound, Resend, Lendflow, Mailgun, PostGrid, Bland, Submagic) get no door check. Lendflow is the only source of the `round.*` events and was once unmounted without anyone knowing. The same one-line router probe would cover each of them.

One more fix: each live GET now has an 8 second abort. The lane runs as one pulse step with a 26 second ceiling, and a door that hangs would have killed the step instead of showing as a FAIL.

Tests: `node --test src/pulse/coverage/gap-webhooks.test.mjs` = 21 pass, 0 fail, 0 skipped.

### Second look — Claude, 2026-10-08 (a checker found more)

The checker agreed with the lane. One thing it flagged as medium: the first read-only test banned the router name everywhere, and the review loosened that to let the router probe run. That is a weaker test on its face. Here is why it stayed, and what was added so it is not weaker in practice:

- The lane was asked for a door check that can fail. A live GET answers 405 for any provider name, so only the router can say a door is missing. The blanket ban made the check blind.
- The first ban is now back, word for word, on the whole file minus the one pinned import and the one pinned call. Any other mention of a handler, the inbox worker, or a drain still fails.
- New proof the probe is safe. The real router is called with a database that counts every query. For the three doors it answers 401. For a door that does not exist it answers 404. The count of queries is 0. If the router ever starts touching the database before it checks the signature, that test fails. Before, the database only threw, which a router could swallow and hide.

Kept on purpose, both low:

- `webhooks:commas` overlaps `payments:commas-webhook-route`. The webhooks lane prompt names Commas as in scope, so both stay. One missing door shows as two red rows.
- `webhooks:calendar-booking` is the ClickFunnels door. The prompt names it. One missing door shows as two red rows.

Live result now (read-only, production): prod 5 PASS / 0 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes. Only GET left the machine.

Tests: `node --test src/pulse/coverage/gap-webhooks.test.mjs` = 23 pass, 0 fail, 0 skipped.

## Tier 1 — Claude, 2026-10-09

Two new checks in this lane. Both only read. No post, no send, no repo file read at run time.

### 1. `webhooks:inbound-doors-mounted`

**Asks:** Is every door that vendors knock on still there?

It checks nine doors: `twilio` (customer replies and STOP), `resend`, `mailgun` (bank decision mail), `mailgun-events`, `postgrid`, `bland`, `lendflow`, `inquiry-removal`, `submagic`. The first four rows in this lane already watch `twilio-status`, `commas` and `clickfunnels`, so those are not repeated.

Same two looks as the first four rows:

1. A GET to the live site for each door. 405 or 401 is fine. 404 is red.
2. The real webhook router, run inside the pulse with an empty, unsigned post. A door the router knows refuses it. A door the router has never heard of says `404 unknown provider`. That is the red signal.

One row, one answer. If doors are broken, the row names each one and what a customer loses (for example "lendflow (funding round updates)").

**The plan was wrong in one spot.** The plan said red when a live GET answers 404. A live GET answers 405 for every name, even a made-up one, so a missing door looks the same as a good one. Only the router can say "no such door". So the router look is the one that matters. The live GET only proves the `/api/webhooks/` prefix is deployed.

**Measured on the real router (empty unsigned post, no secrets):** 401 for seven doors, 400 for `submagic` (no project id), 503 for `resend` (no signing secret, so it fails closed). All three count as "mounted". A made-up name gives `404 unknown provider`. The probe made 0 database queries and 0 outbound calls. A test pins that.

**Live result:** PASS. All 9 doors mounted. Live site answered 405 on all 9. Router refused the empty post on all 9.

**Red path, proved:**
- With the real router, I asked for `lendflow` under a name it does not know. Row went FAIL: "1 of 9 inbound doors are broken. lendflow (funding round updates): router has no door for it (404 unknown provider)".
- With a fake site that answers 404 for `postgrid`, row went FAIL and named `postgrid`.

### 2. `webhooks:receipts-silent-after-sends`

**Asks:** We sent texts and emails. Did a delivery receipt come back?

It looks at the newest 3 real texts and the newest 3 real emails that left in the last 72 hours (and are at least 60 minutes old). For each one it looks for that send's own receipt in `webhook_captures`. It matches on the vendor's message id (Twilio `SM...`, Resend email id). Red for a channel when none of the newest 3 has a receipt. A wrong signing key or a missing secret makes the door refuse every receipt, and a refused receipt leaves no row. So that case looks like silence. This is the hole it watches.

**The plan was changed in three ways, because of the real data:**
- Plan: "5 or more sent in 24 hours, no receipt row at all." Real volume is 0 to 7 texts a day. 4 of the last 10 full days had no text at all. Only 3 of those 10 days had 5 or more texts, so a floor of 5 would have been blind on the other 7. Now: newest 3 in 72 hours, and even 1 send with no receipt counts.
- Plan matched by provider only. But `webhook_captures` also holds receipts for texts that are not in `messages` (the pulse text, for one: 4 receipts on 10-08 with 0 texts in `messages`). Those would hide a dead door. Now each send is matched to its own receipt.
- Only sends the vendor accepted count (they carry a vendor message id). Demo rows and blocked or failed-at-send rows are left out.

**Measured first:** of 74 real sends with a vendor id (47 emails, 27 texts), 73 had a receipt. One text (2026-09-30 04:38 UTC) never got one. So one lost receipt is rare (1 in 74) and "none of the newest 3" is not chance.

**Live result:** PASS. Texts: 2 of the newest 2 have a receipt. Emails: 3 of the newest 3 have a receipt.

**Red path, proved on real data (read only):** I ran the same SQL against the real sends, with the receipt door names swapped for names nothing writes. Both channels came back `checked 2, got 0` and `checked 3, got 0`. The full row went FAIL: "none of the newest 2 texts has a delivery receipt (door /api/webhooks/twilio-status ...); none of the newest 3 emails has a delivery receipt (door /api/webhooks/resend ...)". With the real doors it is `got = checked` on both.

**What it cannot see (said plainly):**
- A quiet stretch with nothing sent has nothing to wait on. That row is PASS with the reason in the detail.
- One lost receipt, or two of three lost, is not "silent". It stays green on purpose.
- It cannot see the production secret. The router probe runs with no secrets, so `resend` always answers 503 there. A missing `RESEND_WEBHOOK_SECRET` on Netlify shows up in check 2 (no receipts), not in check 1.
- The two client-owned doors (`merchant-whop/<id>`, `merchant-commas/<id>`) are not probed. They need a connection id and read the database.

### Proof and numbers

- Lane test: `node --test src/pulse/coverage/gap-webhooks.test.mjs` = **44 pass, 0 fail, 0 skipped** (23 tests before, 21 new). I changed 9 old assertions only where the lane grew (row count 5 to 7, the id list, the GET list from 3 to 12 paths, the db read count from 1 to 2, the router call list). None got weaker. Every one is now an exact list.
- Mutation proof: I broke the code 13 ways (silent test flipped, silent test removed, unknown door never found, 503 not accepted, router answer ignored, live answer ignored, 200 accepted, 24 hour window, no grace, read error returned as PASS, match by provider only, wrong door name, demo rows counted). Each one made at least 1 test fail. File restored and checked by md5.
- Live tool (`gap-live.mjs webhooks`): prod **7 PASS / 0 FAIL / 0 skip**. Staff database the same: 7 PASS. Bare run (no fetch, no db): 7 skip, none PASS. 0 SQL errors, 0 write attempts. Only GET left the machine. Lane time about 0.8 seconds.
- `node scripts/lint.mjs`: clean.
- The SQL cannot run in a unit test here (no local Postgres). It was run live, read only, three ways: today's window, a dead-door copy, and a one-day window in September. The unit tests pin its text and test the logic with fake rows.

### Left for others (one card, not worked)

- `webhook_captures` has 0 `clickfunnels` rows since 2026-10-02 (904 before). The audit already notes it (`01-client.md` line 346). It is not one of these two checks.

### Checker fix — Claude, 2026-10-09 (the receipts SQL was not pinned)

**What the checker found (medium):** the receipts check reads its answer from one SQL text. The unit test cannot run SQL (no local Postgres here), so a fake database hands back canned rows. That means a bad edit to the SQL still passed. The checker made 3 edits that kept all 44 tests green:
1. Newest-first flipped to oldest-first. The check would look at the oldest 3 sends, so a door that died yesterday stays green. This one is silent.
2. The text door and the email door swapped.
3. The email door renamed to a name nothing writes.

**The checker was right.** I made the same 3 edits in a copy of the repo in the scratchpad (the repo itself was not touched). Against the old test: all 3 survived (0 failing, 44 passing).

**What I changed (tests only, no change to the check):** `src/pulse/coverage/gap-webhooks.test.mjs`, in the test "the read matches each send to its own receipt". It now pins:
- The sort: `ORDER BY ... DESC` inside `row_number()`, no `ASC` anywhere, and only one `ORDER BY`.
- The channel-to-door map, exactly: `CASE s.channel WHEN 'sms' THEN 'twilio-status' ELSE 'resend' END`. Also a small helper reads that CASE back and checks that texts go to `twilio-status` and email goes to `resend`.
- The whole "has a receipt" test: it must be `WHERE EXISTS` (never `NOT EXISTS`), with the door, the time and the message-id match joined by `AND`.
- The texts-or-emails filter, joined by `OR`.
- `GROUP BY s.channel` (one row per channel), the `checked` count, and `max(...)` for the newest send time.

**Proof (copy of the repo in the scratchpad, 27 one-line edits to the SQL):**
- Old test: the checker's 3 edits all survived.
- New test: all 27 caught (each one fails exactly 1 test). 0 survived. The 27 include the checker's 3, and 24 more I added: sort off, partition off, window flipped, grace flipped, demo rows allowed, no-id rows allowed, wrong channel or provider, AND/OR flips, count/max/group-by changes.
- My own extra edits found 4 more holes my first pins missed: group by, `NOT EXISTS`, `max` to `min`, and texts-and-emails joined by AND. Three of those would have been silent (a dead door reads as healthy). I added a pin for each, then re-ran all 27: 0 survived.
- Lane test on the real repo: **44 pass, 0 fail, 0 skipped** (same 44 tests, more checks inside one of them).
- Lint clean. Live tool: prod 7 PASS / 0 FAIL / 0 skip, same as before (the check itself did not change).
