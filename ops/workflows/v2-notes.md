# V2 notes — fixes wanted, built later

Started 2026-10-24 (launch weekend). Nothing on this list gets built this weekend.
Chris clicks. The AI writes down what he says. Every fix goes here.

## How to log one

One row per fix. Fill all five boxes.

- **Date** — the day Chris said it
- **What** — the fix, in one short line
- **Where** — the page link or the file
- **Why** — what felt wrong, in his words if he said it
- **Priority** — `V2 — not this weekend`, or `Before Monday` only if a client sees it before ads go on

## The list

| # | Date | What | Where | Why | Priority |
|---|---|---|---|---|---|
| 1 | 2026-10-24 | Ad spend is not landing. The newest ad day saved is Oct 7. The last day with spend is Oct 4 ($120.21). The sync job still runs each night. | Table `ad_metrics_daily`; check `meta-sync` (green) | We can not see cost per booked call in the CRM yet. Ads were off since about Oct 5, so there was no new spend to save. | V2 — not this weekend. Monday: track cost per booked call in Ads Manager. Tuesday 7 a.m.: look for an Oct 26 row. |
| 2 | 2026-10-24 | Money is not connected to the dashboard. | Owner dashboard / money tiles | Chris named it. | V2 — not this weekend |
| 3 | 2026-10-24 | Calendar-host check: retire it, or mark it "expected". Chris is the only host. | Check `closer-setup:calendar-late` (`src/pulse/coverage/gap-closer-setup.mjs`) | Justice Nikkel and Sarah Blankstein were asked Oct 7, due Oct 10, never joined. It stays red every day. | V2 — not this weekend. One-line owner decision. |
| 4 | 2026-10-24 | Stop counting the same break twice. | Scorecard rows `job:finance-os-money-agent` + `07-finance:finance-os-money-agent`; the two commission ledger rows | 7 red rows are really 5 breaks. | V2 — not this weekend |
| 5 | 2026-10-24 | 23 weak catalog points need a real live check (level 3). | `src/pulse/catalog/generated.json` | Their best check today is level 2. List is on the weekend board, section 5. | V2 — not this weekend |
| 6 | 2026-10-24 | Rebuild the catalog. | `src/pulse/catalog/generated.json` (last built Oct 15, commit `676507d3a`) | 8 days old. New pages since then are not in it. | V2 — not this weekend |
| 7 | 2026-10-24 | Playwright desk sweep is stale. | Check `live-playwright:desks` | Last run 375 hours ago (about 15 days). Last result was 41 of 41. | V2 — not this weekend |
| 8 | 2026-10-24 | Money agent times out. | Job `finance-os-money-agent` | Red every morning. | V2 — not this weekend |
| 9 | 2026-10-24 | Commission ledger is empty. | Commission ledger page tiles + table | Red two times on the scorecard for one break. | V2 — not this weekend |
| 10 | 2026-10-24 | One creative-factory script is missing a label. | Creative factory scripts (1 of 35) | Red on the scorecard. | V2 — not this weekend |
| 11 | 2026-10-24 | Ad-to-teleprompter pipeline drift. | Grok's plan: `ops/workflows/drift-free-plan-2026-10-24.md` | Chris named it. Grok owns the plan. | V2 — not this weekend |
| 12 | 2026-10-24 | Cut bank links down to Giovanni's banks only. | `lenders` table (1,106 rows, 1,057 Apply links); shown on `/app/lenders.html`, the lender match list, `/app/money-banks.html` | List received 2026-10-24. Prep is in `ops/workflows/giovanni-banks-2026-10-24.md`. 1,073 rows would be hidden. | V2 — not this weekend. Waiting on Chris to say go. |
| 13 | 2026-10-24 | Old ClickFunnels `/order` page can still take a real $297 payment. Nothing links to it. | https://apply.fundhub.ai/order | Landing page cleanup. From `docs/tracking/page-inventory.md` row 9. | V2 — not this weekend |
| 14 | 2026-10-24 | Old $297 pages are still up: `/roadmap/`, `/roadmap/pay.html`, `/roadmap/pull.html` on fundhub.ai. | https://fundhub.ai/roadmap/ | Landing page cleanup. Live traffic uses apply.fundhub.ai/roadmap. | V2 — not this weekend |
| 15 | 2026-10-24 | The "Meeting with Chris" calendar carries none of our tracking. | https://apply.fundhub.ai/schedule/phonecall | Landing page cleanup. Packs and `/optimize` link here. | V2 — not this weekend |
| 16 | 2026-10-24 | Cortana: named funnel events, ad-to-booking ID, and the server feed are still missing. | `ops/workflows/cortana-link-audit-2026-10-20.md` | Pages have the tag. Cortana can not yet match a booking to an ad. | V2 — not this weekend |
| 17 | 2026-10-24 | Apply Giovanni bank list (hide others, fix links/logos) — prepared in giovanni-banks-2026-10-24.md, waiting on Chris go. | `lenders` table; `ops/workflows/giovanni-banks-2026-10-24.md` | The list is in. The cut and the link fixes are written down. Nothing was changed in the app. | V2 — not this weekend. Waiting on Chris go. |

| 18 | 2026-10-26 | `/apply` parent stays put after booking in an iframe. | Apply survey and funnel tracker | Customer misses thank-you and its tracking. | Before Monday — funnel lane |
| 19 | 2026-10-26 | Booking email lacks a confirm action. | S-04B email template | SMS may not arrive. | Before Monday — email lane |
| 20 | 2026-10-26 | Reused email keeps an older name and phone. | Client lifecycle | New form values must win for a real booking. | Before Monday — booking lane |
| 21 | 2026-10-26 | Polish the post-book email beyond the minimum. | S-04B | App-first copy can improve later. | V2 |
| 22 | 2026-10-26 | Thank-you page's calendar button creates a second host event without guest or Meet. | Thank-you calendar links | Read-only host calendar showed two events at one time: the true invite has one guest and Meet; the self-added event has neither. Remove the duplicate links. | Before Monday — funnel lane |
| 23 | 2026-10-26 | Portal sign-in leads with expiring link copy. | `public/portal-login.html` | Customer should get the app and confirm there. | Before Monday — integration lane |
| 24 | 2026-10-26 | Booking email needs an alternate call-confirm path. | S-04B email | Customer should not depend on SMS alone. | Before Monday — email lane |
| 25 | 2026-10-26 | Real walk paused after Phase 2. | Walk log | Resume only after fixes are live and proved. | Process |
| 26 | 2026-10-26 | App Store taps need Cortana and server funnel events from thank-you, email path and portal. | Shared tracker, app CTAs | Prove a human tap and preserve Meta Lead. | Before Monday — funnel and email lanes |
| 27 | 2026-10-26 | Mac runs the iPhone app. | iOS tooling | Native Mac target is separate product work. | V2 |

Add new rows under row 27 as Chris talks.

### Cortana booking receipt repair, 2026-10-29

- **Owner:** Codex owns the Fundhub server feed and DirectROAS source. Claude owns the funnel event retry in PR #251; those files are separate.
- **Ground truth:** ClickFunnels bookings 75827 and 75829 reached Fundhub but were absent from DirectROAS's native ClickFunnels receipt list. Both were sent to the new Funding Call webhook source on October 29; the source showed 2 successes and 0 failures. A separate setup event was marked test.
- **Plan:** Reuse the saved `bookings` row, `client_ad_attribution`, the adapter outbound fence, and the Netlify cron clock. Add one delivery ledger and one five-minute sender. Keep the calendar, pixel, qualification copy, and funnel HTML unchanged.
- **Proof:** Run focused provider, retry, workflow registry, lint, full suite, migration manifest, and diagram checks. Deploy with the production webhook URL and verify a real or controlled new booking in DirectROAS before saying future sends work live.
- **Risk:** A vendor timeout after acceptance can be ambiguous; the booking ID stays stable in the payload. Failed sends stay in the ledger and the job heartbeat goes red.

### Qualified vs unqualified credit pixel split, 2026-10-29

- **Owner call (2026-10-29):** The two buckets only split the Meta pixel. Same calendar, same people take the call, same thank-you page. Qualified credit is a score answer of 700-749 or 750+ (the same 700 line UnderwriteIQ uses for "fundable"). Every other answer, including "Not sure", is unqualified.
- **Owner:** Claude owns the funnel lane (Chris, 2026-10-29). Branch `feat/funnel-credit-pixel-split`. Codex was told on Tether to stay out of these files.
- **Spec:** The /apply survey sends `credit_tier` (`qualified` or `unqualified`) on its last answer. It never sends the score itself. The shared tracker keeps that tier for the tab and puts it on the booking it relays. Lead and Schedule still fire for everyone. Each person also fires `QualifiedLead` or `UnqualifiedLead` on the last answer, and `QualifiedSchedule` or `UnqualifiedSchedule` on the booking. The browser and the server send each one under the same event id, so Meta counts it once. The word "credit" and the score never go to Meta.
- **Why no second calendar or page:** The ClickFunnels API cannot create a calendar. The bucket comes from the survey answer, not from the calendar. Meta can optimize an ad set on the new events, so a second thank-you web address is not needed.
- **Files:** `marketing/landing-pages/apply-survey.html` (no visible change), `public/funnel/fh-events.js`, `src/funnel/track.mjs`, `src/meta/map.mjs`, their tests, `docs/tracking/meta-events.md`, `docs/tracking/tracking-spec.md`.
- **Proof:** Focused tracker, survey, Meta map and door tests; lint; GitHub CI; ship; ClickFunnels push of `/apply`; a live browser check that catches the sends before they leave the page.
- **PR #251 live proof (2026-10-29, checked by a different chat than the fixer):** Merged as `855c8545`. Before the ship, a browser on the live `https://apply.fundhub.ai/thank-you` with a kept booking in the tab sent no `booking_confirmed` (FAIL). After `https://fundhub.ai/funnel/fh-events.js` served the new code, the same check sent it once, with the exact kept body, cleared the key, and sent nothing on a second load (PASS). The browser's send was stubbed and the door was blocked, so no row reached the live database and nothing reached Meta.
- **PR #260 shipped to ClickFunnels (2026-10-29):** Merged as `d9b69f31`. `/apply` (page 25515671) was pushed from the merged file. A cache-busted view of `https://apply.fundhub.ai/apply` matches the repo file, has `QUALIFIED_SCORES`, one Meta pixel, and the same "...qualified. Pick a time below." wording. The server side waits for the GitHub ship; until then the live door drops `credit_tier`, so nothing is lost.

### Funding call bucket (`qualification_bucket`), 2026-10-29

- **Ask (Chris, through the orchestrator chat):** Two internal buckets, funding-qualified and funding-unqualified, with Capital Blueprint and credit repair together in the second one. Save a stable value on each client and booking. Route each bucket to its own ClickFunnels calendar. Keep the page words, the one Meta pixel, the hosts and the hours. Never full-replace `/funding-book-call`. Codex owns the Cortana webhook payload (`src/workflows/cortana-booking-feed.mjs`, `src/messaging/providers/cortana-booking-webhook.mjs`).
- **Rule reused:** `src/config/survey-qualification.mjs`, gate 1 (`PASSING_FICO_BANDS` = 700-749, 750+). A definite "Yes" on negatives moves a passing score down. A missing negatives answer does not, because `/apply` never asks it. "Not sure" is unqualified. No score answer yet is NULL, not a guess. The page pixel split uses the same bands; a test holds them together.
- **Field for Cortana (Codex wires it):**
  - `bookings.qualification_bucket` — `'funding_qualified'` | `'funding_unqualified'` | NULL. Set once from the client when the booking is saved, then never changed (trigger `trg_bookings_qualification_bucket`).
  - `clients.qualification_bucket` — same two values | NULL. Follows the client's newest score answer.
  - Database CHECK allows only the two values. Source: `db/migrations/508_qualification_bucket.sql`. Writer: `stampQualificationBucket` in `src/config/survey-qualification.mjs`, called by `onSurveySubmitted` in `src/handlers/client-lifecycle.mjs`. Constants: `FUNDING_QUALIFIED`, `FUNDING_UNQUALIFIED`, `QUALIFICATION_BUCKETS`.
- **ClickFunnels calendars, checked 2026-10-29:** There is one live calendar. `/funding-book-call` (page 25062844) holds the native scheduler "Funding Strategy Meeting", event type 14234, host 14784. `/roadmap-book` frames that same page. The Capital Blueprint "Book a call" page (25783743) is not live on `apply.fundhub.ai`. Of 60 booked events in the API, 56 are "Funding Strategy Meeting" and 4 are an old "Meeting" type from August and September. The ClickFunnels API can only read booked events (`GET /workspaces/{id}/appointments/scheduled_events`). It cannot make a calendar or a meeting type.
- **Second calendar, 2026-10-29 (Chris decided two ClickFunnels calendars):**
  - A second native meeting type now exists: event type 14959, made in the ClickFunnels app (not by API), at `https://apply.fundhub.ai/schedule/funding-strategy-meeting--6ffa5`. Same name "Funding Strategy Meeting". That page is a bare standalone scheduler: no Meta pixel, no `fh-events.js` or `fh-attribution.js`, no booking relay to `/apply`, no move to `/thank-you`. Framed in `/apply`, the unqualified group would lose its Schedule and UnqualifiedSchedule events and the thank-you page.
  - By API, `POST /funnels/968281/clone_actions` (receipt EYRBlY) made funnel 994750, "Copy of Fundhub Funnel". Its booking page 25820226 is live at `https://apply.fundhub.ai/funding-book-call--02424` with the same scripts, the same words, one pixel, and the same relay and thank-you move as `/funding-book-call`. Its scheduler still points at event type 14234, host 14784 (the API cannot change a scheduler). `live_mode` false only changes payments. It also holds copies of the VSL, Apply and Thank You pages at generated paths that nothing links to.
  - Both booking messages carry the page at the top level (`page.id` 25062844 for `/funding-book-call`, 25820226 for the copy, none for a standalone `/schedule` page), so the page is the calendar's identity. The event type name is the same on both.
  - **Resolved 2026-10-30:** Chris chose two calendars, and Codex set the copy page's Appointment Scheduler to event type 14959 (host 15580) in the ClickFunnels builder. Checked live: `/funding-book-call` has event type 14234 (host 14784); `/funding-book-call--02424` has event type 14959, the same words, `fh-events.js`, one pixel, the booking relay (`CAL='funding-book-call'`) and the thank-you move.
  - **/apply pushed with the routing, 2026-10-30 ~00:57 UTC** (page 25515671, from branch `feat/two-funding-calendars`, which is main plus only the routing lines). Live browser check with every send blocked: a 750+ answer frames `/funding-book-call` (event type 14234, date picker shown); a "Not sure" answer frames `/funding-book-call--02424` (event type 14959, date picker shown). Same "...qualified. Pick a time below." words, one PageView. Main catches up when #285 merges; a push of `/apply` from main before that would drop the second route.
  - Branch `feat/two-funding-calendars` (draft PR, stacked on #280): `/apply` frames `data-src` for 700-749 and 750+, and `data-src-unqualified` (`/funding-book-call--02424`) for every other answer. No word, pixel or thank-you change. The morning page check gets `funnel:funding-book-call-unqualified`, and `funnel:apply-form` now needs the second route.
  - **Leftover:** the push manifest (`marketing/landing-pages/tracking-manifest.mjs`) only writes page 25062844 and funnel 968281's head code. A later push to the booking page will not reach the copy, so the two can drift. Adding the copy means changing the pinned "one calendar page" and "one funnel pixel" checks.
- **Duplicate bookings (2026-10-29):** the form post and the appointment webhook for one call raced; 2 of 13 live booked slots were saved twice (FH-000855 real-looking, both rows sent to Cortana; FH-000849 is +sim). The adapter fix (one lock per person and start time around the slot check and emit; keeps the call id and the calendar page) is the other Claude session's branch `fix/clickfunnels-booking-slot-race`. Removing FH-000855's extra row is Chris's call; FH-000849 is test data.
- **Proof plan:** Focused rule, handler and real-Postgres booking tests; lint; full suite; GitHub CI; ship; `/api/health` pending 0; read the live column shape as the app role.

## 2026-10-26 Monday funnel repair lanes

Source: the 2026-10-26 customer walk notes in the main checkout. This branch covers Monday rows 18–20, 22–24, and 26. Rows 21 and 27 remain V2.

- **Funnel lane:** Read `marketing/landing-pages/apply-survey.html`, `public/funnel/fh-events.js`, related tests and tracking spec. Make the parent navigate to `/thank-you` after a real booking relay. Keep Meta Lead and Cortana events working. Cover App Store tap tracking on the thank-you and portal pages. Prove with focused tests.
- **Booking lane:** Read `src/handlers/client-lifecycle.mjs`, `api/bookings.mjs`, inbound SMS router, portal confirmation UI and tests. Make real funnel form name and phone win on same-email booking, then make portal confirmation persist via the same server path as SMS. Trace host calendar guest/Meet gap; repair only if the controlled path is in repo.
- **Email lane:** Read `db/seed/012_s04_booking_confirm_email.sql`, `src/workflows/s-04b-booking-reminders.mjs` and related tests. Add App Store and call-confirm actions to the booking email, with a working link and event tracking path. Keep the template and live workflow aligned.
- **Integration lane (this session):** Own `public/portal-login.html`, board and journey updates, cross-lane tests, lint, TypeScript, GitHub branch and PR, and live proof where access permits. Do not edit the other lanes' files during parallel work.

### Read-only and live proof, 2026-10-26

- The host's primary calendar had two events for one call time. The ClickFunnels invite had one guest and Meet. The duplicate self-added event had no guest or Meet and matched the thank-you page's calendar template. The thank-you calendar action is the source of the confusing host view.
- The existing portal confirm path was tested once against the named booked call at about 5:09 PM Arizona time. Signed-in login returned 200; `POST /api/bookings` returned 200 with `confirmed:true`; the client flag changed from false to true and the button hid. The earlier failed click was not reproduced. No direct database update was used.
- Local Playwright on `portal-login.html` recorded `page_view`, `click`, and `app_download_tap` requests for the Apple button. The email sign-in hash reached the call card and the token did not enter tracker payloads. Playwright sets `navigator.webdriver`, so this run intentionally did not emit a Cortana milestone; the non-automated test harness covers the browser mapping.
- Local Playwright on the thank-you HTML showed the iPhone app card immediately after the hero, the verified App Store URL and web portal fallback, and no duplicate calendar action. Row 16 advanced only for app taps into the server funnel event feed; the ad-to-booking join and live Cortana/Meta receipts still need a published human walk.
- `npx tsc --noEmit` remains red on two existing `source_proof` type errors in `src/ad-videos/animations.mjs` (lines 657 and 676). That animation file is unchanged by this branch and outside this funnel repair.

### CI repair lanes, 2026-10-26

Owner request: get current GitHub `main` tests green after the post-book SMS fix. Work on `codex/ci-green-postbook` in the clean checkout at `/private/tmp/fundhub-main-ship-20261026`; keep the dirty primary checkout untouched. The baseline failed run is GitHub Actions `40427135273`; current main is `197ecf0b4`. Do not weaken tests, invent missing assets, or touch setter dashboard files.

- **Animation lane:** Own failures in `src/ad-videos/`, marketing ad animation plans, and the protected overlay builder and hook. Reproduce the exact CI failures for frame duration, full-frame limits, clean-source proof, and words-band placement. Repair source or restore real files only; no test relaxation. Do not edit `marketing/broll/`.
- **Broll lane:** Own `marketing/broll/` kit failures: transparent prop type, alpha render README, missing template import, generated catalog and composition/purpose assertions. Read the current source and tests, then restore or repair actual source. Do not edit ad animation plans or `src/ad-videos/`.
- **Docs and vault lane:** Own `docs/diagrams/`, Hormozi vault file failures, and the public script-map assertion. Establish whether required files were omitted from Git and restore authentic repo files where possible. Do not invent sales copy or vault notes.
- **Integration lane (this session):** Own `src/ad-videos/animations.mjs` TypeScript type failure only after coordinating with animation lane, CI log triage, manifest/rules/lint checks, branch/PR and GitHub main verification. All lanes report changed paths and focused test results before integration.

Focused repair proof: animation 65/65, broll 44/44, docs/vault/public 128/128, SQL template 246/246; lint parsed 4,314 files, TypeScript and diagrams checks passed. The unsharded local suite saw only the SQL template snapshot failure before that snapshot was regenerated; GitHub's sharded suite is the final full-suite gate.
