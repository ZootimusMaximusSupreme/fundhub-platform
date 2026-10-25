# Skills cleanup

Date: 2026-10-24. Branch: `drift-cleanup`. This agent edited only the 16 real `SKILL.md` files it was given. It did not commit. It did not edit `.ai/rules/`, marketing books, `CLAUDE.md`, `AGENTS.md`, or `docs/rules/RULES-INDEX.md`.

Cut sentences are in `ops/archive/ai-instructions-2026-10-24/removed-lines/.agents__skills__<name>__SKILL.md.md`. Each note has the date and the reason.

## Skills changed

- `.agents/skills/fundhub-auditor/SKILL.md` — Repeats now point at the owner rules. Call 30: board and evidence files may be committed; app code stays read-only.
- `.agents/skills/fundhub-ui-auditor/SKILL.md` — Call 2: no test logins stay on production, with the Full End-To-End Audit carve-out. Call 30: same commit line as the auditor. The brand file path is `public/app/fundhub-brand.css`. The rebuild line names `docs/rules/UI-STANDARDS.md`.
- `.agents/skills/fundhub-perf-auditor/SKILL.md` — Measure line points at PERF-STANDARDS. The median-of-3 sentence stays. Call 30: board and evidence commits are allowed.
- `.agents/skills/fundhub-agent-tester/SKILL.md` — Sim identity, cards, credit pulls and paper mail point at `agentic-audit-guardrails`. "Do not ask Chris to listen" and "Do not send extra SMS" stay.
- `.agents/skills/fundhub-system-map/SKILL.md` — Stale S28: the heading is now `## Instant FAIL`. The list under it stays.
- `.agents/skills/fundhub-fixer/SKILL.md` — Repeats point at the owner rules. Call 10 kills "(secret when needed)". Call 11 pastes a secret only when Chris asks. Call 12 changes the fix after two tries. Call 22: a different tester tries the hole, and the fixer never marks it done.
- `.agents/skills/fundhub-builder/SKILL.md` — Reading level, handoffs, four states and speed budgets point at the owner files. Call 16: the builder drafts the steps on the board; Chris writes or approves the intended file. Brand path is `public/app/fundhub-brand.css`.
- `.agents/skills/fundhub-orchestrator/SKILL.md` — Call 12 matches the fixer stuck rule. Call 15: "GHL workflows" is gone, and "env/secrets" is now "stored keys (never delete or overwrite)". The 80% quota stop stays. The repeated standing-GO sentence is gone.
- `.agents/skills/fundhub-version-control/SKILL.md` — Call 5: push only `main` or a PR branch with `git push origin <branch>`. The whole-repo script is not the default. The Claude Code section 8 sentence stays for phase 5.
- `.agents/skills/fundhub-repo-hygiene/SKILL.md` — Secrets and raw ID packs point at the owner rules. The dead `repo-purge-candidates-2026-08-21.md` name is gone. "Never touch `.env` or `credentials/`" stays.
- `.agents/skills/fundhub-ad-writer/SKILL.md` — Call 42: the ad books and the checker are in force (owner-set 2026-10-05). Call 43: give the one-line section 0 answer. Stale S26 removed the 2026-09-07 loader note. Stale S27 dropped "(once confirmed)". Stale S31 on the skill lines now says "locked controls (filmed August 2026)".
- `.agents/skills/fundhub-ad-editor/SKILL.md` — Call 36: Submagic does captions and clean audio only. Eye contact waits until Chris says an agent may drive the Submagic app. B-roll and the -14 level point at the owner rules.
- `.agents/skills/fundhub-video-animation-overlay/SKILL.md` — Sound, style, no-echo and who-builds point at the owner rules. Call 38: behind his head is fine, and the closing ask can carry a CTA only when it fits (owner-set 2026-10-24). Call 39: video files go in a scratch folder; the schedule, the plan and the notes go in the repo. Call 40: on the Mac, use the whisper step from `fundhub-ad-editor`. The loudnorm recipe stays.
- `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` — Banned words point at RULES.md Part 0 and outcome-first-copy. The 4K card exception points at `video-4k-unless-ad`. The marked draft points at `page-edits-marked-draft`. "Never upscale" stays.
- `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` — Push laws point at `chris-never-clickfunnels` (the fold is already in that rule). Stale S44: `/apply` is custom HTML page 25515671, manifest key `apply-survey`.
- `.agents/skills/clickfunnels-developers-docs/SKILL.md` — The body is now the pointer to `.ai/rules/clickfunnels-developers-docs.md`. Front matter and the title stay.

## Skills archived

None. No plan said to archive one of these skills.

## Handoff

These lines are not in this agent's files. Do not treat them as done here.

- Phase 3 call 16, the journeys sentence. Add this line to the journeys text (CLAUDE.md section 4 when that section moves): "One-time exception (2026-08-02): `docs/journeys/README.md` says the existing `-intended.md` files were generated once, as a starting draft for a human to revise." The builder skill line is already changed.
- Phase 3 call 8, marketing books. In `marketing/ads/slo/SLO-CHAT-PROMPT.md`, remove "Over $25 million secured for our clients." and the Koi Poke line. In `marketing/ads/reference/locked-ads-2026-09.md`, remove "tens of thousands of data points across the funding ecosystem". The proof list that stays is RULES.md Part 0 ("A decade in the industry..."). Archive `marketing/ads/slo/slo-297-prompt-2026-09-18.md` only if no code reads it.
- Phase 3 call 36, board line. `ops/workflows/animation-builds-2026-10-22.md` line 5 now says Submagic edits and Chris downloads. Change it to: Submagic does captions and clean audio only. Eye contact is not done until Chris says an agent may drive the Submagic app.
- Phase 3 call 42, index and paste brief. `docs/rules/RULES-INDEX.md` still says the ad books were "set aside". `marketing/ads/WRITE-ADS-FROM-HERE.md` must not say "set aside". Both should say: RULES.md Part 0, the other parts and the checker are in force, as amended by Part 0 and the newer owner rules. Where a book line fights a newer rule, the newer rule wins.
- Phase 3 call 43. `marketing/ads/WRITE-ADS-FROM-HERE.md` line 12: change the "do not load CLAUDE.md section 0" line to "give the one-line section 0 answer; no board, no extra prompts."
- Stale S31, marketing files only (the skill lines are done). Change the "live" and "running right now" words to "locked controls (filmed August 2026)" in `marketing/ads/CONTROLS.md` (lines 1, 3, 13-14), `marketing/ads/slo/fundhub-297/INDEX.md` line 38, and `marketing/ads/WRITE-ADS-FROM-HERE.md` line 23. Keep "never rewrite".
- Stale plan D40. `ops/workflows/system-map-2026-08-26.md` lines 133, 196 and 319 name `docs/workflows/agent-tester-2026-08-26.md` and `docs/workflows/repair-build-spec-2026-08-21.md`. Remove those dead names. The system-map skill still says to read that board end to end.
- `.ai/rules/animation-overlay-on-spoken-words.md` still says "only decoration goes behind him" on the same line that says "Behind his head is fine" (owner-set 2026-10-24). Call 38 said behind his head is fine. The skill line matches that. The rule line still has both.

Already applied by the rule agent, so this agent did not touch them:

- D105 on `.ai/rules/clickfunnels-developers-docs.md` (pointer to `chris-never-clickfunnels`).
- The M5 fold in `.ai/rules/chris-never-clickfunnels.md` (calendar, CAPI, field-capture, slo-02-booking).
- Call 38 and call 39 on `.ai/rules/animation-overlay-on-spoken-words.md`, including the folded style block from `animation-ad-style`.

## Skipped

- Stale S29 on `fundhub-testimonial-thumbnails` (the broken "Fundhub, never Fundhub" sentence). Skipped because dedupe D55 already replaced those lines, which is what the stale plan says to do.
- No whole skill was archived. The plans did not say to move any of these 16 folders.
- `fundhub-system-map` had no dedupe section. Only the heading rename (S28) applied.
- The stale plan's R7 note about old boards is not an edit. Left it.
- Did not fix the drift-check failures below. They name `CLAUDE.md`, `AGENTS.md` and `no-test-data-on-production`, which this agent does not own.

## `node scripts/rules-drift-check.mjs`

Ran once at the end. Exit code 1. 21 problems. None of the lines name these 16 skills.

```
Counts: pointer=19, index=1, claudemd=1
```

The 19 pointer lines are `CLAUDE.md` and `AGENTS.md` naming archived rule links (`approved-launch-release-blockers`, `rules-for-claude-and-cursor`, `clickfunnels-html-api-push`, `monday-100-percent`, `pulse-registry`, `animation-ad-style`, `one-issue-per-thread`, `live-playwright-100-before-manual`, `grok-lattice-overseer-perpetual`, `stop-asking-follow-the-rules`). The other two lines say `.ai/rules/no-test-data-on-production.md` is missing from `docs/rules/RULES-INDEX.md` and from `CLAUDE.md`.
