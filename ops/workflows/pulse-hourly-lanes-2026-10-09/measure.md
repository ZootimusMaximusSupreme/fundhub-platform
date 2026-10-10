# Hourly lanes: what we measured (2026-10-09)

**In plain words.** We took the 41 deep checks (we call them lanes) and the 396 door pings that run once a day at 6 a.m. We ran each lane three times, one at a time, inside the same read-only box the hourly pulse uses. None of them wrote anything. None of them sent anything but a GET or a HEAD. All 41 can run every hour. The only catch is time. All 41 lanes together take about 68 seconds one after another, so they need to be split into 6 groups that run side by side (5 groups is the least possible, and that leaves almost no room). The door pings take 5 seconds. 27 lanes can show a red for one hour and then go green by themselves (a slow page, or an email that was 20 minutes late), so those need two reds in a row. 12 reds are on the board today and Chris already knows them. Two of them (handoff and text-journey) will turn green on their own this afternoon when the old record gets too old to count.

Numbers below were seen on 2026-10-09 this morning (Arizona time, about 9:10 to 10:00). Seconds are from this Mac (about 45 ms to the database per round trip). The first 3-pass run overlapped a second run by mistake, so it was thrown away and all 41 lanes were run again alone (other sessions still ran lint and tests on the Mac, so read the range in the table). Scratch scripts and raw output: `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/69703f6e-8139-4197-a6cb-b4514d0157ce/scratchpad/design/` (`measure-lane.mjs`, `box-clean.json`, `flap.mjs`, `doors.mjs`, `pack.mjs`).

## How each number was taken

| Question | What was run |
|---|---|
| Seconds, queries, web reads, hosts | `measure-lane.mjs box`: each lane's `gapChecks(ctx)` with `ctx.db = { query }` backed by the real `openReadBox` (src/pulse/beats/readbox.mjs, staff scope, savepoint per statement, extended protocol), `ctx.scope = (fn) => fn(db)`, a fetch that only lets GET and HEAD leave, 3 passes, one lane at a time, median of 3. `DATABASE_URL` was replaced with a dead address after the box connection was made, and `pg.Pool`, `pg.Client`, `http` and `https` were watched for any escape: 0 escapes. |
| Statement refusals | Same run (0 refused in 123 lane runs, 1,233 reads) plus a second run that records the allow-list verdict and runs the statement anyway (0 refused, 0 errors, 0 write attempts), plus a static scan of every SQL string in the 41 files (161 whole statements pass; 15 hits are pieces of bigger statements, not statements). |
| Current reds | `gap-live.mjs` (the morning job's shape: plain role plus staff scope), compared row by row with the real 06:00 scorecard stored in `pulse_scorecards` (209 of 209 lane rows found). |
| Flap | `flap.mjs`: every lane run with `ctx.now` moved to -3, -2, -1, 0 and +1 to +24 hours on the same live data and the same fetched pages. |
| Door pings | `doors.mjs`: the real `checkRegistry`, concurrency 20, one pass, GET only, against https://fundhub.ai. |
| Groups | `pack.mjs`: 200,000 random packings, cap 14 s, sequential inside a group. |

## Table

Columns: seconds alone is the median of 3 passes (min-max in brackets); queries are reads sent to the database; red now matches the live 06:00 report.

| lane | checks | seconds alone (min-max) | queries | web reads | hosts | read-only allow-list | GET-only fetch | red now | hourly fit | why |
|---|---|---|---|---|---|---|---|---|---|---|
| ads | 4 | 0.61 (0.6-0.6) | 4 | 0 | none | pass | pass | none | yes | Red only after a 3 hour gap in the hourly Meta pull (the pull runs at :30, the pulse at :07). Reads closed Arizona days, so the hour does not matter. 2 rows skip today (no ad is running). |
| ai-agents | 2 | 0.3 (0.3-0.3) | 2 | 0 | none | pass | pass | none | yes-with-damping | ai-agents:failed-runs has a 15 minute retry grace, so a run that fails and retries between two looks can show red once. 7 day window: stays red up to 7 days after a failed run unless a later run exists. |
| auth | 5 | 0.88 (0.8-0.9) | 6 | 0 | none | pass | pass | none | yes | State checks. 24 hour windows (gap:auth-staff-login, gap:auth-magic-link-dead, gap:auth-signin-no-session) stay red up to 24 h after the fix. gap:auth-reset-mail skips on this Mac (RESEND_API_KEY is a mask here); green in the live 6 a.m. run. |
| banks | 4 | 0.6 (0.6-0.6) | 4 | 0 | none | pass | pass | none | yes | All four are state checks. Bank sync is red after 3 days, so a one hour look changes nothing. |
| brain | 3 | 0.55 (0.3-0.6) | 2 | 0 | none | pass | pass | none | yes | Runs the real search doors in this process (POST, fixed stub vector, no AI, history writes off). brain:embed-key reads red only on this Mac (OPENAI_API_KEY is a mask here); it was green in the live 6 a.m. run. |
| calls | 5 | 1.37 (1.1-1.6) | 7 | 1 | fundhub.ai | pass | pass | calls:booked-no-join-link | yes-with-damping | calls:booked-no-outcome (30 min grace, a closer logs the outcome by hand), calls:booking-webhook (10 min), calls:ai-dial-no-failure (15 min) can catch an item mid-way; calls:calendar is one GET of a 77 KB page. calls:booked-no-join-link is a standing red that never fades by itself. |
| closer | 2 | 0.41 (0.4-0.7) | 1 | 3 | fundhub.ai | pass | pass | none | yes-with-damping | closer:desk-pages is 3 GETs (present.js is 141 KB); one failed GET turns it red. closer:held-disposition has a 2 h grace and a 14 day window. |
| consent | 5 | 0.68 (0.6-0.8) | 4 | 1 | fundhub.ai | pass | pass | none | yes-with-damping | consent:page is one GET of a 40 KB page. The rest are state checks (24 h paid grace, 1 h store grace, 7 day dispute grace, all in SQL now()). |
| contracts | 4 | 0.73 (0.7-0.9) | 3 | 2 | fundhub.ai | pass | pass | none | yes-with-damping | contracts:sign-route is 2 GETs that must answer 404 on purpose (503 means no secret). One failed GET flips it. Other rows are state checks. |
| crm-links | 10 | 6.8 (6.7-7.4) | 29 | 64 | fundhub.ai | pass | pass | none | yes-with-damping | 64 reads of our own site (51 HEAD), 4 pages over 64 KB. One failed GET reds crm-links:pages or crm-links:bank-logos. The logo sample rotates by UTC day, so the same 40 logos are re-read all day. |
| csm | 3 | 0.42 (0.4-0.5) | 3 | 0 | none | pass | pass | none | yes-with-damping | csm:missing-step has a 10 min grace on an event handler and a 60 day window (sticky). |
| documents | 4 | 2.25 (2.2-2.3) | 6 | 6 | api.netlify.com | pass | pass | none | yes-with-damping | 6 HEAD reads to api.netlify.com (the file store behind uploads). documents:cannot-open flips on one failed read. documents:stuck-processing is red after 60 min (3 x the 20 min sweeper). |
| email | 5 | 0.54 (0.5-0.6) | 4 | 0 | none | pass | pass | email:drip-step-no-email, email:morning-no-failure-check | yes | email:sending-stuck is 15 min (3 x the 5 min dispatcher). email:provider-fail stays red 3 days, email:magic-link-unqueued 24 h (sticky). The 2 reds today are standing findings. |
| finance-os | 7 | 11.41 (11.1-12.4) | 81 | 0 | none | pass | pass | none | yes | 81 reads, 11.4 s, so it must sit alone in a group. Runs 7 real GET handlers for the newest linked client in this process; 0 write attempts. With the 1.2 to 1.3 server factor it is about 14 to 15 s. |
| fulfillment | 3 | 2.56 (2.5-2.6) | 18 | 0 | none | pass | pass | fulfillment:next-action | yes-with-damping | fulfillment:apply-blocked has a 10 min grace. fulfillment:next-action is red today and stays red until the file moves. |
| funding | 5 | 0.95 (0.9-1) | 7 | 0 | none | pass | pass | none | yes | 72 hour no-movement rules and door reads. State based. |
| funnels | 27 | 0.91 (0.6-1.3) | 0 | 42 | apply.fundhub.ai, cdn.embedded.fanbasis.io, fundhub.ai | pass | pass | funnel:order-price-matches-till | yes-with-damping | 42 web reads incl. 9 apply.fundhub.ai (ClickFunnels) pages and 1 Fanbasis CDN script; 6 answers over 64 KB (/order is 284 KB). One failed GET flips any of 27 rows. funnel:order-price-matches-till is red today. |
| handoff | 5 | 1.66 (1.7-1.7) | 12 | 0 | none | pass | pass | handoff:lead-first-touches-missing | yes-with-damping | Event-driven email graces of 20 to 30 min (welcome 30, nudge 25, confirm 20, no-show 20, offer 30) on handoff:lead-first-touches-missing, handoff:booking-no-confirm, handoff:call-outcome-no-followup, handoff:contact-no-followup. 7 day window: the red today turns green on its own when it ages out (seen with the clock moved +7 h). |
| inquiry | 4 | 1.02 (0.9-1.2) | 6 | 1 | fundhub.ai | pass | pass | none | yes-with-damping | inquiry:upload-door is one GET of client-portal.html (215 KB). inquiry:case-stuck is a 72 h rule. |
| jobs | 2 | 0.29 (0.3-0.4) | 2 | 0 | none | pass | pass | none | yes | Two state reads of failed events and job receipts. 0.3 s. |
| keys | 6 | 0.49 (0.5-0.5) | 1 | 1 | www.fanbasis.com | pass | pass | none | yes-with-damping | Only 1 of 6 rows could be measured here: 5 skip off the live server (masks, no Netlify marker). Vendor reads (Twilio, Resend, Commas) repeat the shipped vendor-keys beat, and one vendor 5xx flips them. The 1 web read here is the Commas/Fanbasis key check. |
| leads | 3 | 0.31 (0.3-0.6) | 2 | 0 | none | pass | pass | none | yes | Windows are whole closed Arizona days (3 days), so the answer is the same all day. 3 rows skip today (not enough ad traffic). |
| marketing-queue | 3 | 1.8 (1.6-2) | 11 | 1 | fundhub.ai | pass | pass | none | yes-with-damping | marketing-queue:read-api is one GET (401 counts as up). stuck-queued is 45 min (3 x the 15 min clock). failed-no-note has a 7 day window (sticky). |
| meet | 2 | 0.28 (0.3-0.6) | 2 | 0 | none | pass | pass | none | yes | Red after 3 x the sweeper cadence; 14 day window. |
| nurture | 3 | 0.3 (0.3-0.4) | 2 | 0 | none | pass | pass | none | yes | Graces are 15 min (3 x the 5 min dispatcher) and 180 days; state based. |
| opt-out | 4 | 0.77 (0.7-0.9) | 4 | 0 | none | pass | pass | none | yes-with-damping | opt-out:stop-did-not-stick has a 5 min grace on an inbound-STOP handler; 30 day window. opt-out:unsubscribe-link reads red only on this Mac (UNSUBSCRIBE_TOKEN_SECRET is a mask here); green in the live 6 a.m. run. |
| outside-inngest | 3 | 0.33 (0.3-0.3) | 2 | 0 | none | pass | pass | none | yes | outside:inngest-crons-stale reads 24 h of receipts, so one outage keeps it red up to 24 h. The other 2 rows run the real 5 minute alarm and the real 6 a.m. pulse code against a pretend dead database (no live data; they only change when code changes). |
| owner-tools | 7 | 6.77 (6.7-6.8) | 38 | 1 | fundhub.ai | pass | pass | none | yes-with-damping | 38 reads, 6.8 s, plus 1 GET of /api/marketing/shoot (126 KB, 1.4 s). Runs galaxy, ops pulse and creative-jobs reads in this process. One failed GET flips owner-tools:teleprompter. |
| partners | 4 | 0.58 (0.6-0.6) | 4 | 1 | fundhub.ai | pass | pass | none | yes-with-damping | 1 GET (start.html). The file imports netlify/functions/api.mjs (ROUTES), so any new function that holds this lane bundles the whole api graph. |
| payments | 8 | 1.16 (1.1-1.3) | 7 | 1 | fundhub.ai | pass | pass | payments:paid-product-unmapped | yes-with-damping | Graces: 3 min (3 x the 1 min sweeper), 10, 10 and 60 min. payments:commas-webhook-route runs the real router in this process with a database that refuses every query, plus 1 GET (405 = up). payments:paid-product-unmapped has a 30 day window (sticky) and is red today. |
| pixels | 8 | 0.82 (0.6-1.1) | 2 | 11 | apply.fundhub.ai, fundhub.ai | pass | pass | none | yes-with-damping | 11 GETs, 5 to apply.fundhub.ai (/roadmap is 262 KB). It walks every environment value only to hide secrets in its own output, so all 39 masked names show in its read list on this Mac; no row depends on one. 7 day ad-click window; ad-click-stored skips today (too few clicks). |
| portal | 7 | 4.43 (4.4-4.5) | 31 | 42 | fundhub.ai | pass | pass | portal:paid-client-never-signed-in | yes-with-damping | 42 GETs of our own site, 31 reads, 4.4 s, with its own 14 s page budget. portal:paid-client-never-signed-in is a 72 h state rule and is red today. |
| repair | 2 | 0.69 (0.7-0.7) | 5 | 0 | none | pass | pass | repair-letter-round | yes-with-damping | repair-letter-round has a 30 min grace (letters_generated SLA) on an engine step; repair-case-stuck is a state check. repair-letter-round is red today and stays red until the file moves. |
| sales-manager | 3 | 7.78 (7.6-7.8) | 56 | 0 | none | pass | pass | none | yes | 56 reads, 7.8 s, library reads of sales numbers (no web). State based. |
| sms | 8 | 1.14 (1.1-1.2) | 8 | 0 | none | pass | pass | gap:sms-journey-zero, gap:msg-sent-no-receipt, gap:msg-approved-template-bad-copy | yes-with-damping | gap:sms-journey-zero and gap:msg-inbound-unmatched have 15 min graces on event handlers; gap:sms-sending-stuck is 15 min (3 x 5). Windows 7 to 30 days stick: gap:msg-sent-no-receipt is red with an item 17 days old, gap:sms-journey-zero turns green by itself when it ages out (seen at +7 h). |
| social | 3 | 0.81 (0.8-0.9) | 6 | 0 | none | pass | pass | none | yes | Stale rule is 3 days; the one skip is no YouTube connection. |
| soft-pull | 6 | 0.83 (0.8-0.8) | 6 | 2 | fundhub.ai | pass | pass | none | yes-with-damping | 2 GETs (approve page 18 KB, signed read answers 400 = ok). 15 min graces on softpull:request-failed-or-stuck and softpull:approve-click-no-pull; windows 3 to 30 days. |
| staff | 4 | 0.67 (0.4-0.9) | 1 | 9 | fundhub.ai | pass | pass | none | yes-with-damping | 9 GETs, 5 over 64 KB (shell.js, pipeline.html, client-control-panel.html 261 KB). role-gate sends a bad cookie header on purpose. One failed GET flips a row. |
| training | 3 | 1.21 (1.1-1.4) | 7 | 2 | fundhub.ai | pass | pass | none | yes-with-damping | 2 GETs (page and script, 15 KB and 9 KB). Other rows are state checks. |
| underwrite | 6 | 1.83 (1.8-1.9) | 13 | 0 | none | pass | pass | none | yes-with-damping | uw-pack-files-incomplete and uw-pack-email-not-queued settle for 30 min; others use a 2 h grace. Runs the real read door in this process. |
| webhooks | 7 | 0.34 (0.3-3) | 2 | 12 | fundhub.ai | pass | pass | none | yes-with-damping | 12 GETs to /api/webhooks/* (405 = up) plus the real router in this process with a refusing database. One of 36 reads took 3.0 s in one pass. webhooks:receipts-silent-after-sends has a 72 h window. |

Totals: 41 lanes, 209 checks, 68.3 s one after another, 411 reads and 203 web reads per pass (5.9 MB). 14 lanes are `yes`, 27 are `yes-with-damping`, 0 are `no`.

## 1. Read-only box (the allow-list)

- 0 of 411 reads were refused by `assertReadOnlySql`. 0 SQL errors. 0 "read-only transaction" errors. 0 commits sent. 0 leaked boxes (checked with the box's own read-only-at-close test on all 123 runs).
- No lane needs a note about a refused statement. The words the allow-list hunts for (a write word, a semicolon, set_config, nextval, a comment trick) do not appear in any statement the lanes send.
- The slowest single statement, timed one at a time, was 0.41 s (a crm-links logo query). The box default of 4 s per statement is far enough away. (The first timing showed 5 s for finance-os, but that was the wait in line behind its own parallel queries, not the statement.)
- The box default of 300 statements does not hold one box for everything: the lanes send 411 reads per pass (the 7 shipped beats add about 22). One box per group holds it: the biggest group sends 81.
- Same status on all 209 rows through the box and through the morning job's shape (plain role plus staff scope): 0 differences, 0 rows blind to row security.
- The lanes need the full context (`orgId`, `fetchImpl`, `baseUrl`, `env`, `scope`). With only `{ db, scope, now }` (what `runCoverageSlices` passes today) 117 rows change status or go missing.

## 2. GET and HEAD only

- 0 blocked requests in 123 runs: every lane works with a fetch that refuses anything but GET and HEAD. 19 lanes read the web: 181 reads of fundhub.ai, 14 of apply.fundhub.ai, 6 HEAD to api.netlify.com, 1 to cdn.embedded.fanbasis.io, 1 to www.fanbasis.com. 65 of the 203 are HEAD (51 crm-links, 8 funnels, 6 documents).
- Two lanes send a header the probe treats as secret on the first request: keys (Authorization or x-api-key) and staff (a cookie, on purpose). The shipped probe only strips secret headers on a redirect to another host, so a first request keeps them. How the documents store signs its HEAD reads was not looked at.
- What the lanes need that `pulse-probe` does not give today (it returns a result object, not a Response, keeps a 2 KB snippet, reads 64 KB, 8 s total): 13 lanes read an answer over 2 KB and 9 lanes read one over 64 KB (calls, closer, crm-links, funnels, inquiry, owner-tools, pixels, portal, staff; the biggest is the /order page at 284 KB). Several lanes also use `redirect: "manual"` (keys, webhooks) or read `res.headers`. A fetch-shaped wrapper with a bigger cap is needed, not the bare probe.

## 3. Hourly flapping (reds that come and go)

I moved the clock on the same live data (28 steps from -3 h to +24 h):

- Nothing changed with the hour of the day. 4 check ids changed: `ads-meta-sync-stale` and `outside:inngest-crons-stale` go red when the clock moves ahead of the newest receipt (no new receipt can arrive in a replay, so that is a test artifact, not a flap). `handoff:lead-first-touches-missing` and `gap:sms-journey-zero` are red up to +6 h and green from +7 h with no fix: the one old record ages out of the 7 day window. Both red lanes will clear on their own between about 3:30 and 4:30 p.m. Arizona time today.
- Not moved by this test: windows written as SQL `now()` (auth, consent, portal, webhooks stuck rows). Read by hand: they are windows of 1 h to 72 h on rows that exist, so they age out the same way.

**Needs two reds in a row (lane is `yes-with-damping`).** A lane gets this when it holds at least one of these:
1. A live GET or HEAD where one slow answer or one 5xx turns the row red (same reason the shipped `doors-live` beat uses damp 2). 19 lanes. In this run one webhooks GET took 3.0 s once, and 5 door pings took 3.1 to 3.6 s.
2. A grace of 30 minutes or less on work that an event or a person clears, with no sweeper to line it up against: ai-agents (15 min), calls (30 / 10 / 15), csm (10), fulfillment (10), handoff (20 to 30; `handoff:lead-first-touches-missing`, `handoff:booking-no-confirm`, `handoff:call-outcome-no-followup`, `handoff:contact-no-followup`), opt-out (5), repair (30), sms (`gap:sms-journey-zero`, `gap:msg-inbound-unmatched`: 15), soft-pull (15), underwrite (30).
3. Not flapping: grace of 3 times the job that clears it (payments 3 min vs 1 min sweeper, email and nurture 15 vs 5, marketing-queue 45 vs 15, meet, documents). These are fine at one look.

**Red that stays after the fix (windows longer than an hour).** These do not flap. They stay red for the whole window after one bad record, even if the cause is fixed, so a text every hour would repeat for that long unless the alert only counts records newer than the last run:
24 h: `gap:auth-staff-login`, `gap:auth-magic-link-dead`, `gap:auth-signin-no-session`, `email:magic-link-unqueued`, `outside:inngest-crons-stale`. 3 days: `email:provider-fail`, `payments:checkout-started-no-link`, `payments:card-declined-no-followup`, `webhooks:receipts-silent-after-sends` (72 h). 7 days: `ai-agents:failed-runs`, every handoff row, `gap:sms-provider-failed`, `gap:sms-journey-zero`, `gap:msg-inbound-unmatched`, `gap:msg-failed-no-address`, `marketing-queue:failed-no-note`. 14 to 30 days: the calls, closer and meet rows (14), `gap:msg-blocked-by-sender` (14), `gap:msg-sent-no-receipt` (30), `payments:paid-no-entitlement` and `payments:paid-product-unmapped` (30), the opt-out rows (30), the partners rows (30 and 7), `csm:missing-step` (60). Never fades by design: `calls:booked-no-join-link`.

## 4. Third-party hosts and cost at 24 times a day

| host | reads per run | per day | note |
|---|---|---|---|
| fundhub.ai (our site) | 181 lane reads (+ 396 door pings) | 4,344 (+ 9,504) | 59 of the lane reads are HEAD. About 330 of them hit the api function each hour (303 door-ping routes + about 27 lane reads), so about 7,900 function runs a day. Netlify's price for that was not looked up here. |
| apply.fundhub.ai (ClickFunnels) | 14 (9 different pages, up to 284 KB) | 336 | roadmap, roadmap-book, roadmap-thank-you, apply and watch are read by both funnels and pixels (5 pages twice). A shared page cache for one run would cut 14 reads to 9. |
| api.netlify.com | 6 HEAD (documents store) | 144 | |
| www.fanbasis.com | 1 GET with the checkout key | 24 | |
| cdn.embedded.fanbasis.io | 1 GET (21 KB script) | 24 | |
| api.twilio.com, api.resend.com | 0 here, about 2 live | about 48 | keys lane vendor reads; the shipped `vendor-keys` beat already makes the same reads each hour |

19 URLs are read by more than one lane in the same pass (e.g. shell.js by 3 lanes, closer-dashboard.html by 3). None of this is rude to a vendor; the ClickFunnels and Fanbasis counts are the ones to watch. No Cloudflare, no 429, no rate-limit header was seen anywhere.

## 5. In-process handlers: read only?

The lanes that run real code inside the pulse process: finance-os (7 GET handlers, newest linked client), sales-manager (sales library reads), underwrite (GET read door), funding (GET applications door), csm (GET queue), brain (POST search door with a stub vector, no AI, history writes off), owner-tools (galaxy, ops pulse, creative jobs, 1 GET), soft-pull (GET approve handler), payments and webhooks (the real webhook router called with an unsigned empty body and a database that refuses every query), outside-inngest (real 5 minute alarm and real 6 a.m. pulse code against a pretend dead database and pretend senders), partners (imports `netlify/functions/api.mjs` and reads ROUTES).

Evidence they only read: every handler got the box as its database, so a write would have been refused by Postgres; there were 0 write attempts and 0 refused statements in 123 runs, and 0 connection attempts to the dead address or raw http/https calls in a separate watched pass of all 41 lanes (`DATABASE_URL` poisoned, `pg`, `http` and `https` wrapped). Each one's request is a GET (brain is the one POST, and its two writes are switched off in the lane).

Bundle weight (only matters for a new function): the lanes that load api handlers or the router are brain, csm, finance-os, funding, owner-tools, partners (the whole api graph through `api.mjs`), payments, soft-pull, underwrite, webhooks.

## 6. Current reds (the baseline)

The 06:00 live report had 14 reds: 12 from these lanes and 2 from the slices (`live-playwright:desks`, `03-marketing:outbox_drain`). This Mac's run of all 41 lanes finds the same 12 plus 2 that only this Mac shows (its `.env` holds masks for OPENAI_API_KEY and UNSUBSCRIBE_TOKEN_SECRET; the live run was green on both). Status of all 209 rows matches between the box, the morning job's shape and the live report, except 8 rows that read a key (`brain:embed-key`, `opt-out:unsubscribe-link`, `gap:auth-reset-mail`, 5 `keys:*` rows) and cannot be proved from this Mac.

| check id | detail now |
|---|---|
| calls:booked-no-join-link | 0 of the newest 5 real bookings carried a join link (newest booking 47 days ago) |
| email:drip-step-no-email | 1 person on the roadmap drip with 3 steps that never queued an email |
| email:morning-no-failure-check | src/workflows/slo-infinite-drip.mjs (8:00 a.m. Arizona) sends email and does not check whether it queued |
| fulfillment:next-action | 1 repair file past the clock with no next step on screen (in analysis) |
| funnel:order-price-matches-till | apply.fundhub.ai/order charges $297, the till says $147 |
| handoff:lead-first-touches-missing | 1 new lead got no welcome email 30+ minutes after sign-up (6 days ago); 1 lead no nudge. Ages out today |
| payments:paid-product-unmapped | 1 paid order in 30 days with an unknown product name and no access given (UnderwriteIQ soft-pull assessment $32.00) |
| portal:paid-client-never-signed-in | 1 paying client with access over 72 hours who never signed in (4 days) |
| repair-letter-round | 1 repair file in analysis past the 1 hour clock with no letters made (same file as fulfillment:next-action) |
| gap:sms-journey-zero | 2 steps that should text have no text row (entry.captured). Ages out today |
| gap:msg-sent-no-receipt | 2 emails sent and no delivery receipt for over 24 hours; the oldest left 17 days ago |
| gap:msg-approved-template-bad-copy | 15 templates marked ready still hold placeholder words (14 lorem ipsum, 1 draft mark) |

Skips today (7 on the live report): `ads-spend-day-missing`, `ads-running-no-metrics` (no ad running), `social:video-stats-stale` (no YouTube connection), `gap-pixels:ad-click-stored` (0 ad clicks), the 3 `lead:*` rows (no traffic). All 7 give a real answer once ads run, so the hourly pulse would see them flip from skip to PASS or FAIL the day ads start.

## 7. Door pings (396 rows)

- Row count: 396 (303 api, 57 desk, 36 public static). Full pass at concurrency 20: **4.97 s**, 396 up, 0 down. HTTP answers: 105 x 200, 5 x 400, 191 x 401, 95 x 405. No 3xx, 403, 404, 429 or 5xx. Per request: median 153 ms, 95th percentile 418 ms, slowest 3.57 s. Server header Netlify on every row, no Cloudflare ray, no rate-limit header, no retry-after.
- How up and down are decided (src/pulse/registry.mjs `isUp`): desk and public static rows are up only on a 2xx after redirects (fetch follows redirects). Api rows are up on any 2xx, 400, 401, 403 or 405. Everything else is down: 404, 429, 5xx, a timeout at 15 s, a network error. The daily job pings 8 at a time, with GET, accept html or json, no cookie.
- Rows that could false-alarm every hour:
  1. Any single 5xx or timeout on any row. Nothing waits for a second red. Across 9,504 pings a day a 1 in 1,000 blip is about 9 false downs a day. Needs two reds in a row per row (the `doors-live` beat already does).
  2. Cold starts: 5 api rows took 3.1 to 3.6 s on their first touch (`chat/peers`, `journeys`, `lender-observations`, `adintel/board`, `auth/authorized-rep`). 4 times under the 15 s limit.
  3. A deploy or `npm run ship` that lands in minute 7: many rows can answer 404 or 502 for a moment and all go red together. A storm rule (one text, not 300) is needed.
  4. `/api/health?strict=1` (571 ms) is non-2xx if the database is down or migrations are pending; the `doors-live` beat and `db-health` beat already watch it.
  5. Blind spots, not alarms: 191 rows count a 401 as up and 95 count a 405 as up, so a broken sign-in check still reads up; a desk page that redirects to a login page that answers 200 reads up.
  6. `public/rb2b-webhook`, `public/optimize`, `public/slo-interest`, `auth/login`, `hiring/apply`, `marketing/shoot`, `public/slo-checkout` answer 200 to a GET. The handlers were read: each GET returns a status or a config and writes nothing.
- Cost: the 303 api rows go to the api function, so about 303 runs an hour from the door pings alone. The 93 desk and static rows are file reads.

## 8. Groups of at most 14 seconds (sequential inside, side by side between)

The sum is 68.3 s, so it needs more than 4 groups. 4 groups is impossible (4 x 14 = 56). **5 groups is the floor and leaves 0.3 s of room each**, too thin for a server that runs 1.2 to 1.3 times slower than this Mac (this Mac ran the 7 shipped beats in 4.3 s; the server's saved `duration_ms` for them is 5.1 to 5.5 s). **6 groups holds at 11.4 s each:**

| group | lanes | seconds (Mac) | reads | web reads |
|---|---|---|---|---|
| G1 | fulfillment, documents, underwrite, training, soft-pull, sms, banks, staff, meet | 11.37 | 65 | 19 |
| G2 | portal, marketing-queue, handoff, social, payments, consent, closer, csm | 11.37 | 75 | 48 |
| G3 | crm-links, inquiry, pixels, ads, partners, funnels, jobs, webhooks | 11.37 | 49 | 131 |
| G4 | owner-tools, calls, repair, contracts, auth, leads, outside-inngest, ai-agents | 11.38 | 65 | 4 |
| G5 | sales-manager, funding, brain, opt-out, email, nurture, keys | 11.38 | 76 | 1 |
| G6 | finance-os | 11.41 | 81 | 0 |

5-group version (13.65 to 13.67 s each): owner-tools+documents+funding+soft-pull+partners+social+consent+keys+ai-agents; finance-os+banks+closer+pixels+csm; sales-manager+handoff+auth+staff+inquiry+contracts+jobs+outside-inngest+nurture; portal+fulfillment+marketing-queue+calls+training+funnels+email+meet+brain; crm-links+underwrite+sms+payments+opt-out+repair+webhooks+ads+leads.

Notes: 6 groups means 6 pooler connections at once (the pooler holds 60 with about 12 in use at rest). **finance-os alone is 11.4 s, about 14 to 15 s on the server, so it does not keep a margin even in its own group** (it runs 81 reads one after another through the single box connection; those are the cost, not the SQL). The door pings (5 s) would be a 7th group, or join the 6 groups and lift each to 12.2 s. Several lanes carry their own cut-offs that are longer than the room left in a group (handoff 15 s, funnels 15 s, portal 14 s page budget, 12 s reads in sales-manager and portal), so a slow day would turn them into skips, not into a longer run.

## 9. What this does not prove

- Server seconds. Measured on this Mac. The ratio to the server is inferred from the beats (1.2 to 1.3), not measured for the lanes.
- 8 key-reading rows (`keys:*` x 5, `gap:auth-reset-mail`, `brain:embed-key`, `opt-out:unsubscribe-link`) only run properly on the live server (masks here). Their seconds and web reads here are lower than they will be live (the keys lane did 1 of its 3 or 4 vendor reads).
- Server-side reads of lanes that look at the Netlify store (documents) used this Mac's Netlify credentials.
- Hour-of-day and age-out behavior was tested by moving `ctx.now` only; SQL `now()` windows were read, not run at other hours.
- The flap list says where a single read can flip a row. How many times it actually flipped in history was not measured (the hourly beats have only run since 06:07 today).
