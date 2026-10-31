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

### Doubled ClickFunnels bookings, 2026-10-29

- **Seen on live (read-only):** 2 of 13 live booked times were saved twice: FH-000855 (2026-11-01 20:00 UTC, rows `428b91ef` form id and `e0d06ede` call id 75918, both sent to Cortana) and FH-000849, a +sim person (2026-10-29 23:00 UTC, call id 75896 and form id `aea658d2`). Each pair has the same person, time and Meet link, saved 0.12 s and 0.18 s apart, and each has two "Strategy session booked" tasks. A third booking at 00:04 UTC saved once.
- **Cause:** The form post's booking was not saved yet when the scheduled event checked for it, so both saved one. The UID lock in `src/handlers/comms.mjs` never held them apart because the two ids differ.
- **Fix (branch `fix/clickfunnels-booking-slot-race`, Claude funnel lane):** `withBookingSlotLock` in `src/adapters/clickfunnels.mjs` holds one transaction-scoped lock per (company, email, call time) around the slot check and the save; a booking is only re-keyed to the call id; the payload keeps `calendarPageId` and `eventType`. A test sends both messages at once and fails with the lock off.
- **Left for Chris:** the 2 existing pairs are not merged. FH-000849 is test data. FH-000855 looks like a real lead, so removing its extra row and task is his call.

### Qualified vs unqualified credit pixel split, 2026-10-29

- **Owner call (2026-10-29):** The two buckets only split the Meta pixel. Same calendar, same people take the call, same thank-you page. Qualified credit is a score answer of 700-749 or 750+ (the same 700 line UnderwriteIQ uses for "fundable"). Every other answer, including "Not sure", is unqualified.
- **Owner:** Claude owns the funnel lane (Chris, 2026-10-29). Branch `feat/funnel-credit-pixel-split`. Codex was told on Tether to stay out of these files.
- **Spec:** The /apply survey sends `credit_tier` (`qualified` or `unqualified`) on its last answer. It never sends the score itself. The shared tracker keeps that tier for the tab and puts it on the booking it relays. Lead and Schedule still fire for everyone. Each person also fires `QualifiedLead` or `UnqualifiedLead` on the last answer, and `QualifiedSchedule` or `UnqualifiedSchedule` on the booking. The browser and the server send each one under the same event id, so Meta counts it once. The word "credit" and the score never go to Meta.
- **Why no second calendar or page:** The ClickFunnels API cannot create a calendar. The bucket comes from the survey answer, not from the calendar. Meta can optimize an ad set on the new events, so a second thank-you web address is not needed.
- **Files:** `marketing/landing-pages/apply-survey.html` (no visible change), `public/funnel/fh-events.js`, `src/funnel/track.mjs`, `src/meta/map.mjs`, their tests, `docs/tracking/meta-events.md`, `docs/tracking/tracking-spec.md`.
- **Proof:** Focused tracker, survey, Meta map and door tests; lint; GitHub CI; ship; ClickFunnels push of `/apply`; a live browser check that catches the sends before they leave the page.
- **PR #260 live proof (2026-10-29, checked by the chat that built it):** Merged as `d9b69f31`; `/apply` (page 25515671) pushed from the merged file; GitHub ship run 40974169491 passed and the live `https://fundhub.ai/funnel/fh-events.js` has the tier key. A browser walked the live `https://apply.fundhub.ai/apply` survey twice, then sent one booking in the same tab. Before the ship (old tracker): Lead and Schedule only, no tier kept (FAIL). After the ship: a 750+ answer sent Lead + `QualifiedLead`, then Schedule + `QualifiedSchedule`; a 580-649 answer sent Lead + `UnqualifiedLead`, then Schedule + `UnqualifiedSchedule`. The last answer and the booking both carried the right `credit_tier` (PASS). The pixel and the send were stubbed and every outside call was blocked, so no row reached the live database and nothing reached Meta. The server copy to Meta is held by the CI tests, not this browser check.
- **Two calendars on main, PR #308 (2026-10-30):** Chris asked to merge #285, but #285 sits on #280 (the `qualification_bucket` database change), so #308 carries only its routing commit on current main. All 14 GitHub checks green at `2249e592`, 29,790 tests pass on the Mac, merged as `39692d24`. The `/apply` file in it is the one live since 2026-10-30 ~00:57 UTC, so a push from main keeps both calendars. #280 and #285 stay open for their owner. Live check with every send blocked: 750+ and 700-749 frame `/funding-book-call` (event type 14234); 650-699, 580-649 and Not sure frame `/funding-book-call--02424` (event type 14959); both show 21 open times, Confirm opens the booking form and `time_selected` fires; the word "unqualified" is on neither screen. Pixel recheck: 750+ sends Lead + QualifiedLead, then Schedule + QualifiedSchedule; 580-649 sends Lead + UnqualifiedLead, then Schedule + UnqualifiedSchedule (PASS). One slip: an early run let one page-view hit reach Cortana (DirectROAS); no lead or booking. No bookings since the split: three people finished the survey after it went live (Patricia 8:33 PM, Keith 4:00 AM on the second calendar; Roger 4:56 AM on the first) and none clicked a time. ClickFunnels has no booked call on either calendar after Danny at 5:04 PM on 10-29, so no booking was lost on the way to Fundhub. **Leftover:** the ClickFunnels Confirm button after a time is picked is faint (no fill, almost no border) on both calendars; the booking page look last changed 10-26 and people booked through it 10-26 to 10-29.
- **Text and email links pick the calendar, 2026-10-30 (Chris: "Yes, build it"):** Found on 10-30: every text and email link opened the first calendar, and a booking from one sent only Schedule, because the tab that opens from a text has no survey answer in it. Both leads in the second group since the split (580-649 and 500-579) got the first calendar. Branch `feat/text-link-calendar-tier`.
  - **Spec:** Every text and email link to a call comes from one place (`clientContext` in `src/workflows/messaging.mjs`, the `{{custom_values.booking_link}}` tag). It now reads the lead's saved score answer (`cf_svy_self_reported_fico`). 700-749 or 750+ gets `https://apply.fundhub.ai/funding-book-call?fh_tier=q`. Every other answer, "Not sure" too, gets `https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u`. No saved answer keeps today's link with no mark. A per-lead link saved on the file still wins (none exist on 10-30). The mark is one letter: never the score, never the word "unqualified".
  - **Spec, the booking:** On either calendar page, the tracker keeps the mark for that tab. The booking then sends Schedule plus `QualifiedSchedule` or `UnqualifiedSchedule` from the browser and from the server, under one event id. The second calendar page is added to the tracker's page list and the server's page list as the same step as the first, so a booking made there straight from a text counts (Schedule, the label, the Cortana booking steps). Inside the /apply frame nothing changes.
  - **Files:** `src/workflows/messaging.mjs`, `public/funnel/fh-events.js`, `src/funnel/pages.mjs`, their tests, `docs/tracking/tracking-spec.md`, `docs/journeys/booking-notifications-flow.md`, `docs/journeys/CHANGELOG.md`.
  - **Leftover (not fixed here):** main was already red at `6a859d6d` (tests.yml run 41121692035, 12 of 14 jobs). Three groups fail: the apply-book footer test after `e8f22099` added `04g-book-close-today.html`; the partner licence and money-chain tests after `f4055a2e`; and the Company Brain and staff-display browser tests. PR #330 adds no failure that main does not already have. The owners were told on Tether.
  - **Shipped and checked live, 2026-10-31 (Chris: "Merge it now"):** The branch took in the latest main first, with no conflicts. On the combined code the 223 tests for these files pass and lint is clean. The full suite on the merged commit: 29,870 tests, 0 fail, 27 skipped; the 1,170 database tests ran with no database (1,087 skipped), because they never run against the live one. Merged as `20b94157` and shipped (`ship: 20b94157 is live`). The live tracker carried the new code at 18:25 UTC. Live check with every send blocked and no booking made: it picks a real time next month, presses Confirm, then fires the "booking accepted" page event by hand. The q link on the first calendar sends Schedule + QualifiedSchedule, tier qualified. The u link on the second calendar sends Schedule + UnqualifiedSchedule and counts the Cortana booking steps on that page. The plain link sends Schedule only. Each booking uses one event id, and the mark never shows in the booking address (PASS). A read-only database check of the 17 leads from the last 30 days: 2 at 700-749 get the q link, 11 under 700 get the u link, and 4 with no answer keep the plain link. Not checked live: the server saving a booking from the second calendar page, because that would put a test row on production. The tests cover it.
  - **Note for the next live check:** the first calendar now clears any time picked for today (`04g-book-close-today.html`, from another chat). Pick tomorrow or later.
  - **Leftover (not fixed here):** those two leads each got EMAIL-NOBOOK-01 twice, both delivered. The second SMS-NOBOOK-01 was blocked as `duplicate_sms:batch`, so only the email repeats.
- **PR #251 live proof (2026-10-29, checked by a different chat than the fixer):** Merged as `855c8545`. Before the ship, a browser on the live `https://apply.fundhub.ai/thank-you` with a kept booking in the tab sent no `booking_confirmed` (FAIL). After `https://fundhub.ai/funnel/fh-events.js` served the new code, the same check sent it once, with the exact kept body, cleared the key, and sent nothing on a second load (PASS). The browser's send was stubbed and the door was blocked, so no row reached the live database and nothing reached Meta.

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

### Active Pipeline repair, 2026-10-30

- **Owner request:** Stop the many repeated "Setter: call new opt-in" pills on Sales > Fulfillment and the duplicate Setter tasks behind them. This is active work, outside the V2 backlog above.
- **Cause:** ClickFunnels stores a distinct `entry.captured` event for each survey-screen post. The local Setter handler previously made one task per event ID; the Pipeline painted every open task as a pill.
- **Change:** `src/setter/tasks.mjs` reuses an open task for the same client and type under a client-row lock, then allows a new task after the prior one is complete. `public/app/pipeline.html` shows one pill for repeated older Setter tasks. No task rows are deleted.
- **Proof:** `src/setter/tasks.test.mjs` covers repeat events and a later event after completion; `src/http/pipeline-screen.test.mjs` covers old repeated pills and preserves other blockers. Focused tests passed locally (104/104). A focused real-browser check in `e2e/pipeline-workspace.spec.mjs` passed on an isolated local port: one Setter pill, two distinct booking pills. Live repeat check and GitHub release proof remain pending.
