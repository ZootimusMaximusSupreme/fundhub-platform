# Heartbeat map, group 06: partners and other (2026-10-09)

Read-only audit. No app code, tests, config or env were changed. Live proof was run read-only against production on the night of 2026-10-08 (Arizona) as the `fundhub_app` role, inside `BEGIN READ ONLY`, with GET-only web calls.

## What I covered

- `docs/journeys/affiliate-intended.md` and `affiliate-actual.md`
- `docs/journeys/white-label-intended.md` and `white-label-actual.md`
- `docs/journeys/authorized-rep-intended.md` (no `-actual.md` exists)
- `docs/journeys/fh-consulting-intended.md` (no `-actual.md` exists)
- `docs/journeys/optimize-intended.md` and `optimize-actual.md`

## Counts

67 steps counted (2 more rows, A3 and H7, are marked n/a and not counted).

| Status | Rows |
|---|---|
| covered (a deep check would go red) | 14 |
| ping-only (door answers, wrong data not seen) | 25 |
| weak (check exists, but it can only pass, skip, or is "not checked") | 14 |
| missing (nothing would go red) | 14 |

Holes where a customer loses money or is blocked: 41.

## In plain words

1. No real customer is in the data yet. Production holds only test affiliates and test partners. So no money check here has ever had a real case to read.
2. Only 14 of 67 steps would turn red when they break. 25 steps have only a "does the door answer" ping.
3. The affiliate money chain is almost blind. A sale that does not turn into a commission makes nothing red. A commission with no rate makes nothing red. Nothing in the code can clear the license and tax gates, and nothing reports a payout that waits for a person.
4. A white-label partner's published page is served by a function (`netlify/functions/partner-site.mjs`) that is on no watch list. It answers 200 today.
5. A $297 trial is provisioned by a person after the card is charged. Nothing counts a paid trial that nobody provisioned.
6. A real-looking white-label application (GPN Funding) has been "invited" since 2026-10-02. Nothing watches how long an application waits.
7. The real referral link for a partner is `/optimize.com`. The pulse pings `/optimize.html`, not that link. The "Book a call" calendar (`apply.fundhub.ai/schedule/phonecall`) is watched by nothing.
8. The 5-minute instant watch (`pulse-instant-watch`) checks only `health`, `login`, `apply`, `funnel:roadmap-sales` and `pipeline:outbound`. For this group only `health` and the stuck-message check (`pipeline:outbound`) matter.
9. Every door row in slice 22 (`22-partners:*`) and slice 31 (`31-affiliate-wl:*`) reads "not checked" in production. They have no last-success time, so they can never go red. The real door check is the `reg:` ping.
10. A job row is a snapshot at 6 a.m. A job that dies at noon and wakes up at midnight is never red.

## How I judged

- covered: a deep check exists and would flip within one morning when the step breaks for a customer.
- ping-only: only a `reg:` ping, a page load, or a "job has run" row. It sees a dead door. It does not see wrong data.
- weak: a check exists, but in production it can only pass, only skip, or is "not checked".
- missing: nothing would go red.
- "Can it go red" is about the break named in the step, not about any break.
- Every check id below was found in the code or in a read-only live run.

## Journey docs: stale or missing

| File | Finding |
|---|---|
| `affiliate-intended.md` | Not a step journey. It is a list of routes an affiliate may reach (88 routes counted on 2026-08-02). It was written after the fact from the same data as `-actual.md`. `affiliate-actual.md` now counts 323 routes (41 reachable). It has no click, referral, commission or payout step. I traced those from code and marked them "from code". |
| `white-label-intended.md` | Same. 88 routes in the intended file, 323 in the actual file (77 reachable). The "Marketing suite (beta)" notes are the only step content. The apply, approve, pay, publish and payout steps are traced from code. |
| `authorized-rep-intended.md` | Current. It matches `db/migrations/397_authorized_representatives.sql` and `src/auth/authorized-rep.mjs`. There is no `authorized-rep-actual.md`, and it is not on the CLAUDE.md section 4 list of tracked journeys. |
| `fh-consulting-intended.md` | Stale. It describes an education site with three posted prices ($5,000, $5,000, $10,000) and an email to `support@fundhub.ai`. The live page says "Marketing consulting for agencies", posts no prices, and uses `support@fhconsulting.online` (commits `a9af0815`, `4a6405f9`, `c6650471`). No `-actual.md`. |
| `optimize-intended.md` | Behind the code. It still describes the Pay for Audit checkout. The page no longer has it (removed 2026-08-28, said so in `optimize-actual.md`). The `POST /api/public/optimize` door still exists but no page calls it. I did not count that step. |

---

## Table 1. Affiliate: the groups in the intended file

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| A1 Sign in, out, reset, session | `reg:auth/login`, `reg:auth/logout`, `reg:auth/magic-link`, `reg:auth/magic-link-verify`, `reg:auth/reset`, `reg:auth/session`, `gap:auth-session-read`, `gap:auth-reset-mail` | deep + ping | Yes if a route is gone or a database permission is missing. No for a bug only in affiliate sign-in. | 6am | weak | customer-blocked |
| A2 Sign the partner license (`contracts/sign`) | `contracts:sign-route`, `contracts:template-missing`, `job:contract-chaser` | deep | Yes for the sign door. The PARTNER-LICENSE form is not on the template list, so a missing form stays green. | 6am | weak | money |
| A3 Documents link (`documents/[id]`) | `documents:cannot-open` | n/a | No affiliate step I could trace uses it. Not counted. | 6am | n/a | n/a |
| A4 Site health | `health`, `reg:health` | deep | Yes. Strict health reads the database. | 5min | covered | money |
| A5 Incoming webhooks (`webhooks/[provider]`) | `webhooks:commas`, `webhooks:clickfunnels`, `webhooks:twilio-status`, `webhooks:calendar-booking` | deep | Yes if the router is not mounted. It does not read the payload (see B6). | 6am | covered | money |

## Table 2. Affiliate: steps traced from code (not in the intended file)

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| B1 Apply page has the form and posts to the right door | `offer:affiliates`, `reg:affiliates-index` | deep | Yes. Red if the form id, the door name or POST is gone. | 6am | covered | money |
| B2 Submit makes the affiliate, login and link | `reg:public/partner-apply` | ping | No. A GET gets 405 before any code runs. A failing submit stays green. | 6am | ping-only | money |
| B3 Welcome email AF1 | `job:af-01-affiliate-drip`, `17-affiliates:af-01-affiliate-drip`, `pipeline:outbound`, `email:provider-fail` | ping + queue | Partly. The job only fills test emails (+aff-, +sim-) and hides its own error. A draft AF1 template queues nothing and nothing goes red. | 6am (5min for a stuck queue) | weak | internal |
| B4 Share link `/start?ref=` opens and sends on | `partners:referral-link`, `offer:start`, `reg:start` | deep | Yes. Reads the live page for the click call and the funnel link. | 6am | covered | money |
| B5 Click is saved (`POST affiliate-click`) | `reg:public/affiliate-click`, `partners:referral-link` | ping | No. A failing POST leaves no rows and no red. The code still travels in the funnel link. | 6am | ping-only | internal |
| B6 Lead arrives with the code and the referral row is written (af-02) | `17-affiliates:af-02-referral-ownership-capture`, `31-affiliate-wl:af-02-referral-ownership-capture` | none | No. Event rows read "not checked" in production, always. | none | weak | money |
| B7 Sale closes, referral turns converted and earns a commission | none | none | No. `convertSafe` hides its own error. `partners:commission-payable` only reads rows already converted. | none | missing | money |
| B8 Converted with no rate (commission left blank) | none | none | No. `unratedConversions()` is never called by the pulse. `partners:commission-payable` skips blank. Production holds one such test row today. | none | missing | money |
| B9 Monthly payout run writes pending or held rows | `job:affiliate-payout-run`, `17-affiliates:affiliate-payout-run`, `31-affiliate-wl:affiliate-payout-run`, `partners:commission-payable` | deep (gated) | Job row first goes red on 2026-11-02 if no run. Slice rows stay green until about 2026-11-25 on a test payout from 2026-08-25. The deep check cannot go red today: no affiliate has both a license and a tax form. Errors inside the run come back as data, so the job says ok. | 6am | weak | money |
| B10 License and tax gates get cleared | none | none | No. No code in `src/`, `api/`, `netlify/` or `scripts/` writes `partner_license_signed_at` or `tax_form_received_at`. Held payouts never clear and nothing reports old ones. | none | missing | money |
| B11 Payout sits in processing | `partners:payout-stuck` | deep | Yes after 7 days. Today the table has only 1 paid test row, so it can only pass. | 6am | covered | money |
| B12 Payout sits in pending, waiting for a person to pay | none | none | No. Only processing over 7 days is watched. | none | missing | money |
| B13 Affiliate sees referrals and payouts (`affiliate.html`, `read/affiliate-portal`) | `reg:affiliate`, `reg:read/affiliate-portal`, `31-affiliate-wl:affiliate.html`, `live-playwright:desks` | ping | No for a 500 to a signed-in affiliate: the unsigned ping gets 401 first. The laptop sweep does open the affiliate dashboard, but nobody schedules it. Last run 2026-10-07, so it is red today for age, not for a break. | 6am | ping-only | customer-blocked |
| B14 Client presses Refer a friend (`affiliates/refer`) | `reg:affiliates/refer` | ping | No. A GET gets 405 before any code runs. | 6am | ping-only | customer-blocked |
| B15 Staff screens: roster, commissions, rules | `reg:read/affiliates`, `reg:commissions`, `reg:commission-rules`, `reg:read/commissions`, `reg:products-commissions` | ping | Door dead only. | 6am | ping-only | staff-only |

## Table 3. White-label partner: the groups in the intended file

Health, webhooks and documents are the same as A3 to A5 and are not counted twice.

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| C1 Partner signs in | `partners:login-door`, `reg:auth/login`, `gap:auth-session-read` | deep (coarse) | Only if the route is gone or no active partner can sign in (10 of 13 can today). One locked-out partner stays green. Password sign-ins of partners are not in `gap:auth-signin-no-session`. | 6am | weak | customer-blocked |
| C2 Campaigns (list, connections, spend, sync, write, link-asset, meta-agency) | `reg:campaigns/list`, `reg:campaigns/connections`, `reg:campaigns/sync`, `ads-meta-sync-stale`, `job:meta-campaign-sync-hourly` | ping + deep | The sync check reads the newest sync across all accounts, so one stale partner account hides. | 6am | weak | money |
| C3 Partner license (`contracts/sign`, PARTNER-LICENSE) | `contracts:sign-route`, `contracts:template-missing`, `job:contract-chaser` | deep | Same as A2. The partner agreement date unlocks all partner pay, and the form is not on the template list. | 6am | weak | money |
| C4 Creative Factory (generate, jobs, library, approvals) | `reg:creative/generate`, `reg:creative-factory`, `job:creative-job-runner`, `owner-tools:creative-factory` | ping + staff read | The job row says it ran. A job that fails inside the run is not read. | 6am | weak | internal |

## Table 4. Marketing suite (beta, off by default)

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| D1 Off state: colors and logo save, AI buttons stay dark | `reg:partner-brand`, `reg:brand-studio`, `reg:partner-marketing/enable` | ping | No. Nobody reads the flag. | 6am | ping-only | internal |
| D2 Only the owner can flip it on | `reg:partner-marketing/enable` | ping | No. The rule lives in code and tests only. | 6am | ping-only | internal |
| D3 Copy writer, history, restore, wordmark | `reg:partner-marketing/generate-copy`, `reg:partner-marketing/generate-logo`, `reg:partner-marketing/copy-history` | ping | No. Doors answer 405 or 401. Owner call: no AI spend for now. | 6am | ping-only | internal |
| D4 Locked legal blocks stay on published pages | none | none | No. Nothing reads a published page. | none | missing | internal |
| D5 Social Studio queue | `social:studio-read`, `job:social-publish-sweeper`, `reg:social/posts` | deep | Yes if the read would 500. The partner settings read runs only when a partner exists. | 6am | covered | internal |
| D6 Usage card, 250,000 token cap | `reg:partner-marketing/usage` | ping | No. | 6am | ping-only | internal |

## Table 5. White-label partner: steps traced from code

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| E1 `/affiliates/` page, white-label form | `offer:affiliates`, `reg:affiliates-index` | deep | Yes. Same page and form as B1. | 6am | covered | money |
| E2 Submit writes an invited partner and a card | `reg:public/partner-apply` | ping | No. A GET gets 405 before any code runs. | 6am | ping-only | money |
| E3 Application waits for a person to approve | none | none | No. Nothing counts how long it waits. GPN Funding has been "invited" since 2026-10-02. | none | missing | money |
| E4 Approve: login, brand row, page, active | `reg:partners/approve` | ping | No. A GET gets 405. | 6am | ping-only | customer-blocked |
| E5 Welcome email and text | `pipeline:outbound`, `email:provider-fail`, `gap:sms-provider-failed` | deep | Stuck or failed sends go red. A missing or draft template queues nothing, so nothing goes red. | 6am (5min for a stuck queue) | weak | customer-blocked |
| E6 Partner funnel pages (`/partner/`, menu, trial, board) | `offer:partner`, `offer:partner-menu`, `offer:partner-trial`, `offer:partner-board`, `offer:partner-checkout-script` | deep | Yes. Red if the price hook, form or checkout script is gone. | 6am | covered | money |
| E7 The till can take money (`funnel-checkout`) | `reg:public/funnel-checkout` | ping | No. It answers 200 even when checkout is not ready. The roadmap till has a deep read (`funnel:roadmap-checkout`); this one has none. | 6am | ping-only | money |
| E8 Payment lands and settles | `payments:pay-link-webhook`, `webhooks:commas`, `payments:commas-webhook-route` | deep | Only a webhook seen and not settled goes red. `payments:paid-no-entitlement` skips payments with no client. | 6am | weak | money |
| E9 $297 trial is provisioned after payment | none | none | No. A person runs `trials/provision`. Nothing counts paid trials without a `live_trials` row. | none | missing | customer-blocked |
| E10 Trial dashboard, clock, day-8 decision | `reg:trials/dashboard`, `reg:trials/eligibility` | ping | No. 401 and 405 come before any code runs. | 6am | ping-only | customer-blocked |
| E11 $47 board renewals | `job:subscription-billing-sweeper`, `reg:partner-board-live-index` | ping | No. The job is green by design: it charges nothing. Missed renewals are not read. | 6am | ping-only | money |
| E12 Brand Studio save and approval | `reg:partner-brand`, `reg:brand/review`, `reg:brand-studio`, `owner-tools:brand-studio` | ping | No. The deep read is the company brand, not a partner brand. | 6am | ping-only | customer-blocked |
| E13 Published page served at `/sites/{id}/{slug}` and on a custom domain | none (`reg:public/partner-page` is the JSON preview door) | none | No. `netlify/functions/partner-site.mjs` is on no list. It answers 200 today. 8 published pages, all test partners. | none | missing | money |
| E14 Custom domain check | `reg:partner-brand/verify-domain` | ping | No. A GET gets 405. | 6am | ping-only | customer-blocked |
| E15 Partner training (the $10,000 curriculum) | `training:page`, `training:read-api`, `training:required-step` | deep | Yes. Runs the real read in process and checks 13 steps and 4 gates. | 6am | covered | customer-blocked |
| E16 Partner home and production screens | `reg:partner-galaxy`, `reg:read/partner-home-tiles`, `reg:read/partner-production`, `22-partners:partner-galaxy.html` | ping | No. 401 comes first. The slice rows read "not checked". | 6am | ping-only | customer-blocked |
| E17 Revenue share is written on each payment | none | none | No. `accrueForPaymentSafe` hides its own error. Nothing compares payments to `partner_revenue`. | none | missing | money |
| E18 Partner payouts | `partners:payout-stuck` | deep (gated) | Only for a run in processing over 7 days. No code builds partner payouts, so today it can only pass. Owed money that nobody pays is not read. | 6am | weak | money |
| E19 Monthly production floor review | `job:partner-production-floor`, `22-partners:partner-production-floor`, `31-affiliate-wl:partner-production-floor` | ping | Job row first goes red 2026-11-03 if no run. The review scores nobody until partners have an activation date. Zero reviews on file. | 6am | weak | internal |
| E20 Add-ons: buy, cancel, activate | `reg:partner-addons` | ping | No. 401 comes first. | 6am | ping-only | money |
| E21 Staff: partner roster | `reg:read/partners` | ping | Door dead only. | 6am | ping-only | staff-only |

## Table 6. Authorized representative

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| F1 Staff add the rep to a file | `reg:auth/authorized-rep` | ping | No. 401 comes before any code runs. | 6am | ping-only | customer-blocked |
| F2 One live person per file | database unique index `client_authorized_reps_one_live` (migration 397) | database guard | The database refuses a second live rep. It is a guard, not a pulse row. | n/a | covered | internal |
| F3 Rep gets the sign-in email link | `gap:auth-magic-link-dead`, `email:magic-link-unqueued`, `gap:auth-signin-no-session` | deep | Yes when a link was asked for in the last 24 hours and no email was queued. A rep with no file link still stays green. | 6am | covered | customer-blocked |
| F4 Portal opens the first file; switch files | `reg:auth/authorized-rep-file`, `reg:auth/session`, `portal:page`, `portal:summary` | ping | No. The portal reads run for a client, not for a rep. | 6am | ping-only | customer-blocked |
| F5 Texts and emails for linked files go to the rep | none | none | No. Email and phone are required when staff add the rep, so "no address" cannot happen. But nothing compares where a message went to who the live rep is. | none | missing | customer-blocked |
| F6 A file with nobody linked still messages the client | `gap:sms-provider-failed`, `email:provider-fail`, `pipeline:outbound` | deep | Yes. Failed or stuck sends go red. | 6am (5min for a stuck queue) | covered | customer-blocked |
| F7 The rep's text reply or photo lands on the right file | `40-more:dpc-03-inbound-reply-router` | none | No. It is an event row, so it reads "not checked". | none | weak | customer-blocked |

## Table 7. FH Consulting

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| G1 Visitor opens `/consulting/` on fundhub.ai | `reg:consulting-index` | ping | Page gone only. Nothing reads the words. | 6am | ping-only | money |
| G2 Visitor opens `fhconsulting.online` (edge function `fhconsulting-host`) | none | none | No. The pulse pings the fundhub.ai host only. If the edge function breaks, the Fundhub homepage shows on the consulting domain. | none | missing | money |
| G3 Page says what it must say (no card taken, no guarantee, 14-day refund, mailto address) | none | none | No. The ping reads the status code only. | none | missing | money |
| G4 Terms, Privacy and Refund pages | `reg:consulting-terms-index`, `reg:consulting-privacy-index`, `reg:consulting-refund-index` | ping | Page gone only. | 6am | ping-only | internal |

## Table 8. Optimize (hidden referral page)

| Step | Check id(s) | Depth | Can it go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| H1 `/optimize` shows the page | `reg:optimize`, `offer:optimize` | deep | Yes. Red if the form id or the door hook is gone. | 6am | covered | money |
| H2 `/optimize.com` alias (a real referral partner uses this link) | none | none | No. The pulse pings `/optimize.html`. The `netlify.toml` rewrite is not pinged. It answers 200 today. | none | missing | money |
| H3 Book a call goes to `apply.fundhub.ai/schedule/phonecall` | none | none | No. `funnel:funding-book-call` and `funnel:roadmap-book` are other pages. This calendar is also the close on the roadmap, credit analysis and funding deliverables. It answers 200 today. | none | missing | money |
| H4 `/optimize-plan` page loads with its form | `reg:optimize-plan`, `offer:optimize-plan` | deep | Yes. Red if the intake form or the door hook is gone. | 6am | covered | money |
| H5 Plan is drawn (`GET /api/public/optimize?view=roadmap`, repair brain on the stored sample file) | `reg:public/optimize` | ping | No. The ping reads the config answer, not the roadmap view. Nothing runs the brain. | 6am | ping-only | money |
| H6 SmartCredit link or widget (shown only if the keys are set) | `reg:public/optimize` | ping | No. The ping does not read the link or whether the widget stays off. | 6am | ping-only | money |
| H7 Pay for Audit (intended step) | n/a | n/a | The page no longer has it. Doc is stale. Not counted. | n/a | n/a | n/a |

---

## Evidence I ran (read-only)

- `gap-live.mjs partners`: 4 PASS, 0 FAIL, 0 skip, 0 writes (`partners:referral-link`, `partners:commission-payable`, `partners:login-door`, `partners:payout-stuck`).
- Slices 17, 22 and 31 run against production: `17-affiliates:af-01-affiliate-drip` PASS; `17-affiliates:affiliate-payout-run` PASS on a test payout from 2026-08-25; every `22-partners:*` and `31-affiliate-wl:*` door row "not checked".
- Job rows: `job:af-01-affiliate-drip` PASS; `job:affiliate-payout-run` and `job:partner-production-floor` skip ("too soon"). Simulated "no run" dates: `job:affiliate-payout-run` first FAIL 2026-11-02; `job:partner-production-floor` first FAIL 2026-11-03.
- `registry` ping of 63 in-scope rows: all up (GET only).
- Live data: 23 affiliates, 27 clicks, 3 referrals (1 converted, blank commission, test), 1 paid payout (test); 15 partners (13 active, 2 invited); 0 live trials; 0 partner payment links; 0 partner revenue rows; 0 production-floor reviews; 10 partner pages (8 published, all test partners); 2 live authorized reps.
- `GET /api/public/funnel-checkout`: `checkout.ready` true, four items listed.
- `fhconsulting.online/` answers 200 with the marketing-consulting page. `/optimize.com` answers 200. `/start?ref=...` answers 200.
- `live-playwright:desks`: last two sweeps 2026-10-07 21:12 (fail) and 21:40 (pass 41 of 41). None since.

---

## Checker — 2026-10-09

Verdict: not confirmed. Most of the map holds. Three "covered" rows are wrong, and eight steps were skipped. Read-only check. I changed nothing else.

### What I ran

- Looked up every check id in the map (120). All are real.
- Ran the 78 tests for the funnels, partners, training and webhooks gap files. All pass.
- Ran the live partners lane. 4 pass, 0 fail, 0 writes.
- Read-only SQL on production. Plain role and staff role see the same rows, so no check passes just because it cannot see the data.
- Looked in `src/pulse`, `src/ops` and the job list for any check the mapper missed.

### Covered rows I tried to break (all 14)

| Row | Result |
|---|---|
| A4 health | Holds. Also in the 5-minute watch. |
| A5 webhooks | Holds for "door is gone". Caveat below. |
| B1, E1 affiliate page | Holds. Goes red if the form, the door name or POST is gone. |
| B4 share link | Holds. Reads the live start page and the funnel link. |
| D5 social queue | Holds. Internal only. |
| E6 partner funnel pages | Holds. |
| E15 training | Holds. Caveat: the read runs as staff for a fake partner, so a break only in a real partner's view would stay green. |
| F3 rep sign-in email | Holds. Magic links live 15 minutes, which fits the 20-minute window in the check. |
| H1, H4 optimize pages | Holds. |
| **B11 payout in processing** | **Wrong. Should be weak.** |
| **F6 file with no rep still messages the client** | **Wrong. Should be weak.** |
| **F2 one live rep per file** | **Wrong. Not a tripwire.** |

### Why those three are wrong

- **B11.** The code never sets a payout to "processing". The file says that move is "a separate, human action" with no payment rail in the repo (`src/affiliates/payouts.mjs` line 16). The only watch is "processing for 7 days". So it can only pass today, and it would be 7 days late. The mapper said the same words for E18 ("can only pass") and still called B11 covered.
- **F6.** The send checks skip the "has no address to send to" failure on purpose (`gap-sms.mjs` line 244, `gap-email.mjs` line 60). That is the exact error the dispatcher writes when the fallback to the client breaks (`dispatch.mjs` line 574). A message sent to the wrong person looks like a good send. Nothing goes red.
- **F2.** It is a database lock (migration 397). It stops the break. It cannot turn red. It does not belong in "covered". Call it n/a.

### Corrected counts for the 67 rows

| Status | Map said | Checker says |
|---|---|---|
| covered | 14 | 11 |
| ping-only | 25 | 25 |
| weak | 14 | 16 (adds B11, F6) |
| missing | 14 | 14 |
| n/a | 2 | 3 (adds F2) |

Money or customer-blocked holes: 41 became 43.

### Caveat on A5 (still counted as covered)

The webhook probes only prove the door is mounted. A bad signing secret is answered 401 and 401s are never stored (`router.mjs` line 218). `gap-payments.mjs` line 104 says a webhook that never arrived leaves no row. So a wrong secret means every real payment post is refused and nothing goes red. See A5b below.

### Missing rows: all 14 confirmed

I looked for a check the mapper missed on every one. I found none. `notActuallyMissing` is empty. Two small notes:

- **B7.** `money-chain.mjs` says a deal that funds but never pays its success fee never converts. The referral stays "attributed" and earns nothing. That is an owner call, and it adds to this hole.
- **E8 is a little stronger than the map says.** A partner payment that fails to process 10 times goes red on `webhooks:stuck-failed`. The Commas jobs `job:commas-inbox-drain` and `job:commas-inbox-sweeper` also feed it. Still weak: `payments:paid-no-entitlement` skips payments with no client (`gap-payments.mjs` line 174).

### Steps the map skipped

| Id | Step | Status | Impact | Why |
|---|---|---|---|---|
| G5 | `support@fhconsulting.online` can receive mail | missing | money | The consulting page has no form post and no booking link. It only builds a `mailto:` to this address (5 times in `public/consulting/index.html`). On 2026-10-08 the domain's own name servers (`ns39.domaincontrol.com`) and 8.8.8.8 returned no MX record. Mail to that address has nowhere to go. No check looks at mail setup. |
| B16 | Refund or chargeback after an affiliate earned a commission | missing | money | `money-chain.mjs` line 1462: the affiliate's cut has no reverse yet. The commission stays and the monthly run can queue it. Nothing compares refunded sales to converted referrals. |
| E22 | Refund or chargeback reaches the partner revenue ledger | missing | money | The void is wired (`payment.refunded`, `payment.disputed`). A refused reversal only writes a log line. No pulse row reads it. A dispute we win does not undo the void by itself. |
| E23 | Partner recruit bonus ($2,000 once, on the $10,000 entry) | missing | money | `src/partners/recruit.mjs` fires on `payment.received`. Nothing in `src/pulse` reads it. 0 recruited partners in production, so it has never run for real. |
| E24 | A partner sees only their own book (row security holds in production) | missing | money | This is the "should stay blocked from" half of the white-label journey. The two guards (`guard:db`, `guard:rls`) run in CI only. No pulse row or health read asks production. |
| A5b | Real payment and lead posts are accepted (signing secret still matches) | weak | money | `webhooks:commas`, `webhooks:clickfunnels`, `payments:commas-webhook-route` expect the 401 on an unsigned post. A wrong secret makes every real post a 401 and stays green. |
| E10b | Live trial page `/partner/trial/live/` | ping-only | customer-blocked | `reg:partner-trial-live-index` is a status ping. E10 does not list it. A paying $297 trial partner opens this page. |
| B17 | Affiliate and partner Company Brain (`read/company-brain-affiliate`) | ping-only | internal | `reg:read/company-brain-affiliate` is a status ping. Nothing checks the allowlist that keeps internal files from outside users. AI spend is paused by owner call. |

### One thing to say once

G5 is not only a missing tripwire. By the DNS look above, the one way a buyer can reach FH Consulting may be dead right now. A mail look-up check (read-only) would flip red. I did not fix or touch it.
