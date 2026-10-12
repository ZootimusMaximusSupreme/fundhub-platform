# VSL Stacking Theory — Research Board

Date: 2026-10-11
Status: done

## Tasks

| Task | Owner | Status |
|---|---|---|
| Theory and origin research | current session | done |
| Funnel map | current session | done |
| Examples and evidence | current session | done |
| Critical review | current session | done |
| Final synthesis | current session | done |

## Shared context

Research question: What is VSL Stacking Theory, how does it work end to end, what evidence supports it, and how should a marketer decide whether and how to use it?

Sources supplied by user:
- https://www.instagram.com/reel/DadGnlYt9tt/
- https://www.linkedin.com/videos/josh-hamiltonx_vsl-stacking-theres-a-specific-strategy-activity-7511529327398686720-ZSiZ
- https://www.instagram.com/reel/DeHX8vivm3A/
- https://www.instagram.com/reel/Dd4CFzZPnFt/

## Theory and origin findings

- Strongest direct public definition found: Josh Hamilton’s October 2026 LinkedIn post/transcript. He says VSL stacking means putting a separate VSL at each funnel friction point where a prospect would otherwise need a human answer or objection handled.
- The clearest public example has four stages: website video sells a free report/lead capture; no-contact video sells the booking; booked-appointment video sells the show-up; optional in-home video supports the close. A post-signature onboarding video is also described.
- Each video is supposed to sell the next step, not necessarily the final product.
- The public record does not establish Hamilton as the first-ever user of the phrase. No book, peer-reviewed paper, or stable industry standard for “VSL stacking” was found.
- “Stacking” also commonly means stacking proof, bonuses, or value inside one VSL. That is a different concept from stacking multiple VSLs across a journey.
- Hamilton’s percentage lifts and revenue projection are targets/claims in the public transcript. No control group, sample size, baseline, or independent verification is supplied.
- Supporting but indirect evidence: Wistia reports observational CTA benchmarks; Baymard reports usability and discoverability findings; a large PNAS study finds only a modest persuasion advantage for video over text in a different domain. None tests VSL stacking directly.

## Change manifest

- Added `research_notes/VSL Stacking Theory/theory-and-origin.md`.
- Updated this board with the theory/origin findings and marked that workflow done.
- No code, product, funnel, or marketing asset was changed.
- Added `research_notes/VSL Stacking Theory/critical-review.md`.
- Covered assumptions, failure modes, production cost, tracking, attribution, fatigue, privacy/platform constraints, fair testing, minimum useful test, and keep/change/remove rules.
- Separated sourced conclusions from reasoned inference.
- No code, product, funnel, or marketing asset was changed.

### Examples and evidence — done

- Added `research_notes/VSL Stacking Theory/examples-and-evidence.md`.
- Exact public use of the term found in Josh Hamilton's LinkedIn post. The post claims stage-level targets for bookings, show rate, and closes, but does not provide independently verifiable results.
- Adjacent public examples found from Talking Heads, ElasticFunnels, Mark Pescetti, and Ash Davis. These show multi-video, modular, or stage-based practices but do not prove the named method.
- Stronger adjacent evidence found in VWO/Wingify, Unbounce, NextAfter, Wistia, Google Analytics, and academic research. Findings show video effects are context-dependent and can be positive, neutral, or negative.
- Instagram URLs supplied in the board were not independently inspected because web fetches were throttled.
- No public, independently audited full-stack VSL experiment was found.

## Blockers and open questions

- Exact first use and creator of the phrase remain unconfirmed.
- Supplied Instagram reels could not be fetched by the research web tool.
- No public head-to-head experiment comparing a VSL stack with one long VSL was found.
- Other workflows remain pending for funnel examples and the final synthesis.
- Critical-review gap: no reliable public randomized study was found that directly compares one VSL with a multi-micro-VSL stack while holding offer, traffic, and message constant.
- Examples/evidence gap: no public operator has published stage-level randomized results for a true multi-VSL stack with downstream revenue and quality metrics.

### Funnel map — done

- Added `research_notes/VSL Stacking Theory/funnel-map.md`.
- The recommended map covers: ad click → lead capture; captured lead → booking; no-pickup recovery; booked call → show-up; high-ticket qualification; discovery call → proposal/second appointment; ecommerce product page → checkout; checkout abandonment; purchase confirmation; onboarding/first success; and referral/retention.
- Each stage records the friction point, likely objection, video job, what to cover, what to avoid, handoff action, and primary measurement.
- Theory claims are separated from the recommended operating model. The theory is sourced chiefly to Josh Hamilton's LinkedIn post/transcript; the operating model is an inference from that source plus public funnel guides and platform measurement docs.
- Source notes added for Asset Academy, Skyline Social, Inflo Partners, Google Analytics Funnel exploration and Events, YouTube retention, Wistia Audience Analytics, Vimeo video measurement, Unbounce's large landing-page analysis, and the PMC randomized clinical-recruitment landing-page experiment.
- Measurement recommendation: pair video events (`play`, retention milestones, CTA click) with the intended downstream event (`lead_submit`, `calendar_booked`, `showed`, `checkout_started`, `purchase`, `onboarding_started`) and judge the video by the transition it is meant to improve.
- Important evidence limit: no independent controlled study was found that tests the complete VSL-stacking sequence from ad click through onboarding. Public lift numbers should not be used as benchmarks.

## Final synthesis manifest

- Status: done
- Final report: `reports/VSL Stacking Theory.md`
- Scope covered: plain-English definition; origin and documentation limits; end-to-end funnel map; micro-VSL jobs; example sequence; offer-type differences; evidence table; single-VSL comparison; metrics and testing plan; production and tracking requirements; failure modes; minimum viable test; decision framework.
- Evidence posture: Hamilton’s framework and lift figures are labeled as practitioner claims. Adjacent studies and platform documentation are labeled as indirect or stronger evidence. No direct public head-to-head VSL-stack versus single-VSL study was found.
- Files changed: `reports/VSL Stacking Theory.md`; `ops/workflows/vsl-stacking-theory-2026-10-11.md`
- No code, product, funnel, or live marketing asset was changed.
