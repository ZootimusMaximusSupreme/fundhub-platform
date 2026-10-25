# Phase 3 decisions (made for Chris, 2026-10-24)

Chris said: finish Phases 2 to 7 without stopping to ask. These are the calls the lead made on all 50 fights in `phase-3-conflicts.md`.

## The rules Chris gave

1. **Newest rule wins.**
2. **One exception: a rule meant for one day, one batch or one deadline is archived, even if it is newer.** ("No new features today", "green by Monday 10-19".)
3. **A true toss-up** (neither clearly newer nor clearly temporary): pick the side closer to Chris's most recent instructions, and list it under "Decisions I made for you".
4. Archive, never delete. Only AI instruction files. Never app code.

Side labels: A and B are the sides in `phase-3-conflicts.md`. Paths: rules are at `.ai/rules/<name>.md`, skills at `.agents/skills/<name>/SKILL.md`. "CLAUDE.md §N" lines move into rule files in Phase 5; apply the edit where that text now lives.

Basis codes: **NEW** = newer owner-set date wins. **TEMP** = the older or newer side is date-bound, so it is archived. **TOSS** = a toss-up; the call is on the "Decisions I made for you" list.

## The 50 calls

| # | Call | Basis | What to change |
|---|---|---|---|
| 1 | B, masks only | NEW (2026-10-04 over 2026-09-17) | In "Never remove a key": add one sentence. A value that is only a mask placeholder (a row of stars) is not a key and may be replaced with the real value. A real key is still never removed, even when broken. |
| 2 | A, with one carve-out | TOSS | New repo rule `no-test-data-on-production` from the 2026-10-20 call: no test rows and no test logins are left on production; tests run on scratch databases. The one carve-out: a Full End-To-End Audit that Chris orders by name may make sim people on live while it runs, and the agent removes them right after with the guarded delete (allowed since 2026-10-24). Edit `sim-assume-paid`, `full-end-to-end-audit` and the `fundhub-ui-auditor` skill line 14 to say so. |
| 3 | A | TOSS | Add "direct mail (`src/mail`) stays unbuilt until Chris names the switch" to the Named exceptions in `product-is-live`, next to Plaid. Keep the section 12 line. |
| 4 | A | NEW (2026-10-09) | Rewrite the hand command "Apply new SQL yourself" and line 666 in the deploy section: push `main`, the GitHub ship applies the SQL, the Mac deploys only when pending is 0. Drop the `DATABASE_URL` hand command. Keep the production-only guard line. |
| 5 | B | NEW (2026-10-24) | Fix the text lines that say push everything: the GitHub paragraph in CLAUDE.md, `AGENTS.md` line 51, the `fundhub-version-control` skill line 13. Say: push only `main` and branches headed to a PR. `scripts/ship.mjs` is code: leave it, put it on the leftovers list. |
| 6 | B | NEW (2026-10-09) | No rule change. Memory note edit (done by the lead): a canary buy waits until Chris names a safe way to buy. |
| 7 | A, plus one clause | NEW (2026-10-12) | Keep "if shipping is blocked, offer a manual path". Add: the manual path is a pull request Chris can merge (GitHub ships it); it is never a deploy or a database command for him. Fix the ship LAW sentence and the "do not tell Chris to run commands" line so they say this. |
| 8 | B | NEW | Chris's proof list (RULES.md Part 0 lines "A decade in the industry..." and the three after) is the only proof list. Remove the $25M, Koi Poke and "tens of thousands of data points" lines from `SLO-CHAT-PROMPT.md` and the locked-ads house rules. `slo-297-prompt-2026-09-18.md` is archived (old copy, replaced). |
| 9 | B | NEW (2026-10-24) | `no-remote-control`: "give the cloud the same GitHub path as the Mac" (no keys, no hosts). |
| 10 | B | NEW (2026-10-04) | `--secret` is banned for keys the Mac or cloud must read. Fix `fundhub-fixer` line 55 and RUNBOOK line 183. `postgres-least-privilege.md` is history: add a banner saying do not use `--secret`, do not rewrite the old commands. |
| 11 | B | NEW (2026-10-04) | Add "unless Chris asks for the value (`show-secrets-when-chris-asks`)" to the Never-print lines in `chris-never-submagic`, `chris-never-clickfunnels` and the `fundhub-fixer` skill line 56. |
| 12 | B | NEW (2026-10-20) | Stuck rule: two failed tries of the same fix means change the fix, never repeat it a third time. For required checks and approved work keep going with a different fix until a `finish-the-requested-job` stop reason applies. Make `fundhub-fixer` ("Two chances per ticket") and `fundhub-orchestrator` agree. |
| 13 | B for required checks, A for new scope | NEW (2026-10-20) | Scope-creep line: a required build, verification or release check never counts toward "double the estimate". New product scope still stops. Keep the orchestrator's quota-checkpoint stop. |
| 14 | Split by kind of block | TOSS | A rule that blocks the obvious fix: find the best move that keeps the rule and say what you did. A policy or permission block (a 403, the classifier, a tool-enforced approval): report once, do not bypass. The exact command goes to Chris only for permission dialogs only he can approve. Add this as a short paragraph in the ground rules. Fix `AGENTS.md` line 11 to match. |
| 15 | B | NEW | `fundhub-orchestrator` line 45: remove "GHL workflows"; change "env/secrets" to "stored keys (never delete or overwrite)". Leave `.env.example` alone. |
| 16 | A | TOSS | Section 4 stands: intended journey files are hand-authored. `fundhub-builder` line 66 becomes: the builder drafts the steps on the board, Chris writes or approves the intended file. Add one line in the journeys text pointing to the `docs/journeys/README.md` one-time exception (2026-08-02). |
| 17 | A, by archiving the Monday rule | TEMP | `monday-100-percent` is archived (deadline 2026-10-19 has passed). Add to `heartbeat-on-every-build`: rows Chris settled in `owner-calls-settled` stay red labelled "owner declined" and are not a to-do. |
| 18 | B | NEW | The session-start hook text gets the exception: "Exception: a Full End-To-End Audit skips the split (CLAUDE.md section 0)." Done in the hook JSON when it is wired. |
| 19 | A, narrowly | NEW (2026-09-18) | `owner-scope-minimal-diff` gets a third exception: same named hole, same symptom, real cause one layer over in a file he did not name: fix it without asking, and say which file. Everything else stays stop-and-ask. |
| 20 | B | NEW (2026-10-24) | Rewrite the `no-claude-in-cursor` Example to "write the need on the board". Archive `ui-standards` (a Cursor-only rule with no audience, since Cursor models cannot do screen work). |
| 21 | A for one check, the other archived | NEW and TEMP | Only the iPhone check stays: add "Chris checks the shipped teleprompter on a real iPhone (owner-set 2026-10-13)" to the exceptions list in "Agents run the work" and in `live-playwright-100-before-manual`. The money walk was part of the Monday sweep and is archived with it. |
| 22 | B | NEW (2026-09-18) | Rewrite the FINISH line in `three-step-repair` and the Prove path in `fundhub-fixer`: a different tester tries to recreate the hole; the fixer never marks done. |
| 23 | B | NEW | Definition of done: replace the tsc and "no skipped test" wording with the `AGENTS.md` wording. Name any check that could not run here and say how many database tests skipped. The tsc line runs only when TypeScript is installed. |
| 24 | B | NEW (2026-10-09) | "Set every variable first; the next push to `main` ships once and picks them up." An env-only deploy needs a change to `scripts/ship.mjs`: leftovers list. |
| 25 | B | TOSS | Real builds go to Claude: `model-by-job` (Sonnet back end, then front end). "Codex builds, Claude tests" disappears with the Monday rule. Archive the board `codex-build-claude-test-2026-10-13.md` (a one-day rule). Archive `grok-lattice-overseer-perpetual` (tied to the 2026-09-20 launch board). |
| 26 | B | NEW (2026-10-21) | The Monday schedule goes with the archive (#17). The refactor start (Tuesday 2026-10-27) stays in the memory note; no repo rule carries a date. |
| 27 | B | NEW | Dated banner at the top of `docs/sops/RUNBOOK.md` and `docs/sops/README.md`: "Written before the owner laws of Aug to Oct 2026. Where this page and CLAUDE.md disagree, CLAUDE.md wins." Then fix the six lines in the conflicts sheet. Fix `README.md` line 3 (Vercel). Fix `ops/workflows/pulse-layer-2026-10-09-brief/04-alerts-and-github.md` line 65 ("text at once") to "text inside the texting window". |
| 28 | B | TOSS | `agents-run-ops-not-chris` stands: Chris never hand-copies env blocks. Cloud needs only GitHub (#9), so change the `env-full-copies-never-masked` line "before Chris pastes cloud env vars" and the pbcopy example to match. |
| 29 | B | NEW (2026-10-21) | Add one line to `heartbeat-on-every-build`: on the Mac, OK means no reds except the known laptop key rows, and the newest live scorecard row decides. |
| 30 | B | NEW (2026-09-08) | Audit skills: "no fixes, no commits, no branches" becomes "no fixes and no app-code changes; commit your board and evidence files like any session". Fix `fundhub-perf-auditor`, `fundhub-ui-auditor`, `fundhub-auditor` line 87. |
| 31 | B | NEW (2026-09-08) | Remove the order to add the label from: `marketing/ads/RULES.md` lines 253 to 255, `marketing/avatars/partner/COPY-DIRECTIVES.md` line 45, the title of `CHECKOUT-FOR-CLAUDE.md`, line 3 of `SLO-CHAT-PROMPT.md`, and the false "per CLAUDE.md section 7 that label stays" sentence in `docs/specs/W1`, `W3`, `W4`, `W6`, `W7`. Old code comments and applied migrations stay. |
| 32 | B | NEW | Widen the "Superseded" banner in `marketing/ads/video-pipeline-plan.md` to cover the file names, the Raw folder and `autoRender`. Fix `docs/journeys/ad-video-flow.md` line 265. |
| 33 | B | NEW (2026-10-24) | `NAMING.md` line 126: filmed SLO files live in SLO Ads root only; Direct Book has its own folder. |
| 34 | B | NEW (2026-10-24) | Add the "testimonial card videos on pages do not need 4K" sentence to `AGENTS.md` line 61, `teleprompter-camera` line 15, `docs/rules/TELEPROMPTER-VIDEO.md` line 13, and fix `video-4k-unless-ad` line 16. |
| 35 | B | NEW | `AGENTS.md` line 65 matches the locked labels: "iPhone mic on" and "Rode on". |
| 36 | A | NEW (2026-10-23 and 2026-10-24) | Submagic does captions and clean audio only. In `fundhub-ad-editor` lines 9 and 72, replace eye contact with: not done until Chris says an agent may drive the Submagic app (API-only law). Correct line 5 of `ops/workflows/animation-builds-2026-10-22.md`. |
| 37 | B | TOSS | `animation-ad-style` line 27: "no cuts and no sound clean-up, except the -14 level reset". |
| 38 | B on all four | NEW (2026-10-24) | Edit the older lines in `animation-overlay-on-spoken-words` (lines 13 and 15) and the `fundhub-video-animation-overlay` skill (lines 49 and 56) to match `animation-ad-style`: behind his head is fine, the CTA only when it fits, long clips allowed. |
| 39 | Split by size | TOSS | Video files go in a scratch folder. Small files (the schedule, the plan, the notes) go in the repo. Fix skill line 28 and the rule line 17. |
| 40 | B | TOSS | `fundhub-video-animation-overlay` line 107: on the Mac, use the whisper step from `fundhub-ad-editor`. |
| 41 | B | NEW | Update the one paragraph in `marketing/ads/watch-curve.md` (line 65): add the tap-through exception and the texting window. |
| 42 | B: the ad rule books are in force | NEW (2026-10-05) | RULES.md Part 0, the other parts and the checker are in force, as amended by Part 0 and the newer owner rules (where a book line fights a newer rule, the newer rule wins; the 15 fixes in #44). Rewrite `fundhub-ad-writer` line 16, the RULES-INDEX note, and `WRITE-ADS-FROM-HERE.md` so none says "set aside". Record: the checker's 135-word floor fights the 115 to 125 word sorting-hat ads (owner-set 2026-10-02): code change, leftovers list. |
| 43 | A | TOSS | `fundhub-ad-writer` line 134 and `WRITE-ADS-FROM-HERE.md` line 12: give the one-line section 0 answer; no board, no extra prompts. |
| 44 | B on all 15 | NEW (see below) | The 15 fixes are listed below. |
| 45 | B | NEW (2026-10-24) | The screenshot paragraph in CLAUDE.md section 8 points to `audit-screenshot-markups` (numbered red circles and yellow arrows). Drop the missing tool names. Fix `AGENTS.md` line 45. |
| 46 | B | NEW (2026-09-21) | Add a banner to `marketing/landing-pages/clickfunnels/CHRIS-DO-THIS-FIRST.md`: "Old. Agents do this through the API (`chris-never-clickfunnels`)." Keep the file until the API covers all four parts. |
| 47 | B | NEW (2026-10-24) | Memory edit by the lead. |
| 48 | B | NEW | Section 1: "Opus plans and checks slices, Sonnet may do the moves (owner-set 2026-10-21)." Chris also said on 2026-10-24 that Opus is not really needed here. |
| 49 | B on its own scope | NEW | Memory edit by the lead: ship and `pulse:prove` run from a sibling folder; everything else stays in the batch worktree. |
| 50 | B | NEW | Memory edit by the lead. |

### The 15 fixes in #44 (each one: the newer side wins)

1. RULES.md line 38: "how much you qualify for based on where you're at right now" (copy-certainty, 2026-10-15). `rules-data.mjs` line 250 is code: leftovers.
2. RULES.md line 42: remove "most likely" (copy-certainty). `rules-data.mjs` line 259: leftovers.
3. RULES.md lines 119 and 237: remove "Up to ... is the only safe shape". Chris's 2026-10-02 ask bans "up to".
4. Optimize: RULES.md Part 0 line 37 (2026-10-05) is newer than the 2026-10-02 board. "Credit optimization" and "optimize your credit" are allowed.
5. Close promises: the soft-pull and no-obligation close is no longer required (2026-10-02, later that day). Fix RULES.md line 529 and `SLO-CHAT-PROMPT.md` line 439.
6. Same close in every ad: RULES.md line 659 and `ASSET-BANK.md` line 321 become "write each ad's close fresh" (`ad-no-recycled-lines`, 2026-10-15).
7. `VOICE.md` line 110: remove "your number".
8. `VOICE.md` line 81: remove the "it's not X, it's Y" denial shape (Part 0 line 52).
9. `ANGLE-GENERATOR.md` line 67: remove the "Not another ___, but" stem.
10. Bullets or paragraphs (TOSS): teleprompter scripts are full flowing sentences in paragraphs (Part 0 line 90). Bullets are for Notes and green-screen cue ads only. Fix `RECIPES.md` line 9 and RULES.md line 97 (it names an Appendix B that does not exist).
11. `notes-green-screen.md` line 337: Notes ads are bullet cues (Part 0 line 94).
12. `locked-ads-2026-09.md` line 457: remove the "potentially seven figures" rule line (hedge words are banned).
13. `SLO-CHAT-PROMPT.md` line 467: remove the "Frodo" framing line (Part 0 line 78).
14. `SLO-CHAT-PROMPT.md` line 70: "Funding Snapshot" is banned in sales copy (`outcome-first-copy`).
15. RULES.md line 125: add a scope line, "$10,000 once is the Ascension offer, not this one".

## Archived because they were meant for one day, one batch or one deadline

| What | Why |
|---|---|
| Rule `monday-100-percent` (real file and both links) | Deadline 2026-10-19 passed. The standing parts already live in `heartbeat-on-every-build`. |
| Rule `grok-lattice-overseer-perpetual` | Tied to the 2026-09-20 launch board. |
| Board `ops/workflows/codex-build-claude-test-2026-10-13.md` | A one-day rule ("no new product features today"). |
| Board `ops/workflows/ad-scripts-2026-10-02.md` | One batch (ads 21 to 26). Fold any standing rule that is not yet in RULES.md Part 0 into RULES.md first, then archive. |

## Archived because they are dead, superseded or have no audience

| What | Why |
|---|---|
| Rule `pulse-registry` | A pointer to `heartbeat-on-every-build`. |
| Rule `approved-launch-release-blockers` | `finish-the-requested-job` (2026-10-20) covers every approved task. Fold anything unique into it first. |
| Rule `ui-standards` | Cursor-only, no audience (#20). |
| `marketing/ads/slo/slo-297-prompt-2026-09-18.md` | Old paste prompt, replaced by `SLO-CHAT-PROMPT.md`. Archive only if no code reads it. |
| Planner finds | Each planner may add more with evidence. |

## Not done on purpose (leftovers for Chris, because they are code or outside the repo)

- `scripts/ship.mjs` pushes every unmerged branch and tag (#5). `scripts/ship.mjs` has no env-only deploy (#24).
- `marketing/ads/rules-data.mjs` lines 250 and 259 teach "we think" and "most likely" (#44).
- `scripts/ads/check-script.mjs` has a 135-word floor that flags the 115 to 125 word sorting-hat ads (#42).
- `.env.example` still lists `GHL_API_KEY` (#15).
- Old COMPLIANCE REVIEW REQUIRED text in about 56 older docs and 225 code comments (#31).
- Memory notes are edited by the lead after the PR is open; they are not in git.
- `ops/workflows/AGENTS-local-backup-2026-10-12.md` is untracked in the main folder; it is on the Phase 6 list.

## Chris's answers after the PR was opened (2026-10-24)

These answer the two questions in Cursor's "Left for Chris" list. They are final. Both are applied (commit `e37da57ed`).

| # | Call | Basis | What changed |
|---|---|---|---|
| 51 | Account access is standing. It is not tied to the launch. | NEW (owner-set 2026-10-24) | In `owner-authorized-account-ops` and the CLAUDE.md line about it, "for the Fundhub launch" and "for this launch" are gone. The rule says it is standing for all later work. The 2026-10-17 date stays on the old sentence. |
| 52 | The `redundancy-before-ui-polish` cleanup was a job-specific task and it is done. | TEMP | The rule is archived. Its section "Protected core flow - closer context + Present" (owner law 2026-08-20) moved word for word into the new rule `protected-present-flow`, because that protection is a standing law. |

Chris also typed "IDK" next to these answers; it may mean he was unsure about call 52. The lead kept the Present-flow protection so no standing law is lost. Chris can drop it later by saying so.

Note: a Cursor "wording check" agent once reset this file to the committed copy and wiped this section. It was added back and committed on its own.
