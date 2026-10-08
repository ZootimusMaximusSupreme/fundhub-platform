# Funnel gaps — 2026-10-08

Lane 5. Fundhub funnel doors on apply.fundhub.ai, and the public offer pages on fundhub.ai.

This file does not add a watchdog. Recon (AG-07) is the one morning tripwire.

## What the morning check misses

`checkFunnelRoadmapSales` already reads https://apply.fundhub.ai/roadmap for the checkout anchor (`fh-order`) and the roadmap offer line.

These pages are not in that body check: `/watch`, `/thank-you`, `/roadmap-thank-you`, `/apply`, `/roadmap-book`, `/funding-book-call`.

Public offer files in the pulse registry are scored up on HTTP 200 alone. The body is not read. A blank sales page, a missing checkout form, or a form that can no longer post still looks fine.

Slice 05 watches the ClickFunnels and Clarity jobs. Slice 19 watches the SLO jobs. Those are job rows. This lane does not change them.

## How this check works

`src/pulse/coverage/gap-funnels.mjs` exports `gapChecks(ctx)`.

It uses GET only. It does not post a lead. It does not open ClickFunnels admin. It does not mint a Commas product.

A door is FAIL when the page is down, or when a marker named in the page code is missing. That marker is the checkout anchor, the offer line, or the form post. On a public offer page, a 200 with the marker gone still fails, because the morning ping would have said up.

No fetch in the run is `skip`.

## Live read — 2026-10-08

21 doors. 21 PASS. 0 FAIL. 0 skip.

| Door | Status |
|---|---|
| funnel:roadmap-sales | PASS |
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

9 tests. 9 pass. 0 fail. Fake fetch only. Every call in the test is GET.
