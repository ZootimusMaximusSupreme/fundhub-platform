# Marketing machine build — board (spec v3)

Spec: `docs/specs/marketing-machine-2026-10-04.md` (approved by Chris, §17 all defaults).
Goal (Chris, 2026-10-05): "use the dashboard to run marketing, not Claude Code."
Finish line: spec §15 (Monday batch → approve on phone → Shoot Day → videos cut and captioned → Load all approved → numbers next morning).

Board rule (spec §0.3): only the main session (orchestrator) writes this board. Workers report claim, change manifest and blockers in their final message.
Models (owner order 2026-10-05): Opus builds, Fable reviews and polishes.

## Already done before this board (2026-10-05 batches, live on main 96be0809)

- Command Center page, Today view, Write ad copy, Write offer (M10, M11, M12; migration 409 `marketing_jobs`, seed 296).
- Ad numbers by ad set + name, roadmap lane, Meta purchases / link clicks / landing page views saved (migrations 406–408).
- Report tie-out (Arizona days), dying-ad buzz, next-take table, ClickFunnels night job, heartbeat machine checks, take joiner (M6), Meta event fixes.

## Lanes and migration numbers (spec §0.5)

| Lane | Builds | Migration numbers |
|---|---|---|
| A | M0, M1 back end, M2 back end | 410–415 (406–409 used today) |
| B | M3, M4 back ends | 416–423 |
| C | CI fix (M0 step 6), M6a, M6b | none |
| D | M5, M7, M8 back ends | 424–429 |
| E | every screen | none |

Note: production also holds migrations 430–433 from another session (files not in this repo). Do not use 430+.

## Wave 0 (running)

| Id | Work | Status |
|---|---|---|
| C1 | CI fix (M0 step 6): fresh database builds, unit suite green, pg suite runs and blocks | claimed |
| D | Fable design team: `docs/specs/command-center-design-2026-10-05.md` (4 audits, 3 designs, 3 judges) | done |
| S0 | Slice 0 "Today tells the truth" (design §6): Opus build, 3 Fable reviews, Opus fix, Fable re-check | claimed |
| G | Ground: map M0–M5 + Command Center tabs against the repo; plan units; Fable critique | claimed |

## Overnight run (owner order 2026-10-05, Chris asleep, no questions)

Chris: "run these tokens into the ground, make this beautiful, and as a test when you are done build a funnel end to end for the Blueprint ($5k-$10k book-a-call offer): avatar to scripts loaded, funnel done, all tracking ready, every funnel tagged. Then test it."

Order (each stage starts when the one before lands; the main session runs it):
1. Running: C1 CI fix, G plan, S0 slice 0, the five-jobs redesign (nothing stays in Claude Code).
2. Build: Opus builders, Fable reviewers, Opus fixers, GitHub CI proof per unit, merged in dependency order into one integration branch. Scope for tonight, in order: Foundations + Settings (slice 1, incl. the marketing_funnels table that tags every funnel), research jobs on the server (avatar, ad research, deep research), Ideas tab + flywheel ports (copy, ad strategy; offer exists), Scripts (slice 3), Numbers v1 (slice 4), a Funnel builder (book-a-call funnel pages from the offer and copy, with pixel, server events, attribution script and UTM tags, saved as drafts), Videos thin (slice 2), page drafts and proof cards if time allows.
3. One ship (spec 0.8: at most two a day).
4. Blueprint test, run through the shipped machine: Capital Blueprint (src/config/offers.mjs 'consulting-package') book-a-call funnel: avatar, ad research, offer, copy, ad strategy, a script batch in the Scripts tab, funnel pages + tracking + tag. Fable QA on every output.
5. Morning report for Chris in 4th grade English, plus his taps.

Safety for the whole night (no exceptions): nothing goes public or live without Chris's tap. The funnel stays a draft (no ClickFunnels publish, no live page change). No Meta ad created or turned on. No message to any customer. No money moved. No data deleted. No key removed. Model spend is allowed ("run the tokens into the ground").

## Units (filled in from the plan)

## Owner defaults taken (design §7, 2026-10-05)

- Seven tabs (Today, Ideas, Scripts, Shoot, Videos, Launch, Numbers; Settings behind the gear): yes.
- A Submagic retry that makes a new project may pay again: yes, only behind a confirm that prints the minutes and "a retry pays again".
- Per-ad Pause and ad-set budget on Launch in v1: no; Launch links to Campaigns; per-ad Pause comes with slice 9.

## Blockers / only-Chris items (spec §16)

- The intended journey `docs/journeys/marketing-machine-intended.md` was approved in the archived chat but never committed. A hook blocks agents from writing `*-intended.md`.

## Change manifests
