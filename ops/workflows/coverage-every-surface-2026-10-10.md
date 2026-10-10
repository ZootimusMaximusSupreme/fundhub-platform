# Every single thing checked — 2026-10-10

Shared board for the "check every surface" batch.

Chris asked: "What would be your definition of every single thing that checks? A Kanban is like the pipeline. There are pipelines, the entire CRM, every single aspect of it needs to be checked. How else are we going to know if something's broken?"

Evidence: the 12 lists in `ops/workflows/coverage-every-surface-2026-10-10/` (one row per button, screen read, board column, card move, API door, email, text, bank step and link). Every number below was counted from those files on 2026-10-10, not copied from the agent notes. They match.

## The short answer

- We listed **2,690** things.
- **548** have a real daily check. It reads the data and goes red when the answer is wrong. That is 20 out of every 100.
- **1,305** things touch money, a customer message, or a customer record. Only **395** of those have that real check. **910 do not.**
- Nothing checks a whole customer trip from start to end yet.
- Some things are on no list yet: 52 API doors, 29 background jobs, the webhook doors, 21 public pages, every key, every table, every live AI agent.
- The plan: 8 workflows. 5 run at once. Nothing has started. Waiting on Chris's go.

**Model:** Sonnet for W1 to W6 and W8, because they are back end (owner call 2026-10-06). Opus for W7, because it is screens. This board was written on Opus. Match.

---

## 1. The definition

### The ladder

Every thing climbs the same 5 steps.

| Step | Name | Plain words | What proves it | Score in the lists |
|---|---|---|---|---|
| L0 | Known | It is on a list. We know what it does and what it touches. | a row in an inventory | `none` |
| L1 | Alive | Something knocks every day, and it answers. | a ping row (`reg:` page or route, `job:` heartbeat) | `ping` |
| L2 | The control works | A test presses it, and the right thing happens. | a test that runs the real code | `e2e` |
| L3 | The result is right | Every day a check reads the real data. It goes red when the answer is wrong. | a deep check in `src/pulse/coverage/gap-*.mjs`, on the tripwire map | `deep` |
| L4 | The whole trip ends right | One check follows each customer from the first step to the last. It goes red if any step is missing. | a journey check (none exist yet) | not scored |

Two warnings:

- `e2e` in these lists often means a test with fake data. It is not a real browser on the live site. It counts as L2. It never counts as L3.
- `none` means the thing is on a list, but nothing checks it. It sits at L0.

### The rule

- Money, a customer message, or a customer record: must reach **L3**.
- Everything else: must reach **L2**.
- A dead thing (no sender, no caller, no way in) gets a "nothing to judge" code from `src/pulse/na-conditions.mjs`. The code is re-checked every day. It goes red the day the dead thing comes alive.
- A money trip (pay, fund, bill, pay out) also gets **L4**, once the L3 checks under it exist.

### What "every single thing is checked" means, kind by kind

**Staff button**
- L2: a browser test presses it and sees the save land.
- L3, if it moves money, sends a message, or changes a customer record: every day a check reads the row the button wrote. It goes red if the row is missing or wrong. Example: "Mark funded" must leave a closeout row and a success-fee invoice.

**Pipeline stage** (a column on a board)
- L3 for every stage on every board:
  1. The number on the column equals the number in the database.
  2. Every card is in the stage the facts say. Paid means Closed Won. Booked means Booked. Funded means Funded. Case cleared means Removed.
  3. No card sits past its time limit.
  4. The stage has a way in, or a "nothing to judge" code.

**Pipeline move** (a card going from one column to another)
- L3: the move fires its event, and the event's result exists. Example: a card moved to Funded fires `round.funded`, and an invoice shows up.
- The check knows who may move it, and which way.

**API door** (route)
- L1: every routed door has a ping.
- L2: a test runs the real handler.
- L3 for money and customer doors: a check reads what the door wrote.

**Email**
- L3 for every live email:
  1. The words are approved. No blank spots. No placeholder words.
  2. When its trigger fires, the email is queued.
  3. It is sent, and the provider says delivered.
  4. Every link in the sent email opens the right page.
- A dead email gets a "nothing to judge" code.

**Text**
- The same 4 steps as email.
- Plus: STOP works. Texting hours hold. The pause switch stops it. One person never gets the same text twice.

**Bank flow**
- L3: every bank login synced in the last 3 days, or the client is told.
- The Plaid keys are set and real.
- No money move is stuck, failed, or sent back.
- Disconnect also tells Plaid.

**Link**
- L3: every link in a sent message points at the right site. It is not blank.
- A signed link still works when the customer taps it.
- Public pages open and show the right price.

**Background job**
- L1: it ran on time (heartbeat).
- L3 for money and customer jobs: what it should have made exists.

---

## 2. The numbers

### Totals

| | Rows | none (L0) | ping (L1) | e2e (L2) | deep (L3) |
|---|---|---|---|---|---|
| All 12 lists | **2,690** | 348 | 388 | 1,406 | 548 |

### By impact

| Impact | Rows | none | ping | e2e | deep | Meets the rule |
|---|---|---|---|---|---|---|
| Money | 329 | 9 | 33 | 199 | 88 | 88 (needs L3) |
| Customer message | 354 | 17 | 29 | 153 | 155 | 155 (needs L3) |
| Customer record | 622 | 41 | 42 | 387 | 152 | 152 (needs L3) |
| Staff only | 531 | 29 | 82 | 326 | 94 | 420 (needs L2) |
| No impact | 854 | 252 | 202 | 341 | 59 | 400 (needs L2) |
| **All** | **2,690** | 348 | 388 | 1,406 | 548 | **1,215** |

- Below the rule: **1,475** of 2,690.
- Money, message or record rows with no L3 check: **910**. That is 241 money, 199 messages, 470 records.
- 158 of the "no impact, none" rows are dead message templates. They need a "nothing to judge" code, not a test.

### By kind of thing

| Kind | List files | Rows | none | ping | e2e | deep | Money or customer rows | ...with L3 | Meets the rule |
|---|---|---|---|---|---|---|---|---|---|
| Screens (59 staff and client pages) | desks-a to desks-f | 1,453 | 117 | 291 | 853 | 192 | 594 | 116 | 657 |
| Pipelines and status ladders | pipelines | 262 | 42 | 29 | 118 | 73 | 159 | 52 | 113 |
| API doors | routes-0 to routes-2 | 392 | 4 | 54 | 246 | 88 | 181 | 47 | 220 |
| Emails, texts, and the send machine | messages | 447 | 166 | 5 | 132 | 144 | 270 | 142 | 160 |
| Bank flows and links | banks-links | 136 | 19 | 9 | 57 | 51 | 101 | 38 | 65 |

Inside those:

- **Screen controls** (785 rows: buttons, forms, inputs, switches, picks, filters, tabs): none 65, ping 212, e2e 448, deep 60.
- **Screen reads** (355): none 24, ping 45, e2e 209, deep 77.
- **Screen links** (152): none 21, ping 20, e2e 104, deep 7.
- **Board columns drawn on screens** (103): 62 CRM board columns, 36 hiring, marketing and repair board columns, 5 sales floor columns. The other 58 screen rows are gates, jobs and outside parts.
- **Pipeline stages** (72): none 26, e2e 24, deep 22. **Card moves** (26): ping 1, e2e 20, deep 5. **Status ladders** (33): ping 4, e2e 12, deep 17.
- **API doors:** 324 doors in the ROUTES map. 272 have rows. 52 have none.
- **Emails** (247 templates): 82 live (none 1, e2e 34, deep 47). 126 have no sender. 39 are retired.
- **Texts** (85 templates): 58 live (e2e 39, deep 19). 15 have no sender. 12 are retired.
- **The send machine** (115 rows: workflows, send rules, providers, gates, receipts): none 7, ping 5, e2e 56, deep 47.
- **Bank flows** (60): none 10, ping 6, e2e 38, deep 6. **Lenders and Apply** (13): none 2, e2e 6, deep 5. **Links and public pages** (63): none 7, ping 3, e2e 13, deep 40.

### Repeats and disagreements

- 109 pipeline board rows in desks-e are also in pipelines.
- 38 rows in routes-2 repeat 35 doors already in routes-0 or routes-1. 6 of those doors got different scores: dashboard/kpis, finance/paydown-simulator, inquiry-cases, read/invoices, read/ops-pulse, read/tradelines.
- The shared sidebar code (shell.js) shows up in 5 desk files (51 rows).
- So the real count of unique things is at least 147 lower than 2,690.
- desks-e scores the Sales, Funding and Repair columns `deep`, because the board read is checked. pipelines scores the same stages `e2e` or `none`, because nothing checks that the cards are in the right stage. **The stricter score is right.** A column is L3 only when its cards are proven right.

### The tripwire map today

- `src/pulse/tripwires.mjs` sorts 38 surfaces as money or customer (TRIPWIRES) and 4 as staff only.
- `src/pulse/tripwires-baseline.json` still holds **494** surfaces nobody has sorted: 305 API doors, 86 jobs, 56 desks, 37 pages, 10 send paths.

### Lists that are missing or short

1. **Background jobs: no list.** 100 workflows are registered in `src/workflows/index.mjs`. 29 are named in no file:
   af-02-referral-ownership-capture, at-01-first-touch-capture, bc-01-customer-responsiveness, bc-02-customer-friction, commas-inbox-drain, finance-os-pull-sweeper, meta-campaign-sync-sweeper, clickfunnels-analytics-sweeper, watch-curve-diagnosis-sweeper, partner-production-floor, c-00-crs-soft-pull-request, c-02-inquiry-created, c-02b-inquiry-removal-requested, c-05-pre-funding-review, c-06-crs-results-router, dpc-01-analyzer-lock, f-08-post-funding-monitoring, f-09-funding-declined-no-path, f-10-client-funding-inbox-provisioner, s-portal-invite, s-06-post-call-funding-purchased, s-08-post-call-funding-declined, slo-genuine-reply, slo-genuine-checkout-sms, sys-01-client-value-calculator, sys-01-ltv-calculator, u-02-analyzer-complete-delivery, u-04-promote-crs-primary, u-05-data-health-monitor.
   4 of 16 Netlify functions are named in no file: ad-video-worker-background, commas-inbox-sweeper, marketing-funnel-background, marketing-worker-background.
2. **API doors: short.** 52 of 324 routed doors have no row:
   journeys, message-templates, lender-observations, dashboard/pipeline, dashboard/client-archive, health, read/funding-rounds, read/lender-matches, read/partners, read/partner-home-tiles, read/message-templates, read/staff, read/entitlements, read/inquiries, read/products, read/conversations, read/underwrite, read/finance-command, read/company-brain, read/morning-brief, read/workflows, read/closer-now, read/deal-math, read/sales-floor, inquiries, demo/mode, creative/generate, creative/actions, creative/run, hiring/decisions, hiring/bench, finance/soft-pull, finance/liabilities, finance/containers, finance/bills, documents-upload, read/client-progress, marketing/settings, marketing/funnels, marketing/health, marketing/scripts, marketing/scripts/fix, marketing/batches, marketing/funnels/push-live, marketing/meta/load, marketing/ad, marketing/costs, marketing/flywheel/campaign, marketing/research, marketing/research/tweak, marketing/flywheel/spend-read, marketing/shoot/take.
   The money and customer ones: dashboard/pipeline (the board read itself), dashboard/client-archive (Archive), finance/soft-pull, finance/bills, documents-upload, read/entitlements, read/funding-rounds, read/deal-math, read/underwrite, read/client-progress, marketing/meta/load (sends ads to Meta), marketing/funnels/push-live (public pages), creative/actions.
3. **Webhook doors: no list.** 5 signed doors live in `src/http/router.mjs`: commas, clickfunnels, bland, lendflow, inquiry-removal. Twilio, Resend, Mailgun and the merchant doors come in too. bland (the AI bureau calls) and inquiry-removal are named in no file.
4. **Public pages and their forms: no list of controls.** There are 43 public pages outside `/app`. 21 are named in no file: the partner trial, trial live, board, board live, menu and autopsy pages; education enroll and learn; the consulting and education privacy, refund and terms pages; the climate lender page; the 404 pages; a leads page; two logo preview pages.
5. **Keys: no list.** No list of every vendor key and the check that watches it. The files name 8 that nothing watches: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_TOKEN_ENC_KEY, RESEND_WEBHOOK_SECRET, TWILIO_AUTH_TOKEN, MERCHANT_SECRET_ENC_KEY, FINANCE_OS_SETUP_FEE_CENTS, LENDFLOW_WEBHOOK_SECRET.
6. **Tables: no list.** No list of every table, who writes it, and which check reads it. The files name these as read by no check: commission_ledger, commission_rules, slo_connections, money_transfers, money_transfer_events, paid_service_requests, subscriptions, client_cards, file_protection_alerts, merchant_connections, merchant_events, clarity_payments, clarity_payment_installments, payment_strategy_plans, money_helper_turns, money_helper_threads, blueprint_declines, erasure_requests, pii_identity, pii_access_log, social_posts (sent, failed, stuck), partner_pages, partner_brand, partner_ai_usage, proxy_sessions, customer_insights, education_enrollments, vsl_watch_sessions, client_push_subscriptions, partner_training_progress, ad_videos, hiring_job_postings, candidate_applications, ai_bureau_config, cashflow_settings, cashflow_reminders, owner_notifications, shifts.
7. **Live AI agents: no list.** No row per agent: who it texts, what it may say, when it must hand off. Only the Agent Editor screen is listed.
8. **Whole trips (L4): no list.** No file names the start-to-end customer trips or scores them.

---

## 3. The pipelines

### The 7 checks every board needs

- **P1 Count.** The number on each column equals the number in the database. Today the board read stops at 500 cards (2,000 at most), and a column shows the cards it got back, not the real count.
- **P2 Facts.** Every card is in the stage the facts say.
- **P3 Age.** No card sits past its time limit. This is on every board, not just Repair.
- **P4 Event.** Every move fires its event, and the event's result exists.
- **P5 Way in.** Every stage has a mover, or a "nothing to judge" code that goes red if a card lands there.
- **P6 Nobody lost.** Every paying client has a card. No card sits on a stage its board does not have. A client who was archived and then pays is flagged.
- **P7 Two records agree.** When two tables hold one fact, they match.

Today: P2, P6 and P7 are checked nowhere. P1 checks that the read works, not that the count is true. P3 is only on Repair, and only paints a chip. P4 is only on Funding.

Rows in pipelines, by board:

| Board | Rows | none | ping | e2e | deep |
|---|---|---|---|---|---|
| The board screen (pipeline.html) | 35 | 7 | 8 | 14 | 6 |
| Sales | 21 | 1 | 0 | 19 | 1 |
| Funding: Card Stacking | 12 | 1 | 0 | 6 | 5 |
| Funding: Alt-Fin | 8 | 7 | 0 | 1 | 0 |
| Repair | 31 | 8 | 0 | 10 | 13 |
| Inquiry Removal | 34 | 2 | 1 | 17 | 14 |
| AR / Collections | 7 | 5 | 0 | 1 | 1 |
| Hiring | 30 | 5 | 11 | 14 | 0 |
| Affiliates + White Label | 12 | 4 | 0 | 5 | 3 |
| Sales floor and Closer dashboard | 17 | 0 | 3 | 6 | 8 |
| CSM queue | 6 | 0 | 1 | 3 | 2 |
| Client Control Panel round buttons | 19 | 0 | 0 | 15 | 4 |
| Journeys and Agent Editor | 6 | 1 | 1 | 2 | 2 |
| Pipeline pulse checks | 3 | 1 | 0 | 0 | 2 |
| Status ladders with no board | 21 | 0 | 4 | 5 | 12 |
| **All** | **262** | **42** | **29** | **118** | **73** |

### The board screen — /app/pipeline.html

- Tabs: Sales, Funding Card Stacking, Repair, Inquiry Removal, AR, Affiliates + White Label, Hiring. The Alt-Fin tab was removed 2026-08-25.
- Checked: the Sales read (`crm-data:pipeline`), cards with no column (`crm-data:pipeline-cards`), the drawer, the lens switch.
- Not checked:
  - Any of 8 staff roles on an open shift can drag any card to any stage on any board, forward or back.
  - A hand drag fires no event, except on Funding.
  - MOVE to another board deletes the old card.
  - Archive does not need a shift. It deletes the client's card on every board. A client who pays later shows on no board and in no count.
  - The tab counts were removed. The counts door has no caller.
  - Search matches names only. The box says "name, phone or email".
  - The Owner filter is hidden. No code sets a card owner.
- Silent failures to catch: a card dropped because its stage is not on the board. A column short because of the 500 cap. An archived client who pays.

### Sales (R-01)

- Stages (10): New Lead, Survey Complete, Booked, Confirmed, Showed, Diagnostic Paid, Decision Rendered, Closed Won (deposit), Downsell, Lost.
- How cards move: lead captured, New Lead. Survey sent, Survey Complete. Booking made, Booked. Call end plus 5 minutes, Showed or Lost. Diagnostic paid, Diagnostic Paid. Decision made, Decision Rendered. Client texts YES, Closed Won. Client texts CLOSE, Downsell. 72 hours with no progress: a task, an email and a text (DPC-05, checked deep).
- Checked: every move has a test. DPC-05 is checked.
- Not checked:
  - A payment does not move the card. Closed Won moves only on a text YES.
  - Confirmed has no mover.
  - A logged call outcome (deposit, no-show) moves no card.
  - A logged no-show fires `call.completed`. DPC-02 reads that as "the call happened."
  - DPC-02 uses a plain move, so it can pull a paid card backward.
  - The Sales floor counts (call outcomes) and the board counts (cards) are never compared.
- Silent failures to catch: a paid client not in Closed Won. A booked client not in Booked. A paid card moved back. The Sales floor and the board disagree.

### Funding: Card Stacking (R-02)

- Stages (6): Apply Now, Round Submitted, Approved, Action Required, Funded, Closed.
- How cards move: any stage to any stage, backward too. Staff drag, or the Client Control Panel buttons. A bank email read as APPROVED or COUNTEROFFER moves the card to Approved (F-11). Funded needs a dollar amount. A funding hold blocks later stages.
- Checked: the messages for Apply Now, Round Submitted, Approved, Action Required and Closed (deep). The Funded amount guard (tests).
- Not checked:
  - A Funded card has its closeout row, success-fee invoice and commission. No live check.
  - The round row (`funding_rounds.status`) only ever says started, open or funded. The card can say Approved while the round says started. Nothing compares them.
  - A bank yes logged in the Client Control Panel moves no card and fires no `round.approved`.
  - "Approved" with no dollar amount is only a flag on the board.
  - Moving a card back and forward inside one round fires nothing the second time.
- Silent failures to catch: Funded with no invoice. Card and round disagree. A bank yes with no card move.

### Funding: Alt-Fin (Lendflow) (R-03)

- Stages (7): App Created, Docs/Stips, Underwriting, Offers, Offer Accepted, Funded, Closed.
- The tab was removed 2026-08-25. No code moves a card here.
- The Lendflow webhook turns 7 stage names into round events. A decline fires nothing. The webhook door has no pulse row. Its secret is not proven live.
- Needed: a "nothing to judge" code on each stage that goes red the day a card lands, and a door check on the Lendflow webhook.

### Repair, also called Optimization (R-04)

- Stages (13 live): Intake, Awaiting Documents, Analysis, Letters Generated, Ready to Send, In Transit, Awaiting Response, Response Received, Round Complete, Program Complete, On Hold, Stalled, Cancelled. 4 old stages are still on the board: Round Sent, Bureau Processing, Portal Updated, Upgrade Invite.
- Time limits written in the code: Intake 3 business days, Documents 14 days, Analysis 1 hour, Letters 30 minutes, Ready 4 hours, In Transit 10 days, Response due date plus 5 days, Answer read 24 hours.
- Checked: the 8 working stages (deep), the Stuck chip, `repair-case-stuck`, `pipeline:repair`.
- Not checked:
  - When a clock runs out, nothing moves the card and no task is made. The chip only paints.
  - Round Complete, Program Complete, On Hold and Cancelled have no mover and no check.
  - The case row (`dispute_cases.status`) never leaves awaiting_response. The check that looks for "stalled" can never go red, because nothing sets it.
  - The MOVE menu still sends clients to the old Round Sent column.
  - `pipeline:repair` has no age. It goes red the first time it sees a card.
- Silent failures to catch: a clock out with no task. A card in an old column. A stalled case nobody sees.

### Inquiry Removal (R-05)

- Board stages (8): Requested, Specialist Assigned, Awaiting Documents, Letters Sent, Calls In Progress, Removed, Resume Funding, Hold.
- Case states (7): Queued, Scheduled, In Progress, Escalated, Blocked, Completed, Canceled. The call has 11 states.
- How cards move: deposit paid or round closeout opens one case per bureau, then Requested, then Awaiting Documents or Specialist Assigned. Documents in, Specialist Assigned. Specialist presses Send, Letters Sent. Call due (checked every 15 minutes), Calls In Progress.
- Checked: most case states (deep), the AI bureau call.
- Not checked:
  - Removed and Hold have no mover.
  - Mark cleared and Close do not move the card. A cleared case leaves its card at Calls In Progress.
  - Setting a case to Completed through the update door sets no close time and fires no `inquiry.removed`. So the "resume funding" task never opens.
  - A fraud alert sets a hold reason, but never the Hold stage.
- Silent failures to catch: case Completed while the card sits at Calls In Progress. Case Completed with no `inquiry.removed`. Funding never resumes.

### AR / Collections (R-06)

- Board stages (5): Invoice Sent, Reminder, Escalation, Paid, Written Off.
- No code ever puts a card here. Only a hand MOVE does.
- The real collections run on the invoice row: draft, sent, reminded, escalated, then paid, partly paid, written off or void. That ladder is checked deep (`payments:invoice-stuck`).
- Silent failure to catch: a hand-moved AR card that disagrees with its invoice. The board needs a "nothing to judge" code, or a check against the invoice ladder.

### Hiring (R-09, and /app/hiring.html)

- Stages (11): Applied, Screening, Group Interview, 1:1 Interview, Offer, Hired, Onboarding, Ramp (60-day trial), Performing, Not Moving Forward, Withdrawn.
- The CRM Hiring tab is always empty. No code makes a hiring card. The real board is hiring.html, built on candidate applications.
- Onboarding, Ramp, Performing and Withdrawn can never be reached. No code writes them.
- The outreach job has a ping only. Its 8 emails and texts are blocked at the send gate as "recipient unknown."
- The two hiring jobs have no machine row. The page counts days in a stage from a fixed date (2026-07-30).
- No test clicks the board, the drawer, Advance or Reject.
- Silent failures to catch: a candidate stuck in a stage. Outreach that never sends.

### Affiliates + White Label (R-08)

- Stages (5): Recruiting, Invited, Agreement Signed, Active, Paused.
- How cards move: a partner applies, Invited. Approve, Active.
- Recruiting, Agreement Signed and Paused have no mover.
- A trial that converts or ends changes the partner row, not the card.
- Payouts go pending, held, processing, then paid or void. The database only lets them go forward. No code sets the license-signed or tax-form stamp, so every real payout is held. The payout check reads "processing" only.
- The commission ledger goes earned, approved, paid, void. No check reads it.
- Silent failures to catch: a payout stuck in held. A card that says Invited while the partner is Active or Paused.

### Queues and desks that act like boards

- **Sales floor and Closer dashboard:** the funnel columns (Booked, Held, Deposits, Funded, Downsells) are checked deep.
- **CSM queue:** open tasks, Claim, shifts. The list is checked deep.
- **Client Control Panel round buttons:** Mark submitted, Mark funded, Close round, Bank yes and Bank no. Each has a test. None has a check that reads what it wrote.
- **Journeys:** saved journey steps are run by no live code.

### Status ladders with no board

- Checked deep: payment links, contracts, bookings, client steps (waypoints), soft pulls, social post status, document delivery, alerts and failed events, creative jobs, morning briefs, marketing batches, the client portal stepper.
- Ping only: subscriptions (a past-due plan is never checked), paid service requests (a paid request stuck at paid or staged is never checked), money helper tasks and money moves (stuck is never checked), next funding steps.
- Tests only: live trials, funding closeout, ad videos, erasure requests, ops suggestions.

---

## 4. The gaps, ranked

Money first. Then customer messages. Then customer records. Then staff only.

### Money

1. **Funded with no bill.** A card moved to Funded fires the money chain. Nothing checks that the closeout, the success-fee invoice and the commission were made.
2. **Meta ad money.** "Start spending again" and "Change daily budget" move real ad money. No test runs them. Only "Stop spending" is tested. Nothing compares our status and budget to Meta's. The Load-to-Meta job rows are read by nothing.
3. **Affiliate payouts.** No code sets the license-signed or tax-form stamp, so every real payout is held. No check flags a held payout. The check for money owed passes because the list is empty.
4. **Plaid money moves.** The 15-minute job has a ping only. No check finds a move that is stuck, failed or sent back. No test presses "Yes, move $X". It is sandbox today. It is real money once live.
5. **Staff commissions.** Approve, Mark paid and rate changes have no test of the door. No check reads the commission ledger, the rates, or the SLO product map.
6. **Checkout links.** The paid dispute round, the $200 and $1,000 repair plans, and the partner $47 board all make real checkout links. None is on the tripwire map. Nothing checks that a buyer got a working link, or that a paid request started.
7. **FinanceOS setup fee.** Only "money came in but the link was never settled" is watched. Nothing checks that a paid setup turned FinanceOS on, that the Pay button works, or that the price is set.
8. **Payments page.** Record payment, Mark settled and Add payment plan change what a client owes. Payments that fit no plan pile up as "unmatched." No check reads any of it.
9. **Save month/year on Present is broken now.** It calls a function that does not exist anywhere (`api/soft-pull-approve.mjs` line 279, checked 2026-10-10). Every save fails. Only a ping watches it. The Client Control Panel uses the same door.
10. **Sales board is not tied to money.** Closed Won moves only on a text YES, never when money lands. DPC-02 can pull a paid card backward.
11. **Sample data in the live books.** The sample-client tool writes fake payments and a $3,000 sale into live tables. It has a ping only. Nothing looks for sample rows.
12. **Present "Invoice this client" fails for closers and sales managers.** The read lets sales managers in. The email step lets only owner and admin. The deck is open to closers.
13. **Subscriptions.** A past-due plan is never checked for a retry. Plans, saved cards and partner add-ons have no live check.
14. **Approved amounts.** Staff type them, and they drive the success fee. No live check compares them to bank emails.

### Customer messages

1. **A staff-only email goes to clients.** EMAIL-DPC05-NO-PROGRESS-72H says "Internal alert" and has an "Open Client Record" button. dpc-05 sends it to the client 72 hours after a booking.
2. **Blanks in live emails.** Funding locked says "Total funding secured: $" with nothing after it. The ID email's only link is never filled. The no-show email says "We had you down for  and didn't connect." The e-book email says "placeholder." The letters-ready email goes out even when letters failed. Nothing reads a sent email.
3. **The brakes do not cover every road.** The pause switch and the 500-a-day cap work on one send path only. Staff replies, closer sends, AI agent replies and the staff job skip them. The duplicate-text guard is written but never called.
4. **Dead senders nobody is told about.** Hiring outreach is blocked at the gate. Web push has no caller. Owner alert texts are queued with no sender. 141 templates have no sender. Only 7 launch templates have a ready check.
5. **Delivery is proven in bulk, never per template.** The receipt keys (RESEND_WEBHOOK_SECRET, TWILIO_AUTH_TOKEN) are not on the key check. Only a one-time hand run (2026-09-19) proved 40 of 98 client templates land. 58 were never proven.
6. **Links in messages.** A missing link becomes a blank and the message still sends. The web address comes from 4 different settings in about 25 files.
7. **File-protection alert texts.** The 4 switches and the daily job have a heartbeat only. Nothing reads the alerts table or the receipts.
8. **Card-due reminder texts and the money helper.** Ping only.
9. **Social Studio.** "Queue it" writes to a table the sender never reads, so queued posts never go out. No check sees a failed or stuck post.
10. **Phone calls.** Calls to clients and to credit bureaus have no door test and a ping only.
11. **Bureau letters.** The inquiry letter send mails a paid paper letter. No test runs it. Nothing checks the letter left.
12. **Ops & Admin mail buttons.** "Send what is waiting," "Pause sending" and "Email unsent invoices" reach real clients. No test clicks them.
13. **AI agents cannot hand off.** The Escalate-to and After-no-reply boxes can never make an agent hand off. "May book" is read by nothing.
14. **No HELP reply.** Several texts say "Reply HELP." Nothing answers HELP.

### Customer records

1. **No board checks stage against facts.** Paid clients not in Closed Won. Cleared cases stuck at Calls In Progress. Funded cards whose round row says started.
2. **Inquiry funding never resumes** when a case is set Completed through the update door.
3. **Repair cases go quiet.** Clocks only paint a chip. The case row never leaves awaiting_response. The stalled check can only pass.
4. **A broken bank login stays broken.** No button fixes it. No screen says so. The money page date is the page read time, not the bank read time. The staff red never clears after a re-link. Plaid has no webhook into us. Disconnect never tells Plaid.
5. **Keys nobody watches.** The 3 Plaid keys and the merchant key. The merchant tables are only tested on a stand-in, never on Postgres.
6. **Archive and MOVE delete cards.** Archive needs no shift and deletes the card on every board. MOVE to another board deletes the old card.
7. **Any of 8 roles can move any card anywhere.**
8. **Private data.** The personal-info door checks the client id only, with no company check, and no row rule was found on `pii_identity`. Nothing reads erasure requests.
9. **Consent.** Call recording and ad use consent have no morning check.
10. **Rows nobody picks up.** "Do task," "I'm ready to get funded" and the money helper write rows. Nothing watches them for stuck or failed.
11. **AI bureau caller setup.** The Save on the bureau config feeds the number the AI dials with client details. No test runs it.
12. **Partner pages.** Publish changes public partner pages. No check reads a published page.
13. **After paying.** The page a customer sees right after paying runs a script no test or check runs.

### Staff only

1. **Hiring.** The CRM tab is always empty. No test clicks the board. The jobs have no machine row. Days in stage count from a fixed date.
2. **10 desks with no click test.** No real-browser test clicks any control on company-brain, consent-capture, content-admin, contracts, creative-factory, csm-queue, documents, finance-os, galaxy or financeos. A broken Save, Send, Remind, Void, Claim or Record consent would pass.
3. **Board tools.** Tab counts gone, search on names only, Owner filter hidden.
4. **Calendar.** Claim and Mark done have no click test.
5. **Teleprompter.** The Settings sheet has no button. The header bar is hidden.
6. **The live click sweep has no schedule.** `scripts/live-playwright-sweep.mjs` runs only when someone runs it.
7. **494 surfaces are still unsorted** on the tripwire baseline.

### Leftover cards (breaks the lists found; this batch builds checks, it does not fix these)

Each is one card for a named fix later. The checks in W1 to W5 should go red on them.

- [ ] Present and Client Control Panel "Save month/year" fails: `api/soft-pull-approve.mjs:279` calls `stampIncorporatedAsStaff`, defined nowhere.
- [ ] EMAIL-DPC05-NO-PROGRESS-72H (a staff alert) is queued to the client by `src/workflows/dpc-05-no-progress-escalation.mjs`.
- [ ] `src/messaging/sms-dedup.mjs` is called only by its own test.
- [ ] Social Studio "Queue it" writes a table the sender never reads.
- [ ] Present "Invoice this client" is refused for closers and sales managers.
- [ ] No code sets `affiliates.partner_license_signed_at` or `affiliates.tax_form_received_at`, so every payout holds.
- [ ] An inquiry case set Completed by the update door fires no `inquiry.removed`.
- [ ] `api/pii.mjs` read, reveal and history check client id only, with no company check.
- [ ] Agent Editor Escalate-to and After-no-reply can never hand off; "May book" is read by nothing.
- [ ] Live emails with blank merge spots: F-07 funding locked, F-02 ID portal link, the no-show time.

---

## 5. The build order

8 workflows. 5 at once (the cap in CLAUDE.md §5). Each builds checks. None fixes the product.

| # | Workflow | Owns | Wave | Waits on | Model |
|---|---|---|---|---|---|
| W1 | Money A: funding, fees, payouts | funded-to-bill, approved with no amount, held payouts, commission ledger and rates, sample rows in live books | 1 | nothing | Sonnet |
| W2 | Money B: payments, checkouts, moves, ad spend | checkout links, setup fee, unmatched payments, past-due plans, stuck money moves, Meta spend | 1 | nothing | Sonnet |
| W3 | Pipelines truth | P1 to P7 on every board | 1 | nothing (one shared tripwire line with W1, see below) | Sonnet |
| W4 | Messages truth | sent-body blanks, staff email to client, links in sent mail, per-template trigger to delivered, brakes, dead senders, HELP, alert texts | 1 | nothing | Sonnet |
| W5 | Customer records and banks | bank logins, all 8 unwatched keys, merchant sync, helper rows, erasure, consent, partner pages, bureau config | 1 | nothing | Sonnet |
| W6 | Finish the lists (L0) | jobs, 52 doors, webhooks, public pages, keys, tables, agents, trips | 2 | a free slot only | Sonnet |
| W7 | Screens (L2) | click tests for money and customer buttons, handler tests for untested doors | 2 | a free slot only | Opus |
| W8 | Whole trips (L4) | 5 start-to-end journey checks | 2 | W1, W2 and W3 merged | Sonnet |

**What runs at the same time:** W1 to W5 together. W6 and W7 start the moment a slot frees. W8 starts when W1, W2 and W3 are on main.

**Real dependencies:**
- W8 reuses the checks from W1, W2 and W3.
- `route:pipeline-cards` in `src/pulse/tripwires.mjs`: W1 sorts it with its Funded check id. W3 adds its own check ids to that same entry after W1 merges.
- `src/pulse/coverage/gap-keys.mjs` belongs to W5 alone. W4 does not touch it. W5 adds all 8 keys, including the 2 receipt keys.
- Everyone appends their own lines to the shared lists: `src/pulse/coverage/modules.mjs`, `src/pulse/tripwires.mjs`, `src/pulse/tripwires-baseline.json`, `src/pulse/self-audit.mjs`, `src/pulse/beats/index.mjs`. Pull `origin/main` and re-run the tests before each merge. Merge one at a time.

**This session owned:** reading the 12 lists, the arithmetic, and this board. No build started.

**Chris decides:** go or no go on this batch. That is the only decision. Everything else is on the agents.

### Task list

| Unit | Owner | Status |
|---|---|---|
| Synthesis and this board | synthesis session | done |
| W1 Money A | | pending |
| W2 Money B | | pending |
| W3 Pipelines truth | | pending |
| W4 Messages truth | | pending |
| W5 Customer records and banks | | pending |
| W6 Finish the lists | | pending |
| W7 Screens | | pending |
| W8 Whole trips | | pending (waits for W1, W2, W3) |

### Copy-paste prompts

Each prompt stands alone. Paste one into a new Claude session in the repo.

#### W1 — Money A: funding, fees, payouts

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, docs/journeys/heartbeat-flow.md, docs/lessons/pulse-lessons.md.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W1 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/*.json (desks-a, desks-f, pipelines, routes-0, routes-1, routes-2). Read the rows for the surfaces below before you build.
Work in a worktree: git worktree add .claude/worktrees/cov-w1 -b cov/w1-money-funding. Never switch the branch of the main folder.

JOB: build read-only deep checks (L3) that go red when money is wrong. You do NOT fix the product.
Build these checks (reuse src/pulse/coverage/gap-funding.mjs and gap-partners.mjs where they fit; a new file is fine):
1. funding:funded-no-bill — every client whose card is in Funded on funding_card_stacking, or whose funding_rounds row is 'funded', past the money chain's own wait, has a funding_closeout row, a success-fee invoice, and commission rows. Read src/handlers/money-chain.mjs and src/funding/closeout.mjs for the real timing; do not invent one.
2. funding:approved-no-amount — a bank yes (Approved) with no dollar amount, older than one day.
3. partners:payout-held — an affiliate or partner payout sitting in 'held' past its monthly run. In the detail, name the cause: partner_license_signed_at or tax_form_received_at is empty (src/affiliates/payouts.mjs gates on both).
4. commissions:ledger — commission_ledger rows 'approved' and not paid past the payout date; rows 'earned' with no matching commission_rules version; more than one open rule version per product.
5. commissions:slo-map — every sold SLO product has a slo_connections row and a commission rule.
6. books:sample-rows — rows made by api/dashboard/seed.mjs (sample payments, the $3,000 sale) sitting in live tables.
Sort these in src/pulse/tripwires.mjs (TRIPWIRES, with your check ids) and remove each from src/pulse/tripwires-baseline.json: route:pipeline-cards, route:applications, route:commissions, route:commission-rules, route:slo-connections, route:dashboard/seed, route:read/affiliates, desk:products-commissions.html, desk:client-control-panel.html, desk:affiliate.html.

HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Ask one yes-or-no question a customer would feel.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, email, AI call, Plaid write, credit pull or card charge.
- Each lane under 20 seconds. No repo files at run time.
- A failed read is skip with the reason, never PASS. A skip that will last needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS test and one FAIL test per check that would break if the logic broke. Never skip, delete or weaken a test.
- tripwires-baseline.json only shrinks. Never add to it.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists (modules.mjs, tripwires.mjs, tripwires-baseline.json, self-audit.mjs, beats/index.mjs): add only your own lines. Pull origin/main and re-run tests before merging. Merge one at a time.

SCOPE LOCK: do not fix any break. If a check goes red on a real break on day one, that is correct. Write one leftover card on the board and keep going. Do not hunt for other holes.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

#### W2 — Money B: payments, checkouts, money moves, ad spend

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, docs/journeys/heartbeat-flow.md, docs/lessons/pulse-lessons.md.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W2 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/*.json (desks-a, desks-d, desks-e, routes-1, routes-2, banks-links). Read the rows for the surfaces below before you build.
Work in a worktree: git worktree add .claude/worktrees/cov-w2 -b cov/w2-money-payments. Never switch the branch of the main folder.

JOB: build read-only deep checks (L3) that go red when money is wrong. You do NOT fix the product.
Build these checks (reuse src/pulse/coverage/gap-payments.mjs, gap-finance-os.mjs, gap-ads.mjs, gap-marketing-queue.mjs where they fit):
1. checkout:paid-service — every paid_service_requests row in awaiting_payment has a payment link that answers (HEAD); every row paid but still 'paid' or 'staged' past its window is red.
2. checkout:repair-and-funnel — the prices that api/public/slo-repair-checkout.mjs and api/public/funnel-checkout.mjs offer match the till (copy the pattern of funnel:order-price-matches-till); funnel.checkout_started events that never became paid or expired are red after a day.
3. finance-os:setup-paid-on — every paid FinanceOS setup fee has FinanceOS turned on for that client; the setup price setting is present.
4. payments:unmatched — money_agent_log rows with action 'payment_unmatched' older than the window the code uses; clarity_payment_installments past due with no flag.
5. subscriptions:past-due — a past_due subscription with no billing attempt inside the sweeper's own retry window (src/subscriptions/billing-store.mjs).
6. money-moves:stuck — money_transfers approved but not sent past their date, sent but not settled past the provider window, or failed/returned with the task still open. While PLAID_ENV is not production and there are no rows, use a verified "nothing to judge" code.
7. ads:meta-matches — our campaign status and daily budget equal what Meta reports (GET only, read the key the ads lane already uses); Load-to-Meta (meta_load) job rows failed or stuck. gap-marketing-queue.mjs skips meta_load today and says the ads lane has it; no check does.
Add an hourly beat (src/pulse/beats/beat-<id>.mjs on src/pulse/beats/index.mjs, with covers, steps, fixGuide, selfTest) for the checkout doors customers hit: repair checkout, funnel checkout, paid-service link. GET only. Prove with npm run pulse:prove -- --beats.
Sort these in src/pulse/tripwires.mjs (TRIPWIRES, with your check ids) and remove each from src/pulse/tripwires-baseline.json: route:paid-services, route:public/slo-repair-checkout, route:public/funnel-checkout, route:money/setup, route:money/payments, route:money/transfers, route:finance/subscriptions, route:finance/cards, route:partner-addons, route:campaigns/write, desk:money-setup.html, desk:money-payments.html, desk:money-transfers.html, desk:campaign-manager.html, job:finance-os-money-transfers, job:subscription-billing-sweeper.

HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Ask one yes-or-no question a customer would feel.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, email, AI call, Plaid write, credit pull or card charge.
- Each lane under 20 seconds. No repo files at run time.
- A failed read is skip with the reason, never PASS. A skip that will last needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS test and one FAIL test per check that would break if the logic broke. Never skip, delete or weaken a test.
- tripwires-baseline.json only shrinks. Never add to it.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists (modules.mjs, tripwires.mjs, tripwires-baseline.json, self-audit.mjs, beats/index.mjs): add only your own lines. Pull origin/main and re-run tests before merging. Merge one at a time.
- Do not touch src/pulse/coverage/gap-keys.mjs (W5 owns it).

SCOPE LOCK: do not fix any break. If a check goes red on a real break on day one, that is correct. Write one leftover card on the board and keep going. Do not hunt for other holes.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

#### W3 — Pipelines truth

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, docs/journeys/heartbeat-flow.md, docs/lessons/pulse-lessons.md, and section 3 "The pipelines" of the board.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W3 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/pipelines.json (262 rows) and the pipeline.html rows in desks-e.json.
Work in a worktree: git worktree add .claude/worktrees/cov-w3 -b cov/w3-pipelines. Never switch the branch of the main folder.

JOB: build read-only deep checks (L3) that prove every card on every board is right. You do NOT fix the product.
Boards: sales, funding_card_stacking, funding_altfin, optimization (repair), inquiry_removal, ar_collections, affiliates_white_label, hiring. Reuse src/pulse/coverage/gap-crm-links.mjs and src/pulse/pipeline-motion.mjs where they fit.
Build these checks:
P1 pipeline:count-true — per board and stage, the database card count vs what api/dashboard/pipeline.mjs returns (it stops at LIMIT 500, cap 2000, and drops a card whose stage is not on the board).
P2 pipeline:stage-vs-fact — Sales: paid (deposit.paid, sale.closed, payment.received) but card before Closed Won or Downsell; booked but card before Booked. Funding: round 'funded' but card not Funded, and the reverse. Inquiry: case Completed but card not Removed or Resume Funding. Repair: dispute_cases.status vs the card. Partners: partners.status vs the card. AR: a card on ar_collections vs its invoices.status.
P3 pipeline:age — no card past its stage time limit, on every board. Use limits already written in the repo (src/repair/sla.mjs, docs/journeys). Where a board has none written, do not invent one: ship that board's age check with the limit as one named setting, off, behind a verified "no limit set" code, and add the board name to the board under "Chris decides".
P4 pipeline:move-receipt — every card move in the last day on funding_card_stacking fired its round event (its card_stacking:<client>:<round>:<stage>:<event> key exists) and the event's result exists.
P5 pipeline:dead-stage — a verified "nothing to judge" code for every stage with no mover (Sales Confirmed; Inquiry Removed and Hold; Repair Round Complete, Program Complete, On Hold, Cancelled and the 4 old stages; all 5 AR stages; all 7 Alt-Fin stages; Hiring Onboarding, Ramp, Performing, Withdrawn; Partners Recruiting, Agreement Signed, Paused). It goes red the day a card lands there.
P6 pipeline:nobody-lost — a paying client with no card on any board (src/handlers/purchase-routing.mjs bail paths only console.warn); a client archived (custom_fields.crm_archived_at) who paid after the archive; a card on a stage its board does not have.
P7 pipeline:two-records — funding_rounds.status vs the funding card; dispute_cases.status vs the repair card; call_outcomes this month (Sales floor) vs Sales board counts.
Sort in src/pulse/tripwires.mjs and remove from src/pulse/tripwires-baseline.json: desk:pipeline.html, desk:inquiry-remover.html, desk:hiring.html, desk:csm-queue.html, desk:sales-floor.html, route:dashboard/pipeline, route:dashboard/client-archive, route:pipeline-clients, route:inquiry-cases. For route:pipeline-cards: W1 sorts it; after W1 merges, add your check ids to that same entry.

HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Ask one yes-or-no question a customer would feel.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, email, AI call, Plaid write, credit pull or card charge.
- Each lane under 20 seconds (split boards into separate lanes if needed). No repo files at run time.
- A failed read is skip with the reason, never PASS. A skip that will last needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS test and one FAIL test per check that would break if the logic broke. Never skip, delete or weaken a test.
- tripwires-baseline.json only shrinks. Never add to it.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists (modules.mjs, tripwires.mjs, tripwires-baseline.json, self-audit.mjs, beats/index.mjs): add only your own lines. Pull origin/main and re-run tests before merging. Merge one at a time.

SCOPE LOCK: do not fix any break (no new movers, no card moves, no board changes). If a check goes red on a real break on day one, that is correct. Write one leftover card on the board and keep going. Do not hunt for other holes.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

#### W4 — Messages truth

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, .claude/rules/texting-hours.md, docs/journeys/heartbeat-flow.md, docs/lessons/pulse-lessons.md.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W4 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/messages.json (447 rows: 247 email templates, 85 text templates, 115 send-machine rows) and banks-links.json rows 99 to 109 (links in messages).
Work in a worktree: git worktree add .claude/worktrees/cov-w4 -b cov/w4-messages. Never switch the branch of the main folder.

JOB: build read-only deep checks (L3) that prove what customers receive is right. You do NOT fix the product.
Reuse src/pulse/coverage/gap-email.mjs, gap-sms.mjs, gap-opt-out.mjs, gap-nurture.mjs where they fit. Build:
1. msg:sent-body-blanks — sent and queued messages in the last day whose rendered body has an empty merge spot ("$" with no number after it, two spaces where a value belongs, a leftover "{{", the words "placeholder", "lorem ipsum" or "[DRAFT]"). Red per template key.
2. msg:staff-template-to-client — a template written for staff (for example EMAIL-DPC05-NO-PROGRESS-72H, which says "Internal alert") sent to a client address.
3. msg:links-in-body — every link in sent bodies from the last day: not blank, host on the allowed list, answers to HEAD. Cap the count to stay under 20 seconds.
4. msg:per-template-path — for each live template (82 emails, 58 texts): trigger fired vs queued vs sent vs delivered over 7 days. Red when a trigger fired and nothing queued, or it was queued and never delivered.
5. msg:brakes — a send that went out while the pause switch was on, sends over the daily cap, or the same text to the same phone twice in 24 hours (src/messaging/sms-dedup.mjs is never called today).
6. msg:dead-senders — a verified "nothing to judge" code for the 141 templates with no sender and the 51 retired ones (red if one is ever queued); owner_notifications rows never sent; hiring candidate outreach rows blocked as recipient_unknown.
7. msg:help-reply — an inbound HELP text with no reply.
8. alerts:texts-went-out — file_protection_alerts due today have a queued and delivered text; card-due reminders inside their window have a text.
Sort in src/pulse/tripwires.mjs and remove from src/pulse/tripwires-baseline.json: every send: entry still in the baseline, route:messages-outbound, route:money/alerts, desk:messaging.html, desk:ops-admin.html, desk:money-alerts.html, job:blueprint-finance-os-alerts, job:finance-os-card-due-reminders.
Do not touch src/pulse/coverage/gap-keys.mjs. W5 adds RESEND_WEBHOOK_SECRET and TWILIO_AUTH_TOKEN there.

HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Ask one yes-or-no question a customer would feel.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, no email, no AI call. A check never sends.
- Each lane under 20 seconds. No repo files at run time.
- A failed read is skip with the reason, never PASS. A skip that will last needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS test and one FAIL test per check that would break if the logic broke. Never skip, delete or weaken a test.
- tripwires-baseline.json only shrinks. Never add to it.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists (modules.mjs, tripwires.mjs, tripwires-baseline.json, self-audit.mjs, beats/index.mjs): add only your own lines. Pull origin/main and re-run tests before merging. Merge one at a time.

SCOPE LOCK: do not fix any break (no template edits, no sender changes). If a check goes red on a real break on day one, that is correct. Write one leftover card on the board and keep going. Do not hunt for other holes.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

#### W5 — Customer records and banks

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, .claude/rules/secrets-env-law.md, docs/journeys/heartbeat-flow.md, docs/lessons/pulse-lessons.md.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W5 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/*.json (banks-links rows 0 to 72, desks-b, desks-c, desks-d, routes-2).
Work in a worktree: git worktree add .claude/worktrees/cov-w5 -b cov/w5-records-banks. Never switch the branch of the main folder.

JOB: build read-only deep checks (L3) that prove customer records and bank links are right. You do NOT fix the product.
Reuse src/pulse/coverage/gap-banks.mjs, gap-finance-os.mjs, gap-consent.mjs, gap-keys.mjs, gap-partners.mjs where they fit. Build:
1. banks:login-broken — plaid_items with link_state 'error' past the window, with no client message or staff task. The red must clear once the client links the same bank again (judge the newest login per bank).
2. keys — add to LAUNCH_SECRETS in src/pulse/coverage/gap-keys.mjs: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_TOKEN_ENC_KEY, MERCHANT_SECRET_ENC_KEY, FINANCE_OS_SETUP_FEE_CENTS, LENDFLOW_WEBHOOK_SECRET, RESEND_WEBHOOK_SECRET, TWILIO_AUTH_TOKEN. Set and not a mask. Never print a value.
3. banks:merchant-sync — merchant_connections with a last_sync_error, or no sync in 2 days.
4. helper:rows-stuck — money_agent_tasks queued, needs_approval or claimed past the window; money_helper_turns with no answer; an "I'm ready to get funded" press with no CSM prep-call task.
5. privacy:erasure — erasure_requests 'requested' past the window, or 'failed'.
6. consent:recording-and-ads — extend gap-consent.mjs to the consent kinds call_recording and marketing_use.
7. partner-pages:live — every published partner_pages row answers 200 at /sites/<partnerId>/<slug>.
8. bureau-config:complete — ai_bureau_config has a number and a menu path for each bureau the AI caller dials.
Sort in src/pulse/tripwires.mjs and remove from src/pulse/tripwires-baseline.json: route:banking/link-token, route:banking/link-exchange, route:banking/revoke, route:banking/sync-accounts, route:banking/sync-transactions, route:banking/sync-liabilities, route:money/connections, route:money/helper, route:money/tasks, route:privacy/erasure, route:pii, route:partner-pages, route:partner-brand, route:ai-bureau-config, desk:money-accounts.html, desk:money-banks.html, desk:money-connections.html, desk:money-helper.html, desk:brand-studio.html, desk:lenders.html, job:plaid-transactions-sweeper, job:merchant-pull-sweeper.

HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Ask one yes-or-no question a customer would feel.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, email, AI call, Plaid call or credit pull.
- Each lane under 20 seconds. No repo files at run time.
- A failed read is skip with the reason, never PASS. A skip that will last needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS test and one FAIL test per check that would break if the logic broke. Never skip, delete or weaken a test.
- tripwires-baseline.json only shrinks. Never add to it.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists (modules.mjs, tripwires.mjs, tripwires-baseline.json, self-audit.mjs, beats/index.mjs): add only your own lines. Pull origin/main and re-run tests before merging. Merge one at a time.
- You alone own src/pulse/coverage/gap-keys.mjs in this batch.

SCOPE LOCK: do not fix any break (no relink button, no Plaid calls, no PII changes). If a check goes red on a real break on day one, that is correct. Write one leftover card on the board and keep going. Do not hunt for other holes.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

#### W6 — Finish the lists (L0)

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md (especially §2: search src/, scripts/, db/ and docs/ before calling anything missing).
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W6 "claimed" before you start. Write your manifest under "Manifests" when done.
Work in a worktree: git worktree add .claude/worktrees/cov-w6 -b cov/w6-lists. Never switch the branch of the main folder.

JOB: read only. Write the missing inventories so every live thing is at least L0 (known). Do not change any code.
Write new JSON files into ops/workflows/coverage-every-surface-2026-10-10/, one row per thing, the same shape as the existing files:
{ surface, control, kind, calls, tables, impact (money | customerMessage | customerData | staffOnly | none), coverage (none | ping | e2e | deep), evidence }.
Score coverage only from what you can point at: a ping row in src/pulse/registry.mjs or src/pulse/heartbeats.mjs = ping; a test that runs the real code = e2e; a check in src/pulse/coverage/ or src/pulse/beats/ that reads the data and can go red = deep. Name the file in evidence. Never invent.
1. jobs.json — all 100 workflows in src/workflows/index.mjs and all 16 files in netlify/functions/. 29 workflows and 4 functions are named in no list today (see the board, section 2).
2. routes-3.json — the 52 routed doors in netlify/functions/api.mjs ROUTES with no route row (list on the board, section 2).
3. webhooks.json — every inbound door: the STD table in src/http/router.mjs (commas, clickfunnels, bland, lendflow, inquiry-removal), plus Twilio, Resend, Mailgun and merchant doors. Signature check, secret name, what it writes, which check watches it.
4. public-pages.json — every form, button and link on the 43 public pages outside public/app (21 are named in no list today).
5. keys.json — every env name the code reads (process.env and ctx.env), and the check that watches it, if any. Names only. Never a value.
6. tables.json — every table in db/migrations: who writes it, who reads it, which pulse check reads it.
7. agents.json — every AI agent in the agents table seed and code: who it texts, what it may do, when it hands off, whether a check watches it.
8. journeys.json — the start-to-end customer trips in docs/journeys/*-intended.md, each step, and the check (if any) on each step.
Then re-count the whole folder (rows by coverage and by impact) and update section 2 "The numbers" on the board with the new totals, marked as W6's count.
Commit in this session (only the JSON files and the board). Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs.
SCOPE LOCK: list, do not fix. End with the CLAUDE.md §9 task report.
```

#### W7 — Screens (L2)

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
Read first: CLAUDE.md (§6 and §12), docs/rules/UI-STANDARDS.md, and e2e/ for the existing Playwright pattern.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W7 "claimed" before you start. Write your manifest under "Manifests" when done.
Evidence: ops/workflows/coverage-every-surface-2026-10-10/desks-*.json and routes-*.json. Every row with impact money, customerMessage or customerData and coverage none or ping is your list.
Work in a worktree: git worktree add .claude/worktrees/cov-w7 -b cov/w7-screens. Never switch the branch of the main folder.

JOB: add tests so every money and customer button reaches L2 (a test presses it and the right request goes out), and every money and customer door has a test that runs the real handler. Do not change product code.
Start with these (from the lists):
- Click tests: money-transfers Review and "Yes, move $X"; Ops & Admin "Send what is waiting", "Pause sending", "Email unsent invoices"; Pipeline New Client and Archive modals; products-commissions Approve selected, Mark paid, Change rate; Creative Factory Approve, Reject, Archive; the 10 desks in desks-b.json with no click test (company-brain, consent-capture, content-admin, contracts, creative-factory, csm-queue, documents, finance-os, galaxy, financeos); Calendar Claim and Mark done; Agent Editor Return to shadow and Promote; Closer dashboard calculator inputs; soft-pull-approve.html; teleprompter-remote.html.
- Handler tests (src/http/<name>.pg.test.mjs importing the api/ handler; tests under api/ never run): commissions, campaigns/write (resume, update_budget), dashboard/seed, paid-services, public/funnel-checkout, public/slo-repair-checkout, inquiry-cases (send, mark_cleared, close), ai-bureau-config, auth/logout, chat/messages, journeys/run, partner-brand/verify-domain, partner-marketing/generate-copy, partner-marketing/usage, read/invoices, finance/paydown-simulator, marketing-flags, social/schedule.
Rules: green tests must run against a real DATABASE_URL on a scratch database as the fundhub_app role, never production (src/verification/scratch-guard.mjs). No skipped, deleted or weakened tests.
If a test would fail because the product is broken (for example stamp_incorporated in api/soft-pull-approve.mjs calls a function that does not exist), do not commit a red test and do not fix the product. Write one leftover card on the board and move on.
Done means: npm run lint, npx tsc --noEmit, npm test green, and the Playwright specs pass.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
SCOPE LOCK: tests only. End with the CLAUDE.md §9 task report.
```

#### W8 — Whole trips (L4)

```text
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Owner: Chris Stanbridge. Talk to him at a 4th grade reading level.
WAIT until W1, W2 and W3 show "done" on the board and their checks are on main. Read their manifests first.
Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, docs/journeys/heartbeat-flow.md, docs/journeys/client-intended.md, docs/journeys/affiliate-intended.md, docs/lessons/pulse-lessons.md.
Board: ops/workflows/coverage-every-surface-2026-10-10.md. Mark W8 "claimed" before you start. Write your manifest under "Manifests" when done.
Work in a worktree: git worktree add .claude/worktrees/cov-w8 -b cov/w8-trips. Never switch the branch of the main folder.

JOB: build read-only journey checks (L4). Each follows every customer who started a trip in the window and names the first step that is missing. You do NOT fix the product.
Trips (use the steps written in docs/journeys/*-intended.md; do not invent steps):
1. trip:funding — paid diagnostic, Sales card, booked, call held, deposit, Funding Apply Now card, round opened, submitted, approved, Funded, closeout, success-fee invoice, commission.
2. trip:repair — repair purchase, enrolled, documents in, letters made, letters mailed, bureau answer read, round complete.
3. trip:inquiry — inquiry gate, one case per bureau, letters, calls, removed, inquiry.removed fired, funding resumes.
4. trip:partner — partner applies, approved, page published and live, referral clicked, referral converted, commission, payout paid.
5. trip:roadmap — roadmap buyer paid, pull form filled, pack delivered, portal sign-in.
Reuse the W1, W2 and W3 check functions for each step. One lane per trip, each under 20 seconds.
HEARTBEAT LAW (every check):
- File src/pulse/coverage/gap-<lane>.mjs exporting async function gapChecks(ctx) that returns rows { id, status, detail, suggestedFix }; status PASS, FAIL or skip.
- Put any new file on the literal list in src/pulse/coverage/modules.mjs. Put new check ids on the lists src/pulse/self-audit.mjs builds its manifest from.
- Sort each trip's surfaces in src/pulse/tripwires.mjs and remove them from src/pulse/tripwires-baseline.json (it only shrinks).
- Read only. ctx.db is shared: never BEGIN, COMMIT, ROLLBACK or SET. Web calls GET or HEAD only. No text, email, AI call, Plaid write, credit pull or card charge.
- No repo files at run time. A failed read is skip with the reason, never PASS. A lasting skip needs a code in src/pulse/na-conditions.mjs with a verify().
- Tests both ways: at least one PASS and one FAIL test per trip. Never skip, delete or weaken a test.
- Prove: npm run pulse:prove must say OK. Then npm run lint, npx tsc --noEmit, npm test.
- Shared lists: add only your own lines. Pull origin/main and re-run tests before merging.
SCOPE LOCK: do not fix any break. A trip that goes red on day one is correct. Write one leftover card on the board and keep going.
Commit in this session. Before pushing: git fetch and merge origin/main, then node scripts/github-push-whole-repo.mjs. A push to main ships by itself (.github/workflows/ship.yml).
End with the CLAUDE.md §9 task report.
```

---

## Manifests

Each workflow writes here when done: files touched, check ids added, surfaces sorted out of the baseline, `pulse:prove` result, leftover cards written.

- **Synthesis (2026-10-10):** wrote this board only. Read 12 inventories (2,690 rows). Counted with a script. Checked live: ROUTES has 324 doors; `src/workflows/index.mjs` registers 100 workflows; `src/pulse/tripwires.mjs` sorts 38 + 4; `src/pulse/tripwires-baseline.json` holds 494. Confirmed by grep: `stampIncorporatedAsStaff` is called once and defined nowhere; `sms-dedup` is used only by its own test. No code changed.

## Blockers and open questions

- None. Waiting on Chris's go.
