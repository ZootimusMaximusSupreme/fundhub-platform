# Rules drift fix, 2026-10-24

Owner order: "organize them, then fix it so we can get back on track."
Branch: `claude/rules-drift-fix` (local, not pushed). Worktree: `.claude/worktrees/rules-drift`.
Index of every rule: `docs/rules/RULES-INDEX.md`. Guard so it stays fixed: `rules-no-drift` (both homes).

Status: done. Waiting on Chris: the "Chris decides" list below.

## Counts

| Kind | Found (4 audits) | Fixed here | Not fixed (why) |
|---|---|---|---|
| CONFLICT | 43 | 26 | 17: 9 set-aside or outside allowed paths, 7 need Chris, 1 deferred |
| STALE | 35 | 20 | 15: set-aside books, files outside allowed paths, 2 need Chris |
| MIRROR | 48 | 24 new Claude twins, 2 drifted pairs synced, 1 skill link, 1 skill brought to main, 1 frontmatter | 3 left on purpose (Cursor-only), 2 real skill folders left alone |
| DUPLICATE | 15 | 5 | 10 left as is (see "Not done") |
| CLAUDE.md LINE | 37 | 37 new or fixed short owner-set lines (no renumbering) | 0 |
| Memory-only owner calls | 17 | 12 new rule files in both homes, 5 folded into existing rules | 3 on the Chris-decides list |

Audit summary counts from the four findings files (A copy/ads/video, B ops/env/git, C agent work, D map/mirrors):

| File | CONFLICT | STALE | MIRROR | DUPLICATE | CLAUDE.md LINE | UNSURE |
|---|---|---|---|---|---|---|
| A | 10 | 9 | 9 | 4 | 8 | 6 |
| B | 9 | 10 | 9 | 3 | 6 | 5 |
| C | 14 | 8 | 21 | 5 | 17 (9 rows) + 2 stale | 5 |
| D | 2 (AGENTS) + 6 (memory) | 0 | 27 missing + 11 drifted + 4 skills | 0 | 1 + 24 Cursor-only laws | 0 |

## New files

- 24 Claude twins: agentic-audit-guardrails, audit-screenshot-markups, audit-vs-fix-router, build-spec-then-backend-then-frontend, clickfunnels-developers-docs, clickfunnels-html-api-push, commas-catalog-hands-off, full-end-to-end-audit, ghl-blacklisted, live-playwright-100-before-manual, named-fix-regression-gate, no-extra-holes, one-issue-per-thread, one-step-adhd, owner-scope-minimal-diff, product-is-live, pulse-registry, redundancy-before-ui-polish, repo-hygiene-vc-router, sim-assume-paid, split-and-proceed, test-means-human-click, three-step-repair, verify-scratch-only.
- 13 new rules, each in both homes: features-stay-on, no-remote-control, no-ssn-before-checkout-step-3, outcome-first-copy, funding-sequence-term, no-api-spend-for-now, animation-logo-only-on-fundhub, animation-ad-style, ad-sound-level, owner-calls-settled, model-by-job, stop-asking-follow-the-rules, rules-no-drift.
- `docs/rules/RULES-INDEX.md`, this board.
- Skill `fundhub-ad-editor` (+ `scripts/ad-video-edit/edit.py`, `shake.py`) brought from branch `codex/two-ios-apps-launch`, and the `.claude/skills/fundhub-ad-writer` link.

Left Cursor-only on purpose: `no-claude-in-cursor`, `grok-lattice-overseer-perpetual`, `ui-standards`.
Real folders left alone in `.claude/skills`: `clickfunnels-developers-docs`, `fundhub-clickfunnels-html-push`.

## What was fixed

| Finding | File | Old, then new |
|---|---|---|
| B C1 | env-full-copies-never-masked (both) | "Never: use env:set without --secret" (backwards), then "Never: use env:set ... --secret" for keys the laptop reads |
| B C2 | env-full-copies-never-masked (both) | "Chris reveals them in Netlify", then recover from snapshot or reset at vendor, never tell Chris to reveal |
| B C7, D3 | secrets-env-law (both) | added: only a mask (contains `*`) may be replaced; pointer to "Never remove a key" |
| B M7 | secrets-env-law (Cursor) | older text, then synced to the fuller Claude text |
| B S1 | agents-run-ops-not-chris (both) | `git push github main`, then `git push origin main` or the push script |
| B S2 | dictator-owner-overrides (both) | "Test GitLab tokens", GITLAB_TOKEN example, then GitHub |
| B S7 | heartbeat-on-every-build (both) | one hourly function at minute 7, then four shifts |
| B S8 | monday-100-percent (both) | added status line: date passed, standard stays |
| B M8 | github-push (Cursor) | `alwaysApply: false`, then `true` |
| B S6, D1 | pulse-registry (Cursor + new twin) | "7:00 a.m. pulse" full rule, then a pointer to heartbeat-on-every-build, 6:00 a.m. |
| B C3 | fundhub-version-control skill | "commit only when asked", then commit every session (CLAUDE.md 2026-09-08) |
| B C3 | repo-hygiene-vc-router (+ twin) | "Commit only if he asked", then commit finished work locally |
| B C4 | fundhub-version-control skill | "propose delete, wait for go", then delete merged branches at once (section 8) |
| B S10 | version-control, repo-hygiene skills | added: Claude Code uses CLAUDE.md section 8 |
| B C5, L6 | CLAUDE.md section 11 + GitHub ships main | "ship once at end of session", then push main ships; Mac ship only if no push; cloud needs only GitHub |
| B C9 | CLAUDE.md section 12 src/mail | FCRA, Deluxe, lawyer sign-off rider, then "mails nothing, the drop is not built" |
| B S3 | DEPLOY.md | Vercel and Neon steps, then Netlify path; kept runbook link and `/api/health?strict=1` |
| B S4 | netlify.toml header (comment only) | Vercel-style text, then "Netlify is the live host" |
| B S5 | CLAUDE.md section 12 | suite counts read as current, then labelled dated history |
| B D2 | CLAUDE.md section 12 verify bullet | added "Law:" pointers to verify-scratch-only |
| A C3 | fundhub-ad-writer skill | "5th grade", then 4th grade |
| A C7 | fundhub-ad-writer skill | "do not run section 0", then run it in one line, no board |
| A D3 | fundhub-ad-writer skill | added: this is the tracking title, file names follow NAMING.md |
| A C9 | fundhub-testimonial-thumbnails skill | no draft step, then marked draft first before the push |
| A C10 | ad-video-best-of-clips (both) | added pointer: cuts follow fundhub-ad-editor |
| A C10 | fundhub-ad-editor skill | added: agent runs eye contact, Chris never opens Submagic |
| A S1 | fundhub-ad-editor skill | added: Mac-only whisper note, Sonnet note, sound rule pointer |
| A S4, L6 | ad-naming (both) + CLAUDE.md | offer is only SLO, then SLO, Direct Book, Capital Blueprint; never the recording app's title |
| A S7 | docs/rules/fundhub-brand.css | looked live, then marked ARCHIVED with a pointer to `public/app/fundhub-brand.css`; CLAUDE.md table matches |
| A S9 | animation-no-echo (both) | "use the script's own words" quote, then the newer wording |
| A D4 | video-animation-overlay + editor skills | two copies of the -14 LUFS number, then both point at new rule `ad-sound-level` |
| A M9, D | ux-guidance-urls-first (both) | Cursor had the older text; synced to the Claude text; dropped GHL from the list |
| A (note) | ad-watch-curve (both) | added: the buzz obeys texting-hours |
| A (note) | ghl-blacklisted, clickfunnels-html-api-push | "FundHub", then "Fundhub" |
| A L1-L7 | CLAUDE.md | missing owner-set lines for ad-second-line, ghl, sound level, animation logo and style, ad editing, ClickFunnels docs; added |
| C C1 | CLAUDE.md section 3 step 4 | "Wait for approval", then state the plan and proceed |
| C C2 | build-spec-then-backend-then-frontend (+ twin), CLAUDE.md 3a | hard "Wait", then wait only if the spec holds a decision only he can make; spec step added to 3a |
| C C3 | owner-scope-minimal-diff (+ twin), CLAUDE.md section 2 | "approved launch", then "approved task" (finish-the-requested-job) |
| C C4 | CLAUDE.md section 1 | kept the hard rule; added: stop only the step that needs the higher tier, do the safe parts |
| C C5 | CLAUDE.md section 1 | added: animation templates are always Opus; model-by-job owner calls |
| C C6 | no-claude-in-cursor (Cursor) | added exception: display and animation work are Claude work, leave on the board |
| C C7 | audit-vs-fix-router (+ twin) | "Chris launches the extra chats", then the agent starts them from the board |
| C C8 | three-step-repair, one-issue-per-thread, audit-vs-fix-router (+ twins) | "Chris copies each hole", then the agent starts the chat; one hole per chat unchanged |
| C C9 | fundhub-auditor skill + router | "wait for Chris approval of the board", then stop only for a missing owner decision |
| C C10 | fundhub-fixer skill | "Chris does one manual pass" and "What Chris should check", then agent walks it; what was proved |
| C C11 | fundhub-fixer skill | "Flag COMPLIANCE REVIEW REQUIRED" removed (CLAUDE.md section 7) |
| C C12 | fundhub-auditor skill | "Chris or CI runs Playwright", then the agent or CI |
| C C13 | AGENTS.md | split rule had no Full E2E carve-out; added |
| C C14 | CLAUDE.md section 0 item 3 | "so I can open a new session, paste it", then saved on the board, Chris pastes nothing |
| C S1 | full-end-to-end-audit, agentic-audit-guardrails (+ twins) | named a board that is not in the repo, then says so |
| C S2 | grok-lattice-overseer-perpetual (Cursor) | missing evidence folder, then "if one is present" |
| C S3 | audit-screenshot-markups (+ twin), ui-auditor skill | named tools and folders that are not on main, then says so |
| C S4 | builder, orchestrator skills | gate relay: added "never for a GO already given" |
| C S5, S8 | perf-auditor, system-map skills | "39 screens" and "169 letters" read as current, then dated or told to count |
| C S7 | audit-vs-fix-router (+ twin) | added the fundhub-system-map door |
| C (U4) | agentic-audit-guardrails (+ twin) | added: sims do not bypass texting-hours for texts to Chris |
| C L | CLAUDE.md | 15 missing owner-set lines for audit, test, scope, hole, sim, Commas, verify, product-is-live and more; added |
| A5 | AGENTS.md | "Ads target 60 fps", then a hard 30 fps (teleprompter-camera, 2026-10-13) |
| D 5b | memory-only calls | features-stay-on, no-remote-control, no-ssn..., outcome-first-copy, funding-sequence-term, no-api-spend-for-now, animation logo and style, ad-sound-level, owner-calls-settled, model-by-job, stop-asking... became rules in both homes plus CLAUDE.md lines |
| D 5b | fourth-grade-english (both) | added "short is not clipped" (2026-10-21); line 8 "replaces 5th grade" fixed (C stale) |
| D 5b | owner-go-no-repeat-approval, page-edits-marked-draft (both) | added "once he says push, push and prove, do not ask" (2026-10-23) |
| D 5b | owner-scope-minimal-diff (+ twin) | added copy rounds: change only the named line (2026-10-01) |
| D 5b | product-is-live (+ twin) | added named exception: Plaid payouts stay in test mode |
| D 5b | ad-naming (both) | added: never use the recording app's title (2026-10-22) |
| D (index) | CLAUDE.md top | pointer to `docs/rules/RULES-INDEX.md` added |

## Waiting (set aside by Chris on 2026-10-02, or outside the allowed paths; not touched)

Set-aside books (`marketing/ads/RULES.md`, `rules-data.mjs`, `ads:check`). Chris said keep them, rules get rebuilt later.

- A C1: RULES.md:38 and rules-data.mjs:250 teach "how much we think you'll qualify for". `copy-certainty` bans "we think".
- A C2: RULES.md:42, rules-data.mjs:259 and notes-green-screen.md:327 teach "most likely". `copy-certainty` bans it.
- A C4: RULES.md:253-255 tells agents to write COMPLIANCE REVIEW REQUIRED. CLAUDE.md section 7 removed that.
- A S2: RULES.md:108-109 names `docs/company-resources/...`. They moved to `docs/sops/company-resources/`.
- A S6: RULES.md:285 "BigVU only pauses on a space". Own teleprompter exists. Is BigVU still used?
- A D2 / U2: RULES.md reading level "5th grade" for scripts (see Chris decides).

Outside the allowed paths (marketing books and a doc); the fix text is in the findings file A:

- A C7: `marketing/ads/WRITE-ADS-FROM-HERE.md:12` still says "do not run section 0".
- A C8: `marketing/ads/ANGLE-GENERATOR.md:151` "Minimum 60 seconds. No exceptions." vs shorts floors in RULES.md.
- A S3: `marketing/ads/README.md` lists files that do not exist.
- A S5: `marketing/ads/NAMING.md` table stops at 11 ads and lacks Capital Blueprint.
- A S8: `marketing/ads/notes-green-screen.md:6-9` names "optimize".
- A: "FundHub" spelling in `docs/rules/MONITORING-CONSENT-FORM.md`, marketing README, NEXT, CONTROLS (existing strings stay unless asked).

## Chris decides

One line each. Both quotes given. Nothing below was changed.

1. **Netlify auto build.** `github-ships-main`: "Netlify's own auto build stays OFF (`stop_builds`)." vs `netlify.toml`: `ignore = "node scripts/netlify-ignore-machine-only.mjs"` (that only skips machine-only pushes, so it implies Netlify builds). Only the Netlify setting can tell; if it is ON, a push to main builds twice.
2. **Direct Book folder.** `slo-one-filmed-folder`: "all filmed MP4s land here" (the one SLO Ads folder) vs AGENTS.md: "Never place Direct Book recordings in the SLO folder" (code uses `DIRECT_BOOK_ADS_FOLDER_ID`). Which folder holds Direct Book?
3. **Fresh session line.** CLAUDE.md section 8: "note that a fresh session is recommended" vs memory 2026-10-21: "never post the /summarize reminder". Does the one-line recommendation also stop?
4. **GitHub is public.** CLAUDE.md and `github-push`: push "every unmerged local branch" vs memory 2026-10-21: "no backup branches to GitHub... each pushed branch starts 28 jobs... Chris decides on private". Push only branches headed to a PR?
5. **Delete test rows without asking.** CLAUDE.md section 11 "Ask me first: anything that deletes data" vs memory 2026-10-20 "Chris has already said yes to this class of delete" (guarded delete of test rows and test logins). Make it a written exception?
6. **Command Center vs chat.** CLAUDE.md 3c (2026-09-06): "build marketing tooling as a skill plus a rules pack... never a job" vs memory 2026-10-05: "use the dashboard to run marketing, not Claude Code". Does 3c still hold for ad scripts?
7. **Commas titles.** `commas-catalog-hands-off` keeps 10 titles incl. "Business Financial Assessment" vs `src/config/offers.mjs` (no such title; adds Letters, Insights, Retainer, Introductions). Do those four exist in Commas? (Twin copied as is.)
8. **Script reading level.** RULES.md rule 12: "5th grade" for scripts vs `fourth-grade-english` (names chat, reports, boards, not scripts). Should ad scripts be 4th grade?
9. **Testimonial card size.** `fundhub-testimonial-thumbnails`: "608 wide is correct" vs `video-4k-unless-ad`: "a non-ad video that comes back under 4K is a defect". Does the card video need 4K?
10. **Who owns B-roll.** `fundhub-ad-editor`: `magicBrolls` is NOT sent vs `ad-video-best-of-clips`: "Submagic's job is captions and our B-roll". Which stage owns B-roll?
11. **Sol and Luna.** `docs/rules/TELEPROMPTER-VIDEO.md:9`: "Use Sol for requested screen changes and Luna for recording/settings checks" vs `grok-no-displays`: "Only Claude may change what people see." Are Sol and Luna Claude agents?
12. **Branch delete from hosted env.** CLAUDE.md section 8: `git push origin --delete` returns 403 (measured 2026-08-31) vs memory: diag branches were deleted later. Still true on the Mac or in cloud?
13. **Audit or fix.** `audit-vs-fix-router`: "ask one question: audit or fix? Wait." vs `stop-asking-follow-the-rules`: "if the rules settle a choice, make it". Default to the read-only audit and report?
14. **Missing dates.** `one-step-adhd` and `live-playwright-100-before-manual` ("Owner law", undated; the override line is 2026-08-25). What date goes on them?
15. **Standing GO in the builder skill.** `fundhub-builder`: "Standing GO... Build it" for a row Fixer handed over vs `owner-scope-minimal-diff`: a route he did not request is stop-and-ask. Fine if the row is named?
16. **Anchors.** `animation-plan.mjs` says "Copy the phrase exactly" for the anchor; `animation-no-echo` says never print his sentence. Add "anchors are exact, labels are not"?
17. **`credentials/README.md`.** Named by `env-full-copies-never-masked`; the file is gitignored, so main cannot show it. Does it exist on the Mac?

## Not done (kept small on purpose)

- Duplicate cleanups left as is because the copies say the same thing and a pointer would add risk: C D1 (look it up), D2 (no extra holes, nine files), D3 (skill paragraphs on reading level and "language, never a refusal"), D4 (do not ask Chris to QA), D5 (finish rules in AGENTS.md and CLAUDE.md); A D1 (banned words in three files, tests hold them equal). B D1 and D3 and A D3, D4 and C D2 pointers were added where a one-line change was enough.
- `.claude/skills/clickfunnels-developers-docs` and `fundhub-clickfunnels-html-push` stay real folders (Chris said leave them). The Claude rule twin for clickfunnels-developers-docs was added.
- `.agents/skills/source-command-flywheel` belongs to Codex. Left.
- `scripts/ad-video-edit/batch_cut_one.py` is not tracked anywhere. Left out (copy limited to edit.py and shake.py by the order).
- `no-context-reminder` memory note is stale (it says the repo rule was not changed; main removed it). Memory is not edited here.
- Branch `codex/two-ios-apps-launch` may still carry the old `fresh-thread-when-long` rule. Do not merge it back.
