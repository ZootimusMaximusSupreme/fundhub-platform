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
| C1 | CI fix (M0 step 6): fresh database builds, unit suite green, pg suite runs and blocks | done, merged to main (d2a74b5c1). One test left red on purpose: climate page 'Approval Odds' vs the climate brief (owner call) |
| D | Fable design team: `docs/specs/command-center-design-2026-10-05.md` (4 audits, 3 designs, 3 judges) | done |
| S0 | Slice 0 'Today tells the truth' | built + Fable PASS on cc-slice0-today-truth; GitHub run 37427631428 failed; landing in wave 2a as unit S0 |
| G | Ground: map M0–M5 + Command Center tabs against the repo; plan units; Fable critique | done: 39 units |

## Overnight run (owner order 2026-10-05, Chris asleep, no questions)

Chris: "run these tokens into the ground, make this beautiful, and as a test when you are done build a funnel end to end for the Blueprint ($5k-$10k book-a-call offer): avatar to scripts loaded, funnel done, all tracking ready, every funnel tagged. Then test it."

Order (each stage starts when the one before lands; the main session runs it):
1. Running: C1 CI fix, G plan, S0 slice 0, the five-jobs redesign (nothing stays in Claude Code).
2. Build: Opus builders, Fable reviewers, Opus fixers, GitHub CI proof per unit, merged in dependency order into one integration branch. Scope for tonight, in order: Foundations + Settings (slice 1, incl. the marketing_funnels table that tags every funnel), research jobs on the server (avatar, ad research, deep research), Ideas tab + flywheel ports (copy, ad strategy; offer exists), Scripts (slice 3), Numbers v1 (slice 4), a Funnel builder (book-a-call funnel pages from the offer and copy, with pixel, server events, attribution script and UTM tags, saved as drafts), Videos thin (slice 2), page drafts and proof cards if time allows.
3. One ship (spec 0.8: at most two a day).
4. Blueprint test, run through the shipped machine: Capital Blueprint (src/config/offers.mjs 'consulting-package') book-a-call funnel: avatar, ad research, offer, copy, ad strategy, a script batch in the Scripts tab, funnel pages + tracking + tag. Fable QA on every output.
5. Morning report for Chris in 4th grade English, plus his taps.

Owner update (2026-10-05, before sleeping): "we can push a funnel live tho. /blueprint ... we should have a url system as well so that way i dont have to name them or allow me to name them in the dash." And: "when i wake up I expect all this done and 'ready to film'."
- The Blueprint test funnel MAY go live tonight at its own new path (e.g. /blueprint on the funnel domain). Never overwrite or change any existing live page or path; if the path is taken, the URL system picks the next free one.
- URL system: every funnel gets an automatic short URL and its tag on creation (no naming needed); Chris can rename the URL from the dashboard if he wants. The URL, the funnel tag, the UTMs and the tracking all tie to the same funnel row.
- "Ready to film": the Blueprint scripts end the night approved-ready in the Scripts tab and laid out for Shoot Day (film order, teleprompter text).

Safety for the whole night (no exceptions): no existing live page changes. No Meta ad created or turned on. No Meta ad created or turned on. No message to any customer. No money moved. No data deleted. No key removed. Model spend is allowed ("run the tokens into the ground").

## Units (filled in from the plan)

| Id | Lane | Wave | Depends on | Migrations | Work | Status |
|---|---|---|---|---|---|---|
| U01 | A | 1 | C1 | - | API contract for every marketing/* route (docs/specs/marketing-machine-api.md + machine-readable twin) | done, on main (wave 1, 33765ead0) |
| U02 | A | 1 | C1 | - | M0 step 1: rule changes (new §3c, chris-word-wins, animations-last, lowest-tier line, superseded lines, §3b ro | blocked: the auto-mode safety check stops edits to CLAUDE.md and the rule files from a workflow; needs Chris's own order in chat. U33 waits on it. |
| U03 | A | 1 | C1 | 410 | M0 step 3 part 1: marketing_settings, marketing_funnels, marketing_requests (410), funnel seed, offer facts, s | done, on main (wave 1, 33765ead0) |
| U04 | A | 1 | C1 | 411 | M0 step 3 part 2 + buzz/cost half of step 4: buzzes, model usage, shoots, jobs claim index (411), job queue li | done, on main (wave 1, 33765ead0) |
| U05 | A | 1 | C1 | 412 | M0 step 2: repo outbox (412), GitHub client provider, path allow-list, edit ops, lease-based drain (pooler-saf | done, on main (wave 1, 33765ead0) |
| U06 | A | 1 | C1 | - | M0 step 4 model client: callModel provider 'anthropic' with structured outputs, strict tools (auto only), effo | done, on main (wave 1, 33765ead0) |
| U07 | A | 1 | C1 | - | M0 step 5: Meta API v26.0 everywhere (except meta.mjs), hourly 3-day + nightly 28-day sync, link clicks source | done, on main (wave 1, 33765ead0) |
| U08 | A | 1 | C1 | - | M0 step 8: ship pulls (never blocks), pushes after log, skips machine-only commits; Netlify git-build skip rul | done, on main (wave 1, 33765ead0) |
| U09 | A | 1 | C1 | - | M1 7.1: RULES.md Part 0, contradiction sweep, stale paths, checker strict mode, optimize unbanned, per-format  | done, on main (wave 1, 33765ead0) |
| U10 | A | 1 | C1 | - | M1 7.3: RECIPES.md, angles.json, Remotion animation catalog builder, animation-plan validator | done, on main (wave 1, 33765ead0) |
| U11 | A | 1 | C1 | 413, 414 | M1 7.4 data: ad_scripts machine columns + defaults + root trigger + backfill (413), batches/ideas/voice_pairs  | done, on main (wave 1, 33765ead0) |
| U12 | A | 1 | C1 | - | M1 7.2: 30+ real voice pairs from Chris's chats into VOICE.md (main session) | done, on main (wave 1, 33765ead0) |
| U13 | B | 1 | C1 | - | M4 10.1/10.2/10.5a: Meta upload, creative, thumbnails, guards, backoff, Page/Instagram id script (meta.mjs on  | done, on main (wave 1, 33765ead0) |
| U14 | B | 1 | C1 | 416 | M4 10.3/10.4: one ad number on many Meta ads (416: plain index + fundhub_ad_number_source), url_tags builder,  | done, on main (wave 1, 33765ead0) |
| U15 | B | 1 | C1 | - | M4 10.5 Turn on: resume_ad action (one ad, by our ads.id, Chris only) | done, on main (wave 1, 33765ead0) |
| U16 | B | 1 | C1 | - | M3 9.2: the aligner src/ad-videos/align.mjs (pure, no AI) | done, on main (wave 1, 33765ead0) |
| U17 | B | 1 | C1 | - | M3 9.3: ffmpeg argument builders and cut checks src/ad-videos/ffmpeg-plan.mjs (pure) | done, on main (wave 1, 33765ead0) |
| U18 | B | 1 | C1 | - | M3 9.1 match step: whisperWords, free word-overlap pre-check, next free take number, stop renaming raw files | done, on main (wave 1, 33765ead0) |
| U19 | B | 1 | C1 | - | M3 9.5 pure parts: R2 presigned links (SigV4) and video-worker callback HMAC | done, on main (wave 1, 33765ead0) |
| U20 | D | 1 | C1 | - | M5 11.1: metric definitions (docs/marketing/metrics.md) and src/marketing/metrics.mjs with fixture tests | done, on main (wave 1, 33765ead0) |
| U21 | D | 1 | - | - | M5 precondition: run the one-time Meta history backfill for Aug 4-16 (ops, orchestrator in the main checkout) | done (main session): backfill --write applied 23 new days, refreshed 46; ad_metrics_daily now $1,563.13 over 69 days (Aug 4 - Oct 4), equal to Meta |
| U22 | A | 2 | U01, U03, U04, U05 | 415 | M0 step 4: marketing clock + background worker (in-pass waits) + GET marketing/health (heartbeats 415) | claimed (wave 2a) |
| U23 | A | 2 | U01, U03, U04, U05, U10, U11 | - | M1 7.5 planner ('reads the room') + GET/POST marketing/batches/next | claimed (wave 2b, started early on wave-2a branches) |
| U24 | A | 2 | U03, U04, U05, U06, U09, U10, U11 | - | M1 7.6 writer: Anthropic structured output (save_script schema), strict check loop, judge, compliance, samenes | claimed (wave 2a) |
| U25 | A | 2 | U01, U03, U05, U09, U11 | - | M1 7.8 core script actions (scripts, script, approve, edit, reject, order) + 7.9 repo files + voice pairs on e | claimed (wave 2a) |
| U26 | A | 2 | U01, U03, U04, U05, U09, U11 | - | M1 7.8 rest: ideas (incl. suggestions), rules, scripts/fix, batches history (write_now_ready), batches/write-n | claimed (wave 2a) |
| U27 | B | 2 | U07, U14 | - | M4 10.5 sync mapping: ads fetch asks creative{url_tags}; sync writes ad numbers without overwriting manual one | claimed (wave 2a) |
| U28 | B | 2 | U01, U03, U04, U11, U13, U14, U19 | 417 | M4 loader: meta_load job + POST marketing/meta/load + GET load-status (paused only; refuses until the final vi | claimed (wave 2a) |
| U29 | B | 2 | U10 | - | M3 9.4a: see-through (transparent) switch on every Remotion template, alpha renders | claimed (wave 2a) |
| U30 | B | 2 | U10, U16, U17 | - | M3 9.4b: animation planner and overlay/finalize argument builders (pure) | claimed (wave 2a) |
| U31 | D | 2 | U01, U03, U11, U14, U20 | - | M5 11.2 part 1: GET marketing/ads and GET marketing/ad?n= | claimed (wave 2a) |
| U32 | D | 2 | U01, U03, U10, U11, U20 | - | M5 11.2 part 2: GET marketing/angles, GET marketing/funnels/stats, and additive M5 keys in GET marketing/today | claimed (wave 2a) |
| U33 | D | 2 | U02 | 424 | M5 11.4 Clarity: database counter (424), capped adapter for org sync, sweeper registered, law updated in all t | pending |
| U34 | E | 1 | U01, U03 | - | Command Center frame: tab bar, Today moved into its own file, Settings tab (schedule, caps, funnels, campaign  | claimed (wave 2b, started early on wave-2a branches) |
| U35 | A | 3 | U22, U23, U24, U25, U26 | - | M1 7.7 batch lifecycle: weekly scheduling on the clock, start/plan/write/release/expiry jobs, one buzz with th | pending |
| U36 | E | 2 | U25, U26, U34 | - | Command Center Scripts tab: Inbox (Approve, Edit, Fix, Reject, film order, Write now when ready), Ideas, Rules | pending |
| U37 | E | 2 | U22, U23, U26, U32, U34 | - | Command Center Today additions: next drop + Write now (when ready) + suggestion accept, health card, M5 number | pending |
| U38 | E | 2 | U26, U31, U32, U34 | - | Command Center Ads, Angles and Funnels tabs (watch-curve drawer, 'Make more of this', step rates) | pending |
| U39 | E | 2 | U15, U28, U34 | - | Command Center Launch tab: Load to Meta, Load all approved, load status and reasons, Turn on per ad | pending |

Full briefs: `ops/workflows/marketing-machine-2026-10-plan.json` (key final.units). U34 waits for U01 and U03, so it runs in wave 2.

## Owner defaults taken (design §7, 2026-10-05)

- Seven tabs (Today, Ideas, Scripts, Shoot, Videos, Launch, Numbers; Settings behind the gear): yes.
- A Submagic retry that makes a new project may pay again: yes, only behind a confirm that prints the minutes and "a retry pays again".
- Per-ad Pause and ad-set budget on Launch in v1: no; Launch links to Campaigns; per-ad Pause comes with slice 9.

## Design defaults taken without asking (design §7 q4-q14, 2026-10-05 night)

Recommended answer on each, except q10: the approval deck stays OFF /roadmap (Chris said no earlier tonight). q7 (intended journey) stays an only-Chris item. q11 (Render, R2) waits for Chris's accounts. q12: no new image library; crops are cut in the browser.

## Extra units (owner orders not in the plan): `ops/workflows/marketing-machine-2026-10-extras.json`

| Id | Work | Wave | Status |
|---|---|---|---|
| X4 | Funnel builder + automatic funnel URLs + tags + tracking + Push live to a new path | 2a | claimed (wave 2a) |
| X1 | Build the avatar on the server (slice 5a) | 2b | claimed (wave 2b, started early) |
| X2 | Research the market + Research it on the server (slice 10) | 2b | claimed (wave 2b, started early) |
| X3 | Ideas back end: flywheel stages from buttons (slice 5) | 2b | claimed (wave 2b, started early) |
| X8 | Ideas tab + Research + Funnels cards | 2c | pending |
| X5 | Ready to film: Shoot tab + teleprompter page | 2c | pending |

Wave order (updated 2:45 am): 2a = U22, U24-U32, X4, S0 (running); 2b = U23, U34, X1, X2, X3; 2c = U35, U36, U37, U38, U39; 2d = X5, X8. U33 waits on U02. U34 runs after S0 because both change the Today screen. Then one ship, then the Blueprint test.

## Blockers / only-Chris items (spec §16)

- The intended journey `docs/journeys/marketing-machine-intended.md` was approved in the archived chat but never committed. A hook blocks agents from writing `*-intended.md`.

## Change manifests
- 2026-10-06 2:45 am MST (2:40 timer): wave 1 done, 19 of 20 units on main at 33765ead0 and pushed to GitHub; U02 blocked; wave 2a launched (12 units incl. X4 funnel builder and the slice 0 fix).

## Oversight log
- 2:46 am oversight: alive, last activity 2:42 am, board commit 661d5e9a5 (wave 1 on main, wave 2a running).
- Found: the build moved 4 minutes ago. Wave 2a has 12 units running in worktrees.
- Did: nothing to wake. No takeover. Left the main session to run.
- 2026-10-06 5:35 am MST: owner asked for more speed. Wave 2a: 12/12 CI green, 10 clean reviews, U24 and X4 fixing. Wave 2b started early on top of the 2a branches (U23, U34, X1, X2, X3). A separate team writes the Blueprint test plan (docs/specs/blueprint-funnel-test-plan-2026-10-06.md) so the test starts right after the ship.
