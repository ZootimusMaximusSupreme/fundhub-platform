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
