# Funnel gaps — 2026-10-08

Lane 5. Fundhub funnel doors on apply.fundhub.ai, and the public offer pages on fundhub.ai.

This file does not add a watchdog. Recon (AG-07) is the one morning tripwire.

## What the morning check misses

`checkFunnelRoadmapSales` (`src/pulse/funnel-doors.mjs`) already reads https://apply.fundhub.ai/roadmap for the checkout anchor (`fh-order`) and the roadmap offer line. This lane does **not** read those two again. On `/roadmap` it reads what Recon does not: the Pay widget's calls to `slo-checkout`, whether the till is ready, and whether the page shows the price the till charges.

These pages are not in Recon's body check: `/watch`, `/thank-you`, `/roadmap-thank-you`, `/apply`, `/roadmap-book`, `/funding-book-call`.

Public offer files in the pulse registry are scored up on HTTP 200 alone. The body is not read. A blank sales page, a missing checkout form, or a form that can no longer post still looks fine.

The registry already pings `public/slo-checkout`, `funnel-checkout`, `optimize`, `partner-apply`, `education-enroll`, `survey-submit` and `slo-interest`. This lane does not ping those again. It reads the two post doors the registry cannot ping because a GET answers 405 by design: `public/slo-pull` and `webhooks/clickfunnels`.

Slice 05 watches the ClickFunnels and Clarity jobs. Slice 19 watches the SLO jobs. Those are job rows. This lane does not change them.

## How this check works

`src/pulse/coverage/gap-funnels.mjs` exports `gapChecks(ctx)`. It returns 21 rows.

It uses GET only. It does not post a lead. It does not open ClickFunnels admin. It does not mint a Commas product. Every door is read at the same time, with a 10 second timeout, and each address is fetched once.

A door is FAIL when the page is down, or when a marker named in the page code is missing. A marker is real code, not a comment: the Pay widget's `call('POST','slo-checkout'`, the booking page's `id="formContainer"` and calendar picker `id="cronofy-date-time-picker"`, the head block `<!-- fh-watch-lede:start`. On a public offer page, a 200 with the marker gone still fails, because the morning ping would have said up.

`funnel:roadmap-checkout` also reads `GET /api/public/slo-checkout` (the till). It FAILs when the till is not ok, is not ready, is in demo mode (Pay charges no card), or when the page does not show the price the till charges.

`funnel:apply-form` and `offer:roadmap-pull` also GET their post door. 404, 410 or 5xx is FAIL. 405 or 200 is alive.

No fetch in the run is one `skip` row. The pulse's `fetchImpl`/`fetch`, `baseUrl` (app), and `FUNNEL_URL` (funnel) are honored.

## Live read — 2026-10-08, after review

21 doors. 21 PASS. 0 FAIL. 0 skip. 25 GETs, 566 ms (it was 5012 ms read one after another).

| Door | Status |
|---|---|
| funnel:roadmap-checkout (was funnel:roadmap-sales) | PASS |
| funnel:watch | PASS |
| funnel:thank-you | PASS |
| funnel:roadmap-thank-you | PASS |
| funnel:apply-form | PASS |
| funnel:roadmap-book | PASS |
| funnel:funding-book-call | PASS |
| offer:partner | PASS |
| offer:partner-menu | PASS |
| offer:partner-trial | PASS |
| offer:partner-board | PASS |
| offer:partner-checkout-script | PASS |
| offer:education | PASS |
| offer:education-enroll | PASS |
| offer:affiliates | PASS |
| offer:roadmap-pay | PASS |
| offer:roadmap-pull | PASS |
| offer:optimize | PASS |
| offer:optimize-plan | PASS |
| offer:home-survey | PASS |
| offer:start | PASS |

Nothing is broken on these doors today. The gap is the morning check, not a down page.

## Test

`node --test src/pulse/coverage/gap-funnels.test.mjs`

24 tests. 24 pass. 0 fail. 0 skipped. Fake fetch only. Every call in the test is GET.

## Review — Claude, 2026-10-08

**What was wrong**

- It copied Recon. `funnel:roadmap-sales` had the same name, the same two markers (`fh-order`, the offer line) and the same page as `checkFunnelRoadmapSales`. Two rows for one question.
- The `/roadmap` marker `slo-checkout` matched a comment. The page's real calls were never checked. The booking page marker `formContainer` matched our own CSS, and the lede marker matched a stray mention.
- "Form that cannot post" only meant the page held the word. It never asked whether the door the form posts to still exists. A removed route 404s, and the page would still pass.
- The checkout could be broken with every marker present: till not ready, till in demo mode, or the page showing another price than the till charges.
- 21 GETs one after another took 5 seconds. The pulse runs in a 26 second function with 30-plus other lanes.

**What changed**

- `funnel:roadmap-sales` is now `funnel:roadmap-checkout`. It no longer reads `fh-order` or the offer line. It reads the Pay widget calls, the till, and the price.
- Markers are real code (see above). The apply form and the pull form also check their post door.
- All doors read at once, with a timeout, one fetch per address.
- Tests: 9 became 24. New ones cover the till (not ready, demo, other price, 500, not JSON), a comment that is not the hook, the lost calendar picker, the lede block, a dead post door, a post door that throws, the pulse's names, and reading at the same time.

**Live proof (read-only)**

- Prod mode: 21 PASS, 0 FAIL, 0 skip. Staff mode and bare mode match. No writes. GET only.
- Real pages with damage on purpose (the Pay call removed and the price changed on `/roadmap`, the calendar picker removed, the slo-pull door answering 404, the trial page blanked) turned 4 doors into FAIL, and the other 17 stayed PASS. The real markup does fail the check.

**Left for Chris**

- Nothing from this lane. The page price ($147) and the till price match today.

## Tier 1 — Claude, 2026-10-09

Six new checks. They sit in the same file (`src/pulse/coverage/gap-funnels.mjs`), so the lane now returns 27 rows: the 21 doors and these 6. They read with GET and HEAD only. They post nothing, and they call no model, no text, no email, no card, no credit pull.

Each check asks one yes-or-no question a buyer would feel.

| Check id | The question | Red when | Live, 10-09 |
|---|---|---|---|
| `funnel:card-box-script-loads` | Will the card box show on step 2? | The card company script is not 200, is not JavaScript, is empty or tiny, no longer defines `PaymentCheckout` (the name the page calls), or `/roadmap` stops naming it. | PASS. 21121 bytes. |
| `funnel:book-and-order-pages-live` | Can a buyer reach the call calendar? (The id keeps its first name. It reads only `/schedule/phonecall` now. See the checker fix below.) | `/schedule/phonecall` is down, or the calendar lost its box, its token or its query. | PASS |
| `funnel:order-price-matches-till` | Does the order page charge what the till charges? | `/order` is a working checkout and its price is not the till's (`/api/public/slo-checkout`). Passes when `/order` is taken down. Skips when a side cannot be read. | **FAIL.** `/order` charges $297. The till says $147. |
| `funnel:roadmap-tracking-scripts` | Do the scripts that tie a sale to an ad still load on the sales page? | `/roadmap` stops loading `fh-attribution.js`, `fh-events.js`, `vsl-watch-beacon.js` or Clarity, or any script it loads from fundhub.ai is not 200, or comes back as a web page or empty. | PASS. 4 scripts. |
| `funnel:sales-videos-play` | Do the sales page videos still play? | HEAD on any video or poster the page names is not 200, has the wrong type, or has size 0. The page naming no video at all is red too. | PASS. 8 files (the main video, 3 testimonials, 4 pictures). |
| `funnel:widget-cross-site-call` | Will the browser let the roadmap page talk to our server? | Any of the 4 doors the widget calls (`slo-checkout`, `slo-pull`, `slo-status`, `slo-repair-checkout`) is gone or broken, or does not name `https://apply.fundhub.ai` in `access-control-allow-origin`. For a post door it must also allow POST and the `content-type` header. | PASS. 4 of 4 doors. |

### Where I changed the plan

- **The order price is its own check.** The plan had it inside `book-and-order-pages-live`. The price is wrong today and will stay red until Chris decides. If it sat inside the page check, that row would be red all day, and a lost calendar tomorrow would not change anything. Now the page check stays green and tells the truth, and the price check is the red one.
- **`/funding-book-call` and `/roadmap-book` are not read again.** `funnel:funding-book-call` and `funnel:roadmap-book` already check them. The new page check reads the page nobody watched: `/schedule/phonecall`. (`/order` was in it first. It moved to the price row. See the checker fix below.)
- **The cross-site check reads 4 doors, not 1.** The plan named `slo-status`. The widget calls four doors, and `src/slo/cors.mjs` covers all four. All four answer the same headers even to a bare GET (400 or 405), so one GET each is enough. This is the same set of headers a browser reads before a post. I cannot send the browser's own question (OPTIONS) because the rule is GET and HEAD only.
- **If `/roadmap` itself is down,** the card box, tracking and video checks say `skip` and name the page. `funnel:roadmap-checkout` (and the 5 minute watch) already turn red for the page. One cause, one red.
- **A new time limit.** Every web call waits at most 8 seconds (it was 10). Any row still waiting at 15 seconds becomes a `skip`, so the step always ends before Netlify's 26 second cut.
- **Cross-site reads share the fetch.** The till and `slo-pull` reads now send the page's `Origin`, so the new check reuses them. No address is fetched twice.

### What the checks cannot see

- **Open times on the calendars.** They load in the browser from Cronofy. Reading them needs a POST with the page's token. That is tier 2. The new page check does read that the calendar has its box, its token and its availability query, so a blank token goes red. A calendar with a good token and no open times still passes.
- **A running card box.** The check reads that the script is there and defines `PaymentCheckout`. It cannot draw the boxes. Only a browser walk can.

### Live proof (read only, on the real site)

- `gap-live.mjs funnels`: 27 rows, **26 PASS, 1 FAIL, 0 skip**. All three modes agree. 0 SQL errors, 0 write tries, 0 shape problems. 42 calls, all GET or HEAD, no address twice. The lane took 1.6 to 3.2 seconds.
- `npm run pulse:prove -- --lanes=gap-funnels` (real Netlify bundle): **OK**. `coverage-gap-funnels` took 1.7 seconds. The one red from this lane was the order price.
- **Red paths on the real pages** (real network, one thing damaged in memory per case):

| Damage | Result |
|---|---|
| `/roadmap` stops naming the card company script | card box row FAIL |
| the page points at a script the card company does not have (their CDN answered 403) | card box row FAIL |
| `fh-attribution.js` tag removed | tracking row FAIL |
| Clarity tag points at a file that is not there (real 404) | tracking row FAIL |
| main video name wrong (real HEAD 404) | video row FAIL |
| a poster points at a script file (real type `application/javascript`) | video row FAIL |
| calendar box removed from `/schedule/phonecall` | page row FAIL |
| checkout form removed from `/order` | page row FAIL (changed 2026-10-09: now the page row stays PASS and the price row skips. See the checker fix below.) |
| `/order` priced at the till price | all 27 rows PASS |
| the browser asks from a site the doors do not allow (the real doors refuse) | cross-site row FAIL |

Each case turned only its own row red. The order price row stayed red in the other cases, because the price really is wrong.

### Tests

`node --test src/pulse/coverage/gap-funnels.test.mjs`: **62 tests, 62 pass, 0 fail, 0 skipped** when first built. It was 24. (After the checker fix below it is 71.) 38 are new: a PASS test and several FAIL tests for each check, the readers, the deadline, and a test that no call is a POST.

I also broke the code on purpose in a scratch copy, 23 ways (ignore the allow-origin header, never compare the price, count a commented-out tag, ignore a 404 on a video, and so on). 22 broke a test. The one that did not was a line that did nothing (a 500 was already caught by the line after it). I removed that line.

**Four old tests changed. Their checks are the same.**

- "every live door passes": it now expects 21 + 6 rows, and allows HEAD (for media) and the card company host. It still demands all PASS, no POST, and no address twice.
- "HTTP 200 with the checkout hook gone": the page it uses is now the real shape minus the hook, so only that one row fails, as before.
- "a thrown fetch fails that door only": counts "all but one row passes" in place of "20".
- "the pulse's names work": the page now names scripts on the app site it is told about, and the host list adds the card company.

### Left for Chris

- **`https://apply.fundhub.ai/order` charges $297.00 for the Complete Funding Diagnostic. The till and `/roadmap` charge $147.** It is a live ClickFunnels checkout (product 1035377, 29700 cents). I opened 8 live pages (`/roadmap`, `/watch`, `/thank-you`, `/apply`, `/roadmap-thank-you`, `/funding-book-call`, `/roadmap-book`, `/schedule/phonecall`). None links to `/order`, so only an old link or a bookmark reaches it. The audit says a ClickFunnels order does not open the portal. I did not test that. The check stays red until the price matches or the page comes down. Chris decides which. I changed nothing.

### Checker fix — Claude, 2026-10-09 (medium)

**The problem the checker found.** The fix text on the price row says "take `/order` down". But the calendar row also read `/order`. So the day Chris took `/order` down, the calendar row would turn red and stay red forever, and it would hide a real calendar loss. Nothing links to `/order`. It had 3 views in 30 days and 0 sales.

**What changed.**

- `funnel:book-and-order-pages-live` now reads only `/schedule/phonecall`. It goes red when that page is down, or the calendar lost its box, its token or its query. It does not read `/order` at all. (The id keeps its first name so the work list still matches.)
- `funnel:order-price-matches-till` is now the one row that reads `/order`:

| What `/order` does | Row |
|---|---|
| a working checkout at a price that is not the till's | **FAIL** (still red today: $297 against $147) |
| a working checkout at the till's price | PASS |
| answers 404 or 410 (taken down) | PASS, says it is down |
| sends buyers to another page (a redirect off `/order`) | PASS, says it is retired |
| up, but the checkout form is gone | skip, says why |
| a form with no price | skip |
| error (500, 403) or cannot be reached | skip |

A skip is never a green. A page that is gone cannot charge a wrong price, so that is a clear answer, not a failed read.

**Live result (real site, GET and HEAD only, one thing damaged in memory per case).** Now: 27 rows, 26 PASS, 1 FAIL (the price, because `/order` is still live at $297). `/order` as 404: no red rows. As 410: no red rows. Redirected to `/roadmap`: no red rows. 500: price row skips. Form stripped: price row skips. Priced at $147: both PASS. Calendar token removed: calendar row FAIL, with `/order` retired. Calendar page gone (404) with `/order` live: both rows FAIL.

**Test result.** `node --test src/pulse/coverage/gap-funnels.test.mjs`: **71 tests, 71 pass, 0 fail, 0 skipped.** I broke the new code 16 ways in a scratch copy (410 not counted, redirect ignored, a missing response address read as retired, a trailing slash read as moved, no-form not skipped, the calendar row reading `/order` again, and more). All 16 broke a test.

**Tests I had to change.** Three old tests said the opposite of the checker's point (the calendar row goes red when `/order` is down, has no form, or has no price; both pages bad are both named; the price row skips and the calendar row fails when `/order` is down). I replaced them with tests of the new rule. One more test now proves the calendar row never reads `/order`. None was skipped or weakened. The calendar-page tests and the price-mismatch tests are unchanged.

**One small code change.** The reader for each web call now also keeps the address the call ended at (after any redirect), so a redirect off `/order` can be seen. A fetch that does not say where it ended is never read as retired.
