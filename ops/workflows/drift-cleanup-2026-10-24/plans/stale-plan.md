# Phase 4 planner 2: the stale and dead plan

Date: 2026-10-24. Branch: `drift-cleanup`. Agent: planner 2 of 2 (Sonnet). Read only: this file is the one thing written. Nothing is edited, moved or committed. The lead applies it.

**The answer.** Four kinds of finds, all checked against the committed text at `40c0f49bc`:

| Kind | Count | What it is |
|---|---|---|
| Archive whole files | 15 | 9 boards and briefs meant for one day or one batch, plus 6 old landing-page notes. Each passed all three tests: old, nothing live points at it, a named replacement. |
| Remove lines | 44 | Text meant for a night, a week, a launch or a batch, or plainly wrong now. Each has its archive reason. |
| Fix dead references | 54 | A path, file or folder that does not exist at the committed state. Most have a right current path. The rest were never committed or were deleted. |
| Maybe | 28 | Files and lines where one fact is only Chris's to settle, or where code still points at the file. |

After those, a report-only list for code, generated files and files outside the brief's list.

## How I looked

1. Read all 79 rules, our 16 skills, `CLAUDE.md`, `AGENTS.md`, `README.md`, `DEPLOY.md`, `docs/rules`, `docs/sops`, `ops/*.md`, the marketing books, the landing-page notes, the VSL notes, the flywheel and broll READMEs, and `.claude/commands`. Read the heads and standing-rule parts of the boards the brief names.
2. Searched every one of those files for time words: today, tonight, tomorrow, this week, until, by Monday, for now, paused, before launch, next month, temporary, "this batch".
3. Ran a path scanner over backticked paths, link targets, top-folder paths, bare file names and `npm run` names. It checked each against the committed tree and against git history. Paths in gitignored places (`credentials/`, `.env`, `.claude/settings.local.json`) are not counted as dead.
4. For each file I read its first and last real commit date (`git log --follow`), who points at it (`git grep` over the whole repo, split into live instructions, code, boards and generated pages), and what replaced it.
5. Ran the scanner a second time after I found a retired folder name it had missed (`clickfunnels-fragments/`, now `marketing/landing-pages/`). Also scanned the hook and settings files: no dead path there.
6. Checked every quote in this plan against the committed file with a script: 91 quoted pieces in the Remove-lines list, each found within three lines of the line I cite. The quotes in the archive table and the Maybe list were read against their files the same way; the few that did not match word for word are my own proposed wording or come from another file, and I checked those by hand.

**Already decided in Phase 3 and not repeated:** the five archived rules (`monday-100-percent`, `grok-lattice-overseer-perpetual`, `pulse-registry`, `approved-launch-release-blockers`, `ui-standards`), the two archived boards (`codex-build-claude-test-2026-10-13.md`, `ad-scripts-2026-10-02.md`), the paste prompt `slo-297-prompt-2026-09-18.md`, the 50 calls, and the 15 fixes in #44. Where a find touches a decided file I say so and add only the new part. The pointer table below lists every live line that still names the archived rules, because a retired rule loses every pointer.

**Archive note format.** When a line is removed, append its old text, the date and the reason to `ops/archive/ai-instructions-2026-10-24/removed-lines/<path with / replaced by __>.md` (for `CLAUDE.md` that is `CLAUDE.md.md`). Move whole files into `ops/archive/ai-instructions-2026-10-24/` and keep their relative path.

## Tests that read these files (read before you edit)

Six of the files I propose to edit are held by tests. I ran the six suites below on the untouched tree: 130 tests, 0 fail. Run them again after the matching edit: `node --test src/http/monitoring.test.mjs src/ad-videos/merge-takes.test.mjs src/marketing/shoot-plan.test.mjs src/marketing/catalog.test.mjs src/ui/screen-standard.test.mjs src/marketing/rules-store.test.mjs`.

| File | Test | What it holds | Affects |
|---|---|---|---|
| `docs/sops/RUNBOOK.md` | `src/http/monitoring.test.mjs:71-135` | A heading with "monitor"; a heading with "roll back"; the words alert, alarm or page; on-call words; a "down / fix / what to do" heading; `/api/health?strict=1` and "503"; the five state words; a rollback section naming Netlify and the database and saying "not" or "forward-only"; and one honesty phrase: "not (yet) done / set up / configured", "nothing watches / checks", or "no monitoring / alerting / alarms". That last test is itself stale (the pulse watches now). | S20 to S24 and decision #27 |
| `DEPLOY.md` | same file, line 175+ | A link to `docs/sops/RUNBOOK.md` and the text `/api/health?strict=1`. | no edit planned |
| `marketing/ads/NAMING.md` | `src/ad-videos/merge-takes.test.mjs:165,342`; `src/marketing/shoot-plan.test.mjs:20-62` | Exactly 7 SLO rows and 11 Direct Book rows in the two tables, and the example names printed in backticks. | S33: change prose only; add no table rows |
| `marketing/ads/RECIPES.md` | `src/marketing/catalog.test.mjs:409` | The file equals Appendix B of `docs/specs/marketing-machine-2026-10-04.md` word for word. | S38 and #44.10: edit both together |
| `marketing/ads/ASSET-BANK.md` | `src/marketing/catalog.test.mjs:347-396` | Sections 2, 3 and 4 (mechanism headings, the numbered list, the avatar rows) must match `marketing/ads/angles.json`. | S32: change cell text only |
| `marketing/ads/RULES.md`, `VOICE.md`, `RECIPES.md` | `src/marketing/writer.mjs:154-156` loads all three into the live script writer; `src/marketing/rules-store.test.mjs:128` parses Part 0 (rules 0 to 44, in order) | My RULES.md edits (S37, D14, D15) sit outside Part 0. The writer reads the new text on the next run. | S37, S38 |
| `CLAUDE.md` | `src/ui/screen-standard.test.mjs:217` | The file must name `docs/rules/UI-STANDARDS.md` (line 433 today) and UI-STANDARDS must keep its section 12. The rules checker also needs each always-on owner law named in `CLAUDE.md`. | Phase 5 index |

## Overlaps with the dedupe plan (`plans/dedupe-plan.md`)

Both plans edit some of the same files. Every line number in both plans comes from commit `40c0f49bc`. If one plan is applied first, find the text by its quote, not by its line number. These are the real overlaps:

| This plan | Dedupe plan | What to do |
|---|---|---|
| S12 (RULES-INDEX row 41) | D200 | Same row. Delete it once. |
| S29 (testimonial skill lines 62-63) | D55 (lines 59-63) | D55 replaces the block with a pointer and drops the garbled sentence. If D55 is applied, skip S29. |
| D6 (ui-auditor skill line 41) | D58 | Same edit. Do it once. |
| D4 (`live-playwright-100-before-manual.md` line 23) | M3, D134, D191 | M3 archives that rule and moves its text into `test-means-human-click`. Make the D4 edit there. |
| S33 (NAMING.md line 63) | D226 | D226 adds the pointer to `filmed-names-2026-10-22.md`. S33 changes only the table caption. |
| S20 to S24 (RUNBOOK) | D218, D219 | Different lines. D218 says not to touch RUNBOOK line 183. Keep the RUNBOOK test caution above. |
| S43 and D45 (clickfunnels SOP lines 38, 42, 85, 95, 105) | D220 to D224 (lines 8, 82-84, 92, 117-119, 123) | Different lines. D221 keeps line 85. Lines shift after D221 to D223, so use the quotes. |
| S44 (push skill, the `/apply` row) | D24 (line 44) | D24 deletes the row above it. Apply S44 after that, by the row's text. |

---

## Archive whole files

Each row passed the three tests: the last real edit is old, no live instruction file points at it (boards that point at each other do not count), and a newer file replaced it. No code, test or hook opens any of them. Two scripts in `scripts/tmp/` (`hole17-finish-db-token-2026-09-20.mjs` and `hole17-finish-reuse-token-2026-09-20.mjs`) build a path into the evidence folder `docs/workflows/full-launch-lattice-2026-09-20-evidence/`, which is not in the repo. A comment at `src/pulse/coverage/slice-28-funding-advisor.mjs:8` says "full-launch lattice". Neither reads the board.

| ID | Path | Why (quote, date) | Replacement | Inbound pointers to fix (path:line) |
|---|---|---|---|---|
| A1 | `ops/workflows/full-launch-lattice-2026-09-20.md` | "Long-running launch workflow — full client e2e + AI ops e2e + all employee/staff paths" (2026-09-20, 809 lines). Its governing rule `grok-lattice-overseer-perpetual` is archived in Phase 3. The repo-sync board of 2026-10-05 lists it "not done", so its open lanes are launch work the heartbeat took over. | `.ai/rules/full-end-to-end-audit.md` (walk every live path) and `.ai/rules/heartbeat-on-every-build.md` with `docs/journeys/heartbeat-flow.md` (the company tests itself every hour) | `.ai/rules/grok-lattice-overseer-perpetual.md:13` (archived with the rule); `ops/workflows/grok-overseer-handoff-2026-09-20.md:6,19,55`; `ops/workflows/ops-overseer-lattice-2026-09-20.md:3,32`. No live instruction file names the board. `marketing/MACHINE-GAPS.md:145` cites it (a dated snapshot; report only). |
| A2 | `ops/workflows/ops-overseer-lattice-2026-09-20.md` | "Stays continuous in perpetuity (owner-set 2026-09-20)." A Grok overseer job for the launch lattice. | same as A1 | `.ai/rules/grok-lattice-overseer-perpetual.md:17` (archived with the rule); `ops/workflows/full-launch-lattice-2026-09-20.md:19` and `ops/workflows/grok-overseer-handoff-2026-09-20.md:7,20,56` link to it. |
| A3 | `ops/workflows/grok-overseer-handoff-2026-09-20.md` | "Cursor chats die. The launch lattice does not." A paste prompt to restart the Grok overseer (2026-09-20). | same as A1 | `.ai/rules/grok-lattice-overseer-perpetual.md:14` (archived with the rule); `ops/workflows/full-launch-lattice-2026-09-20.md:20,538`; `ops/workflows/ops-overseer-lattice-2026-09-20.md:5,47`. |
| A4 | `ops/workflows/codex-finish-handoff-2026-10-13.md` | "This file is a brief for Codex. It is the only thing Codex needs to start." (2026-10-13). Paired with the board Phase 3 archives (`codex-build-claude-test-2026-10-13.md`, a one-day rule). Its own rules list says "Keep no branches on GitHub: merge, push `HEAD:main`", which the 2026-10-24 branch call replaced. | The work it briefed was built in `ops/workflows/heartbeat-build-2026-10-13.md` and finished in `ops/workflows/heartbeat-finish-2026-10-18.md`. The standing laws are in `heartbeat-on-every-build`. | `ops/workflows/codex-build-claude-test-2026-10-13.md:5,13` (archived with it). Nothing else. |
| A5 | `ops/workflows/tuesday-plan-review-2026-10-11.md` | "Read-only review. No product code changed." (2026-10-11). Reviews a plan for Tuesday 2026-10-13. Both rows say "done". | `ops/workflows/heartbeat-build-2026-10-13.md` (the Tuesday wiring round) | none |
| A6 | `ops/workflows/animation-plans-2026-10-22.md` | "All 14 plans pass the checker … Not saved to the database." (2026-10-22). All four units say "done". | `marketing/ads/animation-plans/2026-10-22.json`, `marketing/ads/animation-plans/new-animations-needed.md`, and `ops/workflows/animation-builds-2026-10-22.md` | none |
| A7 | `ops/workflows/claude-submagic-style-brief-2026-09-23.md` | "Repo context is accurate as of 2026-09-23." A paste brief that asks for eye tracking ON and Submagic dead-space trimming. Chris later ruled both out (2026-10-23 and 2026-10-24: Submagic does captions and clean audio only; we do the cutting). | `.agents/skills/fundhub-ad-editor/SKILL.md` ("Submagic gets only this") and `.ai/rules/ad-video-best-of-clips.md` | none |
| A8 | `ops/workflows/lender-data-brief-2026-09-16.md` | "Lender data — what we have, for the Cursor build (2026-09-16)." A one-time brief. The build followed within two days: `scripts/lenders-merge-crm-into-csv.mjs` (2026-09-16) and `scripts/lenders-add-personal-loans.mjs` (2026-09-18, 19 national personal-loan lenders). The 313 banks load from `docs/legacy-strong/lenders-legacy-strong.csv` through `scripts/lenders-import-alec.mjs` (named in `CLAUDE.md` section 2). | `scripts/lenders-import-alec.mjs`, `scripts/lenders-add-personal-loans.mjs` and `docs/legacy-strong/` | none |
| A9 | `marketing/landing-pages/fixes.md` | "Drop-in files live in this folder. Paste each into the matching Custom HTML/JS element in ClickFunnels." (2026-08-11). The output file of the Cursor repair task. It tells people to paste, which `chris-never-clickfunnels` and `clickfunnels-html-api-push` ban. | The live fragments in `marketing/landing-pages/`, pushed by `scripts/cf-push-custom-html.mjs`; `docs/sops/clickfunnels-custom-html-push.md` | `marketing/landing-pages/CURSOR-PROMPT.md:60,83` name `fixes.md` as the deliverable. Both lines sit inside the range S41 removes. |
| A10 | `marketing/landing-pages/fixes-v2.md` | "ClickFunnels fragment polish V2 … Paste into the matching Custom HTML/JS elements." (2026-08-11) | same as A9 | none |
| A11 | `marketing/landing-pages/fixes-v3.md` | "Fundhub funnel fragments — fixes V3 … Date: 2026-08-11" | same as A9 | none |
| A12 | `marketing/landing-pages/roadmap-updates-2026-09-21.md` | "This is the spec only. The live page was not changed in this pass." and "Do not upload testimonials or approval screenshots into the funnel yet." (2026-09-21). The page was rebuilt on 2026-09-29 and 2026-10-01, and testimonial cards are live. | `marketing/ads/roadmap-page-changes.md` (the change log) and the live page `marketing/landing-pages/slo/slo-01-sales.html`. `fundhub-testimonial-thumbnails` says where assets go (`public/funnel/`). | none |
| A13 | `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` | "Chris pastes this whole file into a Claude chat." (2026-10-01). It fills a hole `SLOT-SNEAK-PEEKS` on `slo-01-sales.html`; that marker is gone (0 hits). It tells the page to use "Funding Snapshot" (banned in sales copy by `outcome-first-copy`) and points at the archived `slo-297-prompt-2026-09-18.md` (line 74). | The "See a sample" cards on `slo-01-sales.html` (24 lines mention a sample); `.ai/rules/sample-clients-consistent.md` | `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md:134,209` (see M9: fix both lines in the same change) |
| A14 | `marketing/landing-pages/slo/FUNDHUB-297-FUNNEL-README.md` | "FundHub $297 Funnel — everything from 9/18–9/20". It lists folders not in the repo (`1-clickfunnels-fragments`, `2-shareable-previews`), files that do not exist (`01-sales-page-297.html`), and "Set FH_SIM = false before launch". | `marketing/landing-pages/slo/README.md` (after S40 cleans it) | none. Before moving it, copy any still-open item from its "Open items" list (lines 26-32) to `TODO.md`. |
| A15 | `ops/workflows/coverage-paused-until-2026-10-13.md` | "Coverage batch — PAUSED until Tuesday 2026-10-13, 10:00 a.m. Arizona (MST)." The date passed 11 days ago. Its state report is from 2026-10-10. | `ops/workflows/heartbeat-build-2026-10-13.md`. The laws it states (clean code, small read-only checks, tests both ways) are in `heartbeat-on-every-build` items 6 to 9. | `ops/workflows/tuesday-plan-review-2026-10-11.md:12` and `ops/workflows/codex-finish-handoff-2026-10-13.md` (both archived above) |

**Check after the moves:** `git grep` for each moved name should find only other archived boards and the history boards under `ops/workflows/repo-restructure-2026-10-01/`.

### Pointers to the rules Phase 3 archives (live lines that must change)

Phase 3 archives `monday-100-percent`, `grok-lattice-overseer-perpetual`, `pulse-registry`, `approved-launch-release-blockers` and `ui-standards`. These live lines still name them. `npm run rules:check` catches path-form pointers (such as `.cursor/rules/x.mdc` in `CLAUDE.md`). It does not catch bare names (such as `approved-launch-release-blockers.mdc` inside a rule), so fix those by hand.

| Rule | Live lines to fix | What to do |
|---|---|---|
| `monday-100-percent` | `CLAUDE.md:288-290` (whole section); `docs/rules/RULES-INDEX.md:76` | Remove both. The standing parts are already in `heartbeat-on-every-build`. |
| `grok-lattice-overseer-perpetual` | `CLAUDE.md:388` (the sentence "The Grok overseer stays on the launch lattice." and the second path in the last sentence); `docs/rules/RULES-INDEX.md:55`; `scripts/rules-drift-allow.json:5` (code, see R2) | Keep the `no-claude-in-cursor` half of `CLAUDE.md:388`. |
| `pulse-registry` | `CLAUDE.md:300` (whole paragraph; keep line 298); `docs/rules/RULES-INDEX.md:75` | Remove. Rename the heading at `CLAUDE.md:296` to "Human-click tests (owner-set 2026-08-16)". Code comments name it too (R3). |
| `approved-launch-release-blockers` | `.ai/rules/named-fix-regression-gate.md:10`; `.ai/rules/no-extra-holes.md:12`; `.ai/rules/one-issue-per-thread.md:10`; `.ai/rules/owner-scope-minimal-diff.md:26`; `AGENTS.md:41`; `CLAUDE.md:125-127`; `docs/rules/RULES-INDEX.md:41` | Point each rule line at `finish-the-requested-job` (2026-10-20). Remove `CLAUDE.md:125-127` and the `AGENTS.md:41` bullet (it repeats `AGENTS.md:28`). The one unique clause, "a new file, route, field or test fixture needed for the repair is included", already lives in `owner-scope-minimal-diff` line 32. Nothing to fold. |
| `ui-standards` | `.agents/skills/fundhub-ui-auditor/SKILL.md:41`; `docs/rules/RULES-INDEX.md:122`; `scripts/rules-drift-allow.json:6` (code, see R2) | The skill line becomes "`docs/rules/UI-STANDARDS.md` governs the rebuild". |

---

## Remove lines (archive their text)

Kinds: TEMPORARY = meant for a night, a week, a batch or a launch. STALE = was true, is not now (evidence given). WRONG = false or garbled today. SUPERSEDED = a newer file says the same thing.

### CLAUDE.md
Apply each edit where the text lives after Phase 5.
- S1 | line 461 | STALE "**Measured 2026-09-06:** … `fundhub-scripts.md` and `fundhub-vsl.md` are not in the repo, not on any branch, and not anywhere on this Mac. `marketing/ads/registry.json` was built without them" | remove and archive the paragraph. The scripts were compiled on 2026-10-03 into `marketing/ads/scripts/ALL-SCRIPTS-since-2026-09-02.md` and `ALL-ADS-since-2026-09-03.md` (the second says "from the repo and from the Claude chat threads"). Titles are optional (line 477). Keep line 450 and line 463. This is the only live pointer to `ops/2026-09-06-self-analysis.md` (see M1).
- S2 | line 135, last clause | STALE "Four marketing skills and 83 ad scripts were never in git and are gone." | change to "…were never in git. The 83 ad scripts were rebuilt on 2026-10-03." Keep the laptop story; it is the reason for the commit rule.
- S3 | lines 296 and 300 | SUPERSEDED heading "Heartbeat pointer and human-click tests" and "`pulse-registry` (owner-set 2026-08-25) is only a pointer to `heartbeat-on-every-build` above." | the pointer table covers line 300; this entry is here so the heading rename is not missed.

### AGENTS.md
- S4 | line 41 | SUPERSEDED "An approved launch includes repairs to every required release check that fails … See `.cursor/rules/approved-launch-release-blockers.mdc`." | remove the bullet. Lines 23-36 ("Finish the requested outcome") already say it and are newer.

### README.md
README is a July 2026 build log. Today it tells agents things that are false.
- S5 | line 5 | TEMPORARY "Built WHILE the live CRM system keeps running. Nothing about launch pauses. Cut over rail by rail once gates pass." | remove and archive.
- S6 | lines 12-14 | TEMPORARY "Status: Phase 0 / B1 started … B1 merges first." | remove and archive. Lines 16-17 describe files that exist; keep them only if the lead wants a short "what is here" list.
- S7 | lines 19-20 | STALE "Open item before B2/B3 build against this … Migration `003_clients_custom_fields.sql` must generate the typed columns" | remove and archive. That file does not exist (003 is `003_client_indexes.sql`; the custom-field migration is `005_client_custom_fields.sql`), and the typed `cf_svy_*` columns exist (`marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md:7`).
- S8 | lines 22-26 | WRONG "Phase 0: … + Cognee ingestion … Tooling (mandated): OpenCode + Antigravity + **Cognee** (shared memory — every agent queries the graph before writing code …)" | remove and archive. The owner chose pgvector, not Cognee, on 2026-08-02 (`db/migrations/130_company_brain.sql:3`, `src/company-brain/config.mjs:3`). No other instruction file mentions Cognee. Replace with one true line: "Company Brain uses pgvector in Postgres (owner-set 2026-08-02). Cognee is not used."
- S9 | lines 40, 45, 46 | STALE "**105 unit tests pass** … **124 unit tests pass** … **Validated live against real Postgres 16** (2026-07-24, throwaway Docker container)" | remove the three counts and archive them. `npm test` runs more than 29,000 tests today (`ops/workflows/animation-builds-2026-10-22.md:76`).
- S10 | lines 43, 44 | WRONG "Deploy target = Vercel (Spec §2)" and "`public/dashboard.html`" | line 43: drop the Vercel sentence (line 3 is decided in #27). Line 44: drop `public/dashboard.html` (deleted in commit `6a50fb48c`). `api/dashboard/*.mjs` still exists.
- S11 | lines 120-121 | TEMPORARY the "## Next" heading, then "Provision a Postgres, run `npm install` + `npm run migrate` to validate the schema live … Deferred behind the Monday launch — builds in parallel." | remove and archive.

### docs/rules/RULES-INDEX.md
- S12 | lines 41, 55, 75, 76, 122 | SUPERSEDED rows for the five rules Phase 3 archives | remove the five rows. The index check only requires rules that exist. Dedupe-plan D200 deletes the line 41 row too (the merge into `finish-the-requested-job`); delete it once.
- S13 | lines 157-159 | TEMPORARY "## Open calls and drift fixes … The 2026-10-24 drift pass is on the board `ops/workflows/rules-drift-2026-10-24.md`" | after this cleanup merges, point at `ops/workflows/drift-cleanup-2026-10-24/BOARD.md` or remove. Lines 138 and 153 are decided in #42.

### docs/rules/TELEPROMPTER-VIDEO.md
- S14 | line 9, one sentence | TEMPORARY "This batch permits the requested small actual-camera badge and the reported overlapping script-picker labels." | remove that one sentence and archive it. It allows one batch of 2026-10-12. Keep the rest of line 9, including "The badge shows granted camera settings … Never fill the badge from the selected preset" (a standing rule).
- S15 | line 21 | TEMPORARY "Measured regression (2026-10-12): the 7:18 p.m. Ad take has correct full portrait framing … averages 24.23 fps." | archive. It is one dated incident; the lesson is in items 7 and 8.

### docs/rules/compliance/creative-block-reasons.md
- S16 | lines 201-203 | TEMPORARY "**This folder did not exist.** `CLAUDE.md` §7 says domain rules live in `docs/compliance/`. Before this file, that folder was not in the repository at all. This page creates it." | remove item 1 and renumber. It describes the day the file was made. The folder is now `docs/rules/compliance/`.

### docs/sops/README.md
- S17 | line 4 | TEMPORARY "SMS = Twilio (prove Monday) · … · CRS = sandbox today" | rewrite to the live stack or remove the stack line. It dates from 2026-08-14.
- S18 | line 21 | STALE "Do not dump the paused outbound queue." | remove. Sending is live (`product-is-live`); no queue is paused.

### docs/sops/manual-sms-twilio.md
- S19 | lines 5, 15 | TEMPORARY "Twilio must be **proven Monday** before it is the approved live path. Until then, treat every live send as a careful test only." and "You are proving Twilio on the approved Monday check." | remove both. That Monday was 2026-08-17.

### docs/sops/RUNBOOK.md
Decision #27 fixes six lines and adds a banner. These other lines say what is "today" and are false now. Fix them in the same pass. **Do not just delete them:** `src/http/monitoring.test.mjs` needs the monitoring, alerting, on-call and rollback topics to stay (see the test table), and it needs one sentence that says no monitor or alert is set up. Keep the headings. Replace each false claim with a true one. For the honesty sentence, write something that is true and that the test reads, for example "No outside uptime monitor is set up on `/api/health?strict=1` yet; the hourly pulse checks the company from inside (`docs/journeys/heartbeat-flow.md`)." Check first whether an outside monitor polls that URL (`netlify/functions/pulse-outside-watch.mjs` is a five-minute watcher). If the test's claim is no longer true at all, change the test (code, leftovers list) instead.
- S20 | lines 7-13 | STALE "Almost nothing in this system watches itself. If the database stops answering at 2am, nothing sends an email, a text, or a phone alert on its own." | replace with a pointer to `docs/journeys/heartbeat-flow.md` (the morning pulse and the hourly beats) and `texting-hours`.
- S21 | lines 31, 84, 93-94 | STALE `"migrations":69,"expected":69`, "51 of 69 migrations applied, 18 pending", "There are 69 of them today." | there are 347 `.sql` files in `db/migrations`. Say "read the count from `/api/health`" and drop the numbers.
- S22 | lines 237-238 | STALE "Right now nothing checks the site on a schedule." | the hourly pulse does (`netlify/functions/pulse-hourly*.mjs`). Rewrite or remove the Monitoring section.
- S23 | lines 276-277, 283-284 | STALE "Nothing else in this system alerts on anything … it is not switched on yet." and "There is no rota today and no agreed response time." | the alert road exists (texts to Chris inside the texting window). Remove with S22.
- S24 | lines 313-326 | STALE the "none of this exists" list: "No alarms", "No error collection", "No speed or usage tracking", "No automatic checks before a deploy", "Nobody on call" | `ship.yml` runs lint and guard tests before every deploy; the pulse records and texts breaks. Replace the block with a pointer to the heartbeat flow. Lines 308 and 328 are in #27.

### docs/specs/teleprompter-ios-app-build-2026-10-10.md
- S25 | lines 3-4, 6-7, 52-53 | STALE "**Status: paused.** … Nothing here is started." and "Chris pays the $99 Apple developer account at the end of this week." and owner step 1 "Pay for the Apple developer account" | the account is set up ("Apple account — Complete", `ops/workflows/apple-developer-account-setup-2026-10-16.md`), the app exists in `tools/teleprompter-ios/` (the spec says so at line 17), and Build 1 reached TestFlight. Rewrite the status to "in progress; see `ops/workflows/two-ios-apps-launch-2026-10-16.md`" and drop owner step 1. `teleprompter-speed` cites this spec, so it stays.

### Skills
- S26 | `.agents/skills/fundhub-ad-writer/SKILL.md` lines 59-69 | TEMPORARY "5. **The rule loader is swappable — the generator is not.**", then "Tonight, the loader is", "Later, as a real Fundhub product feature, the loader could instead be" and "makes tonight's one-off tool and a future paid feature the same build." | remove prime rule 5 and archive. It is a design note from the 2026-09-07 night build. The loader now exists in code (`src/marketing/writer-prompt.mjs`, `src/marketing/rules-store.mjs`). It also fights the Fast path, which tells the agent to read the two files.
- S27 | `.agents/skills/fundhub-ad-writer/SKILL.md` lines 5-6 (front matter description) | STALE "(once confirmed) evergreen backend-selling ads" | change to "evergreen backend-selling ads". The skill says "Confirmed, owner-set 2026-09-07" at line 94. Only this phrase changes; the front matter stays.
- S28 | `.agents/skills/fundhub-system-map/SKILL.md` line 23 | TEMPORARY "## Instant FAIL (tonight’s lies)" | rename to "## Instant FAIL". The list under it stays.
- S29 | `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` lines 62-63 | WRONG "**Fundhub**, never Fundhub." (the sentence breaks across the two lines) | change to "Write **Fundhub** (see `fundhub-company-name`)." Do not bring back the bad spelling on its own line: the original at commit `4cc723650` read "**Fundhub**, never FundHub", a company-name sweep turned it into nonsense, and the retired-word check reads one line at a time, so a bare "FundHub." on line 63 would fail `npm run rules:check`. Dedupe-plan D55 replaces lines 59-63 with a pointer that also removes the sentence; if D55 is applied, skip S29.

### marketing/ads
- S30 | `marketing/ads/README.md` lines 19, 21-22, 33-37, 46 | STALE "The ads running right now", the `20-ads.md` and `SHOOT-PLAN.md` rows and workflow boxes, "Marked `NEXT MONTH` until it's finished." | remove the two file rows and the two boxes (the files were never committed; see D17). Change "running right now" to "locked controls" (see S31). Drop "Marked `NEXT MONTH`" (see S32).
- S31 | `marketing/ads/CONTROLS.md` lines 1, 3, 13-14; `marketing/ads/slo/fundhub-297/INDEX.md` line 38; `marketing/ads/WRITE-ADS-FROM-HERE.md` line 23; `.agents/skills/fundhub-ad-writer/SKILL.md` lines 28, 80 | STALE "# LIVE — DO NOT EDIT … These are the ads running right now." / "**Filmed and running:**" / "Five ads **live** today" / "five live ads" | `marketing/ads/INVENTORY-2026-10-02.md` section 4 reads Meta: three of the four ran Aug 4-20 and are paused, and Ad 1 never ran. Change the words to "locked controls (filmed August 2026)". The lock itself ("never rewrite") stays.
- S32 | `marketing/ads/ANGLE-GENERATOR.md` line 227; `marketing/ads/ASSET-BANK.md` lines 34, 65 | TEMPORARY "Not until next month, and never as the lead." / "**NOT LED WITH — next month, 2 concepts max**" / "*not yet, next month*" (written 2026-09-01) | remove "next month" and "not yet". Keep "never as the lead" and "2 concepts max" (they match `marketing/ads/README.md:45-46`).
- S33 | `marketing/ads/NAMING.md` line 63 | STALE "The eleven ads, numbered in film order:" | this table is the 2026-10-10 list of Direct Book ads. `marketing/ads/filmed-names-2026-10-22.md` names Direct Book Ads 12, 13, 14 and 16 and three Capital Blueprint ads. Change the caption to "The first eleven Direct Book ads, numbered in film order (the 2026-10-10 list):". Dedupe-plan D226 adds the pointer to the live list, so add none here. Prose only: the tests count the table rows (see the test table).
- S34 | `marketing/ads/scripts/README.md` line 1 | STALE "Ad scripts (83) and VSLs from 2026-09-02 live in the Claude chat outputs as fundhub-scripts.md and fundhub-vsl.md until Chris drops them here." | replace with: dated batches are `YYYY-MM-DD.md`; the compiled history is `ALL-SCRIPTS-since-2026-09-02.md` and `ALL-ADS-since-2026-09-03.md` (2026-10-03).
- S35 | `marketing/ads/reference/locked-ads-2026-09.md` line 9 | TEMPORARY "Ads 4 and 5 were rewritten today around their own reasons" | change "today" to "2026-09-22".
- S36 | `marketing/ads/notes-green-screen.md` lines 6-9 | SUPERSEDED "Owner-set 2026-10-02: this doc's copy rules win over the ad checker … those checker rules are outdated." | both overrides are now settled by newer rules (#44.4: "optimize" is allowed; #44.5: the close promise is no longer required). Replace with "These scripts follow `marketing/ads/RULES.md` Part 0."
- S37 | `marketing/ads/RULES.md` lines 402-406, 535, 695 | TEMPORARY "Three examples sat here until 2026-10-05 …" (a change note); "booking calls at $32–36 today"; "would have rejected 3 of the 5 ads running today" | archive the change note. For the two "today" claims, replace "today" with the date or drop it.
- S38 | `marketing/ads/RECIPES.md` lines 29-32 | STALE "That ad needs 3 new templates (check RatesRising first):" and its three bullets "spend → data → better ads", "$10K, $20K and $50K a month, climbing to $100K" and "rates going up while banks lend less" | `RatesRising` and `MoneyClimb` are in `marketing/broll/catalog.json`. Check the three, then remove what is built. Only the first (spend → data → better ads) has no template I found.
- S39 | `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` lines 99-108 (section 4) | STALE "## 4. Proposed CAPI module (future PR)" with `src/adapters/meta-conversions.mjs` | the sender is built: `src/messaging/providers/meta-capi.mjs` (live 2026-10-02, `docs/tracking/meta-events.md`). Mark section 4 "built" and use the real paths (D22). The "ShowedCall" part is still a plan (`TODO.md:287`); keep it.

### marketing/landing-pages
- S40 | `marketing/landing-pages/slo/README.md` lines 17-20 and 22-50 | TEMPORARY "SWAP BEFORE LAUNCH …" and "SIM MODE — LAYOUT PREVIEW (added 2026-08-31, temporary) … REMOVE BEFORE LAUNCH." | the launch is over. Archive both blocks. Sim mode is already off in the pages: `slo-02-booking.html` has five `FH_SIM` lines and sets `FH_SIM` to `false`; `slo-01-sales.html` still carries one `SIM MODE` comment and one `.sim-flag` rule (lines 203-204); `slo-02-order.html` and `slo-03-thank-you.html` have none. The README lists `slo-03-thank-you.html` but not `slo-02-booking.html`; rewrite the PAGES list from `ls`. Line 64 (the build command) is a path fix, not a removal: see D51.
- S41 | `marketing/landing-pages/CURSOR-PROMPT.md` lines 1, 3-9 and 18-86 | TEMPORARY "# FUNDHUB CLICKFUNNELS FRAGMENT REPAIR — CURSOR TASK", the Context ("pasted into ClickFunnels **Custom JavaScript/HTML elements**"), then "Files in this folder:" through "APPENDIX A — resolved" (the file list, Bugs 1-5, Deliverables, Working method) | archive lines 3-9 and 18-86, and change line 1 to "# Fundhub funnel design tokens". The task is done: its output `fixes.md` (archived in A9) and `harness/` exist. Keep lines 10-16 (the design tokens, "canonical, do not change"). `public/partner/funnel.css:2,14` cites this file as "the canonical funnel set", so the file stays.
- S42 | `marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` lines 8, 10, 91 | TEMPORARY "**Still on you in ClickFunnels:** Contact Attributes (Parts A–B) + webhook." / "When finished, reply in chat: **`attributes set`**" / "Walk Chris click-by-click through …" | a one-time ask that fights `chris-never-clickfunnels` (2026-09-21). Give it the same banner the lead decided for `CHRIS-DO-THIS-FIRST.md` in #46 ("Old. Agents do this through the API"). Keep the file: code comments cite it (R4).

### docs/sops/clickfunnels-custom-html-push.md and the push skill
Dedupe-plan "Conflicts found while deduping" #2 left this to the stale pass. The evidence below settles it: `/apply` is a custom-HTML page now.
- S43 | `docs/sops/clickfunnels-custom-html-push.md` line 38 (the `/apply` row of the table at lines 33-40) | STALE "Inject tracking — keep native survey" | the same file says at line 51 that `/apply` is "custom HTML (apply survey)", page 25515671, after the split of 2026-10-01. `docs/tracking/page-inventory.md:28` says the same. `ops/workflows/apply-funnel-fixes-2026-10-01.md:56` records the push to page 25515671. The manifest key `apply-survey` uses `strategy: "apply_survey_replace"` ("Custom survey replaces native Survey/V1 on the /apply step"), added in commit `21a7ca98f` on 2026-09-30. | change the push-mode cell to "Custom HTML (apply survey), pushed by manifest key `apply-survey`". Keep the other three rows and the "Headline (2026-09-20)" column (a dated snapshot).
- S44 | `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` line 45 | STALE the `/apply` row of the step table: "Multi-block builder — inject tracking; do not wipe survey with custom HTML unless Chris names that migration." | the migration is done (same evidence as S43). | change that cell to "Custom HTML page 25515671 holding `marketing/landing-pages/apply-survey.html`. Push it with manifest key `apply-survey`; the native survey is already replaced." Keep the other rows. Dedupe-plan D24 deletes the row above it (line 44), so find this row by its text.

---

## Fix dead references

Format: ID | line | names X | change to Y. "Right path" means it exists today. "Never existed" means `git log --all` shows no history. "Deleted" means it was removed in commit `b5076e58e` (2026-10-02) and is only in git history.

### Mechanical remap (apply by script, then re-run the scanner)
The 2026-10-02 repo move renamed folders. These swaps are safe when the new path exists:

| Old prefix | New prefix | Hits that resolve (in the files I scanned) |
|---|---|---|
| `docs/workflows/` | `ops/workflows/` | 105 (24 more have no new home; each is in D21 to D44 below or in the boards that get archived) |
| `docs/ads/` | `marketing/ads/`, except `ascension-ads.md` → `marketing/ads/ascension/`, `fundhub-297/` → `marketing/ads/slo/fundhub-297/`, `portal-welcome-video.md` → `marketing/vsl/`, `slo-297-prompt-2026-09-18.md` → `marketing/ads/slo/` | 54 (2 have no new home: a `DATE.md` placeholder and a board that gets archived) |
| `docs/clickfunnels/` | `marketing/landing-pages/clickfunnels/` | 11 |
| `docs/flywheel/` | `marketing/flywheel/` | 7 |
| `docs/compliance/` | `docs/rules/compliance/` | 3 |
| `docs/company-resources/` | `docs/sops/company-resources/` | 6 |
| `docs/copy/` | `marketing/copy/` | 1 |
| `docs/CLOSEOUT-FEE-BASIS.md` | `docs/finance/CLOSEOUT-FEE-BASIS.md` | 1 |
| `clickfunnels-fragments/` | `marketing/landing-pages/` | 24 (one more, `slo/peeks/`, never existed; see D45 to D54) |

The full old-to-new table is in `ops/workflows/repo-restructure-2026-10-01/W4-manifest.md`.

### .ai/rules
- D1 | `no-remote-control.md` line 12 | names `tools/mac-bridge/` | remove the path. It exists only on branch `feat/mac-bridge-v1`, never on main. The bridge lives in its own repository outside this one; say so in words.
- D2 | `no-remote-control.md` line 12 | names `ops/workflows/mac-bridge-2026-10-20.md` | remove. Never on main.
- D3 | `repo-hygiene-vc-router.md` line 22 | names `repo-purge-candidates-2026-08-21.md` | remove the "e.g." clause. Never existed in git.
- D4 | `live-playwright-100-before-manual.md` line 23 | "Required ids live on `ops/workflows/live-playwright-100.md`" | the board exists, but its first line says "Live Playwright requirements — teleprompter repair" and it says "This is not a score for other Fundhub journeys". Change to "Required ids live on the batch's own board (for example `ops/workflows/live-playwright-100.md` for the teleprompter repair)". Dedupe-plan merge M3 archives this rule and moves the sentence into the "Live Playwright gate" section of `.ai/rules/test-means-human-click.md` (its D191). Make this edit there, once.

### .agents/skills
- D5 | `fundhub-repo-hygiene/SKILL.md` line 55 | names `repo-purge-candidates-2026-08-21.md` | remove the clause (same as D3).
- D6 | `fundhub-ui-auditor/SKILL.md` line 41 | names `ui-standards.mdc` | `docs/rules/UI-STANDARDS.md` (the rule is archived). Dedupe-plan D58 makes the same edit; do it once.
- D7 | `fundhub-ui-auditor/SKILL.md` line 8 | names bare `fundhub-brand.css` | `public/app/fundhub-brand.css`. The copy in `docs/rules/` is labelled ARCHIVED (59 lines against 274).
- D8 | `fundhub-builder/SKILL.md` line 10 | names bare `fundhub-brand.css` | `public/app/fundhub-brand.css`.

### README.md
- D9 | line 3 | names `fundhub-docs` → `/raw/master-rebuild-spec.md` | remove the "canonical copy" clause. `fundhub-docs/raw/` never existed in git; `fundhub-docs/` holds only `sources/` (3 files). The Vercel word in line 3 is decided in #27.

### docs
- D10 | `docs/sops/README.md` lines 7, 14, 15, 16, 17 | names `manual-email-resend.md`, `manual-call-bland.md`, `manual-dispute-letters.md`, `daily-handoff-checklist.md` | remove the four rows and the link in line 7. None of the four ever existed in git. Only `manual-sms-twilio.md` exists (see M11).
- D11 | `docs/sops/clickfunnels-custom-html-push.md` line 88 | names `docs/workflows/archive/ads-revenue-model-2026-08-24.md` | `ops/workflows/archive/ads-revenue-model-2026-08-24.md`.

### marketing/ads
- D12 | `ASSET-BANK.md` line 329 | names `docs/copy/Copywriting-Reference.md` | `marketing/copy/Copywriting-Reference.md`.
- D13 | `ASSET-BANK.md` line 330 | names `docs/workflows/fundhub-closer-pack-from-alec-2026-08-24.md` (objections §5) | `docs/sops/company-resources/closer-playbook-2026-08-24.md` (section 9, "Objections — Alec’s list, Fundhub words"). The old file was deleted in `b5076e58e`.
- D14 | `RULES.md` line 108 | names `docs/company-resources/closer-playbook-2026-08-24.md` | `docs/sops/company-resources/closer-playbook-2026-08-24.md`.
- D15 | `RULES.md` line 109 | names `docs/company-resources/sales-manager-objections-and-funding-2026-09-01.md` | `docs/sops/company-resources/sales-manager-objections-and-funding-2026-09-01.md`.
- D16 | `README.md` line 1 | title "docs/ads" | `marketing/ads`.
- D17 | `README.md` lines 21, 22, 33, 35 | names `20-ads.md` and `SHOOT-PLAN.md` | remove. Never existed in git (`ops/2026-09-06-self-analysis.md` line 39 already says so).
- D18 | `apply-survey-meta-tracking-2026-09-30.md` line 5 | `docs/clickfunnels/apply-survey-extract-2026-09-30.md` | `marketing/landing-pages/clickfunnels/apply-survey-extract-2026-09-30.md`.
- D19 | same file, line 7 | `docs/workflows/archive/ads-revenue-model-2026-08-24.md` | `ops/workflows/archive/ads-revenue-model-2026-08-24.md`.
- D20 | same file, line 26 | `docs/workflows/marketing-data-pipeline-2026-09-22.md` | `ops/workflows/marketing-data-pipeline-2026-09-22.md`.
- D21 | same file, line 28 | `docs/workflows/archive/comms-logic-2026-08-23-slice-capture.md` | remove. Deleted.
- D22 | same file, lines 103, 106, 107 | `src/adapters/meta-conversions.mjs`, `src/handlers/meta-conversions.mjs`, `src/adapters/meta-conversions.test.mjs` | never created. Built as `src/messaging/providers/meta-capi.mjs` (sender) and `src/handlers/meta-purchase.mjs` with `src/handlers/meta-purchase.test.mjs` (handler and test). Contract: `docs/tracking/meta-events.md`.
- D23 | `video-pipeline-plan.md` line 221 | `docs/workflows/video-pipeline-manual-5.md` | remove the clause. Never existed in git. The file is under the #32 banner change.

### marketing/ads/slo/trigger-maps (7 files)
- D24 | all seven files | name `docs/workflows/submagic-settings-lock-2026-09-23.md` | `ops/workflows/submagic-settings-lock-2026-09-23.md`. Lines: `84-…` 7, 22-28, 40; `85-…`, `86-…`, `87-…`, `88-…` 7, 22-26, 38; `89-…`, `90-…` 7, 22-27, 39. One find-and-replace fixes all 53 hits. The folder stays: the number prefix is the registry id and `db/migrations/407_ad_number_from_meta.sql:76` cites it.

### marketing/avatars/partner
- D25 | `Core_Avatar_Profile.md` line 95 | `docs/compliance/creative-block-reasons.md` | `docs/rules/compliance/creative-block-reasons.md`.
- D26 | `First_Party_Data_Map.md` lines 22, 37 | `docs/clickfunnels/cf-survey-ground-truth.md`, `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` | `marketing/landing-pages/clickfunnels/…` (same file names).
- D27 | `Service_Business_Foundation.md` lines 6, 38, 173, 187 | `docs/ads/ascension-ads.md` | `marketing/ads/ascension/ascension-ads.md`.

### marketing/flywheel and the flywheel board
- D28 | `marketing/flywheel/README.md` line 54 | `docs/flywheel/partner/` | `marketing/flywheel/partner/`.
- D29 | `ops/workflows/flywheel-partner.md` line 5 (the board `.claude/commands/flywheel.md:30` points at) | `docs/flywheel/README.md` | `marketing/flywheel/README.md`.

### marketing/landing-pages
- D30 | `clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` lines 4, 87, 88 | `docs/clickfunnels/cf-survey-ground-truth.md`, `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` | `marketing/landing-pages/clickfunnels/…`.
- D31 | `clickfunnels/cf-survey-ground-truth.md` line 6 | `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` | `marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md`.
- D32 | `clickfunnels/apply-survey-extract-2026-09-30.md` lines 5, 119 | `docs/clickfunnels/cf-survey-ground-truth.md` | `marketing/landing-pages/clickfunnels/cf-survey-ground-truth.md`.
- D33 | same file, line 195 | `docs/workflows/fix-batch-2026-09-03-remaining.md` | `ops/workflows/fix-batch-2026-09-03-remaining.md`.
- D34 | same file, lines 195, 255 | `docs/workflows/archive/cf-funnel-seam.md`, `docs/workflows/archive/comms-logic-2026-08-23-slice-capture.md` | remove. Both deleted.
- D35 | same file, line 293 | `docs/workflows/funnel-cutover-2026-09-21.md` | `ops/workflows/funnel-cutover-2026-09-21.md`.
- D36 | `clickfunnels/apply-survey-rebuild-2026-09-30.md` lines 3, 45 | `docs/clickfunnels/apply-survey-extract-2026-09-30.md`, `docs/ads/apply-survey-meta-tracking-2026-09-30.md` | `marketing/landing-pages/clickfunnels/apply-survey-extract-2026-09-30.md`, `marketing/ads/apply-survey-meta-tracking-2026-09-30.md`.
- D37 | `climate-front-door-2026-09-18/SPEC.md` line 258 | `docs/ads/RULES.md` | `marketing/ads/RULES.md`.
- D38 | `slo/README.md` line 67 | `docs/workflows/slo-sim-evidence/` | remove. Never existed in git (an evidence folder).

### ops
- D39 | `ops/2026-09-18-outside-financing-not-approved.md` line 29 | `docs/CLOSEOUT-FEE-BASIS.md` | `docs/finance/CLOSEOUT-FEE-BASIS.md`. The note itself is a standing owner call and stays.

### Boards that instructions point at (they hold dead paths too)
- D40 | `ops/workflows/system-map-2026-08-26.md` lines 133, 196, 319 | `docs/workflows/agent-tester-2026-08-26.md`, `docs/workflows/repair-build-spec-2026-08-21.md` | remove. The first was deleted in `b5076e58e`, the second archived on 2026-08-27 and later gone. The `fundhub-system-map` skill says "Read this end to end", so a reader hits these.
- D41 | `ops/workflows/testimonial-thumbnails-2026-09-27.md` line 178 | `docs/workflows/testimonial-thumbnails-2026-09-27-evidence` | remove. An evidence folder, not in the repo.
- D42 | `ops/workflows/live-prove-2026-09-17-notes.md` | 38 dead paths, 32 with the old `docs/workflows/` prefix (the board `named-fix-regression-gate` names) | run the mechanical remap; the rest are evidence folders that were never committed.
- D43 | `ops/workflows/slo-ads-content-map-2026-09-23.md` lines 5, 12, 25 | `docs/ads/fundhub-297/FundHub-LOCKED-ADS.md`, `docs/ads/portal-welcome-video.md` | `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`, `marketing/vsl/portal-welcome-video.md`.
- D44 | `ops/workflows/submagic-settings-lock-2026-09-23.md` lines 119, 850, 1084 | `docs/ads/fundhub-297/FundHub-LOCKED-ADS.md`, `docs/workflows/slo-broll-2026-09-23-evidence/clips` | the first remaps; the clips folder was never committed.

### The retired folder name `clickfunnels-fragments/` (found on the second scan)
The folder `clickfunnels-fragments/` became `marketing/landing-pages/` on 2026-10-02. `marketing/landing-pages/package.json` still carries the old name `fundhub-clickfunnels-fragments`. Each file below exists at the new path unless I say so.
- D45 | `docs/sops/clickfunnels-custom-html-push.md` lines 42, 85, 95, 105 | names `clickfunnels-fragments/slo/slo-01-sales.html`, `clickfunnels-fragments/06-utm-hidden-fields.html`, `clickfunnels-fragments/04c-book-framed.html`, `clickfunnels-fragments/04d-book-fit.html` | `marketing/landing-pages/slo/slo-01-sales.html`, `marketing/landing-pages/06-utm-hidden-fields.html`, `marketing/landing-pages/04c-book-framed.html`, `marketing/landing-pages/04d-book-fit.html`. Dedupe-plan D221 keeps line 85, so this still applies.
- D46 | `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` lines 7, 25, 40, 152, 164 | names `clickfunnels-fragments/tracking-manifest.mjs`, `…/05-thank-you.html`, `…/02b-apply-bottom.html`, `…/apply-survey.html`, and (line 164, in words) "inside `clickfunnels-fragments`" | the same names under `marketing/landing-pages/`; line 164 reads "inside `marketing/landing-pages`".
- D47 | `marketing/landing-pages/clickfunnels/CHRIS-DO-THIS-FIRST.md` line 88 | names `clickfunnels-fragments/06-utm-hidden-fields.html` | `marketing/landing-pages/06-utm-hidden-fields.html`. The file gets the "Old. Agents do this through the API" banner in #46; fix the path as well.
- D48 | `marketing/landing-pages/clickfunnels/apply-survey-extract-2026-09-30.md` lines 22, 23, 26 | names `clickfunnels-fragments/02a-apply-top.html`, `…/02b-apply-bottom.html`, `…/harness/apply.html` | `marketing/landing-pages/02a-apply-top.html`, `marketing/landing-pages/02b-apply-bottom.html`, `marketing/landing-pages/harness/apply.html`.
- D49 | `marketing/landing-pages/clickfunnels/apply-survey-rebuild-2026-09-30.md` lines 3, 33 | names `clickfunnels-fragments/apply-survey.html` | `marketing/landing-pages/apply-survey.html`.
- D50 | `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` lines 17, 19, 89, 96, 203, 205 | names `clickfunnels-fragments/slo/slo-02-order.html`, `…/slo/slo-01-sales.html`, `…/slo/README.md`, `…/06-utm-hidden-fields.html` | `marketing/landing-pages/slo/slo-02-order.html`, `marketing/landing-pages/slo/slo-01-sales.html`, `marketing/landing-pages/slo/README.md`, `marketing/landing-pages/06-utm-hidden-fields.html`. If M9 is a yes, the file moves with A13 and none of this is needed.
- D51 | `marketing/landing-pages/slo/README.md` line 64 | names `node clickfunnels-fragments/slo/preview/build.mjs` | `node marketing/landing-pages/slo/preview/build.mjs` (the file exists). Keep the command; fix the path. This is the fix for the part of S40 that is not a removal.
- D52 | `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` lines 15, 143, 144 | names `clickfunnels-fragments/slo/slo-01-sales.html` and `clickfunnels-fragments/slo/peeks/` | nothing to do if A13 moves the file. If A13 is refused: `marketing/landing-pages/slo/slo-01-sales.html`, and drop the `slo/peeks/` clause (that folder never existed in git).
- D53 | `docs/prompts/testimonial-thumbnails.md` lines 6, 146 (the "Prompt of record" named at `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md:9`) | names `docs/workflows/testimonial-thumbnails-2026-09-27.md` and `clickfunnels-fragments/slo/slo-01-sales.html` | `ops/workflows/testimonial-thumbnails-2026-09-27.md` and `marketing/landing-pages/slo/slo-01-sales.html`. Leave the rest of the file alone: it keeps Chris's original prompt word for word, "Right now" at line 21 included.
- D54 | the boards that live instructions point at: `ops/workflows/testimonial-thumbnails-2026-09-27.md` (3 hits), `ops/workflows/funnel-cutover-2026-09-21.md` (4), `ops/workflows/submagic-settings-lock-2026-09-23.md` (1) | name `clickfunnels-fragments/…` | apply the same swap to `marketing/landing-pages/…`. The other 20 boards that name the old folder are history (R7): `apply-funnel-fixes-2026-10-01.md`, `cf-calendar-switch-plan-2026-09-22.md` and `wiring-audit-2026-10-02.md` are cited only by `marketing/MACHINE-GAPS.md` or by code comments.

### Checked and cleared (not dead; do not re-check)
- `.agents/skills/fundhub-video-animation-overlay/SKILL.md` names `tools/ocr.swift`, `tools/matte.swift`, `tools/align-anchors.py` and others. They resolve inside the example folders (`marketing/ads/animation-plans/thank-you-test-2026-10-23/tools/`; `person-union-maps.py`, `fit-search.py` and `band-compare.py` in `direct-book-ad-16-test-2026-10-23/tools/`). Optional: name the folder at line 20.
- `CLAUDE.md:166` names `.claude/settings.local.json`. It is gitignored and lives on the Mac.
- `.cursor/hooks.json` runs `but cursor after-edit` and `but cursor stop`. `but` is not installed on this Mac. Phase 7 already reports this (`phase-7-hooks.md:37`), so I do not list it again.
- `.ai/rules/agentic-audit-guardrails.md:53` and `.ai/rules/chris-never-clickfunnels.md:35` show `ops/workflows/…` and `marketing/landing-pages/slo/…`. These are ellipsis placeholders.
- `marketing/ads/slo/SLO-CHAT-PROMPT.md` and `marketing/ads/slo/fundhub-297/*`: the scanner found no dead path.
- `ops/workflows/ad-scripts-2026-10-02.md` has 13 dead paths (10 old-prefix) and `ops/workflows/full-launch-lattice-2026-09-20.md` has 23. Phase 3 and A1 archive them; no edit needed.

---

## Maybe (Chris decides later)

Each line says what is unclear and what I would do after a yes.

- M1 | `ops/2026-09-06-self-analysis.md` (1,151 lines, 2026-09-06) | It holds an owner rule found nowhere else: "no Google Workspace, personal Gmail only, per-user OAuth, never domain-wide delegation" (lines 196 and 1132-1133), and "Filming stays fully manual, by his own choice" (2026-09-07). The code now uses domain-wide delegation (`src/company-brain/auth.mjs:14`, `src/hiring/calendar-freebusy.mjs:3`), so the rule may have changed. Decide the rule first. Then archive the file and remove `CLAUDE.md:461` (S1).
- M2 | `ops/STILL-MISSING.md` (2026-08-06) | Stale on its face: it lists `GHL_API_KEY` as present, says `INNGEST_EVENT_KEY` is an owner gate "Do not flip until other credentials are verified" (against the 2026-08-20 law), and says Commas has "Website Expired". But `api/social/oauth.mjs:99,115` and `api/campaigns/sync.mjs:1117` tell users "see ops/STILL-MISSING.md". Archiving would orphan those messages. Choice: add a "history, do not follow" banner, or change the three messages (code).
- M3 | `ops/2026-10-03-skills-rating.md` | A rating of Chris, not an instruction. Its "Next step: Run the book-a-call funnel for 14 days with no offer changes" ran out about 2026-10-17. `personal/weakness-scorecard.md:7` cites it. I would move it into `personal/`, or archive it.
- M4 | `marketing/ads/NEXT.md` (2026-09-01) | "1. Refine the 20 (in progress)" and "Remind him once the 20 are refined." Nothing live points at it. The repo does not answer two things: did the 10 open-Sorting-Hat ads (owner-set 2026-09-01) get made (the 2026-10-02 batch has three), and the three open questions (repair on payments, where the click lands, which ad wins). I would archive it once he says the sorting-hat ask is done.
- M5 | `marketing/ads/INVENTORY-2026-10-02.md` | A one-day snapshot of Meta and Drive. Replaced in part by `filmed-names-2026-10-22.md` and the compiled scripts. `db/migrations/407_ad_number_from_meta.sql:76` and `marketing/MACHINE-GAPS.md` cite it. I would keep it and add "snapshot of 2026-10-02" at the top. The same goes for `marketing/ads/scripts/ADS-NOT-RUNNING-since-2026-09-02.md` ("Ads that are not running on Meta right now", pulled 2026-10-03) and the "Running on Meta now" headings in the two `ALL-*` files: they are Meta statuses as of 2026-10-02.
- M6 | `marketing/ads/backend-selling-system.md` (2026-10-11) | No instruction points at it (one board does). It is the Haynes "Harvester + Hammer Them" map for Fundhub, and the ad-writer skill allows evergreen backend-selling ads. I would link it from the skill and `README.md`, not archive it.
- M7 | `marketing/ads/creator-program-copy.md` (2026-09-13) | No inbound pointer at all, and nothing shows the creator program ran. Chris decides whether the program is alive.
- M8 | `marketing/ads/apify-scrape-pipeline.md` | "DECISION 2026-08-31: deferred — start with the free stack below … (for now)". Only `README.md:61` points at it. Chris decides whether Apify stays parked.
- M9 | `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` (2026-10-01) | Same family as A13: a paste brief for Claude. Lines 127-128 and 184 still say "Funding Snapshot" and never "optimize" as a verb, both changed by newer laws. #31 already edits its title. I would archive it with A13 now that the checkout is built (`slo-02-order.html`). It needs one yes, because #31 planned to keep it.
- M10 | `marketing/landing-pages/slo/COPY-CHANGELOG-Aug27.md` | "Paste into FundHub-Copy-Source-of-Truth.md's change log whenever." A to-do note about a Drive doc from the CRO pass of 2026-08-27. `slo/README.md:2` cites it. The page was cut down on 2026-10-01. I would archive it and drop the cite.
- M11 | `docs/sops/README.md` and `docs/sops/manual-sms-twilio.md` | Their premise is "until SMS / email / AI calling are automated". Sending is live. Decision #27 keeps both with a banner. Four of the five linked SOPs never existed (D10). If Chris wants the manual SMS steps kept, keep; otherwise archive both and point `docs/sops/RUNBOOK.md` at the heartbeat.
- M12 | `ops/workflows/broken-walkthrough-plan-2026-10-14.md` | A plan for one day, nothing points at it. But line 9 holds three owner calls found nowhere else: "the join link is Justice and Sarah's calendar setup; Twilio is Chris's credit; the five welcome templates stay pending (owner 2026-10-13)". Its decision log (lines 21-24) is empty. Add those three calls to `owner-calls-settled` first, then archive.
- M13 | `ops/workflows/grok-handoff-ad-video-text-2026-09-24.md` | A one-goal Grok handoff ("get video 1 texted to Chris"). The repo-sync board of 2026-10-05 marks it "not done": the `sms: sent` proof line was never seen. It also says "there is no GitHub in use" and "never push", which are false now. `marketing/MACHINE-GAPS.md:75,81` and `src/ad-videos/notify-fanout.test.mjs:91` cite it. Chris decides if the goal is still open. If not, archive.
- M14 | `ops/workflows/finish-853-2026-10-14/` (`BRIEF.md`, `RESUME.md`, 26 batches) | Tied to the archived Monday rule ("every one of the 853 rows"). Unfinished work: `RESUME.md` says 17 of 26 builders had manifests and nothing is pushed. Chris decides whether the 853 run is dead.
- M15 | `ops/workflows/heartbeat-ranked-2026-10-14.md` and `ops/workflows/company-refactor-plan-2026-10-12.md` | The Monday rule names both. The first is a snapshot (2,622 items, 114 broken, 2026-10-14). The second is the plan for the refactor that starts 2026-10-27. Keep the plan. Add "snapshot of 2026-10-14" to the ranked list, or archive it.
- M16 | `ops/workflows/manual-walkthrough-SOP.md` (2026-09-03, 332 lines) | "Who: Chris types, Claude watches" fights "Agents run the work" and `test-means-human-click`. Not replaced one for one: it lists every product path. Chris decides.
- M17 | `ops/workflows/submagic-settings-lock-2026-09-23.md` (1,282 lines) | All four tasks say "done". Its locked settings partly fight the 2026-10-23 and 2026-10-24 laws (Submagic: captions and clean audio only). Seven trigger maps and `marketing/MACHINE-GAPS.md` cite it. I would add a "settings superseded by `fundhub-ad-editor`" banner, not archive.
- M18 | `docs/specs/teleprompter-camera-orientation-correction-2026-10-12.md` | A one-time correction spec ("Seen failure", "Likely fault to test"). Nothing points at it. Its "Required behavior" (upright preview and file in both phone positions) is not in `teleprompter-camera`. I would move that behavior into the rule, then archive the spec.
- M19 | `owner-authorized-account-ops` (rule line 8), `CLAUDE.md:131`, `AGENTS.md:19` | "including Apple Developer and App Store Connect for the Fundhub launch / this launch" and "An earlier denial of App Store Connect access for this task is superseded." Is the Apple grant for every app update, or only the first launch? Only Chris can say. If it stands, drop "for this launch" and the supersession sentence.
- M20 | `no-api-spend-for-now` | Chris's words are "for now" and "when I have money". No end date. Keep it. Ask only when the Anthropic credit comes back.
- M21 | `redundancy-before-ui-polish` (2026-08-20) | Lines 30-34 say the closer-context proof "is currently wired in code. A live/database proof is still required … before launch". The launch is over and I found no proof record. The review boards it names (`*redundancy*`, `simplify-review*`) are not in `ops/workflows/`. Keep the Protected core flow section. Chris decides whether the redundancy-first order is finished.
- M22 | `marketing/landing-pages/climate-front-door-2026-09-18/SPEC.md` | A build spec for `/climate/`. The skills rating of 2026-10-03 says "Climate specced and never built". Chris decides if Climate is dead.
- M23 | `marketing/vsl/portal-welcome-video.md` lines 44, 51-52, 53 | "It is now on the portal page too", "The 5% tier now actually pays. Until 2026-09-20 it did not", "Payouts are built now too (2026-09-21)" are change notes. Plaid payouts stay in test mode (`owner-calls-settled`). I would turn "now" into dated facts.
- M24 | `docs/sops/clickfunnels-funnel-push-stops.md` lines 6-9 | "Status: documented, not tried" (2026-10-09). I found no record of the first live push. The Blueprint funnel launched (`ops/workflows/blueprint-launch-2026-10-15.md`). Check, then update the status.
- M25 | `docs/rules/fundhub-brand.css` | Labelled "ARCHIVED copy of old brand tokens (verified Jul 26 2026)". `public/app/crm-sidebar.css:7` cites it. It is a CSS file, not an instruction. I would leave it and fix the two skill pointers (D7, D8).
- M26 | `CLAUDE.md` lines 751-758 (suite counts) | Already labelled "dated history". They still carry 3730, 442, 24, 29, 45, 6867 and "346 migration files" (there are 347). They could be cut to three sentences: skipped database tests are not green; re-measure; record where you ran it. The lead chose to label them on 2026-10-24.
- M27 | `marketing/ads/POST-BOOKING-15.md` line 3, `marketing/ads/ascension/ascension-ads.md` line 9, `marketing/avatars/partner/Core_Avatar_Profile.md` line 3 | Three more files open with the dead "COMPLIANCE REVIEW REQUIRED" banner (`Core_Avatar_Profile.md` also says "Per CLAUDE.md §7", which says the opposite). #31 lists other files and left "about 56 older docs" alone on purpose. Say if these three marketing books should be cleaned too.
- M28 | `.ai/rules/teleprompter-camera.md` lines 14 and 44, `AGENTS.md:61`, `docs/rules/TELEPROMPTER-VIDEO.md:5`, `CLAUDE.md:156` | "every take is a hard 30 fps until the iPhone app" and "60 fps waits for the iPhone app". That is a condition, not a date, and it is close: Prompter Build 1 reached TestFlight on 2026-10-16 (`ops/workflows/apple-developer-account-setup-2026-10-16.md`). Keep the lock. Chris says when the app lifts it for the app only.

---

## Report only (code, generated, outside the list)

- R1 | `.claude/workflows/offer.js` lines 87 and 116 read `~/.claude/skills/offer/`. `copy.js` line 29 says its ban lists were copied from `~/.claude/skills/humanizer/SKILL.md`. Neither folder is on this Mac (`~/.claude/skills` holds `caveman`, `caveman-help` and `synced`). `docs/rules/RULES-INDEX.md:145` lists the `offer` and `copy` workflows as if they run.
- R2 | `scripts/rules-drift-allow.json` lines 5 and 6 list `grok-lattice-overseer-perpetual` and `ui-standards` as Cursor-only. Remove both entries when the rules move.
- R3 | `src/pulse/registry.mjs:5` and `src/pulse/machine.mjs:10` say "See .cursor/rules/pulse-registry.mdc". Point them at `heartbeat-on-every-build.mdc` (comments only).
- R4 | Code comments that cite AI-instruction files that stay (do not move these files): `public/partner/funnel.css:2,14` (`CURSOR-PROMPT.md`); `src/survey/cf-question-map.mjs:3`, `public/js/homepage-survey.js:3`, `public/app/pipeline.html:2196` (`OWNER-CF-SETUP-CHECKLIST.md`, `cf-survey-ground-truth.md`); `public/app/crm-sidebar.css:7` (`docs/rules/fundhub-brand.css`); `api/social/oauth.mjs:99,115` and `api/campaigns/sync.mjs:1117` (`ops/STILL-MISSING.md`); `db/migrations/407_ad_number_from_meta.sql:76` (`INVENTORY-2026-10-02.md`); `scripts/tmp/hole17-finish-*.mjs` (a path into the lattice evidence folder) and `src/pulse/coverage/slice-28-funding-advisor.mjs:8` (a comment on the lattice funding-advisor lane); `src/messaging/providers/clickfunnels-pages.mjs:247` (`docs/sops/clickfunnels-custom-html-push.md`, which stays).
- R5 | `docs/journeys/*` (generated; 87 pages scanned): 392 paths do not exist. 172 are in `CHANGELOG.md` (history, expected), 97 in `marketing-dashboard-flow.md`, 17 in `ad-script-flow.md`. 51 use the old `docs/workflows`, `docs/ads` or `docs/ops` prefixes. Regenerate; do not hand-edit.
- R6 | `docs/specs/*` (28 design docs): the command-center and marketing-machine specs name about 600 planned files, routes and endpoints that do not exist (`command-center-design-2026-10-05.md` 239, `marketing-machine-api.md` 191, `marketing-machine-2026-10-04.md` 73). These are not instruction text and I did not list them line by line. Old `docs/` prefixes sit in `CLOSER-DASHBOARD-SCREEN-MERGE-BUILD-SPEC.md` (8, the targets were deleted), `W7-curriculum.md` (11) and `marketing-machine-2026-10-04.md` (4).
- R7 | The other boards in `ops/workflows/`: 186 of 214 top-level boards are neither on the brief's named list nor pointed at by an instruction file. 2 are from August, 42 from September, 142 from October. Five whose own title is time-bound: `heartbeat-complete-2026-10-09-worklist.md` ("what to build tonight"), `pulse-layer-2026-10-09-v1.md` ("tonight's scope"), `tonight-heartbeat-pilot-2026-10-11.md`, `malloy-motion-tomorrow.md`, and `launch-2026-10-13.md` ("launch card — Tuesday"). The mechanical remap fixes about 100 old-prefix paths in the boards; about 24 point at files never committed or deleted. The `fundhub-repo-hygiene` skill (KEEP / ARCHIVE / MOVE) is the tool for the rest.
- R8 | `TODO.md:189` ("Consolidate the conflicting rules …") and `TODO.md:510` ("Update the repo rules that still say GitLab") are tasks this cleanup finishes. Tick them when it merges.
- R9 | `marketing/MACHINE-GAPS.md` (outside the brief's list): a snapshot "As of 2026-10-05, about 5:30pm". Line 63 says `INVENTORY-2026-10-02.md` and `scripts/2026-10-02.md` "are only on branch `ad-scripts-2026-10-02`"; both are on main now.
- R10 | `docs/sops/mortgage-reconveyance-playbook-2026-10-05.md` (1,351 lines) is a course checklist for one property. It is not Fundhub product work and not an AI instruction. It is not stale or dead; I left it alone.
- R11 | The `.agents/skills/higgsfield-*` (8) and `supabase*` skills are third-party and out of scope. `credentials/hormozi-kb-work/whisper.cpp/AGENTS.md` is a third-party `AGENTS.md` in a gitignored folder (Phase 6).
- R12 | Memory notes (outside the repo; the lead edits them after the PR): `coverage-batch-paused-until-tuesday` (A15's twin; the date passed) and `monday-100-percent` (the rule is archived) are stale by the same tests. `ad-rules-set-aside` is stale by decision #42.
- R13 | Boards on the brief's named list or pointed at by an instruction file that I read and kept: `cf-calendar-switch-plan-2026-09-22.md` (an analysis; tests and `marketing/MACHINE-GAPS.md` cite it); `full-end-to-end-audit-rule-2026-08-25.md` (an 11-line pointer page whose links to the rules resolve); `rules-drift-2026-10-24.md` (the last pass's record; history once this cleanup merges); `animation-builds-2026-10-22.md` (lines 9-39 are standing builder rules; the unit table and merge notes are batch history; the line 5 fix is #36); `testimonial-thumbnails-2026-09-27.md`, `crm-astra-rollout-2026-10-20.md`, `slo-ads-content-map-2026-09-23.md`, `slo-ads-drive-manifest-2026-09-23.md`, `live-prove-2026-09-17-notes.md`, `system-map-2026-08-26.md`, `broll-v2-2026-10-02.md` and `flywheel-partner.md` (live instructions point at them). Their dead paths are in D40 to D44.
- R14 | `marketing/landing-pages/tracking-manifest.mjs` line 486 (code) still gives the `apply-survey` row `pageId: "25068989"`. That page is dead; the live `/apply` page is `25515671` (`docs/tracking/page-inventory.md:28`). `ops/workflows/tracking-everything-2026-10-02.md:78` already notes it ("push still finds the right one by path"). Change the value in code, not here. S43 and S44 use the live id.
- R15 | Non-instruction files that also name `clickfunnels-fragments/`: `docs/finance/capital-blueprint-next-2026-09-29.md:82,239` (the same swap fixes them) and `docs/audits/wiring-audit-2026-10-02.md:162` (an audit that records the folder as missing on disk; history, leave it). `marketing/landing-pages/fixes.md`, `fixes-v2.md` and `roadmap-updates-2026-09-21.md` name it too and are archived in A9, A10 and A12.

---

## Order I would work in

1. Move the 15 files in the archive table, and the Phase 3 files, with their README notes.
2. Fix every pointer in the pointer table. Run `npm run rules:check`; its pointer and index checks name any miss.
3. Apply the mechanical remap, then the single fixes in the dead-reference list.
4. Remove the 44 lines, appending each to `removed-lines/`.
5. Leave the Maybe list for Chris. Add the three owner calls from M12 to `owner-calls-settled` before anyone archives that board.
