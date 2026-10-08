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
