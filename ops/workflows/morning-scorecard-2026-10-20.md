# Morning scorecard check — 2026-10-20

Owner of this board: the morning-scorecard session (worktree `silly-elion-fb36a2`). This is one job, done in order: find the cause, fix it, prove it. It cannot be split.

| Unit | Owner | Status |
|---|---|---|
| Find why the morning scorecard stopped saving | this session | done: it never stopped |
| Fix the cause | this session | done: nothing to fix |
| Lesson in `docs/lessons/pulse-lessons.md` | this session | done |
| List today's reds (do not fix them) | this session | done (below) |

## The finding

The morning check saves a scorecard every day. It did not stop on 10-12.

- Live database, read only, as `fundhub_app` on the 6543 pooler, inside `BEGIN READ ONLY`.
- `pulse_scorecards` has 13 rows, one each morning from 2026-10-08 to 2026-10-20. There is 1 org and 1 table. The read rule is `true`.
- The 10-12 row (691 green, 76 red, 0 not checked, 35 n/a) is real, but it is an old row. The newest row is today's.

## Today: 2026-10-20, saved 13:02:18 UTC (6:02 a.m. Arizona)

| Green | Red | Not checked | Nothing to judge | All rows |
|---:|---:|---:|---:|---:|
| 975 | 94 | 2 | 282 | 1353 |

The groups come from the ranked list `ops/workflows/heartbeat-ranked-2026-10-14.json`. All 96 ids are on it. "Day N" = how many mornings in a row the row has been red.

### Money (17)

- `meta-sync` (day 9)
- `ads-number-unmapped` (day 9)
- `catalog-display:desks-a.json:client-control-panel.html:Mark funded… button, amount box, Save funded, Cancel` (day 7)
- `catalog-display:desks-b.json:financeos.html#next:'Do task' button on a step the helper or a person can do` (day 7)
- `catalog-display:desks-b.json:financeos.html#next:'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task)` (day 7)
- `catalog-display:desks-e.json:public/app/pipeline.html:Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero)` (day 7)
- `catalog-display:desks-f.json:products-commissions.html:Commission rule 'Close v<N> - open v<N+1>': saves a new effective-dated rate and reason` (day 7)
- `catalog-display:desks-f.json:products-commissions.html:'Approve selected': moves Accrued rows to Approved` (day 7)
- `catalog-display:desks-f.json:products-commissions.html:'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money)` (day 7)
- `catalog-display:desks-f.json:soft-pull-approve.html:'I agree - submit soft-pull approval': saves consent, SSN and DOB, businesses, a portal account and sign-in email, and mints the exact-total checkout` (day 3)
- `catalog:hourly-proof-linked` (day 7)
- `funding:round-stuck` (day 6)
- `partners:commission-payable` (day 8)
- `payments:invoice-stuck` (day 8)
- `payments:paid-product-unmapped` (day 1)
- `portal:paid-client-never-signed-in` (day 12)
- `gap-underwrite:uw-pack-email-not-queued` (day 9)

### Customer messages (22)

- `calls:booked-no-join-link` (day 12)
- `catalog-display:desks-a.json:closer-dashboard.html:Send contract button (opens panel)` (day 3)
- `catalog-display:desks-a.json:closer-dashboard.html:Contract panel: wording select and blank-field inputs` (day 3)
- `catalog-display:desks-a.json:closer-dashboard.html:Contract panel: Send button` (day 3)
- `catalog-display:desks-b.json:shell.js shared chrome (on every desk here except financeos.html):Chat widget launcher and its modes (Ask, Knowledge, Message: a teammate, or an SMS to a client by id)` (day 3)
- `catalog-display:desks-b.json:consent-capture.html:Record consent: call_recording` (day 7)
- `catalog-display:desks-b.json:consent-capture.html:Record consent: marketing_use (permission to use what the client said in ads)` (day 7)
- `catalog-display:desks-b.json:consent-capture.html:History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt)` (day 7)
- `catalog-display:desks-c.json:shell.js (shared chrome on every staff desk):Chat widget on every desk: Ask (AI answer), Knowledge, Message staff, Message a client` (day 3)
- `catalog-display:desks-c.json:messaging.html:Send button (staff reply to a client by text or email; shift clock-in required)` (day 3)
- `catalog-display:desks-e.json:public/app/pipeline.html:New Client (button opens the modal: name, email, phone, product with 6 choices; Save / Cancel; same save as the apply form)` (day 3)
- `catalog-display:desks-e.json:public/app/pipeline.html:pipeline-clients (server): creates or finds the client through the funnel door and emits entry.captured, which sends the welcome email and text and places the Sales card` (day 3)
- `catalog-display:desks-e.json:public/app/chat-widget.js (mounted by shell.js on the same desks; skipped for partner and affiliate roles):Message > Client: paste a client id and send (goes through the compliance gate as a text)` (day 3)
- `catalog-display:desks-f.json:present.html (+ present.js, contract-send.js):'Send contract': picks the agreement that matches the offer, creates the draft, sends it, returns the sign link` (day 3)
- `catalog-display:desks-f.json:social-studio.html:Waiting row: 'Queue it' with its own time box (sets or keeps the send time, no account needed)` (day 3)
- `catalog-display:desks-f.json:social-studio.html:Held row (owner and admin only): 'Approve it' (asks first; the post goes out at its time)` (day 3)
- `consent:dispute-required` (day 8)
- `email:sending-stuck` (day 9)
- `email:provider-fail` (day 4)
- `handoff:lead-first-touches-missing` (day 4)
- `msg:per-template-path` (day 2)
- `gap:sms-sending-stuck` (day 9)

### Customer records (32)

- `pipeline:repair` (day 9)
- `pipeline:clients` (day 9)
- `clickfunnels-night-job` (day 9)
- `calls:booked-no-outcome` (day 10)
- `calls:booking-webhook` (day 7)
- `catalog-data:client_custom_fields` (day 8)
- `catalog-data:repair_decision_log` (day 8)
- `catalog-display:desks-a.json:client-control-panel.html:Mark round submitted button` (day 7)
- `catalog-display:desks-a.json:client-control-panel.html:Close round button` (day 7)
- `catalog-display:desks-a.json:client-control-panel.html:Lender row: Approved $ amount input` (day 7)
- `catalog-display:desks-a.json:client-control-panel.html:Lender row: Approved button` (day 7)
- `catalog-display:desks-a.json:client-control-panel.html:Lender row: Declined button` (day 7)
- `catalog-display:desks-a.json:client-control-panel.html:Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)` (day 7)
- `catalog-display:desks-a.json:client-portal.html:Upload door: ID and personal documents (type select, Upload button, file picker)` (day 3)
- `catalog-display:desks-a.json:client-portal.html:What You Own: Download link per file` (day 3)
- `catalog-display:desks-b.json:contracts.html:Wording list: click a row to edit it` (day 7)
- `catalog-display:desks-b.json:contracts.html:Save (edit an existing wording)` (day 3)
- `catalog-display:desks-b.json:contracts.html:PDF editor: Save boxes` (day 7)
- `catalog-display:desks-b.json:csm-queue.html:Save these answers button (needs at least one answer)` (day 7)
- `catalog-display:desks-c.json:inquiry-remover.html:Repair stage: analysis (SLA 1 hour -> engineering_engine_failure)` (day 3)
- `catalog-display:desks-e.json:public/app/money-vault.html:documents-upload (server): stores the file, one document per file, sniffs the bytes` (day 3)
- `catalog-display:public-pages.json:page:leads/<32-hex>/index.html:Private leads list page (noindex, secret folder name): a local table with Name, Number, Follow up date, Response, Status. Edits save in the browser only; nothing is sent from the page.` (day 3)
- `closer-setup:calendar-late` (day 10)
- `contracts:signed-not-stored` (day 9)
- `documents:cannot-open` (day 9)
- `gap-door-batch-jobs:catalog-job:jobs.json:workflow:inquiry-call-sweeper:inquiry-call-sweeper (src/workflows/inquiry-call-sweeper.mjs): trigger cron */15 * * * *. every 15 minutes places the AI bureau calls whose wait has elapsed (call_due_at) | sends or calls: Bland placeCall to a bureau | writes: inquiry_removal_cases, outbound_calls` (day 8)
- `gap-door-batch-webhooks:door-batch:webhook-lendflow-contract` (day 8)
- `fulfillment:next-action` (day 12)
- `gap-leads:lead:pipe-cut-with-traffic` (not checked)
- `gap-pipeline-boards:pipeline:age` (day 10)
- `repair-letter-round` (day 12)
- `gap-trip-repair:trip:repair` (day 10)

### Staff tools (24)

- `live-playwright:desks` (day 12)
- `meta-server-events` (not checked)
- `catalog-display:desks-a.json:client-control-panel.html:Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover` (day 3)
- `catalog-display:desks-a.json:client-control-panel.html:More menu: Open Credit Snapshot link` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Summary tiles: jobs in flight, failed jobs, awaiting review, library assets, active brand kits` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Write a script and label it: words box, name, kind, angle, hook, offer (suggestion lists) and lane picker` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Save this script button` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Generate form: Kind (static / copy / video), What is being sold, What to make, Name this batch` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Run queued jobs now button` (day 3)
- `catalog-display:desks-b.json:creative-factory.html:Review queue (brand row): reason box and 'Approve this brand' button (owner/admin only)` (day 3)
- `catalog-display:desks-b.json:financeos.html#helper:Suggestion buttons (3: due this week, which card first, got declined paste the letter)` (day 7)
- `catalog-display:desks-f.json:sales-floor.html (+ sales-floor.js):'Flag <belief>' button: stores a belief x source row for marketing` (day 3)
- `catalog-display:desks-f.json:sales-floor.html (+ sales-floor.js):Recording rows: name, client, 'Words ready / Waiting for words', 'Open in Drive' link (https drive.google.com or docs.google.com only)` (day 3)
- `catalog-display:desks-f.json:social-studio.html:'Who approves posts' card (read-only: shows the saved approval switch, the safe default, or 'could not read')` (day 3)
- `catalog-display:desks-f.json:staff-teams.html:Editor 'Reset password': makes a 1 hour reset link and shows it in a prompt box to copy` (day 3)
- `gap-catalog-flow:flow:message:template-copy:SQL-seeded-only-keys-not-in-doc-source` (day 3)
- `gap-catalog-flow:flow:message:manual-proof:comms-map-2026-09-19 (template delivery proof)` (day 3)
- `gap-catalog-flow:flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map` (day 3)
- `gap-catalog-reads:catalog-read:climate-map` (day 1)
- `gap-door-batch-jobs:door-batch:ad-video-worker-result` (day 8)
- `gap-door-batch-keys:door-batch:keys-live-proof` (day 8)
- `gap-door-batch-webhooks:door-batch:webhook-ad-video-worker` (day 8)
- `keys:launch-secrets-present` (day 10)
- `gap-records:bureau-config:complete` (day 10)

### The heartbeat checking itself (1)

- `audit:not-checked` (day 8)

## Change manifest

- `docs/lessons/pulse-lessons.md`: one new lesson, `pulse_false_alarm`, 2026-10-20.
- `ops/workflows/morning-scorecard-2026-10-20.md`: this board.
- No code, route, job, or journey changed.
