# Front-house role/page/action acceptance inventory — source-backed baseline, 2026-10-29

**Scope boundary:** lead through the *verified paid* funding, repair or Blueprint fulfillment handoff, excluding accounts receivable and actual fulfillment execution. The dated Oct 10 inventory files are reference catalogs, **not proof that a page is currently deployed/live**. No production writes or external sends occurred while generating this baseline.

**Verdict rule:** PASS = a functional action and saved/provider result with its specific evidence; FAIL = reproducible defect; **NOT LIVE PROVED** = only source/static/unit/mock/browser or incomplete role/deployment evidence. An inventory row labelled `e2e`, `deep`, or `ping` by the earlier Pulse catalog does **not** automatically become PASS here. Never mark this audit complete while any required row remains NOT LIVE PROVED.

**Source ledger:** `ops/workflows/coverage-every-surface-2026-10-10/desks-a.json` through `desks-e.json` (existing controls and earlier coverage descriptions), plus `ops/workflows/manual-e2e-2026-10-26.md` for October 26 actual observations. Existing PR #254 client-communications ledger, #263 setter answer fix, #257 SOP, #268 Sales Set, and native/Blueprint/A/R/fulfillment agents remain separate code owners. This file only indexes and classifies; it is no substitute for tests or direct read-only production proof.

## Highest-priority cross-role flows (separate from individual page controls)

| Path | Required operation | Evidence / scope note | Verdict |
| --- | --- | --- | --- |
| Ad / landing | Meta pixel and CAPI qualified/unqualified attribution, UTMs, landing video and CTA | PR #260 active, no ad spend or production send | **NOT LIVE PROVED** |
| Owner sales-content teleprompter | Camera overlay, forward scroll speed at 200/205/210/215 WPM, native recording state | PR #255 CI run 40968827186: staff display browser batch failed at 210 WPM due 0.002ms stationary sub-frame observation; 401 other browser proofs passed. PR #283 isolates proof-filter correction; rerun required. Do not call a proof-harness failure a proven production scroll defect. | **NOT LIVE PROVED — CI PROOF FAIL / PR #283 PENDING** |
| Apply / intake | All nine application screens: progress, required fields, next/back/save, identity updates, validation and error/mobile states | No route-scoped full role walk attached | **NOT LIVE PROVED** |
| Booking | ClickFunnels booking and reschedule -> right client, seller, closer, unique booking and notices | Historic 2026-10-26 failed parent thank-you redirect | **NOT LIVE PROVED** |
| Booking | Owner and Justice separate Google Calendar events: guests, timezone, Meet, invite receipt, reschedule/cancel, Join | Owner Oct26 host no Meet/guests; Justice calendar not verified | **NOT LIVE PROVED** |
| Post-book | Parent thank-you redirect, App Store CTA, app-first onboarding and accurate tap-not-install semantics | 2026-10-26 manual redirect FAIL, App Store listing PASS | **NOT LIVE PROVED** |
| Installed client PWA, separate from native app | PWA entry via `/app/client-portal.html` and signed-out `/portal-login.html` / client password `/login.html?next=%2Fapp%2Fclient-portal.html` must never offer `/` or `/index.html` marketing navigation via header/back; browser marketing links and auth/routes stay intact | Manifest deliberately scopes `/` to include sign-in; source repro: both sign-in pages have visible `/` links. Narrow web-only PR #289 updates `client-ios.js`, adds six offline browser proof cases. Native compiled app PR #259 is a different owner and separate test | **FAIL ON MAIN — PR #289 PENDING CI; NOT LIVE PROVED** |
| Confirmation | Portal/email/SMS confirm the same call; saved CRM bit; non-delivery and wrong-phone handling | 2026-10-26 manual confirm mismatch | **NOT LIVE PROVED** |
| Setter dashboard | Lead queue, task attribution, New/Booked/No-show state, Log Dial, checklist and saved closer handoff | NOT captured by dated Oct10 surface catalog; source reviewed in Undo backlog | **NOT LIVE PROVED** |
| Setter dashboard | Accidental Log Dial Undo, idempotent action ledger, correct Phoenix-day KPI reversal | Backlog PR #269 design only | **NOT LIVE PROVED** |
| Sales floor | Sales-manager role dashboard: same client/call across staff, KPI/recording/no-show counts | Not present in dated 5-file surface catalog | **NOT LIVE PROVED** |
| Closer cockpit | Call join, Present, Meet/transcript/recording match, 32-dollar consent and sample CRS personal+business | PRs #147/#148 merged but no final real-customer cross-role proof | **NOT LIVE PROVED** |
| Offers | Decision vs verified money; repair/funding/Blueprint price, agreement, link, financing, declined/downsell/referral/rebook | Do not mistake offer accepted for collected cash | **NOT LIVE PROVED** |
| Payments | Exact paid verified receipt and replay/failure -> correct funding, repair, Blueprint entitlement, task and docs | No live provider receipt+staff handoff proof for all three | **NOT LIVE PROVED** |
| Messages | One buyer ID across setter/closer/advisor/repair/CSM/AI/client, saved inbound/outbound, refresh and unread | PRs #254/#255 active | **NOT LIVE PROVED** |
| Messages | Delivery receipt versus queue, quiet hours/opt-out, failure/retry/idempotency, attachment/docs, no cross-tenant leak | PR #254 active; live provider delivery prohibited for tests | **NOT LIVE PROVED** |
| Native iPhone | Independent installed build, WKWebView sign-in/session, push and first-open (CTA not install) | Dedicated native agent owns verification, tracking future only | **NOT LIVE PROVED** |
| Native Mac | Independent release/install/version and role/login/popup checks | Dedicated native agent owns this lane | **NOT LIVE PROVED** |
| Shared SOP document icon | Staff shortcuts to Company Brain, scoped by role/org, navigation back | Delegated to PR #257; do not duplicate | **NOT LIVE PROVED** |
| Failure/replay | Two-tenant and wrong-owner inputs, lost ACK and concurrent payment/booking replay, no fake live metrics | Scratch PostgreSQL only, no production write | **NOT LIVE PROVED** |
| Production readback | Real role views and deployment-after-merge, no mutation of real clients | Only authorized read-only proof may count | **NOT LIVE PROVED** |

## Per-surface nondecorative controls — catalog baseline

Dated snapshot: **561 recorded controls, 39 candidate route/chrome groups**. These are NOT a claim of exhaustive October 29 live route coverage. One control row = one independent acceptance item; action validation must later attach browser/live proof and change its verdict. References to client-facing `financeos` and specialist desks do not authorize changes to paid Blueprint logic or fulfillment execution.

### calendar.html — staff / assigned role (16 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page open: open tasks read | GET /api/tasks?done=false&limit=200 | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: finished tasks read | GET /api/tasks?done=true&limit=200 | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: Who's On Today coverage rail | GET /api/shifts?roster=1 | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Day / Week segmented control |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Previous day / week (‹) button |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Next day / week (›) button |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Today button |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Week strip day picker (7 days, click or Enter) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Then row (click to load into Up Next) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Timeline event block (click to select) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Join Call button (opens meeting_url in new tab) |  | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Client file button (opens client-control-panel.html?client_id=) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Claim button (timeline rows and No-date rail) | PATCH /api/tasks {id, claim:true} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Mark done button (timeline rows and No-date rail) | PATCH /api/tasks {id, done:true} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Stat tiles: Booked, Done, Left today, No date (display) | GET /api/tasks | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Up Next panel: countdown, client, briefing text (display) | GET /api/tasks | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |

### client-control-panel.html — staff / assigned role (55 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page open: client file read (name, status, tiles, next action, blockers, round, facts) | GET /api/dashboard/client?id= | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Client picker select (200 clients, navigates to ?id=) | GET /api/dashboard/clients?limit=200 | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Do-this-next headline and why/note lines (display) | GET /api/dashboard/client?id= | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Active blockers list and blocked-age (display) | GET /api/dashboard/client?id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Funding round grid (round, finalized, status, approved amount, hold reason, opened) | GET /api/dashboard/client?id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Mark round submitted button | POST /api/pipeline-cards {action:move, stage:round_submitted} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Mark funded… button, amount box, Save funded, Cancel | POST /api/pipeline-cards {action:move, stage:funded, funded_amount} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Close round button | POST /api/pipeline-cards {action:move, stage:closed} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Funding Apply door: lender list (matches for this client) | GET /api/read/lender-matches?client_id= | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Apply button (proxy launch, opens bank page) | POST /api/proxy/launch,POST /api/proxy/end | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Approved $ amount input | POST /api/applications | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Approved button | POST /api/applications {status:Approved, approved_amount} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Declined button | POST /api/applications {status:Denied} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Pending button | POST /api/applications {status:Applied} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason) | POST /api/applications {action:exclude_approval\|reinstate_approval} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Bank email amount suggestion buttons (one click fills the amount box) | GET /api/read/bank-inbox?client_id=&limit=50 | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Waiting count headline (bank yes with no amount) | GET /api/applications?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Consent state line and Record consent link | GET /api/consent/capture?client_id=&kind=soft_pull_consent | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Identity-on-file state line and client approval link box + Copy link | GET /api/consent/capture | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Pull TransUnion button | POST /api/finance/crs-pull {bureau:tu} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Pull Experian button | POST /api/finance/crs-pull {bureau:ex} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Pull Equifax button | POST /api/finance/crs-pull {bureau:eq} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Issue Inquiry Removal button (opens a case, goes to Inquiry Remover) | POST /api/inquiry-cases {action:create} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Send portal sign-in link button (owner/admin) | POST /api/auth/send-portal-link | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Authorized rep: Add this person to the file button and Name/Email/Phone inputs (owner/admin) | POST /api/auth/authorized-rep | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Authorized rep: Take them off this file button | POST /api/auth/authorized-rep {remove:true} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Businesses cards: Save month/year button (stamp incorporation) | POST /api/soft-pull-approve {action:stamp_incorporated} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Need action list (other clients with open removal cases; link per client) | GET /api/read/inquiry-cases | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Inquiries on the credit file tile and bank-names note (display) | GET /api/dashboard/client?id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Agent context toggle and pre block (what the AI sees) | GET /api/read/agent-context?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Credit & Hold Status toggle (credit status, income estimates, hold reason) |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Details toggle (email, phone, tier, path) |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Notes textarea and Save notes button | POST /api/client-notes | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Documents toggle, drop zone, file input, drag and drop upload | POST /api/documents-upload | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Open FinanceOS link (owner, admin, sales_manager only) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| More menu: Open Funding Matrix link |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| More menu: Open Credit Snapshot link |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| More menu: Open Bank Inbox button | GET /api/read/bank-inbox?client_id=&limit=100 | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Combined prequal read | GET /api/read/blueprint-combined-approval?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Add credit partner button and First/Last/Email/Phone inputs | POST /api/blueprint/staff-actions {action:create_credit_partner} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Save ready date button | POST /api/blueprint/staff-actions {action:set_next_sequence_date} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Offer bank tracker button | POST /api/blueprint/staff-actions {action:offer_bank_tracker} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Take the offer back button | POST /api/blueprint/staff-actions {action:offer_bank_tracker, offered:false} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs) | POST /api/blueprint/staff-actions {action:add_bank_todo} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Capital Blueprint: Bank list state buttons | POST /api/blueprint/staff-actions {action:update_bank_todo_state} | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Credit partner links: Open the partner's file, Record the partner's own consent |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Record decline and build the plan button (bank, product, date, bureaus, letter text) | POST /api/blueprint/declines {action:record} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Use this email button |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Save and mark done / Skip / Open again step buttons | POST /api/blueprint/declines {action:step} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Save call date button | POST /api/blueprint/declines {action:schedule} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Save outcome button (approved amount, reapply date, notes) | POST /api/blueprint/declines {action:outcome} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Declines: Upload letter button | POST /api/documents-upload,POST /api/blueprint/declines {action:link_letter} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| System Facts toggle (last pull, scores, round, funded) |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Blueprint group toggle |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |

### client-portal.html — buyer / customer (34 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page open: session read (name, own client id, authorized-rep flag) | GET /api/auth/session | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: client file read (staff view ?id=) | GET /api/dashboard/client?id= | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: portal summary (payments, invoice due, bookings, files, letters, messages) | GET /api/read/portal-summary | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: entitlements read (which tiles are unlocked) | GET /api/read/entitlements | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: portal contracts read (Agreements tab) | GET /api/read/portal-contracts | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Welcome video player (signed URL, retry once on expiry) | GET /api/content/welcome-video | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Sign to authorize dispute letters: legal name input | GET /api/consent/capture?client_id=&kind=dispute_authorization | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Sign to authorize dispute letters: signature pad (draw) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Sign to authorize dispute letters: Clear button |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Sign to authorize dispute letters: submit button | POST /api/consent/capture {action:grant, capture_method:signature} | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Facebook wins group card (external link) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| FinanceOS card link (Open or Set up FinanceOS) | GET /api/money/ready-to-fund | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Upload door: ID and personal documents (type select, Upload button, file picker) | POST /api/documents-upload kind=client_upload | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Upload door: Inquiry documents (type select, Upload button, file picker) | POST /api/documents-upload kind=inquiry_doc | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Upload door: bureau response (type select, Upload button, file picker) | POST /api/documents-upload kind=bureau_response | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Unlock buttons (Soft pull, Funding DFY, Repair DFY, Repair trial, Deliverables, Funding Mastery; opens modal) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Unlock modal: Unlock pay now button (goes to product checkoutUrl) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Unlock modal: Ask an advisor / Talk to an advisor buttons (open chat with topic) | POST /api/chat/portal-message | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Course tiles: Open course and expand modules (Funding Mastery, Deliverables) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| What You Own: Download link per file | GET documents-download signed URL | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| What You Own: Open course button |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Account drawer tabs: Payments, Agreements, Documents, Activity, Messages |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Payments tab: Pay now link per open invoice |  | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Agreements tab: Review & sign link per contract |  | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| See exactly where your file stands link (to /progress.html) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Progress read (Activity tab and status block) | GET /api/read/client-progress | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Refer a friend: Get my link button | POST /api/affiliates/refer | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Refer a friend: Copy button |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Refer a friend: link and counts card (display) | GET /api/read/affiliate-portal | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Turn on / off notifications button (web push subscribe) | GET /api/push/key,POST /api/push/subscribe,POST /api/push/unsubscribe | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Authorized-rep file switcher buttons (one per file) | GET /api/auth/authorized-rep-file,POST /api/auth/authorized-rep-file | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Chat button (floating widget from shell.js: send message to staff) | POST /api/chat/portal-message,GET /api/chat/messages | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Staff view: Open this client in Documents link |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Demo portal (?demo=1: every card unlocked, sample data, no backend calls) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |

### closer-call.html — closer / owner (1 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Redirect page: open Closer Dashboard link and auto-redirect script |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |

### closer-dashboard.html — closer / owner (34 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page open: session read (who chip: name, role) | GET /api/auth/session | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: next booked call lookup (when no client in the URL) | GET /api/read/closer-now | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Page open: call cockpit read (who, call time, bands, credit facts, deal, up next) | GET /api/read/closer-call?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Ad lines block: Gate, Entry, Primary, Secondary (display) | GET /api/read/ad-attribution?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Join call button (opens the booked call link) |  | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Present button (opens present.html?contact= in a new tab) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Send contract button (opens panel) | GET /api/read/contracts?view=templates&active_only=1 | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Contract panel: wording select and blank-field inputs |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Contract panel: Send button | POST /api/contracts {action:create_draft},POST /api/contracts {action:send} | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Contract panel: Copy link button |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Send pay link button (opens panel; closers only) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Pay link panel: offer select and downsell/upsell select |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Pay link panel: Send pay link button (mints a checkout link, emails and texts the client) | POST /api/closer-deck {action:send_pay_link} | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Payment watch note (polls closer-call every 20 s for 5 min after a pay link) | GET /api/read/closer-call?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| What they can get bands: Conservative, Realistic, Stacked (display) | GET /api/read/closer-call | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Where they stand and The deal tables (display) | GET /api/read/closer-call | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Pre-call context block (wants, for, guessed FICO, last message, 'said:') | GET /api/read/agent-context?client_id= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Payment Calculator details toggle |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: Draw amount input | GET /api/read/tradelines?client_id=&draw= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: draw slider | GET /api/read/tradelines | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: utilization guard % input | GET /api/read/tradelines | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: Deposit input | GET /api/read/deal-math | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: Success fee % input | GET /api/read/deal-math | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: Debts to clear input | GET /api/read/deal-math | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal calculator: Minimum payment % input | GET /api/read/deal-math | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Lender matches count tile (display) | GET /api/read/lender-matches?client_id= | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Deal breakdown details toggle |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Before you close: 5 compliance checkboxes (recorded, guarantee, month-14 cliff, bank decides, incorporation verified) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Up next list (display) | GET /api/read/closer-call | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Outcome buttons 1-5: Deposit, Downsell, Callback, No show, Not a fit (also keys 1-5) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Belief failed buttons (pain, doubt, cost, desire, money, support, trust, none) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Repair referral checkbox |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Save · next call button | POST /api/call-outcomes | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| Logbar footer note (cash comes from the payment record) |  | `ping` — `desks-a.json` | **NOT LIVE PROVED** |

### company-brain.html — staff / assigned role (16 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself: staff-only chat screen loads (shell, ramp-quizzes.js, data.js) | GET /app/company-brain.html | `ping` — `desks-b.json` | **NOT LIVE PROVED** |
| Role badge (reads fh_role from localStorage; shows 'owner' or 'staff' and decides whether approval controls draw) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Send question (Send button, Enter key; Shift+Enter makes a line) | POST /api/read/company-brain {question, thread_id},OpenAI embeddings call,model call (OpenAI first, Claude fallback via src/agents/model.mjs) | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| New chat button |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Past chats list: click a chat to reopen it | GET /api/company-brain/threads,GET /api/company-brain/threads?thread_id= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Past chats rail toggle (hamburger, narrow screens) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Documents button (opens right-hand panel) and its Close button |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Add a document: '+' button then file picker (PDF, Word, Excel, PowerPoint, text; 25 MB cap) | POST /api/company-brain/upload (multipart),OpenAI embeddings call | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Files you added: list and Refresh button | GET /api/company-brain/upload | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'N waiting' pending badges (two) | GET /api/company-brain/upload (pendingCount) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Owner: Approve a waiting file (button on the file row and in the review list) | POST /api/company-brain/reviews {review_id, decision:approve} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Owner: Turn down a waiting file | POST /api/company-brain/reviews {review_id, decision:reject} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Owner: 'Waiting for your approval' panel and its Refresh button | GET /api/company-brain/reviews | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Answer source list: 'Open in Drive' link and 'Client record' link | navigates to Drive webViewLink,navigates to client-control-panel.html?client_id= | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Class quiz: 'Which quiz' picker |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Class quiz: answer boxes and 'Check answers' (scored in the browser, nothing saved) |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### consent-capture.html — staff / assigned role (11 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself loads with ?client_id= (and ?kind=) | GET /app/consent-capture.html | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Consent wording, version badge and current status banner (read from the server, never typed in the page) | GET /api/consent/capture?client_id=&kind= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Back link (to Client Control Panel, or to Client Portal for dispute_authorization) | navigates | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| How did they agree: 'They typed their name' / 'They ticked a box' / 'They signed' buttons |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Name box, Expires date box |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Signature pad (draw) and its Clear button; empty pad refused |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Record consent: soft_pull_consent (the key to a paid credit pull) | POST /api/consent/capture {action:grant, kind:soft_pull_consent} | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Record consent: dispute_authorization (signature; lets letters be prepared) | POST /api/consent/capture {action:grant, kind:dispute_authorization, capture_method:signature} | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Record consent: call_recording | POST /api/consent/capture {action:grant, kind:call_recording} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Record consent: marketing_use (permission to use what the client said in ads) | POST /api/consent/capture {action:grant, kind:marketing_use} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt) | POST /api/consent/capture {action:revoke, consent_id, reason} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### contracts.html — staff / assigned role (15 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself loads; lists contract wordings | GET /api/read/contracts?view=templates | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Wording list: click a row to edit it | GET /api/read/contracts?file=template&template_id= (PDF rows) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| New wording button and editor boxes: short name, name, type, filing label, the words, signature sentence |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Editor: 'Blanks you fill in when sending' rows (key, label, needed) and Add a blank / x |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Save (create a new wording) | POST /api/contracts {action:create_template} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Save (edit an existing wording) | POST /api/contracts {action:save_template, id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Archive / Turn back on | POST /api/contracts {action:archive_template, id, active} | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Cancel button |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Upload a PDF: button, file picker, name prompt | POST /api/contracts {action:upload_template, template_key, filename, file(base64)} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| PDF editor: field type chips (Text, Date, Tick box, Signature, Initials), Belongs to, Filled from, selected-box name / kind / signer / source / must-fill / Remove |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| PDF editor: Add a signer |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| PDF editor: Save boxes | POST /api/contracts {action:save_fields, id, fields, signer_roles} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| PDF viewer (pdf.js, vendored) | GET /vendor/pdfjs/pdf.min.mjs | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Link: 'Documents' (see contracts already sent) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### csm-queue.html — CSM / advisor (11 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself loads: 'My queue' for the client success role | GET /app/csm-queue.html | `ping` — `desks-b.json` | **NOT LIVE PROVED** |
| Queue list: one card per waiting call (client, call title, due time, late chip, balance owed chip, owned products) | GET /api/read/csm-queue | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Headline count 'N calls waiting' and 'N calls past due' line |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Start shift / End shift button | GET /api/shifts,POST /api/shifts {action:clock_in\|clock_out} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Claim this call button | PATCH /api/tasks {id, claim:true} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Write down their answers button (opens the interview form; 'Hide answers' closes it) | GET /api/read/customer-insights?limit=1 (question bank) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Interview form: 'How did you speak to them' select, one answer box per question, 'Anything else' notes box |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Save these answers button (needs at least one answer) | POST /api/customer-insights {client_id, task_id, stage, channel, answers, notes} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Client name link (to Client Control Panel) and the footer / empty-state links |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Booking link button (when the task carries a meeting url) | navigates to row.meeting_url | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Banner area (success and error messages for shift, claim, save) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### documents.html — staff / assigned role (16 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself loads (optionally ?client_id=); owner/admin with no client is redirected to the primary demo client in demo mode | GET /api/read/documents?limit=200[&client_id=],GET /api/demo/mode (demo-client-bootstrap.js, owner/admin) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Summary tiles: total, awaiting signature, undelivered; and the 'N past 14 days' stale chip |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Class cards (5: soft-pull authorizations, contracts, invoices, UnderwriteIQ deliverables, uploads): click to filter, click again to clear |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Class tabs (All plus the 5 classes) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Pending only' toggle button |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Status filter select (not delivered, bounced, awaiting signature, signature expired) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Filter box (client or document name) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Column header sort (7 sortable columns) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Document table rows: generated / delivered / signature badges and age pending | GET /api/read/documents | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Download button on a document row (mints a 15-minute signed link, opens a new tab) | GET /api/documents-download?id= | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Contract cell: status badge (draft, sent, opened, signed, void) | GET /api/read/contracts?view=contracts&document_id=<chunks of 200> | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Contract cell: Open PDF button (signed copy when one exists) | GET /api/read/contracts?file=contract&id=&signed= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Contract cell: Remind button (re-sends the signing request to one signer) | POST /api/contracts {action:remind, id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Contract cell: Void button (asks for a reason in a prompt; owner/admin only) | POST /api/contracts {action:void, id, reason} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Role lookup that decides whether Void is drawn | GET /api/auth/session | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Result strip under the table (server's own words after Remind, Void, Open, Download) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html (frame) — buyer / customer (6 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page itself loads (static HTML, 17 section scripts, then financeos.js) | GET /app/financeos.html,GET /app/money*.js, financeos.js, money-*.css | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Header: client name, and the 'Test data - Plaid sandbox' banner (from the one overview read) | GET /api/money/overview | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Back link ('Back to my portal' for a client, 'Back to Finance OS' for staff with ?client_id=) | navigates to client-portal.html or finance-os.html?client_id= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Tab bar: 16 tabs (Overview, Next steps, Money helper, Money moves, Plan, Banks, Strategy, Fundability, Applications, Alerts, Funding papers, Accounts, Credit, Connections, Payments, Setup); Left/Right/Home/End keys; #hash opens a tab |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Sign-in redirect on any 401 (client to /portal-login.html, staff to /login.html, back to the same tab) |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff view: who may open this page and which client is carried |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#accounts — buyer / customer (7 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Containers and accounts read (businesses with their info, 'you', 'Not sorted yet', a 'Move to...' on every bank row) | GET /api/money/accounts | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Connect a bank button (Plaid Link; same flow as Overview) | POST /api/banking/link-token,Plaid Link script,POST /api/banking/link-exchange | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Add account' and 'Add a business' buttons that open the forms |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Add account form (name, type: checking, savings, credit card, loan; last 4 only; due day and minimum for loans) | POST /api/money/accounts {action:add_account, name, type, ...} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Add a business form and 'Save business info' (name, entity type, EIN last 4, etc.) | POST /api/money/accounts {action:create_business\|save_business, name, info} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Add personal container' form | POST /api/money/accounts {action:create_personal, name} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Move to...' select on each account (assign or unassign a container) | POST /api/money/accounts {action:assign\|unassign, account_id, container_id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#alerts — buyer / customer (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| File protection alerts read: what each of four texts watches, when it texts next, what already went out | GET /api/money/alerts | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| On/off switch for each of the four alerts (payment timing, promo ending, cash cushion, new credit) | POST /api/money/alerts {action:set_alert, kind, enabled} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Statement close day: 'Change day' / 'Save day' / 'Cancel' per card and 'Save days' (batch) | POST /api/money/alerts {action:set_statement_close_day, account_id, day} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Promo: 'Edit promo' / 'Save promo' (end date, APR) / 'Remove this promo' (asks first) / 'Keep it' | POST /api/money/alerts {action:set_promo, account_id, ends_on, apr_pct} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Show all' on the texts-sent list, jump links, Try again |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#banks — buyer / customer (6 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Banks near you, Card stacking order, Next funding sequence date, Your bank relationships (each rule with its source) | GET /api/money/banks | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Add to plan' on a bank card and 'Add bank to plan' form (bank, kind, container, day to open, deposit) | POST /api/money/banks {action:plan_bank} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Mark opened' / 'Save the day opened' | POST /api/money/banks {action:open_account, relationship_id, opened_on} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Add deposit' (amount, day) | POST /api/money/banks {action:record_deposit, relationship_id, amount_cents, deposited_on} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Skip this bank' | POST /api/money/banks {action:set_state, relationship_id, state:skipped} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Save date' for the next funding sequence ready date | POST /api/money/banks {action:set_next_sequence_date, ready_date} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#connections — buyer / customer (6 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Connections read: tiles, three processor cards (Commas, Whop, open API), month table per container, sales line under the section | GET /api/money/connections,GET /api/money/trends?range=12m (sales line) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Connect Commas / Connect Whop / Connect open API (entity select and mode select: paste a key or webhook) | POST /api/money/connections {action:create, provider, entity_id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Save key' (client pastes their processor API key; cleared as soon as sent) | POST /api/money/connections {action:api_key, connection_id, api_key},processor API call (Commas or Whop) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Sync now' button | POST /api/money/connections {action:sync, connection_id},processor API call | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Save secret' (webhook secret) and 'Disable' (asks first) | POST /api/money/connections {action:secret\|disable, connection_id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Copy address / Copy key buttons |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#credit — buyer / customer (2 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Credit page read (score per bureau, history line from two or more pulls, UnderwriteIQ sentences, sample-report warning) | GET /api/money/credit | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Try again; link to Setup |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#declines — buyer / customer (2 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Applications list: past declines with reasons, quotes and next steps | GET /api/blueprint/declines | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Paste a decline letter: bank select, bank name box, letter box, 'Read my decline' button | POST /api/blueprint/declines {action:paste, text, bank} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#fundability — buyer / customer (2 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Fundability picture (score path, what to fix) read only | GET /api/money/fundability | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Chart columns (hover or focus shows a month) and Try again |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#helper — buyer / customer (4 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Thread: each message, the helper's answer, which brain answered, and cards for what it did; polls the read every 3 seconds while a turn is queued | GET /api/money/helper (polled) | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Send: message box, Send button, Enter key (20,000 character cap) | POST /api/money/helper {action:send, message, client_id?},model call (AI or rules fallback) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Suggestion buttons (3: due this week, which card first, got declined paste the letter) | POST /api/money/helper {action:send} | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Check again' button (when a turn looks stuck) and Try again | GET /api/money/helper | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#next — buyer / customer (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Next steps list: each task with status, due date, who can do it (agent, person, self) | GET /api/money/tasks | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Do task' button on a step the helper or a person can do | POST /api/money/tasks {action:do_task, task_id, client_id?} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task) | POST /api/money/ready-to-fund {client_id?} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Links: 'Open your checklist', 'Check your accounts', 'Book a call' |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Try again buttons (tasks, ready-to-fund) | GET /api/money/tasks,GET /api/money/ready-to-fund | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#overview — buyer / customer (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Overview read: 'What you have' (personal, business, not sure yet, never added together), 'What you owe', 'Cards used', 'Next due' | GET /api/money/overview | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Overview read: Tip, Coming up, Repeating bills, Containers, Debt (by container, by card, by loan), Cashflow charts, plan billing line | GET /api/money/overview | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Connect a bank button (header, and again in the empty state) - opens Plaid Link | POST /api/banking/link-token,https://cdn.plaid.com/link/v2/stable/link-initialize.js,POST /api/banking/link-exchange | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Try again button (overview failed to load) | GET /api/money/overview | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Trends: 30 days / 90 days / 12 months buttons (choice kept in sessionStorage) and Try again | GET /api/money/trends?range=30d\|90d\|12m | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#payments — buyer / customer (4 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Payments read: what is owed (Clarity Payments, buy-now-pay-later, other), schedule, coming up, helper's log, unmatched Commas payments (staff only) | GET /api/money/payments | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Talk to a person' button | POST /api/money/payments {action:ask_for_person} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Record payment' (amount) and 'Mark settled' | POST /api/money/payments {action:record_payment\|mark_settled, plan_id, amount_cents} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Add payment plan' (kind, owed to, name the client sees, dated schedule) | POST /api/money/payments {action:add_plan, kind, owed_to, label, schedule} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#plan — buyer / customer (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Month calendar and list of dated pins (open accounts, deposits, card and loan due dates, payments owed to Fundhub) | GET /api/money/plan?month= | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Previous month / Next month / Today buttons | GET /api/money/plan?month= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| A pin (calendar chip or list row) opens its detail panel; '+N more'; Close; Esc; Tab stays inside |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Mark done' and 'Mark missed' (asks to confirm; client sees it on their plan) | POST /api/money/plan {action:mark, source, pin_id, status} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Link: 'Add an account' (empty state), 'See it on Payments' |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#setup — buyer / customer (4 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Setup steps read (pay setup fee, run soft pull, add businesses and accounts, you're live) | GET /api/money/setup | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Pay $X setup' button (mints a hosted Commas checkout link; no price set means no button) | POST /api/money/setup {action:start_checkout},Commas createPaymentLink | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Run soft pull' button (hands back the signed soft-pull approval form) | POST /api/money/setup {action:request_soft_pull} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Try again button | GET /api/money/setup | `none` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#strategy — buyer / customer (3 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Payoff plan read (every card and loan, safe amount each month) and the live math | GET /api/money/strategy,GET /app/money-strategy-math.js | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Method buttons (highest rate first, card use first, smallest balance first), monthly amount slider and box, goal select and date, 'Use $X' buttons, 'Show more months' |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Save this plan' button | POST /api/money/strategy {action:save_plan, method, monthly_cents, goal?} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#transfers — buyer / customer (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Waiting-for-your-OK list and History table (status in words, who said yes) | GET /api/money/transfers | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Review this move, then 'Yes, move $X' (the client's approval, with the From account select) | POST /api/money/transfers {action:approve, proposal_id, amount_cents, from_account_id, to_account_id, scheduled_for} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Go back (cancels the review step) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| 'Not now' / 'Stop this move' / 'Take it off the list' (cancel a proposal; asks to confirm) | POST /api/money/transfers {action:cancel, proposal_id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Set up this move' form (to, suggested from, amount, date, what it is for) | POST /api/money/transfers {action:propose, to_kind, amount_cents, due_on, title} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### financeos.html#vault — buyer / customer (7 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Papers list: progress, two groups, each paper's status in words, 'View' link (15-minute signed link) | GET /api/money/vault | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Client: 'Send' / pick-file button on a paper (one or many files) | POST /api/documents-upload (multipart: file, subtype, entity_id, item fields) | `deep` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Accept' (asks months or end date when the paper needs it) and 'Accept file' | POST /api/money/vault {action:accept, document_id, covers?, period_end?} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Reject' with a reason the client reads, then 'Reject file' | POST /api/money/vault {action:reject, document_id, reason} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Change' (flip an accepted file to rejected or back), 'Cancel' |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: files to sort - 'File and accept' / 'Reject' with the paper picker | POST /api/money/vault {action:accept\|reject, document_id, item_key, entity_id} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Staff only: 'Add a paper' form (name, whose paper, why the lender wants it, file type, how many files) | POST /api/money/vault {action:add_item, title, note, entity_id, subtype, need} | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |

### inquiry-remover.html — repair specialist (post-handoff lane) (51 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page gate: inquiry_specialist, owner, admin, funding_advisor roles; setter/closer-only roles bounced | GET /api/auth/session; GET /api/read/inquiry-cases \| repair-cases (role gated) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Desk tabs: 'Inquiries' and 'Repair' (remembers the last pane in browser storage) | none (client only); Repair loads on first open | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Desk headline number + 'next' button (Ready to send / Need me; opens the next case or file) | none (client only; opens a row) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Case queue table: one row per inquiry removal case, oldest first (Client, Waiting, Bureau, Items, Status, Docs, Delivery, Call, Round) | GET /api/read/inquiry-cases?active_only=true&limit=500 | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Case statuses shown in the Status column: Queued, Scheduled, In Progress, Escalated, Blocked, Completed, Canceled | GET /api/read/inquiry-cases | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Show more' button under the case queue (25 rows a time) | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Case row: click or Enter expands the case drawer (items, letter draft, identity packet, send options) | none (client only; data came with the list) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Upload FTC or police report' (file input + button; attaches as additional_fraud_docs) | POST /api/documents-upload {client_id, subtype:'additional_fraud_docs'} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Generate letters' button (writes inquiry items from the credit file; mails nothing) | POST /api/inquiry-cases {id, action:'generate'} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Open documents' link (documents.html?client_id=) | navigates | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer send options: 'Mail letter (PostGrid)' checkbox, 'Mail service' select (bureau default, first class, priority, priority express), Experian portal reference input, 'Upload to Experian portal' checkbox, 'Open Experian upload' link | none until Send | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Send' button (letter to the bureau by PostGrid mail and/or Experian portal; refused while the identity packet is short) | POST /api/inquiry-cases {action:'send', mail, portal, portalConfirmation, mailServiceLevel} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once fired) | POST /api/inquiry?action=launch {id} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Mark cleared' button (case Completed; emits inquiry.removed) | POST /api/inquiry-cases {action:'mark_cleared', id, case_status:'Completed'} | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Case drawer: 'Close' button (case Canceled) | POST /api/inquiry-cases {action:'close', id, case_status:'Canceled'} | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Bureau chips: Equifax, TransUnion, Experian (filter the work queue; show open counts) | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Call state, Hold, Attempts, Status) | GET /api/read/inquiries?limit=200 | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Stat tiles: Still open, Worked, Calls, Confirmed (move by the server's counts after each write) | none (client counters) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Work row: click or Enter expands the work strip; loads attempt history and the masked identity line | GET /api/inquiries?inquiry_id=; GET /api/pii?client_id= | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Work strip: attempt kind select (call, letter, portal, note) + 'Log an attempt' button | POST /api/inquiries {action:'attempt', inquiry_id, kind} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Work strip: 'Mark confirmed' button (confirms removal; sets confirmed_at) | POST /api/inquiries {action:'confirm', inquiry_id} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Work strip: free-text status input + 'Set status' button | POST /api/inquiries {action:'status', status} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Work strip: expected-name input + 'Save expected' button | POST /api/inquiries {action:'expected', expected_name} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Identity line: reason input + 'Reveal SSN' / 'Hide' button (writes name and reason to the access log) | POST /api/pii {client_id, reason} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Recent Letters Issued list + 'All letters' link (documents.html) | GET /api/inquiries?recent=letters | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair tile filters: Need me, Ready to send, Waiting on bureau, Stuck, Trial ending (press again to clear) | none (client only over GET /api/read/repair-cases) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair queue table: Client, Program, Round, Stage, Needs chip, Due (need-me first, most overdue first) | GET /api/read/repair-cases | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: intake (SLA 3 business days -> chase_contract task) | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: awaiting_documents (SLA 14 days -> owner_contact_client) | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: analysis (SLA 1 hour -> engineering_engine_failure) | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: letters_generated (SLA 30 minutes -> generation_or_variance) | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: ready_to_send (SLA 4 hours -> dispatch_failure; shows as 'Ready') | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: in_transit (SLA 10 days -> check_postgrid_tracking; shows as 'Waiting') | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: awaiting_response (bureau due date + 5 days -> bureau_deadline_breach; shows as 'Waiting') | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: response_received (SLA 24 hours -> owner_reviews_parse; shows as 'Answer in') | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: round_complete (no clock; chip 'Round done - next?') | GET /api/read/repair-cases (stage pill) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: stalled (the human queue; shows as 'Stuck') | GET /api/read/repair-cases (stage pill) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: program_complete (shows as 'Done') | GET /api/read/repair-cases (stage pill) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair stage: cancelled (shows as 'Cancelled') | GET /api/read/repair-cases (stage pill) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked' button | GET /api/repair/exceptions; POST /api/repair/exceptions {action:'confirm_parse', responseId} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Retry' button when the queue fails to load | GET /api/read/repair-cases | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair row: click or Enter expands the file (items, letters this round, what is next, timeline) | GET /api/read/repair-cases?client_id= | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Letter list item in an expanded row: opens the letter drawer (letter text, rules, signature); drawer Close buttons | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Letter drawer 'Send this one' button (mails one letter) | POST /api/repair/send {mail:true, client_id, letters:[1]} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Expanded row 'Send' button (mails every sendable letter; fails closed without mail=true) | POST /api/repair/send {mail:true, client_id, letters} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Expanded row 'Stage' button (generates the round's letters; mails nothing) | POST /api/repair/generate {client_id} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Expanded row 'Soft pull' button (owner, admin, closer, funding_advisor only; opens the PULL modal) | none (client only; opens modal) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| PULL modal: type PULL, Cancel, 'Pull' (three bureau pulls in a row; stops on the first refusal; Escape closes) | POST /api/finance/crs-pull {client_id, bureau} x3 (EX, EQ, TU) | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Expanded row 'Clean personal info' button (owner and admin only; asks to confirm; cannot be undone) | POST /api/privacy/erasure {client_id, confirm_client_id, reason} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Expanded row 'Enroll' button (puts the client in the trial program; sends price_total 200 and amount_paid 200) | POST /api/repair/enroll {client_id, program:'trial', price_total:200, amount_paid:200} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Repair headline 'Open <client>' next button | none (client only; scrolls to and expands a row) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |

### messaging.html — staff / assigned role (14 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page load: inbox read (Needs-reply tab first), refreshes on a timer while the tab is visible | GET /api/read/inbox | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Tab: All | GET /api/read/inbox?limit=200 | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Tab: Needs reply (client spoke last, nobody answered; server-side filter) | GET /api/read/inbox?limit=200&needs_reply=1 | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Search box: search people and messages (client-side filter; typing drops needs_reply=1 from the server query on the Needs-reply tab) | GET /api/read/inbox?limit=200 (no q param) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Conversation list row: click opens the thread | GET /api/read/messages?conversation_id=&limit=200; GET /api/dashboard/client?id=; GET /api/read/conversations?client_id= | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Channel toggle: Email / Text buttons (open that client's other-channel conversation) | GET /api/read/conversations?client_id= | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Send this one to' address box (applies to this one message only; never written back to the record) | none until Send (payload.to) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Compose box: type reply, Enter sends, Shift+Enter newline; texting-hours notice shown before typing | none until Send | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Send button (staff reply to a client by text or email; shift clock-in required) | POST /api/messages {conversation_id\|client_id, channel, body, to?, idempotency_key} | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Held-for-quiet-hours result: text deferred to the next window and the words stay in the box | POST /api/messages (outcome deferred) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Blocked result: opt-out or restricted wording refused and a task raised for a human | POST /api/messages (outcome blocked) | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Right panel: 'Their other threads' list and 'Open elsewhere -> Their file' link | GET /api/read/conversations?client_id=; GET /api/dashboard/client?id= | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Reference disclosure (who-sent-it colour key) | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Deep links: ?client_id=, ?channel=, ?conversation_id= open a thread straight from another desk | GET /api/read/conversations; GET /api/read/messages | `ping` — `desks-c.json` | **NOT LIVE PROVED** |

### money-banks.html — buyer / customer (11 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Page gate: client reads own file; staff (owner, admin, sales_manager, closer) need ?client_id=; only staff see plan controls | GET/POST /api/money/banks | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Page load: tiles (next funding sequence date, estimated amount, bank relationships), banks near you, card stacking order, relationships table | GET /api/money/banks[?client_id=] | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Header link 'Back to my portal' and Money nav (8 links incl. Plan and Banks) | navigates to client-portal.html / financeos.html#tab | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Banks near you: per-bank 'Add to plan' form (staff): container, day to open, deposit ($, blank = book minimum) | POST /api/money/banks {action:'plan_bank', lender_id, bank, container_id, planned_open_on, deposit} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Add a bank to the plan' form (staff): bank name, kind (business/personal), container, day to open, deposit | POST /api/money/banks {action:'plan_bank'} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Relationship row (planned): 'Day opened' + 'Mark opened' form | POST /api/money/banks {action:'open_account', relationship_id, opened_on} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Relationship row: 'Skip this bank' button | POST /api/money/banks {action:'set_state', state:'skipped'} | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Relationship row (opened): 'Add deposit' form (amount $, day) | POST /api/money/banks {action:'record_deposit', relationship_id, amount_cents, deposited_on} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Next funding sequence 'Save date' form (staff; Blueprint buyers only) | POST /api/money/banks {action:'set_next_sequence_date', ready_date} | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Card stacking order and bank rules with their source tags (display) | GET /api/money/banks | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| 'Try again' button on a load error | GET /api/money/banks | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |

### public/app/chat-widget.js (mounted by shell.js on the same desks; skipped for partner and affiliate roles) — shared staff chrome, portal where mounted (5 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Chat button (opens and closes the panel) and close x | no request | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Mode tabs: Ask system / Knowledge / Message | no request until Send | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Ask system / Knowledge: type a question and press Ask or Enter | POST /api/chat/ask {mode, question} -> model call | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Message > Staff (internal): pick a teammate and send | GET /api/chat/peers; GET /api/chat/messages?kind=internal; POST /api/chat/messages {kind:internal, peer_staff_id, body}; polls every 4 s | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Message > Client: paste a client id and send (goes through the compliance gate as a text) | POST /api/chat/messages {kind:client, client_id\|conversation_id, channel:sms, body} -> composeAndSend | `ping` — `desks-e.json` | **NOT LIVE PROVED** |

### public/app/my-numbers.html — owner / sales manager (10 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Open the page (closer sees own numbers; owner, admin, sales_manager may pass ?staff_id=) | GET /api/auth/session (shell + name chip); GET /api/read/my-numbers via FHData.read('my-numbers') | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Cash collected this month, target, rank X of N, progress bar | GET /api/read/my-numbers (pace) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Offer stack table: product, units sold, amount sold, cash collected, totals, retired product, reason when unknown | GET /api/read/my-numbers (offer_stack) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| This month vs last month grid: deposits closed, close rate, show rate, downsells, deposit to funded, avg funded (always a dash), calls held, unlogged | GET /api/read/my-numbers (month) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Money boxes: Paid out, Pending funding, At risk (always a dash: not computed) | GET /api/read/my-numbers (money) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Streak strip (always the sentence: daily close streak is not stored yet) | GET /api/read/my-numbers (streak) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Team this month leaderboard (rank, name, deposits, cash, close rate; you highlighted) | GET /api/read/my-numbers (team) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Call quality panel (reason text: call recording and transcription do not exist yet) | GET /api/read/my-numbers (call_quality) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Owed by you: unlogged calls and quiet deposits, each row a link to closer-dashboard.html?client_id=&task_id= | navigation to closer-dashboard.html?client_id=&task_id=; data from GET /api/read/my-numbers (owed[]) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| On shift / Off shift chip and staff name chip in the header | GET /api/read/my-numbers (shift); GET /api/auth/session | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |

### public/app/ops-admin.html — owner / sales manager (22 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Open the page (owner and admin only: ops-admin.html is in OWNER_ADMIN_ONLY and NAV_HIDDEN in shell.js; other roles are bounced home) | GET /api/auth/session; then data reads below | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Period pill: Today / Last 7 Days / Last 30 Days / Quarter to Date (menu, Escape closes) | GET /api/dashboard/kpis?period=; GET /api/read/ops-pulse?period= | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Company KPI tiles: Cash Collected, Funded, Close Rate with show rate, Cost / Funded, New Clients | GET /api/dashboard/kpis?period= | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Today's briefs card: CEO brief, Chris brief, discovery line, hire line with LinkedIn status, ad spend line, fire/raise/bonus line | GET /api/read/ops-pulse?period= | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Write today's C-suite tasks (button, shown only when the calendar is packed, a gap is short, or ad spend is above zero) | POST /api/ops/hire-closer | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| hire-closer (server): writes hire / diagnose / ads-review tasks and, when LinkedIn is connected, posts the closer job on LinkedIn | POST /api/ops/hire-closer -> actOnBrain -> postJob (LinkedIn) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR + Collections table: client, invoice INV-xxxx, amount owed, overdue, status (top 25, total line) | GET /api/read/invoices?status=open&limit=50 | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR column header sort (click or Enter on Client, Invoice, Amount owed, Overdue, Status) | none (client-side) | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| AR row expand (terms, payment method, owner, outstanding, collection history) | none (client-side) | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| Compliance Gate table: messages it stopped (client, channel, reason, when; top 15) | GET /api/read/messages?status=blocked&limit=30 | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Failed events tile (appended to the KPI grid: N failed events awaiting retry) | GET /api/read/failed-events?status=pending&limit=200 | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Outbound mail panel: waiting / sent today / failed / held by compliance, routes, invoices never emailed | GET /api/messages-outbound | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Send what is waiting (button, confirm dialog: goes to real clients, cannot be pulled back) | POST /api/messages-outbound {action:dispatch} | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| dispatch (server): drains the queue now through the provider route and the compliance gate | POST /api/messages-outbound dispatch -> drain -> src/messaging/providers/* | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Pause sending / Turn sending on (button, confirm dialog) | POST /api/messages-outbound {action:settings, outbound_enabled} | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| settings (server): the company-wide send switch and daily cap | POST /api/messages-outbound settings -> setSettings | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Email unsent invoices (button, confirm dialog; shown only when invoices were never emailed) | POST /api/messages-outbound {action:email_invoice_backlog} | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| email_invoice_backlog (server): emails every invoice the client was never told about, bounded to 200 | POST /api/messages-outbound email_invoice_backlog -> emailOutstandingInvoices | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Zone tabs: Money / People | none (client-side) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + Hiring drawer (summary row with 'Open Affiliates' link; body is fixed text: no affiliate data yet, no hiring pipeline data yet) | navigation to affiliate.html; no data call | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Staff & Comp table (name, role, comp and this week always a dash) | GET /api/read/staff?limit=200 | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Staff Monitoring Consent table (Signed / Not yet signed, before names show on the Galaxy) | GET /api/read/staff?limit=200 (monitoring_consent_at) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |

### public/app/payment-success.html — buyer / customer (7 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Open the page after checkout (?ref=<payment reference>&client_id=<uuid>; no sign-in needed to load) | none until the poll starts; then GET /api/read/entitlements | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| The bounded check: up to 6 reads, 3 seconds apart, then stops; baseline = what was already open | GET /api/read/entitlements?limit=200[&client_id=] | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| State shown: Just opened on your account / Nothing new has opened yet / Nothing is open yet / cannot check (signed out) / cannot tell which account / could not reach your account | GET /api/read/entitlements | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| The feed it reads: entitlements opened by a payment | GET /api/read/entitlements | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Check again (button after the 6 tries, starts one more round) | GET /api/read/entitlements | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| Back to your portal (link, carries client_id) | navigation to client-portal.html?client_id= | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Payment reference line (shows ?ref= as text) | none | `none` — `desks-e.json` | **NOT LIVE PROVED** |

### public/app/pipeline.html — staff / assigned role (109 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Open the page (all staff roles; owner and admin land here; closers can open it) | GET /api/auth/session (shell); GET /api/dashboard/pipeline?key=sales on DOMContentLoaded | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-01 Sales | GET /api/dashboard/pipeline?key=sales (cached per key until a move) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-02 Funding: Card Stacking | GET /api/dashboard/pipeline?key=funding_card_stacking (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-04 Optimization (Repair) Rounds | GET /api/dashboard/pipeline?key=optimization (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-05 Inquiry Removal | GET /api/dashboard/pipeline?key=inquiry_removal (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-06 AR / Collections | GET /api/dashboard/pipeline?key=ar_collections (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-08 Affiliates + White Label | GET /api/dashboard/pipeline?key=affiliates_white_label (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail tab R-09 Hiring | GET /api/dashboard/pipeline?key=hiring (cached per key until a move) | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Headline: Waiting on us (big number, button that filters the board to cards someone here must move) | no request (counts the stages already read; sets #fWait) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Headline: Longest wait link (scrolls to that card and rings it; stops being a link when a filter hides the card) | no request (scrollIntoView) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Headline counters: on a bank / on the client / nothing recorded (3 buttons, same filter as the select) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Board summary: cards count and funding est. total (hidden on non-funding rails) | no request (summed from the stages read) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Lens switch: Board / Fulfillment | first open of Fulfillment: GET /api/dashboard/clients?limit=200&fulfillment=1 | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Search box (placeholder says name, phone, or email; the filter compares the card's name text only) | no request (hides cards on the page) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Filter button (opens the panel; count of active filters) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Filter: Waiting on (Anyone / Us / Us - an approval amount / A bank / The client / Nothing recorded) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Filter: Owner (hidden until a card has an owner) | no request | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Filter: Age (Any / Over 1h / Over 1d / Over 3d in stage) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first | no request (reorders cards in each column) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Clear all (button in the filter panel) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| The x on each active filter chip (clears that one filter) | no request | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| New Client (button opens the modal: name, email, phone, product with 6 choices; Save / Cancel; same save as the apply form) | POST /api/pipeline-clients {name, email, phone, product} | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| pipeline-clients (server): creates or finds the client through the funnel door and emits entry.captured, which sends the welcome email and text and places the Sales card | POST /api/pipeline-clients -> resolveClient + emit entry.captured -> s-00-welcome, s-01-new-lead-intake, s-02-incomplete-survey-nudge (20 min) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Rail note on Sales: Closed Won follows a paid funding deposit | none | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'New Lead' (new_lead): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:new_lead, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Survey Complete' (survey_complete): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:survey_complete, from_pipeline_ke | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Booked' (booked): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:booked, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Confirmed' (confirmed): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:confirmed, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Showed' (showed): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:showed, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Diagnostic Paid' (diagnostic_paid): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:diagnostic_paid, from_pipeline_ke | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Decision Rendered' (decision_rendered): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:decision_rendered, from_pipeline_ | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Closed Won (deposit)' (closed_won): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:closed_won, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Downsell' (downsell): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:downsell, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sales column 'Lost' (lost): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=sales (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:sales, stage_key:lost, from_pipeline_key} | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Apply Now' (apply_now): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:a | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Round Submitted' (round_submitted): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:r | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Approved' (approved): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:a | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Action Required' (action_required): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:a | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Funded' (funded): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:f | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Funding: Card Stacking column 'Closed' (closed): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=funding_card_stacking (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:funding_card_stacking, stage_key:c | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Intake' (intake): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:intake, from_pipeli | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Awaiting Documents' (awaiting_documents): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:awaiting_documents, | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Analysis' (analysis): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:analysis, from_pipe | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Letters Generated' (letters_generated): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:letters_generated,  | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Ready to Send' (ready_to_send): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:ready_to_send, from | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'In Transit' (in_transit): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:in_transit, from_pi | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Awaiting Response' (awaiting_response): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:awaiting_response,  | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Response Received' (response_received): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:response_received,  | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Round Complete' (round_complete): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:round_complete, fro | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Program Complete' (program_complete): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:program_complete, f | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'On Hold' (on_hold): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:on_hold, from_pipel | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Stalled' (stalled): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:stalled, from_pipel | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Cancelled' (cancelled): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:cancelled, from_pip | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Round Sent (legacy)' (round_sent): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:round_sent, from_pi | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Bureau Processing (legacy)' (bureau_processing): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:bureau_processing,  | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Portal Updated (legacy)' (portal_updated): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:portal_updated, fro | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Optimization (Repair) Rounds column 'Upgrade Invite (legacy)' (upgrade_invite): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=optimization (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:optimization, stage_key:upgrade_invite, fro | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Requested' (requested): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:requested, fr | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Specialist Assigned' (specialist_assigned): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:specialist_as | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Awaiting Documents' (awaiting_documents): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:awaiting_docu | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Letters Sent' (letters_sent): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:letters_sent, | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Calls In Progress' (calls_in_progress): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:calls_in_prog | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Removed' (removed): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:removed, from | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Resume Funding' (resume_funding): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:resume_fundin | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Inquiry Removal column 'Hold' (hold): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=inquiry_removal (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:inquiry_removal, stage_key:hold, from_pi | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR / Collections column 'Invoice Sent' (invoice_sent): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=ar_collections (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:ar_collections, stage_key:invoice_sent, f | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR / Collections column 'Reminder' (reminder): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=ar_collections (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:ar_collections, stage_key:reminder, from_ | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR / Collections column 'Escalation' (escalation): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=ar_collections (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:ar_collections, stage_key:escalation, fro | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR / Collections column 'Paid' (paid): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=ar_collections (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:ar_collections, stage_key:paid, from_pipe | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| AR / Collections column 'Written Off' (written_off): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=ar_collections (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:ar_collections, stage_key:written_off, fr | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + White Label column 'Recruiting' (recruiting): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=affiliates_white_label (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:affiliates_white_label, stage_key | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + White Label column 'Invited' (invited): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=affiliates_white_label (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:affiliates_white_label, stage_key | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + White Label column 'Agreement Signed' (agreement_signed): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=affiliates_white_label (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:affiliates_white_label, stage_key | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + White Label column 'Active' (active): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=affiliates_white_label (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:affiliates_white_label, stage_key | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Affiliates + White Label column 'Paused' (paused): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=affiliates_white_label (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:affiliates_white_label, stage_key | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Applied' (applied): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:applied, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Screening' (screening): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:screening, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Group Interview' (group_interview): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:group_interview, from_pipeline_ | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column '1:1 Interview' (one_on_one): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:one_on_one, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Offer' (offer): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:offer, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Hired' (hired): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:hired, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Onboarding' (onboarding): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:onboarding, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Ramp (60-day trial)' (ramp): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:ramp, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Performing' (performing): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:performing, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Not Moving Forward' (rejected): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:rejected, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Hiring column 'Withdrawn' (withdrawn): shows count and funding est.; accepts a dropped card | GET /api/dashboard/pipeline?key=hiring (column paint); drop target: POST /api/pipeline-cards {action:move, client_id, pipeline_key:hiring, stage_key:withdrawn, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: click the card body (opens the right-hand client drawer) | GET /api/dashboard/client?id=; GET /api/read/ad-attribution?client_id= | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: drag the card (pointer) to another column on the same rail | POST /api/pipeline-cards {action:move, client_id, pipeline_key, stage_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| pipeline-cards move (server): staff move a client's card to a stage, owners exempt from the shift gate, other org is 404, a Funded move needs a dollar amount | POST /api/pipeline-cards -> moveCardToStage (+ round.* events on Card Stacking) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: MOVE button (opens the route menu for that card) | no request until a destination is chosen | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| MOVE menu: Card Stacking -> funding_card_stacking / apply_now (starts a funding round and texts the client) | POST /api/pipeline-cards {action:move, pipeline_key:funding_card_stacking, stage_key:apply_now, from_pipeline_key} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| MOVE menu: Repair Rounds -> optimization / round_sent | POST /api/pipeline-cards {pipeline_key:optimization, stage_key:round_sent} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| MOVE menu: Inquiry Removal -> inquiry_removal / requested | POST /api/pipeline-cards {pipeline_key:inquiry_removal, stage_key:requested} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| MOVE menu: Mark Lost -> sales / lost | POST /api/pipeline-cards {pipeline_key:sales, stage_key:lost} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| MOVE menu: AR / Collections -> ar_collections / invoice_sent | POST /api/pipeline-cards {pipeline_key:ar_collections, stage_key:invoice_sent} | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero) | no request until a valid dollar amount; then funded_amount in the same POST /api/pipeline-cards | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: DEL button then modal 'Archive this contact?' (type DELETE, Archive / Cancel) | POST /api/dashboard/client-archive {client_id, confirm:'DELETE'} | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| client-archive (server): removes every card and stamps crm_archived_at; payments and credit pulls stay | POST /api/dashboard/client-archive | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: SMS and email lines (links to messaging.html?client_id=&channel=, red 1 badge when the client wrote last) | navigation to messaging.html?client_id=&channel=sms\|email | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: hover tooltip (last activity from the card footer) | none | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| Card: 'Amount needed' chip (approval with no dollar amount) | GET /api/dashboard/pipeline (approval_amount_missing) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Drawer: Contact, Call, Credit (three bureau scores, income estimates, business score), Businesses, Path, How they got here, Survey sections | GET /api/dashboard/client?id=; GET /api/read/ad-attribution?client_id= | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Drawer: Open full file link (client-control-panel.html?id=) | navigation | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Drawer: Archive and Close buttons, Escape key | Archive -> same modal as DEL; Close and Escape close the drawer | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Fulfillment lens: six tiles (Total clients, Needs Pull, Action Needed, Ready, Total Prequal, Total Approved) | GET /api/dashboard/clients?limit=200&fulfillment=1 | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Fulfillment lens: client rows with next-action chip, blocker pills and funding round line | GET /api/dashboard/clients?fulfillment=1 | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Fulfillment lens: click a chip to show only that action; Show all clears it | no request | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Clock (Arizona time) and LIVE pill in the header | none | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| proxy-apply.js (Oxylabs residential proxy door) is loaded on this page; nothing on pipeline.html calls FHProxyApply | none from this page (the script defines /api/proxy/launch and /api/proxy/end callers used elsewhere) | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |

### public/app/shell.js (shared chrome on my-numbers, ops-admin, partner-galaxy, partner-training, pipeline) — owner / sales manager (19 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Role gate: cached role bounces a role that may not open this page; session answer is authoritative; no session sends to the sign-in page | GET /api/auth/session | `deep` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Home' header (fold/unfold) and its links: partner-galaxy.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Sales' header (fold/unfold) and its links: pipeline.html, closer-dashboard.html, my-numbers.html, sales-floor.html, calendar.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Funding' header (fold/unfold) and its links: lenders.html, client-control-panel.html, finance-os.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Client ops' header (fold/unfold) and its links: csm-queue.html, consent-capture.html, messaging.html, documents.html, inquiry-remover.html, company-brain.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Watch' header (fold/unfold) and its links: galaxy.html, ops-admin.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Automation' header (fold/unfold) and its links: agent-editor.html, automations.html, journeys.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Marketing' header (fold/unfold) and its links: marketing-command-center.html, campaign-manager.html, social-studio.html, creative-factory.html, content-admin.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Admin' header (fold/unfold) and its links: staff-teams.html, hiring.html, products-commissions.html, contracts.html, brand-studio.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar group 'Portals' header (fold/unfold) and its links: client-portal.html, affiliate.html | navigation to each desk; rows hidden by role (gateLinks) and by NAV_HIDDEN | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Sidebar logo link (to pipeline.html) and collapse button (to icon strip; closes the drawer on a phone) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Menu button and scrim on a phone (opens and closes the off-canvas sidebar) | no request | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Search button and overlay (Cmd or Ctrl K): type to search clients, contracts, documents, conversations, pipeline cards; hits are links | GET /api/read/search?q= | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Account chip: add or change your photo (hidden file input, PNG or JPEG) | POST /api/staff/avatar (multipart field 'photo'); then GET /api/auth/session | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Account chip: Sign out | POST /api/auth/logout (revokes the staff session and the account session; then clears fh_token, fh_demo, fh_demo_staff and goes to sign-in) | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Account chip: x hide the bar and the small 'account' button that brings it back | no request (localStorage fh_chip_hidden) | `none` — `desks-e.json` | **NOT LIVE PROVED** |
| Account chip: backend badge (LIVE / NO DB / NO API / DEMO) | GET /api/health | `ping` — `desks-e.json` | **NOT LIVE PROVED** |
| Brand paint: company colors and logo applied to the chrome | GET /api/org-brand | `e2e` — `desks-e.json` | **NOT LIVE PROVED** |
| Beta banner with Dismiss (only for owner on pages listed in BETA_PAGES; the list is empty) | no request | `none` — `desks-e.json` | **NOT LIVE PROVED** |

### shell.js (shared chrome on every staff desk) — shared staff chrome, portal where mounted (10 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Sidebar nav: links in 9 groups (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, Portals), filtered per role and by NAV_HIDDEN (hiring, journeys, finance-os, consent-capture, galaxy, partner-galaxy, ops-admin, automations, brand-studio, affiliate, agent-edit | navigates to other desks | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Sidebar group heads (collapse/expand), burger collapse, mobile menu button + scrim | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Global Search button + overlay input (type to search clients, contracts, documents, conversations, cards) | GET /api/read/search?q= | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Avatar photo upload (click avatar, choose image) | POST /api/staff/avatar | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Sign out button | POST /api/auth/logout | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Top bar status chip: LIVE / NO API / DB DOWN word (reads /api/health on load) | GET /api/health | `deep` — `desks-c.json` | **NOT LIVE PROVED** |
| Top bar chip: hide button and the small show pill | none (client only) | `ping` — `desks-c.json` | **NOT LIVE PROVED** |
| Beta banner Dismiss button (owner only) | none (client only) | `none` — `desks-c.json` | **NOT LIVE PROVED** |
| Brand paint (reads /api/org-brand, colours the chrome) | GET /api/org-brand | `e2e` — `desks-c.json` | **NOT LIVE PROVED** |
| Chat widget on every desk: Ask (AI answer), Knowledge, Message staff, Message a client | POST /api/chat/ask ; GET/POST /api/chat/messages ; GET /api/chat/peers | `ping` — `desks-c.json` | **NOT LIVE PROVED** |

### shell.js chrome (mounted on all 10 desks) — shared staff chrome, portal where mounted (6 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Sidebar: 9 group header buttons (fold) + collapse burger + 32 links (one inline copy per desk file) |  | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Global search button and overlay (types a name, opens a hit) | GET /api/read/search?q= | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Account chip: sign out | POST /api/auth/logout | `ping` — `desks-a.json` | **NOT LIVE PROVED** |
| Account chip: avatar upload | POST /api/staff/avatar | `e2e` — `desks-a.json` | **NOT LIVE PROVED** |
| Org brand paint (CRM chrome colours and wordmark) | GET /api/org-brand | `deep` — `desks-a.json` | **NOT LIVE PROVED** |
| System pill (health: LIVE, NO API, DB DOWN) | GET /api/health | `deep` — `desks-a.json` | **NOT LIVE PROVED** |

### shell.js shared chrome (on every desk here except financeos.html) — buyer / customer (10 controls)

| Control / behavior | Request or result | Prior catalog proof type | Final action verdict |
| --- | --- | --- | --- |
| Sidebar navigation: 32 static links in each desk, replaced at load by the role-filtered copy in shell.js |  | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Sidebar group headers (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, Portals) collapse and expand |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Sidebar burger (collapse to icon rail) |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Global search button and overlay (type, results, open a client) | GET /api/read/search?q= | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Account chip: Sign out | POST /api/auth/logout | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Account chip: hide (x) and 'account' show button |  | `none` — `desks-b.json` | **NOT LIVE PROVED** |
| Account chip: add or change your photo (file picker) | POST /api/staff/avatar (multipart) | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Session check on every page load (decides which links and desks this role may see; signs out when no real or demo session) | GET /api/auth/session,GET /api/health,GET /api/org-brand | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Chat widget launcher and its modes (Ask, Knowledge, Message: a teammate, or an SMS to a client by id) | POST /api/chat/ask,GET\|POST /api/chat/messages (kind internal or client, channel sms),GET /api/chat/peers | `e2e` — `desks-b.json` | **NOT LIVE PROVED** |
| Owner-only beta banner and demo-mode banner mounted by shell.js | GET /api/demo/mode (owner/admin) | `ping` — `desks-b.json` | **NOT LIVE PROVED** |

## October 30 route gap sweep — 61 source HTML files, 43 not yet itemized

**Source-verified on Oct 30 against main `df9c988b66d0`:** `public/app/` contains **61 HTML files**. This *front-house verdict document* previously itemized 18 of those pages and shared chrome, so **43 additional source paths require explicit front-house scope/verdict mapping**. This does **not** mean the old Pulse catalogs omitted those pages: across `desks-a.json` through `desks-f.json` plus `public-pages.json`, the existing **1,638 dated source-control rows** have overlapping/shared/non-front-house entries. Source cross-check found **58 of the 61 HTML page filenames already represented by at least one desk-control catalog row**; `sidebar.fragment.html` is a documented shared fragment, **not a standalone page**. Only `setter-dashboard.html` and `bank-outreach.html` lack matching historical desk-control entries. Reuse existing source/control keys for the other 58 rather than double-counting them; neither 1,638 nor 561 measures successfully verified live controls. Some are utility fragments or non-sales operational surfaces; do not count all as proven live routes or declare them out of scope without role/route inspection. No production write or outbound event was generated. This annex is a *gap registry*, **not full action acceptance**, and retains all prior controls/evidence.

| Source path (candidate, not deployed proof) | Intended/likely role (verify) | Control coverage task | Verdict |
| --- | --- | --- | --- |
| `public/app/affiliate.html` | Partner / affiliate: classify handoff boundary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/agent-editor.html` | Owner / automation ops | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/automations.html` | Owner / automation ops | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/bank-outreach.html` | Funding staff / sales-related | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/brand-studio.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/campaign-manager.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/content-admin.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/creative-factory.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/finance-os.html` | Finance staff | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/galaxy.html` | Staff knowledge / ops | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/hiring.html` | Owner / HR | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/index.html` | Staff entry / index | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/journeys.html` | Owner / automation ops | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/lenders.html` | Funding staff / sales-related | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/marketing-command-center.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-accounts.html` | Buyer FinanceOS auxiliary | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/money-alerts.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-connections.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-credit.html` | Buyer FinanceOS auxiliary | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/money-declines.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-fundability.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-helper.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-next.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-payments.html` | Buyer FinanceOS auxiliary | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/money-plan.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-setup.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-strategy.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-transfers.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money-vault.html` | Buyer FinanceOS auxiliary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/money.html` | Buyer FinanceOS auxiliary | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/morning-brief.html` | Owner / sales manager | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/partner-galaxy.html` | Partner / affiliate: classify handoff boundary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/partner-training.html` | Partner / affiliate: classify handoff boundary | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/present.html` | Closer / owner selling deck | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/products-commissions.html` | Owner / sales manager | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/sales-floor.html` | Sales manager / owner | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/setter-dashboard.html` | Setter | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/sidebar.fragment.html` | Shared fragment, not a navigable page | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/social-studio.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/soft-pull-approve.html` | Lead or buyer (token-scoped) | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/staff-teams.html` | Owner / people operations | Priority detailed action sweep below; source present | **NOT LIVE PROVED** |
| `public/app/teleprompter-remote.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |
| `public/app/teleprompter.html` | Marketing/sales content staff | Candidate route/component; source present only. Role/access/actual exposure not established | **NOT LIVE PROVED** |

### Initial source-discovered control families for the highest-risk omitted pages

`present.html` is only a 189-line mount point containing an `#app` root: its buttons are dynamically rendered by **`present.js` (2,343 lines)**, `contract-send.js` and supporting slide modules. An HTML-only control enumerator will misleadingly count zero buttons. Likewise `sales-floor.js` and inline Setter Dashboard scripts create essential runtime controls. The table below is an *action-family starting ledger*, not a claim that every dynamic/conditional control is enumerated. Each row still requires browser-permission/mobile/error tests and saved effect/provider evidence.

| Page/action family | Nondecorative controls and required outcome | Source anchors | Verdict |
| --- | --- | --- | --- |
| Setter Dashboard | Refresh queue; select a lead; next/previous queue page; empty/loading/retry | `public/app/setter-dashboard.html, inline handlers, src/setter/dashboard.mjs` | **NOT LIVE PROVED** |
| Setter Dashboard | Log Dial and count; show correct Phoenix-day KPI; accidental double click; Undo is PLANNED (no live control yet) | `public/app/setter-dashboard.html, inline data-action=log-dial; separate Undo backlog` | **NOT LIVE PROVED** |
| Setter Dashboard | Disposition; attempts; dynamic survey answers/save; qualification fields/save; intro video; no answer/double dial; reschedule link | `public/app/setter-dashboard.html, dynamic inputs/actions` | **NOT LIVE PROVED** |
| Setter Dashboard | Problem/goal, computer/app readiness, completed handoff to exactly the assigned closer; wrong org/assignee denied | `public/app/setter-dashboard.html, inline controls + src/setter/dashboard.mjs` | **NOT LIVE PROVED** |
| Sales Floor | Refresh floor; pick closer; previous/next; keyboard-activated roster; shift and manager KPI same call/client | `public/app/sales-floor.html + sales-floor.js` | **NOT LIVE PROVED** |
| Sales Floor | Today's recordings jump, Sync recordings from Drive, missing-recording counts, manager marketing flag, retry/error | `public/app/sales-floor.js` | **NOT LIVE PROVED** |
| Closer Present | Phase navigation, back/next, client-only display, objection jumps, reframe, 24-part speaking order | `public/app/present.html loads present.js (all controls dynamic)` | **NOT LIVE PROVED** |
| Closer Present | $32 soft-pull send; consent; tier/rung/BluePrint price selection and Blueprint stack decisions | `public/app/present.js data-act=softpull, tier:*, rung:*, stack:*` | **NOT LIVE PROVED** |
| Closer Present | Correct agreement selected and sent, copy signing link, amount/pay-link, invoice, duplicate-send lock/error, offer consistency | `public/app/present.js data-act=contract, contract-copy, pay, pay-optimize, invoice` | **NOT LIVE PROVED** |
| Closer Present | Stage/send letters, referral and disposition, no-show/decline/downsell callback path; replay and verified-paid vs mere click | `public/app/present.js data-act=letters, stage-letters, send-letters, disp, obj:*` | **NOT LIVE PROVED** |
| Soft-pull Approval | Signed token load; expired/malformed/other-client token; personal name/SSN/DOB/address validation; mobile states | `public/app/soft-pull-approve.html GET /api/soft-pull-approve` | **NOT LIVE PROVED** |
| Soft-pull Approval | Add/remove optional business; name/address/EIN/incorporation/owner fields; accurate total; double-submit; mock payment link | `public/app/soft-pull-approve.html POST /api/soft-pull-approve` | **NOT LIVE PROVED** |
| Buyer FinanceOS | Return to client portal; 16 keyboard/touch navigable tabs: Overview, Accounts, Payments, Money moves, Alerts, Next steps, Credit, Fundability, Strategy, Banks, Applications, Money helper, Plan, Funding papers, Connections, Setup | `public/app/financeos.html and money*.js` | **NOT LIVE PROVED** |
| Buyer FinanceOS | Paid entitlement access vs generic money overview; one buyer's saved bank action, validation/retry/privacy, return/forward mobile state | `public/app/financeos.html and money-banks.js; staff finance-os.html separate` | **NOT LIVE PROVED** |

**Remaining closure gate:** expand each of these 43 candidates into one row per actual renderable role-visible nondecorative control, classify non-route fragment/irrelevant features with reason, run deterministic browser + disposable-Postgres failure/replay tests and independently observed read-only production role-screen/provider receipts. Original `manual-e2e-2026-10-26.md` failures persist as FAIL or NOT LIVE PROVED until fresh provider evidence, not overwritten by this source sweep. Individual Google Calendar proof for owner vs Justice, verification of an exact paid funding/repair/Blueprint task+document entitlement handoff, delivery receipts, native installed build and each role's UI remain open. PR #255 was protected-merged at SHA `4203ea99f9e2` on Oct 30 with 14/14 exact-head checks; its saved-chat read remains **NOT LIVE PROVED** pending deployed client-role/receipt verification. No real SMS, charge, bureau pull or production synthetic identity was used.

### New source-keyed control catalog — two genuinely uncatalogued HTML pages

This targeted enumeration fills **new source-inventory holes**. It is not a live-page PASS. All listed controls require both (a) a real-browser role/mobile/empty/error replay case and (b) same-org, same-client or same-assigned-bank persisted/provider result evidence. When an operation can reach a provider, use mock services and throwaway PostgreSQL only; real site is read-only. Existing seven Pulse catalogs remain the canonical source lists for the other 58 pages. This table names the selectors/actions without inventing Pulse proof IDs.

| Stable new source key | Visible nondecorative control / conditional state | Source and persisted/API A→B route to test | Verdict |
| --- | --- | --- | --- |
| `setter-dashboard:refresh` | Refresh queue and fetch error **Try again**; spinner, keyboard activation, selected lead kept | `setter-dashboard.html #setter-refresh, [data-action=retry]` → `GET /api/read/setter-dashboard` → assigned lead list and today's KPIs | **NOT LIVE PROVED** |
| `setter-dashboard:queue-select` | Open one assigned client, wrong-org/removed client hidden; preserve unsaved edits on lead switch | `[data-client-id]` → selected record; `POST /api/setter-dashboard` if dirty | **NOT LIVE PROVED** |
| `setter-dashboard:queue-page` | Previous / Next 25 leads, disabled boundary, selected row identity | `[data-page=prev],[data-page=next]` → client list pagination | **NOT LIVE PROVED** |
| `setter-dashboard:call-link` | Click-to-call link uses current client's number; missing/invalid-number state | `a[href^=tel:]` inside selected lead; opening dialer is **not** a completed call | **NOT LIVE PROVED** |
| `setter-dashboard:log-dial` | Log Dial persisted once, duplicate click/lost ACK, attempts/day KPI, Undo **planned, not offered** | `[data-action=log-dial]` → `POST /api/setter-dashboard action=log_dial` → client handoff JSON and Phoenix-day `setterNumbers`; separate Undo ledger | **NOT LIVE PROVED** |
| `setter-dashboard:disposition` | Reached, no answer, rescheduled, booked-on-call; double-dial checklist conditional on no answer | `#setter-disposition, #setter-no-answer` → `action=save` | **NOT LIVE PROVED** |
| `setter-dashboard:no-answer-checks` | Voicemail and missed-text **checkbox records** are not real voicemail/SMS delivery receipts | `[name=voicemail_left], [name=missed_text_sent]` → saved checklist; external send proof separate | **NOT LIVE PROVED** |
| `setter-dashboard:intro-video` | Send intro video disabled until available/sent; quiet hours/deferred/error must not say delivered | `[data-action=send_intro_video]` → `POST /api/setter-dashboard` and message provider receipt path | **NOT LIVE PROVED** |
| `setter-dashboard:triage` | Problem and goal notes for unbooked lead; booking calendar linked to right closer | `#setter-triage-problem, #setter-triage-goal, Open booking calendar` → `action=save`, actual host calendar receipt | **NOT LIVE PROVED** |
| `setter-dashboard:survey-edit` | Dynamic single/multiple choice, nested values, Save survey answers; retry preserves edits | `[data-survey-key],[data-action=save-survey]` → `action=save_survey` → scoped client survey | **NOT LIVE PROVED** |
| `setter-dashboard:qualification` | Funding type, employment, work description, annual personal income, income-proof choices and Save setter details | `#setter-use,#setter-employment,#setter-employment-details,#setter-personal-income,#setter-income-proof,[data-action=save-details]` → `action=save` | **NOT LIVE PROVED** |
| `setter-dashboard:confirm` | Time confirmed, warmed, problem/goal, computer and app readiness; automatic save and refresh | `[name=time_confirmed],[name=frame_warmed],#setter-problem,#setter-goal,#setter-computer,#setter-app` → `action=save` | **NOT LIVE PROVED** |
| `setter-dashboard:reschedule-app` | Move call time, app-store launch; link click **not app installed** nor calendar confirmed | `Move call time, #setter-app-slot` → external booking / native first-open proof separate | **NOT LIVE PROVED** |
| `setter-dashboard:complete` | Save checklist, mark handoff complete only if required fields saved; repeated submit safe | `[data-action=save],[data-action=complete]` → `POST /api/setter-dashboard` → one scoped client handoff | **NOT LIVE PROVED** |
| `setter-dashboard:handoff-send` | Send lead-only or lead+closer confirmation after completed handoff; quiet hours and actual delivery vs queued | `[data-action=send_handoff]` → `POST /api/setter-dashboard` → outbound messages/provider receipt | **NOT LIVE PROVED** |
| `setter-dashboard:script-expand` | Voicemail/text and intro video wording expand/collapse; role source text and mobile readability | `#setter-script-help details > summary`, inlined into `#setter-no-answer` | **NOT LIVE PROVED** |
| `setter-dashboard:staff-navigation` | Sidebar Collapse / every role-allowed menu, no links to unauthorized customer records | `#burger,.navhead,.navitem` → staff route authorization | **NOT LIVE PROVED** |
| `bank-outreach:queue-filters` | Bank search, state, relationship and Clear filters, debounce, pagination, empty/no-match/error retry | `#search,#state,#status,#queue-filters,#previous,#next,#queue-retry` → `GET /api/read/bank-outreach` | **NOT LIVE PROVED** |
| `bank-outreach:next-open` | Work next banker, row Open, drawer Close, focus return after reload, own assignment | `#work-next,.open-bank,#bank-drawer,#drawer-close,#detail-retry` → `GET /api/read/bank-outreach` with account id | **NOT LIVE PROVED** |
| `bank-outreach:manager-tabs` | Bank queue, Team results, Automation; only manager may see and server must enforce role | `#view-switch,#queue-view,#team-view,#automation-view,#team-retry,#automation-retry` → `GET /api/read/bank-outreach?view=...` | **NOT LIVE PROVED** |
| `bank-outreach:drawer-sections` | Log touch, Bankers, Replies, Product facts, History, Relationship; keyboard tabs and empty state | `[data-section=touch\|contacts\|replies\|products\|history\|relationship]` → scoped detail read | **NOT LIVE PROVED** |
| `bank-outreach:touch` | Channel, banker, outcome, notes, next action/time; Save touch and next action; 409/retry | `form[data-action=log_touch]` → `POST /api/bank-outreach` → retained activity, Phoenix due-date | **NOT LIVE PROVED** |
| `bank-outreach:banker` | Add/Edit banker, validation for name and contact channels; avoid cross-bank ID | `#new-contact,[data-edit-contact],form[data-action=save_contact]` → `POST /api/bank-outreach` → bank-scoped contact | **NOT LIVE PROVED** |
| `bank-outreach:lead-review` | Accept or dismiss discovered banker; retries and idempotency across selection | `[data-accept-lead],[data-dismiss-lead]` → `accept_lead / dismiss_lead` → bank contact/lead status | **NOT LIVE PROVED** |
| `bank-outreach:reply-review` | Apply reply facts to a **draft**, dismiss suggestion, mark human reply done; source and scope | `[data-action=apply_reply_suggestion],[data-dismiss-reply],[data-reply-done]` → bank product draft/reply status | **NOT LIVE PROVED** |
| `bank-outreach:contact-warmup` | Email/text app composer link, optional touch log, external send unverified; no false claim delivered | `a[data-warmup=email\|text]` → `log_touch`; **source finding:** `bank-outreach.js:293` records `outcome='Warm-up email/text sent'` before external mailto/SMS composer proves send. This wording must be corrected by the bank-outreach owner; no real message test. | **FAIL — source repro (unverified live)** |
| `bank-outreach:stop-emails` | Stop automated sequence only after confirm, opt-out state remains durable; never Undo provider history | `[data-stop-emails]` → `stop_emails` → program sequence disabled | **NOT LIVE PROVED** |
| `bank-outreach:products` | Add/Edit facts, category-dependent inputs, preserve edits on category switch, evidence fields | `#new-product,[data-edit-product],form[data-action=save_product]` → bank product draft | **NOT LIVE PROVED** |
| `bank-outreach:verify-lender` | Push complete facts to Lenders only with banker, app link, source evidence, authorized role; repeat safe | `[data-verify]` → `verify_product` → verified Lenders row | **NOT LIVE PROVED** |
| `bank-outreach:relationship` | Status, pace, next action/time and Save; requires verified product before verified partner | `form[data-action=set_status]` → scoped relationship | **NOT LIVE PROVED** |
| `bank-outreach:assignment` | Manager-only Assign rep / Save assignment, nonmanager forbidden by backend | `form[data-action=assign]` → bank assignment | **NOT LIVE PROVED** |
| `bank-outreach:import` | Manager-only FDIC/NCUA CSV upload or paste; 5 MB/invalid format, duplicate/import errors, no real write test | `#import-open,#import-dialog,#import-file,#import-form,#import-close` → `action=import` → bank catalog | **NOT LIVE PROVED** |
| `bank-outreach:automation` | Read-only banker-search, email-template approval and reply-reading modes; no status implies provider send | `#automation-content`, runtime source `bank-outreach.js` → `GET /api/read/bank-outreach?view=automation` | **NOT LIVE PROVED** |
| `bank-outreach:staff-navigation` | Sidebar menus, role-specific route protection and small-phone state | `#burger,.navhead,.navitem` → role routing | **NOT LIVE PROVED** |

**Scope boundary:** Bank Outreach is bank-relationship/lender-data work adjacent to funding fulfillment, **not proof a customer was handed to a paid fulfillment team**. Its manager/representative views must be explicitly classified into the relevant sales-related operations or the separate fulfillment lane before counting it as a front-house completion blocker. Avoid having two agents implement the same page. The documented warm-up wording defect is a source-level finding, not proof any customer or banker received an incorrect message.

## Completeness gaps and next evidence actions

The original dated surface catalogs **do not inventory every control** in the newer Setter Dashboard, Sales Floor, native shells, or marketing/funnel/apply steps. Those surfaces are listed explicitly above and require a fresh Oct 29 live-route and role-aware control sweep before any “complete” claim.

For each row, add a link to a deterministic browser case **and** the persisted identity/tenant/payment/communication proof as applicable, then record post-merge deploy SHA and read-only real-role screen receipt. A screen loading, a 200 response, a mock checkout, or a green GitHub Actions shard cannot substitute for those claims. Keep customer/merchant/Google Calendar/Supabase production read-only; use disposable CI PostgreSQL and fake providers for writes. Owner vs Justice calendar identity, actual received provider deliveries, and actual verified paid handoff remain NOT LIVE PROVED.

**Owner Undo:** separate phased design in `ops/workflows/front-house-undo-log-dial-backlog-2026-10-29.md`. **SOP icon:** exclusively PR #257. **Native:** dedicated sixth lane. **Blueprint product:** separate product-acceptance lane. **A/R and fulfillment:** not acceptance shortcuts for this front-of-house stop line.
