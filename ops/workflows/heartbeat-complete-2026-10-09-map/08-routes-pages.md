# Heartbeat map — group 08: routes and pages

Measured 2026-10-08, evening Arizona (2026-10-09 05:43 UTC). Read-only. The only file written is this one. Branch main, checkout not touched. No POST was sent anywhere.

Words used here: a **door** is a web address the code answers (a route). An **ask** is a plain GET that reads and writes nothing. A **deep** check reads the words on a page, runs the real code, or reads the rows a door writes. **Up/down only** means the ask only says "are you there?".

## What this covers

| Thing | Count | How I counted |
|---|---|---|
| Doors in `netlify/functions/api.mjs` ROUTES | **322** | I loaded the live `ROUTES` object. 302 get a 6 a.m. ask. 20 are on the unmonitored list. 0 are in neither. |
| HTML pages in `public/` | **101** | `find public -name "*.html"`. The brief said 114. I count 101: 58 under `/app` and 43 outside it. |
| Funnel pages on apply.fundhub.ai | **8** | 12 rows in `marketing/landing-pages/tracking-manifest.mjs` push to 8 live URLs. |
| Webhook providers behind `api/webhooks/[provider]` | 14 | One route in the table, but each provider is its own door (table I). |

## What the heartbeat does with a door or page today

- At 6 a.m. it asks every door and page "are you there?". It goes red only on a 404, a server error, or no answer. I ran the same 395 asks just now: 8 seconds, **0 down**.
- **285 of the 302 door asks come back 401 or 405.** That proves the door is hooked up. It does not run the door. Only 17 get past the sign-in wall (12 answer 200, 5 answer 400).
- Every 5 minutes a second job (`pulse-instant-watch`) checks 5 things: `health`, `login`, `apply` (the client control panel page), `funnel:roadmap-sales`, `pipeline:outbound`. Everything else in this file trips at 6 a.m. at best.
- The slice "door" rows say a door is on a list. The runner prints them "not checked" every time. They never go red. I do not count them.
- `live-playwright:desks` is a real-browser sweep. There is no nightly schedule for it (no crontab, no launchd job). Its last run was 2026-10-07 21:40 UTC, so it goes red by age tomorrow. I do not count it as cover for any door.
- A gap check shows in the 6 a.m. list with its file name in front when its own name does not start with the lane name (for example `gap-funnels:funnel:roadmap-checkout`). I name each check by the id written in its code.

## Counts

**Doors (322)**

| Status | Count | What it means |
|---|---|---|
| covered | 48 | A deep check would go red inside one morning when this door breaks for a customer. |
| ping-only | 246 | Only the 6 a.m. ask, or one "alive?" probe. |
| weak | 13 | A check exists, but it can skip, or pass quietly, or cannot see the form send. |
| missing | 15 | Not asked, and nothing reads it. All are on the unmonitored list. |

**75** doors are money or customer-blocked and not covered: 60 ping-only, 11 weak, 4 missing. Each one is named in a table below and listed in the last section.

**Pages (101)**: 22 have a body check (they read the page words or its data). 71 answer as files only. 8 are not asked on purpose (error pages, logo renders, a shelved page, a redirect, a chrome piece).

**Funnel pages (8)**: 7 have a body check. 1 has none: `apply.fundhub.ai/order`, a live $297.00 checkout.

## Stale or missing journey docs

- `docs/journeys/slo-offer-intended.md` (2026-09-20) says `/slo`, a $297 pay page and a Commas card page. The live path is the three-step widget on `apply.fundhub.ai/roadmap` (`slo-roadmap-widget-flow.md`), and the till says $147 today. I used the widget flow for the steps.
- There is no door-by-door or page-by-page journey doc. This map is built from the code: `ROUTES`, `registry.mjs`, the pulse files, the lanes' saved live results in `live-bundle/`, and a fresh run of funnels, webhooks and pixels at 05:41 UTC.

## Four things that sit under many rows

1. **A refused Commas webhook and a Commas card that cannot be made are invisible.** The payments lane says the first one itself. No pulse file reads `COMMAS_API_KEY` or `COMMAS_WEBHOOK_SECRET`. Only three keys are checked on purpose for being missing or a mask: OpenAI (brain), the unsubscribe signer (opt-out) and the Resend mail key (auth reset). Other keys show up only when a job that uses them stops.
2. **The credit pull has no tripwire.** No pulse file reads `soft_pull_requests`. `uw-paid-roadmap-no-pack` starts only after `analysis.completed`, and its own note says a buyer who has not filled the pull form "is not here".
3. **A 405 counts as up.** Pay, lead, enroll, apply, upload and tick doors accept form sends only. They can break and the ask still says up.
4. **The 5-minute watch does not touch money.** Only the roadmap page is on it. The till, the webhook and the pull are 6 a.m. at best.

## Live proof used

- `checkRegistry` from `src/pulse/registry.mjs`, run against https://fundhub.ai at 05:41 UTC: 395 rows, 8.3 s, 0 down. 191 answered 401, 94 answered 405, 105 answered 200, 5 answered 400.
- `gap-live.mjs` (read-only, `fundhub_app`, BEGIN READ ONLY, GET-only web) at 05:41 UTC: funnels 21 PASS, webhooks 5 PASS, pixels 7 PASS and 1 skip. Other lanes: the saved results in `live-bundle/*.json` (2026-10-09 01:38 to 01:41 UTC, from the built bundle).
- Plain GETs: `/api/public/slo-checkout` answered `ok:true`, `demo:false`, `$147`. `/api/public/funnel-checkout` answered `checkout.ready:true`. `apply.fundhub.ai/order` answered 200 with a 290 KB native ClickFunnels checkout page that shows `$297.00`.
- Last saved scorecard (2026-10-08 morning): 420 checks, 411 green, 0 red, 9 not checked. That run was before the coverage lanes went live.

## Limits of this map

- I sent no POST, so I judged every form-send door from its code and from which checks exist. I did not run any of them.
- Lanes other than funnels, webhooks and pixels use the 01:38 to 01:41 UTC saved results. They were not re-run.
- The brief said 114 pages. I count 101 `.html` files in `public/`. I did not find a source of 13 more.

---

## Tables

Column key. **depth**: deep, ping (up/down or "alive?" only), none. **trips**: 5min (the instant watch), 6am (the daily pulse), none. **status**: covered, ping-only, weak, missing. Every check id was found in the code or in a saved live run.

### A. Money — the roadmap buy path (apply.fundhub.ai/roadmap, then the /api/public doors)

Steps come from `docs/journeys/slo-roadmap-widget-flow.md` (2026-09-27). The older `slo-offer-intended.md` (2026-09-20) still says `/slo`, $297 and a Commas card page, so it is stale.

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Sales page apply.fundhub.ai/roadmap loads with the buy box and the offer words | `funnel:roadmap-sales` | deep | yes — page down, buy-box anchor gone, or offer words gone | 5min | covered | money |
| Buy box talks to the till. Till is ready, not in demo, and the page shows the till's price (till says $147 today) | `funnel:roadmap-checkout` | deep | yes — till not ok, not ready, demo on, or price not on the page | 6am | covered | money |
| Pay button makes a real Commas card session (the form send to public/slo-checkout) | none | none | no — "ready" only means the keys are set. A dead Commas key or a server error on the send leaves no row to read | none | missing | money |
| Lead saved when the email is typed (form send to public/slo-interest; every funnel click also goes here) | `reg:public/slo-interest`, `utm-capture-route`, `ad-click-stored`, `funnel-click-stored` | ping | weak — ad-click-stored skips under 20 Meta clicks in 3 days (it skips now). funnel-click-stored needs 7 quiet days | 6am | weak | money |
| Card paid: the Commas webhook door is hooked up, the inbox is not stuck, a paid link settles | `webhooks:commas`, `payments:commas-webhook-route`, `payments:pay-link-webhook`, `webhooks:stuck-failed`, `job:commas-inbox-drain` | deep | yes — door gone, a failed inbox row, or a paid payment with the link still open | 6am | covered | money |
| Commas webhook is refused (wrong secret) or never arrives | none | none | no — a refused webhook writes no row. The payments lane says this itself | none | missing | money |
| Paid buyer gets their access row | `payments:paid-no-entitlement`, `portal:paid-entitlement` | deep | yes — a paid payment with a product but no access row | 6am | covered | customer-blocked |
| Pull form saves identity and consent (form send to public/slo-pull, which is not in the registry) | `offer:roadmap-pull`, `consent:slo-store` | ping | no — the send is only asked "alive?". Red only if an identity was saved with no consent | 6am | ping-only | customer-blocked |
| Credit pull runs and answers (soft_pull_requests goes queued, then fulfilled or failed) | none | none | no — nothing in src/pulse reads soft_pull_requests. A failed pull just shows the buyer a booking link | none | missing | customer-blocked |
| Pack built and delivered after the pull | `uw-paid-roadmap-no-pack`, `uw-offer-fulfillment-failed`, `uw-letters-missing` | deep | yes — a finished pull with no 4-file pack, or a pack job in failed events | 6am | covered | customer-blocked |
| Widget reads the pull result (GET public/slo-status) | `reg:public/slo-status` | ping | no — answers 400 with no link and counts as up. The result is never read | 6am | ping-only | customer-blocked |
| Repair upsell pay (form send to public/slo-repair-checkout) | none | none | no — on the unmonitored list and no data check reads it | none | missing | money |
| Book step: /roadmap-book frame, calendar page, booking form, and a booking landing as a row | `funnel:roadmap-book`, `funnel:funding-book-call`, `webhooks:calendar-booking`, `calls:booking-webhook` | deep | yes — frame, picker or form gone, or a booking webhook with no bookings row | 6am | covered | money |
| Thank-you page after the book step | `funnel:roadmap-thank-you` | deep | yes — thank-you words or next-step block gone | 6am | covered | customer-blocked |
| apply.fundhub.ai/order — native ClickFunnels checkout page, live, shows $297.00 | none | none | no — not in the registry (other site) and not in gap-funnels. The manifest only adds footer scripts to it | none | missing | money |

### B. Funnel pages on apply.fundhub.ai (8 live URLs from tracking-manifest.mjs)

12 manifest rows push to 8 live URLs. 7 have a page-body check. 1 has none.

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| apply.fundhub.ai/roadmap (sales page and buy box) | `funnel:roadmap-sales`, `funnel:roadmap-checkout`, `pixel-on-own-pages` | deep | yes — rows 1 and 2 of table A, or the Meta pixel is not started on the page | 5min | covered | money |
| apply.fundhub.ai/roadmap-book | `funnel:roadmap-book`, `pixel-on-own-pages` | deep | yes — booking frame or funding-book-call link gone | 6am | covered | money |
| apply.fundhub.ai/roadmap-thank-you | `funnel:roadmap-thank-you` | deep | yes — thank-you words or next-step block gone | 6am | covered | customer-blocked |
| apply.fundhub.ai/watch (the VSL and Get Started) | `funnel:watch`, `pixel-on-funnel-page`, `clarity-snippet`, `tracking-scripts-live` | deep | yes — Get Started or the lede gone, or the pixel, Clarity or a tracking script missing. Video play is not checked | 6am | covered | money |
| apply.fundhub.ai/apply (survey page) | `funnel:apply-form` | deep | yes — survey field, post URL or POST method gone, or the post door answers 404/5xx | 6am | covered | money |
| A /apply answer lands as a lead (ClickFunnels sends it to webhooks/clickfunnels) | `webhooks:clickfunnels` | ping | no — only an unsigned probe is read. A refused post or a changed secret leaves no row | 6am | ping-only | money |
| apply.fundhub.ai/funding-book-call (calendar) | `funnel:funding-book-call` | deep | yes — offer words, picker or booking form gone | 6am | covered | money |
| apply.fundhub.ai/thank-you | `funnel:thank-you` | deep | yes — words or thankyou-sort.js gone | 6am | covered | customer-blocked |
| apply.fundhub.ai/order (native $297.00 checkout) | none | none | no — nothing reads it (last row of table A) | none | missing | money |

### C. Money — the other buy and lead doors on fundhub.ai

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Partner pages: /partner/, /partner/menu/, /partner/trial/, /partner/board/ | `offer:partner`, `offer:partner-menu`, `offer:partner-trial`, `offer:partner-board` | deep | yes — price hook, checkout form or funnel.js link gone | 6am | covered | money |
| partner/funnel.js still posts to public/funnel-checkout | `offer:partner-checkout-script` | deep | yes — the checkout post is gone from the script | 6am | covered | money |
| Partner till (GET public/funnel-checkout): ready, right prices | `reg:public/funnel-checkout` | ping | no — answers 200 even when checkout.ready is false. The body is never read (the roadmap till is read, this one is not) | 6am | ping-only | money |
| A partner pays $297 for a trial and gets set up (trials/provision is a staff form send, done by hand) | none | none | no — nothing watches a paid trial that is waiting for a person | none | missing | customer-blocked |
| Trial gate in front of the pay button (trials/eligibility) | `reg:trials/eligibility` | ping | no — answers 401 or 200 and counts as up. The gate's answer is never read | 6am | ping-only | money |
| Trial screen the buyer watches (trials/dashboard, partner/trial/live) | `reg:trials/dashboard`, `reg:partner-trial-live-index` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| White-label add-on menu (partner-addons). It asks partners for money | `reg:partner-addons` | ping | no — up/down only | 6am | ping-only | money |
| Education pages: /education/ and /education/enroll/ (form and where it posts) | `offer:education`, `offer:education-enroll` | deep | yes — enroll link, form or post target gone | 6am | covered | money |
| Education enroll send (public/education-enroll) | `reg:public/education-enroll` | ping | no — up/down only. A failed enroll leaves no row | 6am | ping-only | money |
| Optimize pages and the public/optimize door (free report, a lead) | `offer:optimize`, `offer:optimize-plan`, `reg:public/optimize` | ping | no — the page form is checked, but the door's own code is never tried | 6am | ping-only | money |
| Affiliate apply: /affiliates/ form to public/partner-apply | `offer:affiliates`, `reg:public/partner-apply` | ping | no — the page form is checked, but the door's own code is never tried | 6am | ping-only | money |
| Home page survey to public/survey-submit (a lead) | `offer:home-survey`, `reg:public/survey-submit` | ping | no — the form and script are checked, but the door's own code is never tried. gap:sms-journey-zero only reads leads that got no text | 6am | ping-only | money |
| Repair round buy (paid-services; progress.html calls it) | `reg:paid-services` | ping | no — the price list answers. Making the pay link is never tried | 6am | ping-only | money |
| Closer-made payment link (payment-links) | `reg:payment-links`, `payments:pay-link-webhook` | ping | no — making a link is never tried. A paid link that never settled does show red | 6am | ping-only | money |
| Referral click is credited (public/affiliate-click) | `partners:referral-link`, `reg:public/affiliate-click` | deep | weak — it reads clicks that arrived and were credited to nobody. A dead door writes no clicks, so it stays green | 6am | weak | money |
| Lending-climate lead magnet: /climate/ plus climate, climate/config, climate/geocode, public/climate-match | `reg:climate-index`, `reg:public/climate-match` | ping | no — pages and doors answer 200. The match number is never read | 6am | ping-only | money |

### D. Sign-in and the client portal (a customer is blocked if it breaks)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Sign-in page /login.html | `login` | deep | yes — page down or sign-in words gone | 5min | covered | customer-blocked |
| Sign-in itself (auth/login): the app's rights, the session columns, a yes-sign-in with no session saved, a run of failed sign-ins | `gap:auth-session-read`, `gap:auth-signin-no-session`, `gap:auth-staff-login` | deep | yes — a missing right or moved column, a sign-in with no session, many failures and none ok. It passes quietly when nobody signed in | 6am | covered | customer-blocked |
| Session check (auth/session) | `gap:auth-session-read` | deep | yes — a session read that would fail | 6am | covered | customer-blocked |
| Sign-out (auth/logout) | `reg:auth/logout` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Magic link request (auth/magic-link): the email can send, and no issued link is missing its email | `gap:auth-magic-link-dead`, `email:magic-link-unqueued` | deep | weak — it sees a link that was issued with no email. If the door fails before it issues a link, nothing is left to read | 6am | weak | customer-blocked |
| Staff send a client their portal link (auth/send-portal-link) | `reg:auth/send-portal-link` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| portal-login.html (client sign-in page) | `reg:portal-login` | ping | no — up/down only. The words on the page are not read | 6am | ping-only | customer-blocked |
| Magic link exchange (auth/magic-link-verify) | `gap:auth-signin-no-session`, `reg:auth/magic-link-verify` | deep | weak — it says "nothing to check" and passes when no link was used in 24 hours | 6am | weak | customer-blocked |
| Password reset (auth/reset and reset-password.html) | `gap:auth-reset-mail`, `reg:reset-password` | deep | weak — it skips on the laptop run (the mail key is a mask). Its live answer is unproven until a 6 a.m. run | 6am | weak | customer-blocked |
| Authorized-rep upload (auth/authorized-rep and authorized-rep-file) | `reg:auth/authorized-rep`, `reg:auth/authorized-rep-file` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Client portal page /app/client-portal.html: loads with its tiles and the upload door | `portal:page`, `inquiry:upload-door` | deep | yes — page gone, tiles gone or upload door gone | 6am | covered | customer-blocked |
| Portal reads: portal summary (read/portal-summary) and the client file (dashboard/client) | `portal:summary`, `crm-data:client` | deep | yes — one of the 5 summary reads fails, or the client read fails | 6am | covered | customer-blocked |
| Progress page and its read (progress.html, read/client-progress) | `reg:progress`, `reg:read/client-progress` | ping | no — up/down only. The registry says an outage here empties the scores of clients who paid up to $10,000 | 6am | ping-only | customer-blocked |
| Contracts the client sees, and their access rows (read/portal-contracts, read/entitlements) | `reg:read/portal-contracts`, `reg:read/entitlements`, `portal:paid-entitlement` | ping | no — the doors only answer. Paid clients with no access row do show red | 6am | ping-only | customer-blocked |
| Checklist tick (waypoint-tick), chat to the team (chat/portal-message), welcome video (content/welcome-video) | `reg:waypoint-tick`, `reg:chat/portal-message`, `reg:content/welcome-video` | ping | no — form-send-only doors answer 405 and count as up. A failed write is invisible | 6am | ping-only | customer-blocked |
| Web push on (push/key, push/subscribe) | `reg:push/key`, `reg:push/subscribe` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Web push off (push/unsubscribe, on the unmonitored list) | none | none | no — not asked and not read | none | missing | customer-blocked |
| Email unsubscribe link and its door (public/unsubscribe) | `opt-out:unsubscribe-link`, `reg:public/unsubscribe` | deep | weak — it proves a link can be signed and a forged one is refused. The door that serves the link is only asked "alive?". It reads red on a laptop run because the signing key there is a mask | 6am | weak | customer-blocked |
| The next step opens for a paid client | `portal:next-step` | deep | yes — a paid checklist client or repair sign-up with no journey steps | 6am | covered | customer-blocked |
| Landing page after paying, /app/payment-success.html | `reg:payment-success` | ping | no — a file that answers. The read it makes is not tried | 6am | ping-only | customer-blocked |

### E. Documents, consent, contracts and the soft pull

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Client file upload (documents-upload) | `reg:documents-upload`, `documents:upload-store`, `documents:required-unchased` | ping | weak — it checks the file store is real and the newest file is there. A failing upload leaves nothing to read | 6am | weak | customer-blocked |
| Client file open (documents-download) | `reg:documents-download`, `documents:cannot-open` | ping | weak — it checks the 5 newest files exist in the store. No link is made or opened | 6am | weak | customer-blocked |
| Per-file signed link, GET /api/documents/<id> (on the unmonitored list) | none | none | no — not asked and not read. documents:cannot-open reads the store, not this door | none | missing | customer-blocked |
| A file stuck after upload | `documents:stuck-processing` | deep | yes — a row pending 3+ days, or a file check overdue 60 minutes | 6am | covered | customer-blocked |
| Consent screen and capture door | `consent:page`, `consent:required`, `consent:store`, `consent:slo-store`, `consent:dispute-required` | deep | yes — page stops calling the door, a paid client with no live consent, or a signed paper with no consent row | 6am | covered | customer-blocked |
| Soft-pull approve link: page, unsigned read, signed read | `soft-pull:approve-page`, `soft-pull:approve-read`, `soft-pull:approve-signed-read` | deep | yes — page is not the approve screen, the unsigned answer is wrong, or a signed read cannot reach the data | 6am | covered | customer-blocked |
| Approve click starts the pull (the send to soft-pull-approve) | none | none | no — the send is never tried and soft_pull_requests is never read | none | missing | customer-blocked |
| Contract sign link (contracts/sign, unmonitored on purpose) | `contracts:sign-route` | deep | yes — a forged link must answer 404. The signing secret gone, or the door gone, turns it red | 6am | covered | money |
| Sent contract the client cannot sign, signed contract with no copy, no live template | `contracts:sent-unsignable`, `contracts:signed-not-stored`, `contracts:template-missing` | deep | yes — the lookup repeats the signer's own refusals | 6am | covered | money |
| Page the sign link opens (/contract.html) | `reg:contract` | ping | no — a file that answers. Its script is not tried | 6am | ping-only | money |

### F. FinanceOS and bank linking (client money screens)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Credit page read (money/credit) | `finance-os:credit` | deep | yes — a 400, a 500, an error body or a crash for a linked client | 6am | covered | customer-blocked |
| Plan, declines, vault, transfers, payment schedule and money helper reads | `finance-os:plan`, `finance-os:declines`, `finance-os:vault`, `finance-os:transfers`, `finance-os:payments`, `finance-os:helper` | deep | yes — same: the real code runs for one linked client | 6am | covered | customer-blocked |
| Money overview (the account list on the screen) | `banks-linked-not-on-screen` | deep | yes — a bank that is saved but the screen would hide | 6am | covered | customer-blocked |
| Bank login in error, or a live login with no account | `banks-plaid-item-error`, `banks-active-link-no-accounts` | deep | yes — a login in error, or a live login with no account on the screen | 6am | covered | customer-blocked |
| Bank data keeps coming in (banking/sync-accounts, sync-transactions, sync-liabilities) | `banks-sync-stale`, `reg:banking/sync-accounts` | deep | weak — a sync that quietly stops shows only after 3 days. A login in error shows at once | 6am | weak | customer-blocked |
| Client links a bank (banking/link-token, banking/link-exchange) | `reg:banking/link-token`, `reg:banking/link-exchange` | ping | no — up/down only. Plaid is never called | 6am | ping-only | customer-blocked |
| Bank unlink and accounts (banking/revoke, banking/accounts) | `reg:banking/revoke`, `reg:banking/accounts` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Money tabs: accounts, alerts, banks, connections, fundability, ready-to-fund, setup, strategy, tasks, trends | `reg:money/accounts`, `reg:money/alerts`, `reg:money/banks`, `reg:money/connections`, `reg:money/fundability`, `reg:money/ready-to-fund`, `reg:money/setup`, `reg:money/strategy`, `reg:money/tasks`, `reg:money/trends` | ping | no — they answer 401 with no sign-in. The real code is not run | 6am | ping-only | customer-blocked |
| Client's own card processor feed (merchant/events, on the unmonitored list) | none | none | no — one-way, with a per-client key. Its sibling money/connections is only asked "alive?" | none | missing | customer-blocked |
| The 16 money pages (/app/money-*.html and /app/money.html) | `reg:money-credit` | ping | no — files that answer. The 7 reads above are the deep part | 6am | ping-only | customer-blocked |

### G. Repair, inquiry removal and funding (what a paying client is waiting on)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Repair sign-up (repair/enroll) | `reg:repair/enroll` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Repair letters made after analysis (repair/generate) | `repair-letter-round`, `fulfillment:next-action` | deep | yes — a file past its 1 hour clock with no letters (red in the saved live run) | 6am | covered | customer-blocked |
| Repair letters sent (repair/send) | `pipeline:repair`, `repair-case-stuck` | deep | yes for a file stuck before it is sent. No for the send door's own code | 6am | covered | customer-blocked |
| Bureau mail coming back (repair/inbound-mail) and repair/exceptions | `reg:repair/inbound-mail`, `reg:repair/exceptions` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Inquiry removal reads (read/inquiry-cases) and cases that stall | `inquiry:specialist-api`, `inquiry:case-stuck`, `inquiry:letter-round` | deep | yes — case list or packet read fails, a case stuck 72 hours, a round with no letter | 6am | covered | customer-blocked |
| Inquiry removal writes (inquiry-cases creates, updates and closes a case) | `reg:inquiry-cases` | ping | no — up/down only. The checks above read cases; they never try the write door | 6am | ping-only | customer-blocked |
| Funding apply door (applications) | `funding:apply-door`, `funding:submit-path`, `funding:round-stuck` | deep | yes — the door fails for a client, an application sits 72 hours, a round sits 72 hours | 6am | covered | customer-blocked |
| Bank match read (read/lender-matches) | `crm-data:lender-matches` | deep | yes — the match read fails for a client on file | 6am | covered | customer-blocked |
| Funding rounds read (read/funding-rounds) | `reg:read/funding-rounds` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Funding round news from the lender service (webhooks/lendflow) | none | none | no — it is the only source of round started, submitted, approved and funded. No probe and no check names it | none | missing | customer-blocked |

### H. Partner, affiliate and white-label

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Partner sign-in door (auth/login for partners) | `partners:login-door` | deep | yes — a partner who cannot open the door | 6am | covered | customer-blocked |
| Commission payable and payout runs | `partners:commission-payable`, `partners:payout-stuck` | deep | yes — earned and payable but not payable, or a run processing 7+ days | 6am | covered | money |
| Partner training screen and read (read/partner-training) | `training:page`, `training:read-api`, `training:required-step` | deep | yes — page shows no steps, the read fails, or a step has no title | 6am | covered | customer-blocked |
| Partner site pages (public/partner-page, partner-pages) | `reg:public/partner-page`, `reg:partner-pages` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Brand, domain check, marketing helpers (partner-brand, partner-brand/verify-domain, partner-marketing/*) | `reg:partner-brand`, `reg:partner-brand/verify-domain`, `reg:partner-marketing/usage` | ping | no — up/down only | 6am | ping-only | customer-blocked |
| Affiliate portal reads and refer link (read/affiliate-portal, affiliates/refer) and the home tiles (read/partner-home-tiles) | `reg:read/affiliate-portal`, `reg:affiliates/refer`, `reg:read/partner-home-tiles` | ping | no — up/down only. The registry says an outage reads to an affiliate as vanished referrals | 6am | ping-only | customer-blocked |
| Winner's board data (adintel/board, behind partner/board/live) | `reg:adintel/board` | ping | no — up/down only | 6am | ping-only | customer-blocked |

### I. Inbound webhook doors (api/webhooks/[provider] is one route, and each provider is its own door)

The router knows 14: twilio, twilio-status, resend, submagic, mailgun, mailgun-events, postgrid, commas, clickfunnels, bland, lendflow, inquiry-removal, merchant-whop and merchant-commas. `gap-webhooks` probes 3 of them (its 4th row, calendar booking, is the clickfunnels door again).

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Door is hooked up at all (a plain ask answers 405) | `webhooks:twilio-status`, `webhooks:commas`, `webhooks:clickfunnels` | deep | yes — 404 on the whole prefix, or the router no longer knows the provider | 6am | covered | money |
| twilio-status (delivery receipts) | `webhooks:twilio-status`, `gap:sms-sending-stuck`, `gap:sms-provider-failed` | deep | yes — door gone, a text stuck on sending 15+ minutes, a text failed at the carrier | 6am | covered | customer-blocked |
| twilio (client text replies and STOP) | `opt-out:stop-did-not-stick` | deep | weak — the inbound door is never probed. The STOP check passes quietly if no replies arrive | 6am | weak | customer-blocked |
| commas (payment webhook) | `webhooks:commas`, `webhooks:stuck-failed`, `payments:commas-webhook-route` | deep | yes for the door gone and stuck rows. No for a refused signature | 6am | covered | money |
| clickfunnels (apply answers, orders, bookings; a booking is the same door) | `webhooks:clickfunnels`, `webhooks:calendar-booking`, `calls:booking-webhook` | deep | yes for the door gone and a booking with no row. No for a refused post | 6am | covered | money |
| resend, mailgun, mailgun-events (email delivery news) | `email:sending-stuck`, `email:provider-fail` | deep | weak — the doors are never probed. Only stuck or failed rows are read | 6am | weak | customer-blocked |
| postgrid (a letter was delivered, which starts the response clock) | none | none | no — no probe and no check names it | none | missing | customer-blocked |
| bland (call results), inquiry-removal (case news), submagic (captioned video) | none | none | no — no probe. The data lanes read what they leave, not the door | none | missing | customer-blocked |
| lendflow (funding round news) — same break as the last row of table G | none | none | no — no probe and no check names it | none | missing | customer-blocked |
| merchant-whop/<id> and merchant-commas/<id> (a client's own processor) | none | none | no — no probe and no check names it | none | missing | customer-blocked |
| rb2b-webhook (visitor identity; its own route, not under webhooks/) | `reg:public/rb2b-webhook` | ping | no — the ask answers 200 and writes nothing | 6am | ping-only | internal |

### J. Staff screens and reads (grouped, because these are internal)

Section M lists every route one by one.

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| CRM reads: dashboard/clients, dashboard/pipeline, dashboard/pipeline-counts, pipeline-cards, read/lenders, read/tradelines | `crm-data:clients`, `crm-data:pipeline`, `crm-data:pipeline-counts`, `crm-data:pipeline-cards`, `crm-data:lenders`, `crm-data:tradelines` | deep | yes — the same data lookup the door runs. A copy test fails if the copy drifts | 6am | covered | staff-only |
| Sales floor and manager (read/sales-floor, read/my-numbers) and the CSM queue (read/csm-queue) | `sales-manager:read-api`, `csm:queue-api` | deep | yes — a read that fails for a signed-in manager, or the queue lookup fails | 6am | covered | staff-only |
| Underwrite and brain reads (read/underwrite, read/company-brain, read/company-brain-affiliate) | `uw-read-door`, `brain:search-staff`, `brain:search-affiliate`, `brain:embed-key` | deep | yes — the real code fails. brain:embed-key reads red in the saved run, which used the laptop copy of the OpenAI key (a mask) | 6am | covered | staff-only |
| Owner tools: org-brand, content/tiles, journeys, creative/jobs, marketing/shoot, read/ops-pulse, read/company-activity | `owner-tools:brand-studio`, `owner-tools:content-admin`, `owner-tools:journeys`, `owner-tools:creative-factory`, `owner-tools:teleprompter`, `owner-tools:ops-admin`, `owner-tools:galaxy` | deep | yes — the screen's reads fail or come back empty | 6am | covered | staff-only |
| Social studio: social/posts, social/channels, social/settings | `social:studio-read` | deep | yes — a read that would answer 500 | 6am | covered | staff-only |
| Marketing machine (44 doors under marketing/*) | `marketing-queue:read-api`, `marketing-queue:stuck-queued`, `marketing-queue:failed-no-note` | deep | yes for marketing/health, marketing/today and marketing/shoot (3). The other 38 are up/down only. 3 research sends are not asked at all | 6am | covered | staff-only |
| Ads and campaigns (10 doors under campaigns/*) | `ads-meta-sync-stale`, `ads-spend-day-missing`, `ads-number-unmapped` | deep | yes for the sync running and spend rows. campaigns/write and link-asset are up/down only. campaigns/meta-agency is not asked | 6am | covered | staff-only |
| Hiring (8 doors under hiring/*) | `hiring-apply`, `staff-invite-link` | deep | yes for hiring/apply (the careers door). The other 7 are up/down only | 6am | covered | internal |
| Closer, calls, bookings, call outcomes, unrecorded calls | `closer:desk-pages`, `closer:held-disposition`, `calls:booked-no-outcome`, `calls:calendar`, `unrecorded` | deep | yes — desk page words wrong, a decision with no outcome row, a call past its time with no outcome | 6am | covered | staff-only |
| Staff sign-in rules and invites (auth/staff-role, staff-update, suspend, invite, admin-reset) | `role-gate`, `role-desk`, `staff-invite-link`, `reg:auth/invite` | deep | yes for the role gate and the desks that load. Role changes themselves are up/down only | 6am | covered | staff-only |
| Everything else staff-side: read/* (54 up/down only), finance/* (13), creative/* , company-brain/*, social/* , demo/*, ops/*, scripts/*, brand/review, blueprint/staff-actions, proxy/* | `reg:read/failed-events` | ping | no — mostly 401 with no sign-in. A broken screen has no tripwire | 6am | ping-only | staff-only |

### K. The unmonitored list in registry.mjs (ALLOWED_UNMONITORED, 34 keys)

34 keys = 20 ROUTES keys + 3 special doors (inngest, webhooks/[provider], documents/[id]) + 3 shelved decline-autopsy keys + 8 pages. A plain ask is skipped on purpose here, because it would write something or look down. Only some have a stand-in check.

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| `inngest` | `job:daily-pulse` | ping | no — the 6 a.m. job reads its own last run. If Inngest stops, nothing outside it tells anyone | none | missing | internal |
| `webhooks/[provider]` | `webhooks:commas`, `webhooks:clickfunnels`, `webhooks:twilio-status` | deep | yes for 3 providers. No for the other 11 (table I) | 6am | weak | money |
| `documents/[id]` | none | none | no — not asked and no data check reads it | none | missing | customer-blocked |
| `contracts/sign` | `contracts:sign-route` | deep | yes — see table E | 6am | covered | money |
| `public/decline-autopsy` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `public/decline-autopsy-upload` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `public/decline-autopsy-report` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `public/vsl-watch` | `vsl-watch-route` | ping | no — one plain ask says alive (405) | 6am | ping-only | internal |
| `trials/provision` | none | none | no — not asked and no data check reads it | none | missing | customer-blocked |
| `trials/convert` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `campaigns/meta-agency` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `training-progress` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `push/unsubscribe` | none | none | no — not asked and no data check reads it | none | missing | customer-blocked |
| `sidebar.fragment.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `merchant/events` | none | none | no — not asked and no data check reads it | none | missing | customer-blocked |
| `analytics/clickfunnels-connect` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `analytics/clickfunnels-sync` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `analytics/youtube-connect` | `social:youtube-last-error` | deep | weak — reads the connection's last error and skips with no connection | 6am | weak | staff-only |
| `analytics/youtube-sync` | `social:youtube-last-error` | deep | weak — reads the connection's last error and skips with no connection | 6am | weak | staff-only |
| `scripts/write` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `ops/weekly-brief` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `public/slo-repair-checkout` | none | none | no — not asked and no data check reads it | none | missing | money |
| `public/slo-pull` | `offer:roadmap-pull` | ping | no — one plain ask says alive (405) | 6am | ping-only | customer-blocked |
| `marketing/research/approve` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `marketing/research/tweak` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `marketing/research/brain` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `public/ad-video-approve` | none | none | no — not asked and no data check reads it | none | missing | staff-only |
| `404.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `climate/404.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `climate/404/index.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `aniso-face/logo-6k/index.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `aniso-face/logo-6k/preview.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `partner/autopsy/index.html` | none | none | no — not asked and no data check reads it | none | missing | internal |
| `roadmap/index.html` | none | none | no — not asked and no data check reads it | none | missing | internal |

### L1. Public pages on fundhub.ai (43 files)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| `/` home page: the survey form and its script | `reg:home`, `offer:home-survey` | deep | yes — survey form, script or where it posts is gone | 6am | covered | money |
| `/start.html` (affiliate hop to /watch) | `reg:start`, `offer:start` | deep | yes — the link to apply.fundhub.ai/watch is gone | 6am | covered | money |
| `/login.html` | `login` | deep | yes — page down or sign-in words gone | 5min | covered | customer-blocked |
| `/optimize.html`, `/optimize-plan.html` | `offer:optimize`, `offer:optimize-plan` | deep | yes — form or optimize hook gone | 6am | covered | money |
| `/roadmap/pay.html`, `/roadmap/pull.html` | `offer:roadmap-pay`, `offer:roadmap-pull` | deep | yes — the pay or pull form, or where it posts, is gone | 6am | covered | money |
| `/partner/`, `/partner/menu/`, `/partner/trial/`, `/partner/board/` | `offer:partner`, `offer:partner-menu`, `offer:partner-trial`, `offer:partner-board` | deep | yes — price hook or checkout form gone | 6am | covered | money |
| `/education/`, `/education/enroll/` | `offer:education`, `offer:education-enroll` | deep | yes — enroll link or form gone | 6am | covered | money |
| `/affiliates/` | `offer:affiliates` | deep | yes — form or where it posts is gone | 6am | covered | money |
| `/portal-login.html`, `/reset-password.html`, `/progress.html` | `reg:portal-login`, `reg:reset-password`, `reg:progress` | ping | no — files that answer. Their words and scripts are not read | 6am | ping-only | customer-blocked |
| `/contract.html` (the page a sign link opens) | `reg:contract` | ping | no — a file that answers. Its script is not tried | 6am | ping-only | money |
| `/unsubscribe.html` | `reg:unsubscribe` | ping | no — a file that answers. The link signer is read by opt-out:unsubscribe-link, not this page | 6am | ping-only | customer-blocked |
| `/partner/trial/live/`, `/partner/board/live/`, `/education/learn/` (the paid course door) | `reg:partner-trial-live-index`, `reg:partner-board-live-index`, `reg:education-learn-index` | ping | no — files that answer | 6am | ping-only | customer-blocked |
| `/climate/`, `/climate/lender-climate/` | `reg:climate-index`, `reg:climate-lender-climate-index` | ping | no — files that answer. The live climate browser test is stale | 6am | ping-only | money |
| `/careers.html` | `reg:careers`, `hiring-apply` | deep | yes — the roles read must answer 200 with open roles. The page file itself is up/down | 6am | covered | internal |
| `/consulting/*` (4), `/education/{privacy,refund,terms}`, `/privacy/`, `/terms/`, `/crm.html`, `/leads/<hash>/` | `reg:consulting-index`, `reg:privacy-index`, `reg:crm` | ping | no — files that answer | 6am | ping-only | internal |
| 7 pages not asked on purpose: 404.html, climate/404.html, climate/404/index.html, aniso-face (2), partner/autopsy (shelved), roadmap/index.html (a redirect) | none | none | no — error pages, logo renders, a shelved page and a redirect. None is a live door | none | missing | internal |

### L2. Desk pages under /app (58 files)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| Client portal `/app/client-portal.html` | `portal:page`, `inquiry:upload-door` | deep | yes — page gone, tiles gone or upload door gone | 6am | covered | customer-blocked |
| Consent `/app/consent-capture.html`, approve `/app/soft-pull-approve.html`, partner training `/app/partner-training.html` | `consent:page`, `soft-pull:approve-page`, `training:page` | deep | yes — the page is not the screen, or it stops calling its read | 6am | covered | customer-blocked |
| Client control panel `/app/client-control-panel.html` (the Apply door words) | `apply` | deep | yes — Apply words or the client-email line gone | 5min | covered | staff-only |
| Calendar, closer dashboard, present | `calls:calendar`, `closer:desk-pages` | deep | yes — the page is not the right page | 6am | covered | staff-only |
| The 16 money pages (`/app/money-*.html`, `/app/money.html`) | `reg:money-credit` | ping | no — files that answer | 6am | ping-only | customer-blocked |
| `/app/payment-success.html`, `/app/affiliate.html`, `/app/partner-galaxy.html` | `reg:payment-success`, `reg:affiliate`, `reg:partner-galaxy` | ping | no — files that answer | 6am | ping-only | customer-blocked |
| The other 30 staff desks (pipeline, sales-floor, documents, hiring, messaging, finance-os and the rest) | `reg:pipeline`, `reg:sales-floor`, `reg:documents`, `reg:messaging` | ping | no — files that answer. A script error that blanks a desk still answers 200 | 6am | ping-only | staff-only |
| `/app/sidebar.fragment.html` | none | none | no — chrome piece, not a door | none | missing | internal |

### M. Every door, one line per family

Code: **D** covered (deep, or reads its rows) · **W** weak · **P** ping-only (the 6 a.m. ask) · **N** nothing watches it.

- **(top level)** (43) — D: applications, health, journeys, org-brand, pipeline-cards, soft-pull-approve · W: documents-download, documents-upload · P: ad-videos, agent-call, agents, ai-bureau-config, bookings, call-outcomes, client-notes, climate, closer-deck, commission-rules, commissions, contracts, customer-insights, inquiries, inquiry, inquiry-cases, lender-observations, lenders, marketing-flags, message-templates, messages, messages-outbound, paid-services, partner-addons, partner-brand, partner-pages, payment-links, pii, pipeline-clients, products, shifts, slo-connections, tasks, waypoint-tick · N: training-progress
- **adintel** (1) — P: adintel/board
- **affiliates** (1) — P: affiliates/refer
- **analytics** (4) — W: analytics/youtube-connect, analytics/youtube-sync · N: analytics/clickfunnels-connect, analytics/clickfunnels-sync
- **auth** (14) — D: auth/login, auth/session · W: auth/magic-link, auth/magic-link-verify, auth/reset · P: auth/admin-reset, auth/authorized-rep, auth/authorized-rep-file, auth/invite, auth/logout, auth/send-portal-link, auth/staff-role, auth/staff-update, auth/suspend
- **banking** (7) — W: banking/sync-accounts, banking/sync-liabilities, banking/sync-transactions · P: banking/accounts, banking/link-exchange, banking/link-token, banking/revoke
- **blueprint** (2) — D: blueprint/declines · P: blueprint/staff-actions
- **brand** (1) — P: brand/review
- **campaigns** (10) — P: campaigns/action-log, campaigns/connections, campaigns/detail, campaigns/fatigue, campaigns/link-asset, campaigns/list, campaigns/spend, campaigns/sync, campaigns/write · N: campaigns/meta-agency
- **chat** (4) — P: chat/ask, chat/messages, chat/peers, chat/portal-message
- **climate** (2) — P: climate/config, climate/geocode
- **company-brain** (4) — P: company-brain/reviews, company-brain/sync, company-brain/threads, company-brain/upload
- **consent** (1) — D: consent/capture
- **content** (3) — D: content/tiles · P: content/upload, content/welcome-video
- **contracts** (1) — D: contracts/sign
- **creative** (7) — D: creative/jobs · P: creative/actions, creative/approvals, creative/brand-kits, creative/generate, creative/library, creative/run
- **dashboard** (7) — D: dashboard/client, dashboard/clients, dashboard/pipeline, dashboard/pipeline-counts · P: dashboard/client-archive, dashboard/kpis, dashboard/seed
- **demo** (2) — P: demo/mode, demo/simulate
- **finance** (13) — P: finance/alerts, finance/bank-accounts, finance/bills, finance/cards, finance/cashflow, finance/containers, finance/crs-pull, finance/entities, finance/liabilities, finance/model, finance/paydown-simulator, finance/soft-pull, finance/subscriptions
- **gifts** (1) — P: gifts/message-blaster
- **hiring** (8) — D: hiring/apply · P: hiring/application, hiring/bench, hiring/candidates, hiring/decide, hiring/decisions, hiring/funnel, hiring/postings
- **journeys** (2) — P: journeys/ask, journeys/run
- **marketing** (44) — D: marketing/health, marketing/shoot, marketing/today · P: marketing/ad, marketing/ads, marketing/angles, marketing/batches, marketing/batches/next, marketing/batches/write-now, marketing/costs, marketing/flywheel, marketing/flywheel/approve, marketing/flywheel/campaign, marketing/flywheel/job, marketing/flywheel/run, marketing/flywheel/spend-read, marketing/flywheel/tweak, marketing/funnel, marketing/funnels, marketing/funnels/build, marketing/funnels/create, marketing/funnels/push-live, marketing/funnels/rename, marketing/funnels/stats, marketing/ideas, marketing/jobs/retry, marketing/meta/load, marketing/meta/load-status, marketing/offer/generate, marketing/research, marketing/rules, marketing/script, marketing/scripts, marketing/scripts/approve, marketing/scripts/edit, marketing/scripts/fix, marketing/scripts/order, marketing/scripts/reject, marketing/settings, marketing/shoot/mark, marketing/shoot/take · N: marketing/research/approve, marketing/research/brain, marketing/research/tweak
- **merchant** (1) — N: merchant/events
- **money** (17) — D: money/credit, money/helper, money/overview, money/payments, money/plan, money/transfers, money/vault · P: money/accounts, money/alerts, money/banks, money/connections, money/fundability, money/ready-to-fund, money/setup, money/strategy, money/tasks, money/trends
- **ops** (2) — P: ops/hire-closer · N: ops/weekly-brief
- **partner-brand** (1) — P: partner-brand/verify-domain
- **partner-marketing** (5) — P: partner-marketing/copy-history, partner-marketing/enable, partner-marketing/generate-copy, partner-marketing/generate-logo, partner-marketing/usage
- **partners** (1) — P: partners/approve
- **privacy** (1) — P: privacy/erasure
- **proxy** (2) — P: proxy/end, proxy/launch
- **public** (18) — D: public/slo-checkout · W: public/affiliate-click, public/slo-interest, public/unsubscribe · P: public/climate-match, public/education-enroll, public/eeo-survey, public/funnel-checkout, public/optimize, public/partner-apply, public/partner-page, public/rb2b-webhook, public/slo-pull, public/slo-status, public/survey-submit, public/vsl-watch · N: public/ad-video-approve, public/slo-repair-checkout
- **push** (3) — P: push/key, push/subscribe · N: push/unsubscribe
- **read** (68) — D: read/company-activity, read/company-brain, read/company-brain-affiliate, read/csm-queue, read/inquiry-cases, read/lender-matches, read/lenders, read/my-numbers, read/ops-pulse, read/partner-training, read/portal-summary, read/sales-floor, read/tradelines, read/underwrite · P: read/ad-attribution, read/ad-books, read/ad-spine, read/affiliate-portal, read/affiliates, read/agent-context, read/agent-shadow-log, read/agents, read/ai-bureau-config, read/bank-inbox, read/banking-surface, read/blueprint-combined-approval, read/call-outcomes, read/client-progress, read/closer-call, read/closer-deck, read/closer-now, read/commissions, read/contracts, read/conversations, read/customer-insights, read/deal-math, read/documents, read/eeo-aggregate, read/entitlements, read/failed-events, read/finance-ask, read/finance-command, read/finance-os, read/finance-os-suggestions, read/funding-rounds, read/funnel-pages, read/inbox, read/inquiries, read/invoices, read/lender-observations, read/message-templates, read/messages, read/money-map, read/morning-brief, read/partner-home-tiles, read/partner-production, read/partners, read/portal-contracts, read/products, read/proxy-sessions, read/repair-cases, read/search, read/slo-connections, read/staff, read/transactions, read/unrecorded-calls, read/video-stats, read/workflows
- **repair** (5) — D: repair/generate, repair/send · P: repair/enroll, repair/exceptions, repair/inbound-mail
- **scripts** (2) — P: scripts/list · N: scripts/write
- **social** (7) — D: social/channels, social/posts, social/settings · P: social/generate, social/oauth, social/publish, social/schedule
- **staff** (3) — P: staff/avatar, staff/monitoring-consent, staff/telemetry
- **trials** (4) — P: trials/dashboard, trials/eligibility · N: trials/convert, trials/provision

### N. Split of the doors by customer impact and status

- customer-blocked / covered: 21
- customer-blocked / missing: 3
- customer-blocked / ping-only: 47
- customer-blocked / weak: 9
- internal / covered: 2
- internal / ping-only: 6
- money / covered: 2
- money / missing: 1
- money / ping-only: 13
- money / weak: 2
- staff-only / covered: 23
- staff-only / missing: 11
- staff-only / ping-only: 180
- staff-only / weak: 2

### O. Money or customer-blocked doors that are not covered, door by door

- `adintel/board` — customer-blocked, ping-only
- `affiliates/refer` — customer-blocked, ping-only
- `auth/authorized-rep` — customer-blocked, ping-only
- `auth/authorized-rep-file` — customer-blocked, ping-only
- `auth/logout` — customer-blocked, ping-only
- `auth/magic-link` — customer-blocked, weak
- `auth/magic-link-verify` — customer-blocked, weak
- `auth/reset` — customer-blocked, weak
- `auth/send-portal-link` — customer-blocked, ping-only
- `banking/accounts` — customer-blocked, ping-only
- `banking/link-exchange` — customer-blocked, ping-only
- `banking/link-token` — customer-blocked, ping-only
- `banking/revoke` — customer-blocked, ping-only
- `banking/sync-accounts` — customer-blocked, weak
- `banking/sync-liabilities` — customer-blocked, weak
- `banking/sync-transactions` — customer-blocked, weak
- `chat/portal-message` — customer-blocked, ping-only
- `climate` — money, ping-only
- `climate/config` — money, ping-only
- `climate/geocode` — money, ping-only
- `content/welcome-video` — customer-blocked, ping-only
- `documents-download` — customer-blocked, weak
- `documents-upload` — customer-blocked, weak
- `inquiry-cases` — customer-blocked, ping-only
- `merchant/events` — customer-blocked, missing
- `money/accounts` — customer-blocked, ping-only
- `money/alerts` — customer-blocked, ping-only
- `money/banks` — customer-blocked, ping-only
- `money/connections` — customer-blocked, ping-only
- `money/fundability` — customer-blocked, ping-only
- `money/ready-to-fund` — customer-blocked, ping-only
- `money/setup` — customer-blocked, ping-only
- `money/strategy` — customer-blocked, ping-only
- `money/tasks` — customer-blocked, ping-only
- `money/trends` — customer-blocked, ping-only
- `paid-services` — money, ping-only
- `partner-addons` — money, ping-only
- `partner-brand` — customer-blocked, ping-only
- `partner-brand/verify-domain` — customer-blocked, ping-only
- `partner-marketing/copy-history` — customer-blocked, ping-only
- `partner-marketing/enable` — customer-blocked, ping-only
- `partner-marketing/generate-copy` — customer-blocked, ping-only
- `partner-marketing/generate-logo` — customer-blocked, ping-only
- `partner-marketing/usage` — customer-blocked, ping-only
- `partner-pages` — customer-blocked, ping-only
- `payment-links` — money, ping-only
- `public/affiliate-click` — money, weak
- `public/climate-match` — money, ping-only
- `public/education-enroll` — money, ping-only
- `public/funnel-checkout` — money, ping-only
- `public/optimize` — money, ping-only
- `public/partner-apply` — money, ping-only
- `public/partner-page` — customer-blocked, ping-only
- `public/slo-interest` — money, weak
- `public/slo-pull` — customer-blocked, ping-only
- `public/slo-repair-checkout` — money, missing
- `public/slo-status` — customer-blocked, ping-only
- `public/survey-submit` — money, ping-only
- `public/unsubscribe` — customer-blocked, weak
- `push/key` — customer-blocked, ping-only
- `push/subscribe` — customer-blocked, ping-only
- `push/unsubscribe` — customer-blocked, missing
- `read/affiliate-portal` — customer-blocked, ping-only
- `read/client-progress` — customer-blocked, ping-only
- `read/entitlements` — customer-blocked, ping-only
- `read/funding-rounds` — customer-blocked, ping-only
- `read/partner-home-tiles` — customer-blocked, ping-only
- `read/portal-contracts` — customer-blocked, ping-only
- `repair/enroll` — customer-blocked, ping-only
- `repair/exceptions` — customer-blocked, ping-only
- `repair/inbound-mail` — customer-blocked, ping-only
- `trials/dashboard` — customer-blocked, ping-only
- `trials/eligibility` — money, ping-only
- `trials/provision` — customer-blocked, missing
- `waypoint-tick` — customer-blocked, ping-only

## Checker — 2026-10-09

An outside checker read this file and tried to break it. Read only. I changed nothing except this section.

**Bottom line.** The map is mostly right. I cannot sign it off as it stands. 4 rows marked covered are not covered. The map also missed 6 things that touch money or a paying customer.

### What holds

- The counts are true. 322 doors (302 asked, 20 not asked). 395 asks at 6 a.m. (302 doors, 57 desks, 36 pages). 101 pages. 431 = 77 + 317 + 13 + 24.
- Every check name is real. All 86 `reg:` names match the registry. Every other name came out of a live lane run. I found no made-up name.
- I ran payments, portal, contracts, consent, auth, calls, soft-pull, partners, funnels and webhooks live (read only). All green except the one reset-mail skip. The pulse tests I ran (99) all pass.
- I tried to break 15 covered rows. 11 held: `funnel:roadmap-sales`, `funnel:roadmap-checkout`, the Commas door and inbox checks, `uw-*`, `contracts:*`, `consent:*`, `finance-os:*`, `portal:*`, `repair-letter-round`, `funding:apply-door`, `gap:auth-*`.
- Two of those held with a catch. `funnel:roadmap-checkout` says "ready" when the key is set. It does not prove Commas works. `gap:auth-*` shows 0 sign-ins in 24 hours right now, so it proves the database side only.

### What does not hold (call these weak)

1. **`partners:login-door` (table H, marked covered).** It never signs anyone in. It looks at the route list and counts partner accounts with a password. Right now 13 partners are active and 10 can sign in. The check says PASS. It only goes red if none can. A broken login would pass. (`gap-partners.mjs` lines 213-231 and 336-355.)
2. **The clickfunnels row in table I (marked covered).** Table B already calls the same door ping-only, and Table B is right. A refused post from ClickFunnels or the `/apply` form (wrong secret, or the browser preflight failing) leaves no row. The router only keeps posts that were accepted (`router.mjs` line 228). `calls:booking-webhook` only sees posts that were accepted and not saved. A lead or an order that never arrives stays green.
3. **The book step in table A (marked covered).** Same cause as 2. The page checks are real. The booking landing as a row is only half watched. Also nobody checks that the calendar has open times (the times load in the browser from Cronofy).
4. **"Paid buyer gets their access row" in table A.** `payments:paid-no-entitlement` drops any payment whose product name matches no product. I tested the roadmap title "Consulting Services Assessment" on the live database. It matches nothing. If Commas sends that title, this check cannot see a roadmap payment. Only the "stranded" part of `portal:paid-entitlement` can, and only for a client with no access row at all. No roadmap link has ever been paid (15 links, 0 paid). So neither check has seen a real roadmap payment. I cannot prove it works.

### Not fully missing (a check exists, but it is half or slow)

- **Repair upsell pay.** `payments:pay-link-webhook` has no purpose filter. It goes red when money landed and the link stayed open. It cannot see a mint that failed.
- **postgrid.** `repair-case-stuck` reads the `in_transit` clock, 10 days (`sla.mjs` line 9). Red, but only after 10 days.
- **lendflow.** `funding:round-stuck` goes red when an open round sits still 72 hours. Red, but only after 3 days.

### Missed by the map

1. **The card boxes on step 2.** The widget loads `cdn.embedded.fanbasis.io/embed/index.js` and has no fallback. No script, no card box, no sale. Nothing reads that script. It answers 200 today (21 KB).
2. **`apply.fundhub.ai/schedule/phonecall`.** A live ClickFunnels calendar page. Every delivered pack, the pull-failed fallback and the optimize pages send buyers there. Not in the registry. Not in any lane.
3. **Open times on the calendars.** The picker is checked. The times are not.
4. **Partner funnel pages at `/sites/<partner>/<page>` and custom domains** (`netlify/functions/partner-site.mjs`). 8 are published. No check, and the map never names it. One answers 200 today.
5. **Ad money with no sale.** Meta spent about $95 on Oct 3 and $120 on Oct 4. The last roadmap checkout started Oct 2. The last saved survey answer was Oct 2. No check compares spend to leads or checkouts. `funnel-click-stored` stays green because clicks still arrive. `ad-click-stored` skips under 20 clicks.
6. **Scripts the customer pages need** (`money-*.js`, `shell.js` and `data.js` on the portal, `fh.js`, `pw-toggle.js`). Nothing fetches them. The page can answer 200 and still be blank.

### Two limits on every 6 a.m. row

- **The coverage lanes have never run in the real 6 a.m. job.** The only saved scorecard (Oct 8, 6 a.m.) has 420 rows and 0 lane rows. The lanes shipped later that day. Tomorrow's run is the first. All proof so far is from the unpacked bundle and live read-only runs.
- **The `run-pulse` step has no total time limit.** It makes 395 asks, 8 at a time, 15 seconds each at worst. Netlify cuts a step at 26 seconds. When the site is slow (the day you need it), the step can be cut. The 5-minute watch still catches a dead site, login, apply and the roadmap page. Nothing else. A failed morning brief step is also swallowed (`workflows/daily-pulse.mjs` lines 116-124).
