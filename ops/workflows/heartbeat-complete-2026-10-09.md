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

## Status

| # | Status |
|---|---|
| A | claimed — Sonnet audit running (9 groups, a checker each); maps land in ops/workflows/heartbeat-complete-2026-10-09-map/ |
| B | rule, picture, proof command done (da48c866). Left: the test that makes every money or customer surface name its deep check — needs A's list, lands with C |
| C | pending — waits on A |

## Manifest — B (da48c866)

- `.claude/rules/heartbeat-on-every-build.md`, `.cursor/rules/heartbeat-on-every-build.mdc` — the tripwire law, same words.
- `CLAUDE.md` — one sentence added to "Heartbeat on every build". No renumbering.
- `docs/journeys/heartbeat-flow.md` — the picture; `docs/journeys/CHANGELOG.md` line.
- `scripts/pulse/prove.mjs`, `package.json` script `pulse:prove`. First run: 39 steps, slowest 11.7 s, 0 SQL errors, 0 writes, OK.
