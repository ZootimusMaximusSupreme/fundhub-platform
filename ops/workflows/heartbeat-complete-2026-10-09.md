# Heartbeat — complete across the company, and wired in on every build (2026-10-09)

Chris's ask (2026-10-08 night): every piece of the company we launch has a heartbeat tripwire that trips before a customer hits the break. Research that it is done completely. Then a rule and an architecture guide so agents wire the tripwire in as they build, forever.

Before: `ops/workflows/heartbeat-gaps-2026-10-08-review.md` (37 gap lanes reviewed, proven in a built bundle, shipped `81b50d23`).

## Split

| # | Workflow | Owns | Waits on |
|---|---|---|---|
| A | Coverage audit | Walk every intended journey and every job, route, page and send. Map each step to the check that goes red when it breaks, or mark it missing. Prove each "covered" with the live read-only tool. | nothing |
| B | Rule + guard tests + explainer | One rule for Claude and Cursor, a CLAUDE.md line, tests that fail a build that ships without its tripwire, and a one-page picture of how the heartbeat works. | nothing |
| C | Fill the holes | Build a check for every "missing" from A, same proof as 10-08. | A |

A and B run at the same time. C waits for A's list.

This session owns B and runs A and C as Sonnet workflows (owner 10-06: Sonnet back end). Opus checks the checkers.

Model: A and C Sonnet, B Opus.

## Prompt A — coverage audit

> Repo /Users/chrisstanbridge/Developer/fundhub-platform, branch main (do not switch branches; other sessions edit it live). Company name Fundhub. Read-only audit — do not edit app code.
>
> Goal: prove whether every step of every intended journey has a morning-pulse check that would go red if that step broke, before a customer hits it.
>
> 1. For each journey in docs/journeys/*-intended.md (client, role-owner, role-sales-manager, role-closer, role-funding-advisor, role-inquiry-remover, role-csm, affiliate, white-label), list every step.
> 2. For each step, name the check id that catches its break: grep src/pulse/registry.mjs, src/pulse/heartbeats.mjs, src/pulse/daily-pulse.mjs, src/pulse/instant-watch.mjs, src/pulse/coverage/slice-*.mjs and gap-*.mjs. Or mark it MISSING.
> 3. Also list every Inngest job in src/workflows/index.mjs, every route in netlify/functions/api.mjs ROUTES, every public page, and every outbound send path, each with its check id or MISSING.
> 4. For every check you call "covered", say whether it can actually go red. A check that can only pass or only skip is MISSING, not covered.
> 5. Write the map to ops/workflows/heartbeat-complete-2026-10-09-map.md as one table per journey: step, check id, can it go red (yes/no + why), how fast it trips (6 a.m. only, or 5-minute instant watch).
>
> Do not invent steps. If a journey file is missing or stale, say so.

## Prompt B — rule, guard tests, explainer

> Repo /Users/chrisstanbridge/Developer/fundhub-platform, branch main. Company name Fundhub.
>
> Write one owner law, for both homes (.claude/rules/heartbeat-tripwire-on-every-build.md and .cursor/rules/heartbeat-tripwire-on-every-build.mdc, alwaysApply), plus one owner-set line in CLAUDE.md (no renumbering). It extends heartbeat-on-every-build (10-07) with what 10-08 proved:
> - Every new page, route, job or send gets a tripwire that can go RED when the customer-facing result breaks — not only an "is it up" ping.
> - New coverage files go on the literal list in src/pulse/coverage/modules.mjs (a folder scan ships empty).
> - Each check runs inside 26 s as its own Inngest step.
> - No reading repo files at run time; the live bundle does not carry them.
> - Every check has a PASS test and a FAIL test.
> - Prove it from a built bundle before calling it done.
>
> Add guard tests that fail the build when a rule is broken (extend src/pulse/registry.test.mjs / modules.test.mjs, do not weaken them).
>
> Write docs/journeys/heartbeat-flow.md: one Mermaid picture of how a check goes from code to Chris's 6 a.m. text, in 4th grade English.

## Prompt C — fill the holes

> Waits for A's map. For every MISSING row, build a read-only gap check in the matching src/pulse/coverage/gap-<lane>.mjs (or a new lane on the modules.mjs list), with PASS and FAIL tests. Prove it with the live read-only tool and from a built Netlify bundle. Do not fix product code; a real break stays red and is reported.

## Status — 2026-10-09 01:35 Arizona

| # | Status |
|---|---|
| A | done — 997 surfaces mapped: 265 deep, 439 ping only, 104 weak, 189 missing. Maps: ops/workflows/heartbeat-complete-2026-10-09-map/ |
| B | done — rule (both homes), CLAUDE.md line, picture, `npm run pulse:prove`, tripwire map + test (da48c866, 810050ca) |
| C tier 1 | done and shipped (803b2fe5) — 12 lanes built and checked; 4 new lanes listed; 37 launch-day surfaces in the tripwire map |
| C tier 2 | pending — 253 money or customer holes, listed in ops/workflows/heartbeat-complete-2026-10-09-worklist.md |
| C tier 3 | pending — 161 staff-only or internal holes, same file |

## Manifest — C tier 1 (803b2fe5)

- New lanes: `gap-handoff`, `gap-keys`, `gap-leads`, `gap-outside-inngest` (on `modules.mjs`). Extended: payments, sms, soft-pull, underwrite, funnels, webhooks, portal, calls.
- The heartbeat now speaks when the database is down: `src/pulse/instant-watch.mjs` (dead database = one red row, at most 2 texts an hour), `src/pulse/daily-pulse.mjs` (each database read guarded), `src/workflows/daily-pulse.mjs` (one fallback text if the brief or the pulse dies), `src/ops/morning-brief.mjs` (a failed save never throws after the text).
- `src/pulse/tripwires.mjs`: 37 launch-day surfaces with their deep checks; baseline 533 → 496.
- `api/ops/notify-owner.mjs` (12f052c3): one text to the owner number behind `OPS_NOTIFY_SECRET`. Used at 01:33 to text Chris "shipped" — sent to …6457.
- Proof: `npm run pulse:prove` from a built bundle — 43 steps, slowest 11.8 s, 0 SQL errors, 0 writes. Full suite: the same 12 failures as before today, 0 new. Live bundle carries 76 coverage files.

## Real breaks the launch-day tripwires see today (not fixed — product)

1. apply.fundhub.ai/order charges $297; the till says $147 (the /roadmap price). `funnel:order-price-matches-till`
2. 15 message templates are marked ready but hold lorem ipsum or a draft mark; the sender holds them, so the customer gets nothing. `gap:msg-approved-template-bad-copy`
3. New bookings carry no join link (0 of the newest 5). `calls:booked-no-join-link`
4. A lead got no welcome email (FH-000532). `handoff:lead-first-touches-missing`
5. One paid order for a product name we do not know, no access given. `payments:paid-product-unmapped`
6. A paying client has had portal access 3 days and never signed in, never sent a link. `portal:paid-client-never-signed-in`
7. Two emails left with no delivery receipt for over a day. `gap:msg-sent-no-receipt`
8. Still red from 10-08: roadmap drip skips emails, repair file FH-000507 stuck in analysis, a lead with no welcome text.

Laptop-only reds (masked keys on this Mac, real on Netlify): `brain:embed-key`, `opt-out:unsubscribe-link`.

## Next

- Move the money tripwires (leads cut, checkout no link, receipts waiting, paid no access) onto the 5-minute watch so a launch-day break texts in minutes, not next morning.
- Run tier 2 the same way.
