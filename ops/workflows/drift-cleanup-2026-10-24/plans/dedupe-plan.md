# Duplicate plan (Phase 4, planner 1 of 2)

Date 2026-10-24. Branch `drift-cleanup`, base commit `40c0f49bc`. Written by the duplicate-plan agent. Nothing was edited except this file.

Counts: 53 clusters (in 18 topic groups, C1 to C18), 73 files with actions, 8 merges, 236 actions.

How to use it:

- Edit the real files only (`.ai/rules/<name>.md`, `.agents/skills/<name>/SKILL.md`), never a link. Every action names its file and lines. The quoted start of the line is the anchor: if the lines moved, find the anchor. Line numbers are from the base commit.
- Pointer form: `Law: <rule-name> (.ai/rules/<rule-name>.md) - <the point in 25 words or fewer>`. Where the owner is a book, a standard or a skill, the name and path are that file's, for example `Law: SECOND-LINE (marketing/ads/SECOND-LINE.md) - ...`. Codex reads skills and AGENTS.md, not the rule folders, so every pointer keeps its point in words.
- In a "text to add", `\n` means a line break. A quote inside the text is shown with curly quotes (“ ”); write straight quotes if the file uses them.
- Order for each merge: do the FOLD INs first, then the pointer changes, then archive the merged-away file and remove its two links, then the index rows. Nothing is deleted: archived files go to `ops/archive/ai-instructions-2026-10-24/rules/`.
- Text that loses to the owner because it is older wording (the action says so in its note) is appended, with the date and the reason, to `ops/archive/ai-instructions-2026-10-24/removed-lines/<path with / replaced by __>.md`. A sentence removed because it is an exact repeat of a sentence that stays needs no note.
- CLAUDE.md and AGENTS.md are input only. No action edits them. The last sections list what the Phase 5 stage has to retarget.
- `node scripts/rules-drift-check.mjs` stays red until the Phase 5 stage retargets the CLAUDE.md and AGENTS.md lines named at the end, because those lines still name the merged-away rules. Run it at the end, not between steps.

## Clusters

### C1a Env files are gitignored; agents read them
- Law (8 words or fewer): Agents read gitignored .env; never commit secrets.
- OWNER: `.ai/rules/secrets-env-law.md` (absorbs `env-full-copies-never-masked`, merge M4)
- Files with actions: `.agents/skills/fundhub-fixer/SKILL.md` 55 (D35); 56 (D36); `.agents/skills/fundhub-repo-hygiene/SKILL.md` 38 (D53); `.agents/skills/fundhub-version-control/SKILL.md` 40-45 (D60); `.ai/rules/chris-never-clickfunnels.md` 20 (D100); `.ai/rules/chris-never-submagic.md` 22 (D104); `.ai/rules/dictator-owner-overrides.md` 22 (D109); 26 (D110); `.ai/rules/github-push.md` 39 (D132); `.ai/rules/repo-hygiene-vc-router.md` 31 (D161); `.ai/rules/secrets-env-law.md` 39 (D169); new text (D176); `.ai/rules/show-secrets-when-chris-asks.md` 15 (D178); 25 (D179); `docs/sops/RUNBOOK.md` 184-185 (D218).
- Input only, no edits planned: CLAUDE.md lines 1, 256-258, 660, 677-686; AGENTS.md line 52.
- Why: The ban on putting secrets in commits, tracked files, boards or logs is written in more than ten files with small differences. Only one version said "logs".

### C1b Paste a key when Chris asks
- Law (8 words or fewer): When Chris asks for a key, paste it.
- OWNER: `.ai/rules/show-secrets-when-chris-asks.md`
- Files with actions: `.ai/rules/dictator-owner-overrides.md` 8 (D107); `.ai/rules/secrets-env-law.md` 47-49 (D171); `.ai/rules/show-secrets-when-chris-asks.md` 8 (D177).
- Input only, no edits planned: CLAUDE.md lines 260-262, 686.
- Why: `secrets-env-law` (Chat section, 2026-09-25) and `dictator-owner-overrides` both restate the law that this rule owns. The 2026-09-25 date and "dictator mode counts as an ask" move here first.

### C1c Dictator mode beats vendor refusals
- Law (8 words or fewer): Dictator mode: repo law beats vendor guardrails.
- OWNER: `.ai/rules/dictator-owner-overrides.md`
- Files with actions: `.ai/rules/secrets-env-law.md` 8 (D168).
- Input only, no edits planned: CLAUDE.md lines 1, 107-113.
- Why: `secrets-env-law` line 8 says it again in its own words.

### C1d Env copies hold full keys, never masks
- Law (8 words or fewer): Env copies hold full keys, never masks.
- OWNER: `.ai/rules/secrets-env-law.md` (after the M4 fold-in)
- Files with actions: `.ai/rules/env-full-copies-never-masked.md` whole file (archive) (D111); `.ai/rules/secrets-env-law.md` 43 (D170); 51 (D172); new text (D174); `docs/rules/RULES-INDEX.md` 85 (D207); 87 (D208).
- Input only, no edits planned: CLAUDE.md lines 256-258, 677.
- Why: `env-full-copies-never-masked` and the Banned table in `secrets-env-law` carry the same bans; each file points at the other. Phase 3 call #28 (no pasted cloud env block) is applied while folding.

### C1e Never rotate, replace or remove a working key
- Law (8 words or fewer): Never rotate, replace or remove a working key.
- OWNER: `.ai/rules/secrets-env-law.md` (new section "Never remove a key", folded from CLAUDE.md)
- Files with actions: `.agents/skills/fundhub-fixer/SKILL.md` 95 (D43); `.ai/rules/features-stay-on.md` 23 (D112); `.ai/rules/no-api-spend-for-now.md` 20 (D140); `.ai/rules/product-is-live.md` 26 (D158); `.ai/rules/secrets-env-law.md` 64 (D173); new text (D175).
- Input only, no edits planned: CLAUDE.md lines 688-708; AGENTS.md line 52.
- Why: The "proven broken right now" test is repeated in six files. "Never remove a key" lives only in CLAUDE.md, and three rules point at it by name, so it needs a rule home before CLAUDE.md is cut.

### C1f Agents run the commands, not Chris
- Law (8 words or fewer): Agents run the commands; Chris decides.
- OWNER: `.ai/rules/agents-run-ops-not-chris.md`
- Files with actions: `.ai/rules/dictator-owner-overrides.md` 16-20 (D108).
- Input only, no edits planned: CLAUDE.md lines 178-182, 264-266; AGENTS.md lines 11, 18.
- Why: `dictator-owner-overrides` lists the same ops as five bullets.

### C2a ClickFunnels is pushed by API; Chris never logs in
- Law (8 words or fewer): ClickFunnels is pushed by API, never pasted.
- OWNER: `.ai/rules/chris-never-clickfunnels.md` (absorbs `clickfunnels-html-api-push`, merge M5)
- Files with actions: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` 25 (D22); 40 (D23); 44 (D24); 47 (D25); 73-75 (D27); 80-83 (D28); `.ai/rules/chris-never-clickfunnels.md` 14 (D98); 18 (D99); 26 (D101); `.ai/rules/clickfunnels-developers-docs.md` 17 (D105); `.ai/rules/clickfunnels-html-api-push.md` whole file (archive) (D106); `docs/rules/RULES-INDEX.md` 123 (D212); 124 (D213); `docs/sops/clickfunnels-custom-html-push.md` 8 (D220); 92 (D222); 117-119 (D223); 123 (D224).
- Input only, no edits planned: CLAUDE.md lines 204-206.
- Why: Three rules, two skills and two SOP pages each say "never paste into the builder as the default" and "report the env name and stop".

### C2b Read the ClickFunnels docs first
- Law (8 words or fewer): Read developers.myclickfunnels.com first; never invent endpoints.
- OWNER: `.ai/rules/clickfunnels-developers-docs.md`
- Files with actions: `.agents/skills/clickfunnels-developers-docs/SKILL.md` 13-28 (D1).
- Input only, no edits planned: CLAUDE.md line 206.
- Why: The skill of the same name is a word-for-word copy of the rule.

### C2c Tracking and the native calendar on pushed pages
- Law (8 words or fewer): Pushed pages carry tracking; the calendar stays native.
- OWNER: `.ai/rules/chris-never-clickfunnels.md` for the laws (after M5). `docs/sops/clickfunnels-custom-html-push.md` for page ids, page types and commands.
- Files with actions: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` 51-56 (D26); `.ai/rules/chris-never-clickfunnels.md` new text (D102); `docs/sops/clickfunnels-custom-html-push.md` 82-84 (D221).
- Input only, no edits planned: none.
- Why: The tracking list and the "never full-replace /funding-book-call" rule appear in the glob rule, the push skill and the SOP. The skill's step table and the SOP's older table also disagree about `/apply` (see Conflicts).

### C2d No logins for any tool an agent can run by API
- Law (8 words or fewer): API only; Chris never logs into tools.
- OWNER: `.ai/rules/chris-never-submagic.md`
- Files with actions: `.ai/rules/chris-never-submagic.md` 16 (D103).
- Input only, no edits planned: CLAUDE.md lines 248-250.
- Why: Line 16 of the rule repeats lines 12-14 of the same file.

### C3a Change only what Chris named
- Law (8 words or fewer): Change only what Chris named; smallest diff.
- OWNER: `.ai/rules/owner-scope-minimal-diff.md`
- Files with actions: `.agents/skills/fundhub-fixer/SKILL.md` 27 (D30); `.ai/rules/owner-scope-minimal-diff.md` 32 (D152).
- Input only, no edits planned: CLAUDE.md lines 115-119, 350-352, 582; AGENTS.md line 40.
- Why: The fixer skill repeats it as prime rule 1.

### C3b Never hunt or fix holes Chris did not name
- Law (8 words or fewer): Never hunt, verify or fix unnamed holes.
- OWNER: `.ai/rules/no-extra-holes.md`
- Files with actions: `.ai/rules/finish-the-answer.md` 20 (D115); 26 (D116); `.ai/rules/named-fix-regression-gate.md` 22 (D136); 27 (D137); `.ai/rules/no-extra-holes.md` new text (D143); `.ai/rules/owner-scope-minimal-diff.md` 22 (D150).
- Input only, no edits planned: CLAUDE.md lines 115-121 (Do not volunteer fixes, Hard lock), 582; AGENTS.md line 40.
- Why: Nine files carry it: `no-extra-holes`, `owner-scope-minimal-diff`, `one-issue-per-thread`, `three-step-repair`, `named-fix-regression-gate`, `finish-the-answer`, the fixer skill, CLAUDE.md and AGENTS.md. This file owns it; the others point here.

### C3c Approved work finishes through its required checks
- Law (8 words or fewer): Approved work finishes through its required checks.
- OWNER: `.ai/rules/finish-the-requested-job.md` (absorbs `approved-launch-release-blockers`, merge M1; also holds the stuck rule and the scope-creep line)
- Files with actions: `.agents/skills/fundhub-fixer/SKILL.md` 29 (D31); 88 (D40); 93 (D42); 97 (D45); `.agents/skills/fundhub-orchestrator/SKILL.md` 42 (D50); 57 (D51); `.ai/rules/approved-launch-release-blockers.md` whole file (archive) (D91); `.ai/rules/finish-the-requested-job.md` 8 (D119); 11 (D120); 16 (D121); 19 (D123); new text (D124); `.ai/rules/named-fix-regression-gate.md` 10 (D135); `.ai/rules/no-extra-holes.md` 12 (D141); `.ai/rules/owner-authorized-account-ops.md` 12 (D146); `.ai/rules/owner-go-no-repeat-approval.md` 15 (D148); `.ai/rules/owner-scope-minimal-diff.md` 26 (D151); `.ai/rules/split-and-proceed.md` 12 (D183); `docs/rules/RULES-INDEX.md` 40 (D199); 41 (D200).
- Input only, no edits planned: CLAUDE.md lines 41-43, 125-127, 580, 586; AGENTS.md lines 23-36, 41.
- Why: The 2026-10-20 rule says "every approved task, not only launches". The stuck rule exists only in CLAUDE.md and in two skills, and Phase 3 calls #12 and #13 amend both; they need one rule home.

### C3d A GO that Chris gave is never asked again
- Law (8 words or fewer): A GO Chris gave is never asked again.
- OWNER: `.ai/rules/owner-go-no-repeat-approval.md` (absorbs `stop-asking-follow-the-rules`, merge M7)
- Files with actions: `.agents/skills/fundhub-orchestrator/SKILL.md` 32 (D48); `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` 126 (D57); `.agents/skills/fundhub-video-animation-overlay/SKILL.md` 101 (D68); `.ai/rules/audit-vs-fix-router.md` 47 (D94); `.ai/rules/finish-the-requested-job.md` 17 (D122); `.ai/rules/owner-go-no-repeat-approval.md` new text (D149); `.ai/rules/page-edits-marked-draft.md` 10 (D153); `.ai/rules/stop-asking-follow-the-rules.md` whole file (archive) (D185); `docs/rules/RULES-INDEX.md` 33 (D197); 39 (D198).
- Input only, no edits planned: CLAUDE.md lines 103-105, 418-420, 431, 440; AGENTS.md line 12.
- Why: Six rules and two skills end with their own copy of "ask only if a missing owner decision blocks the work".

### C3e Ask Chris first only for owner-only decisions
- Law (8 words or fewer): Ask Chris first only for owner-only decisions.
- OWNER: `.ai/rules/finish-the-answer.md` holds the ask-first list; `.ai/rules/finish-the-requested-job.md` holds the stop reasons
- Files with actions: `.ai/rules/agents-run-ops-not-chris.md` 31 (D86); `.ai/rules/features-stay-on.md` 24 (D113); `.ai/rules/finish-the-answer.md` 18 (D114); 28-31 (D117); `.ai/rules/product-is-live.md` 25 (D157); `docs/rules/RULES-INDEX.md` 30 (D196); `docs/sops/RUNBOOK.md` 292-297 (D219).
- Input only, no edits planned: CLAUDE.md lines 71, 182, 647, 731-734; AGENTS.md line 52.
- Why: The list "yes/no, live vs sandbox, delete data except proven test rows and test logins, repoint DATABASE_URL" is typed out in at least eight places. Its full text (the 2026-10-24 exception) lives only in CLAUDE.md section 11.

### C3f Look the fact up; never invent it
- Law (8 words or fewer): Look the fact up; never invent it.
- OWNER: `.ai/rules/finish-the-answer.md` (plus the "Never invent" text folded from CLAUDE.md section 2)
- Files with actions: `.ai/rules/finish-the-answer.md` new text (D118); `.ai/rules/page-edits-marked-draft.md` 21 (D154).
- Input only, no edits planned: CLAUDE.md lines 69-83; AGENTS.md line 43.
- Why: "Look it up" and "never invent" are in CLAUDE.md, AGENTS.md, this rule and `page-edits-marked-draft`.

### C4a One named hole per chat, three steps
- Law (8 words or fewer): One named hole per chat: verify, fix, finish.
- OWNER: `.ai/rules/three-step-repair.md` (absorbs `one-issue-per-thread`, merge M2)
- Files with actions: `.ai/rules/audit-vs-fix-router.md` 51 (D95); 58 (D96); `.ai/rules/named-fix-regression-gate.md` 46 (D139); `.ai/rules/no-extra-holes.md` 37 (D142); `.ai/rules/one-issue-per-thread.md` whole file (archive) (D145); `.ai/rules/three-step-repair.md` 8 (D192); 16-21 (D193); 32 (D194); new text (D195); `docs/rules/RULES-INDEX.md` 45 (D201); 46 (D202).
- Input only, no edits planned: CLAUDE.md lines 354-356.
- Why: Same date (2026-08-26), same owner paragraph and the same sentence "The agent starts that chat from the board prompt; Chris does not have to copy anything."

### C4b A hole is real on live; a fix is real on live
- Law (8 words or fewer): Hole real on live; fix real on live.
- OWNER: `.ai/rules/named-fix-regression-gate.md`
- Files with actions: none under this id.
- Input only, no edits planned: CLAUDE.md lines 358-360.
- Why: The gate itself is only in this rule. Its own repeats of other laws (the Dirty leftover section and two Never bullets) are listed under C3b and C5b.

### C4c Audit and fix are two doors
- Law (8 words or fewer): Never audit and fix in one pass.
- OWNER: `.ai/rules/audit-vs-fix-router.md`
- Files with actions: `.agents/skills/fundhub-fixer/SKILL.md` 92 (D41); `.ai/rules/agentic-audit-guardrails.md` 37-41 (D81).
- Input only, no edits planned: CLAUDE.md lines 362-364.
- Why: `agentic-audit-guardrails` has a whole "Audit vs fix" section, and the fixer skill has a Never bullet.

### C5a Test means live Playwright, then a human click
- Law (8 words or fewer): Live Playwright to 100/100, then the agent clicks.
- OWNER: `.ai/rules/test-means-human-click.md` (absorbs `live-playwright-100-before-manual`, merge M3)
- Files with actions: `.agents/skills/fundhub-auditor/SKILL.md` 54 (D14); `.agents/skills/fundhub-fixer/SKILL.md` 47-49 (D34); `.ai/rules/agentic-audit-guardrails.md` 60-63 (D83); `.ai/rules/full-end-to-end-audit.md` 80 (D130); `.ai/rules/live-playwright-100-before-manual.md` whole file (archive) (D134); `.ai/rules/test-means-human-click.md` 8 (D187); 12-16 (D188); 24 (D189); new text (D191); `docs/rules/RULES-INDEX.md` 62 (D205); 63 (D206).
- Input only, no edits planned: CLAUDE.md lines 178-182, 296-298, 374-376; AGENTS.md lines 15, 49.
- Why: The sentence "Owner override (2026-08-25): do not ask him. Agent walks it. Only if he offers a pass, then he does one." is word for word in three rules.

### C5b Fake e2e emails only; verify stays on scratch
- Law (8 words or fewer): Fake e2e emails only; verify stays on scratch.
- OWNER: `.ai/rules/test-means-human-click.md` line 26 for the emails; `.ai/rules/verify-scratch-only.md` for the harness
- Files with actions: `.agents/skills/fundhub-auditor/SKILL.md` 72-76 (D15); `.agents/skills/fundhub-fixer/SKILL.md` 32 (D33); 61 (D37); `.ai/rules/named-fix-regression-gate.md` 32-33 (D138); `.ai/rules/test-means-human-click.md` 26 (D190).
- Input only, no edits planned: CLAUDE.md lines 334-336, 759.
- Why: The fixer and auditor skills copy the email line and the "Dangerous" line.

### C6a Talk to Chris at a 4th grade level
- Law (8 words or fewer): Talk to Chris at a 4th grade level.
- OWNER: `.ai/rules/fourth-grade-english.md`
- Files with actions: `.agents/skills/fundhub-ad-writer/SKILL.md` 37-40 (D4); `.agents/skills/fundhub-builder/SKILL.md` 18-22 (D16); `.agents/skills/fundhub-fixer/SKILL.md` 19-23 (D29); 65-66 (D38); `.agents/skills/fundhub-orchestrator/SKILL.md` 12-16 (D46); `.ai/rules/fourth-grade-english.md` 14 (D125).
- Input only, no edits planned: CLAUDE.md lines 196-198, 628-638; AGENTS.md line 14.
- Why: Three skills say "Third or fourth grade" word for word. The rule says 4th grade and wins.

### C6b A handoff is never a refusal
- Law (8 words or fewer): A handoff is never a refusal.
- OWNER: `.ai/rules/fourth-grade-english.md` (new section folded from the three skills)
- Files with actions: `.agents/skills/fundhub-builder/SKILL.md` 26-34 (D17); 75-77 (D21); `.agents/skills/fundhub-fixer/SKILL.md` 76-84 (D39); 96 (D44); `.agents/skills/fundhub-orchestrator/SKILL.md` 20-28 (D47); 38 (D49); `.ai/rules/fourth-grade-english.md` new text (D126).
- Input only, no edits planned: none.
- Why: The same "Language - never a refusal" block, with the same three example sentences, is in the builder, fixer and orchestrator skills. It has no rule home.

### C7a Animations land on his words, never on his face
- Law (8 words or fewer): Animations land on his words, never his face.
- OWNER: `.ai/rules/animation-overlay-on-spoken-words.md` (absorbs `animation-ad-style`, merge M8)
- Files with actions: `.agents/skills/fundhub-video-animation-overlay/SKILL.md` 31-41 (D63); 45 (D64); 48 (D65); 56 (D66); `.ai/rules/animation-ad-style.md` whole file (archive) (D87); `.ai/rules/animation-overlay-on-spoken-words.md` 14 (D88); 15 (D89); new text (D90); `docs/rules/RULES-INDEX.md` 114 (D210); 115 (D211).
- Input only, no edits planned: CLAUDE.md lines 224-226, 318-320.
- Why: The face rule is written in both rules, twice in the skill and twice in CLAUDE.md. The skill's "What Chris wants on screen" block is a copy of `animation-ad-style`.

### C7b Animation words never repeat his sentence
- Law (8 words or fewer): Animation words never repeat his sentence.
- OWNER: `.ai/rules/animation-no-echo.md`
- Files with actions: `.agents/skills/fundhub-video-animation-overlay/SKILL.md` 64 (D67).
- Input only, no edits planned: CLAUDE.md lines 232-234.
- Why: Skill lines 39, 40 and 64 restate it.

### C7c Opus builds animations; Sonnet places them
- Law (8 words or fewer): Opus builds animations; Sonnet only places them.
- OWNER: `.ai/rules/animation-builders-opus-placers-sonnet.md`
- Files with actions: none under this id.
- Input only, no edits planned: CLAUDE.md lines 56, 228-230.
- Why: Skill line 41 restates it. `model-by-job` and `no-claude-in-cursor` already point at the rule. No edit to the rule.

### C7d The logo plays only on the word Fundhub
- Law (8 words or fewer): The logo plays only on the word Fundhub.
- OWNER: `.ai/rules/animation-logo-only-on-fundhub.md`
- Files with actions: none under this id.
- Input only, no edits planned: CLAUDE.md lines 314-316.
- Why: Skill line 70 is already a pointer. No edit.

### C8a Every teleprompter take is a hard 30 fps
- Law (8 words or fewer): Every take is a hard 30 fps.
- OWNER: `.ai/rules/teleprompter-camera.md`
- Files with actions: `docs/rules/TELEPROMPTER-VIDEO.md` 5 (D214); 13 (D215).
- Input only, no edits planned: AGENTS.md line 61; CLAUDE.md lines 154-156.
- Why: `docs/rules/TELEPROMPTER-VIDEO.md` restates the sizes, 60 fps and the mirror.

### C8b Teleprompter acceptance checklist
- Law (8 words or fewer): Teleprompter acceptance: queue, recover, prove on iPhone.
- OWNER: `docs/rules/TELEPROMPTER-VIDEO.md` (after the fold-in from AGENTS.md)
- Files with actions: `docs/rules/TELEPROMPTER-VIDEO.md` new text (D216).
- Input only, no edits planned: AGENTS.md lines 55-67.
- Why: RULES-INDEX calls TELEPROMPTER-VIDEO.md "the teleprompter acceptance checklist", but the checklist itself exists only in AGENTS.md.

### C8c Teleprompter speed is held to 130-320 words a minute
- Law (8 words or fewer): Teleprompter speed stays between 130 and 320.
- OWNER: `.ai/rules/teleprompter-speed.md`
- Files with actions: none under this id.
- Input only, no edits planned: CLAUDE.md lines 150-152.
- Why: No other AI instruction file restates the numbers. `teleprompter-camera` line 10 already points at it. No edit.

### C9a Every finished video is -14 LUFS
- Law (8 words or fewer): Every finished video is -14 LUFS.
- OWNER: `.ai/rules/ad-sound-level.md`
- Files with actions: `.agents/skills/fundhub-video-animation-overlay/SKILL.md` 27 (D62).
- Input only, no edits planned: CLAUDE.md lines 310-312.
- Why: The rule says it is "the one source for the numbers". Two skills restate the numbers.

### C9b Film 4K unless it is a paid ad
- Law (8 words or fewer): Film 4K unless it is a paid ad.
- OWNER: `.ai/rules/video-4k-unless-ad.md`
- Files with actions: `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` 99-102 (D56); `.ai/rules/teleprompter-camera.md` 15 (D186).
- Input only, no edits planned: CLAUDE.md lines 216-218; AGENTS.md line 61.
- Why: Five files restate the sizes and the testimonial-card exception. Phase 3 call #34 asks for the exception sentence in each; the pointer carries it.

### C9c Submagic does captions and clean audio only
- Law (8 words or fewer): Submagic does captions only; B-roll is ours.
- OWNER: `.ai/rules/ad-video-best-of-clips.md` for the job; `.ai/rules/chris-never-submagic.md` for the login
- Files with actions: `.agents/skills/fundhub-ad-editor/SKILL.md` 9 (D2); 65-66 (D3); `.ai/rules/ad-video-best-of-clips.md` 36 (D75).
- Input only, no edits planned: CLAUDE.md lines 236-238, 322-324.
- Why: Phase 3 call #36 edits the same sentence in the ad-editor skill.

### C9d Filmed SLO video lives in one folder
- Law (8 words or fewer): Filmed SLO video lives in one folder.
- OWNER: `.ai/rules/slo-one-filmed-folder.md`
- Files with actions: `.ai/rules/slo-one-filmed-folder.md` 10 (D181); `marketing/ads/NAMING.md` 126 (D227).
- Input only, no edits planned: CLAUDE.md lines 244-246; AGENTS.md line 65.
- Why: NAMING.md line 126 and AGENTS.md line 65 restate it; the rule repeats its own Direct Book sentence.

### C10a Drive ad file names
- Law (8 words or fewer): Drive ad names: Offer, Ad number, Angle, Take.
- OWNER: `marketing/ads/NAMING.md` holds the detail; `.ai/rules/ad-naming.md` keeps one short statement
- Files with actions: `.ai/rules/ad-naming.md` 18-21 (D70); 23 (D71); 29-33 (D72); `marketing/ads/NAMING.md` 5 (D225); 29 (D226).
- Input only, no edits planned: CLAUDE.md lines 240-242.
- Why: The rule already says "The book is marketing/ads/NAMING.md", so the table, the "same angle" sentence and the wrong-names list stay in the book. `src/ad-videos/merge-takes.test.mjs` and `src/marketing/shoot-plan.test.mjs` parse the book's tables.

### C10b Sentence two of an ad
- Law (8 words or fewer): Sentence two of an ad does one job.
- OWNER: `marketing/ads/SECOND-LINE.md` holds the detail; `.ai/rules/ad-second-line.md` keeps one short statement
- Files with actions: `.ai/rules/ad-second-line.md` 12-33 (D74).
- Input only, no edits planned: CLAUDE.md lines 302-304.
- Why: Every item in the rule is also in the book. The two "What to fix" bullets are word for word.

### C10c Reading the Meta watch curve
- Law (8 words or fewer): Fix the opening when most plays miss 25%.
- OWNER: `marketing/ads/curve-optimization.md` holds the diagnosis; `marketing/ads/watch-curve.md` holds the definitions, columns and the dying ping; `.ai/rules/ad-watch-curve.md` keeps one short statement
- Files with actions: `.ai/rules/ad-watch-curve.md` 12-16 (D76); 28 (D77); 32-33 (D78); `marketing/ads/curve-optimization.md` 7-16 (D230); `marketing/ads/watch-curve.md` 3 (D233); 35 (D234); 57-61 (D235); 65 (D236).
- Input only, no edits planned: CLAUDE.md lines 268-270.
- Why: Meta's definitions are in the rule, watch-curve.md and curve-optimization.md. The hop (tap-through) test is defined once in curve-optimization.md, and `src/ops/watch-curve.mjs` cites it there.

### C11a Scripts speak with certainty
- Law (8 words or fewer): Scripts state everything with certainty.
- OWNER: `.ai/rules/copy-certainty.md`
- Files with actions: `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` 59-63 (D55); `marketing/ads/notes-green-screen.md` 326-333 (D231).
- Input only, no edits planned: CLAUDE.md lines 284-286.
- Why: RULES.md Part 0 rule 19 and the Copy rules block of `notes-green-screen.md` restate it; the testimonial skill restates the banned words. The ad-writer skill (line 16) already names `copy-certainty` as a newer law, so it needs no edit.

### C11b Say next funding sequence, never round two
- Law (8 words or fewer): Say next funding sequence, never round two.
- OWNER: `.ai/rules/funding-sequence-term.md`
- Files with actions: `marketing/ads/notes-green-screen.md` 336 (D232).
- Input only, no edits planned: CLAUDE.md lines 402-404.
- Why: RULES.md Part 0 rule 9 and `notes-green-screen.md` line 336 restate it.

### C11c Ads are found by id, not by name
- Law (8 words or fewer): Ads are found by id, not name.
- OWNER: `.ai/rules/ad-naming.md` (new section folded from CLAUDE.md section 3c)
- Files with actions: `.agents/skills/fundhub-ad-writer/SKILL.md` 51-56 (D5); 136 (D6); 141 (D7); `.ai/rules/ad-naming.md` new text (D73); `docs/rules/RULES-INDEX.md` 99 (D209); `marketing/ads/README.md` 9 (D228); `marketing/ads/WRITE-ADS-FROM-HERE.md` 40-43 (D229).
- Input only, no edits planned: CLAUDE.md line 477.
- Why: The law is in CLAUDE.md, the ad-writer skill (twice), `WRITE-ADS-FROM-HERE.md` and the ads README. It has no rule home.

### C12 Every new live thing gets a heartbeat row
- Law (8 words or fewer): Every new live thing gets a heartbeat row.
- OWNER: `.ai/rules/heartbeat-on-every-build.md`
- Files with actions: none under this id.
- Input only, no edits planned: CLAUDE.md lines 292-300; AGENTS.md line 44.
- Why: `pulse-registry` is a one-line pointer (Phase 3 archives it). `docs/journeys/heartbeat-flow.md` already points at the rule on line 4 and is the picture; it needs no edit. `src/pulse/heartbeat-law.test.mjs` reads the rule and needs the words "3 times its schedule".

### C13a Full End-To-End Audit: two questions, then walk
- Law (8 words or fewer): Full End-To-End Audit: two questions, then walk.
- OWNER: `.ai/rules/full-end-to-end-audit.md`
- Files with actions: `.agents/skills/fundhub-auditor/SKILL.md` 17 (D12); `.ai/rules/agentic-audit-guardrails.md` 33 (D80); 64 (D84); `.ai/rules/audit-vs-fix-router.md` 14 (D92); 38 (D93).
- Input only, no edits planned: CLAUDE.md lines 13-17, 366-368; AGENTS.md line 7.
- Why: Its "beats the split" rule is restated in five files.

### C13b Sims and audit hard stops
- Law (8 words or fewer): Sims: plus-tag email, agent phone, no live pulls.
- OWNER: `.ai/rules/agentic-audit-guardrails.md`
- Files with actions: `.agents/skills/fundhub-agent-tester/SKILL.md` 30-31 (D8); 63-68 (D9); 86 (D10); 131 (D11); `.agents/skills/fundhub-repo-hygiene/SKILL.md` 71 (D54); `.ai/rules/agentic-audit-guardrails.md` 26 (D79); `.ai/rules/full-end-to-end-audit.md` 25 (D127); 63 (D128); 74 (D129); 86 (D131); `.ai/rules/product-is-live.md` 27 (D159); `.ai/rules/sim-assume-paid.md` 14 (D180).
- Input only, no edits planned: CLAUDE.md lines 370-372.
- Why: The agent phone number is written in two formats in four files; the hard-stop list is in the guardrails, `full-end-to-end-audit`, `sim-assume-paid`, `product-is-live` and the agent-tester skill.

### C14a Push only main and branches headed to a PR
- Law (8 words or fewer): Push only main and PR branches.
- OWNER: `.ai/rules/github-push.md`
- Files with actions: `.ai/rules/agents-run-ops-not-chris.md` 14 (D85).
- Input only, no edits planned: CLAUDE.md lines 139-148; AGENTS.md line 51.
- Why: `agents-run-ops-not-chris` line 14 repeats it.

### C14b Commit locally, every session
- Law (8 words or fewer): Commit locally in the same session, every time.
- OWNER: `.ai/rules/github-push.md` (new section folded from CLAUDE.md)
- Files with actions: `.agents/skills/fundhub-version-control/SKILL.md` 13 (D59); 49 (D61); `.ai/rules/github-push.md` new text (D133); `.ai/rules/repo-hygiene-vc-router.md` 15 (D160).
- Input only, no edits planned: CLAUDE.md lines 133-137.
- Why: Two skills and a router rule restate it, and the law itself exists only in CLAUDE.md.

### C14c A cloud session needs only GitHub
- Law (8 words or fewer): A cloud session needs only GitHub.
- OWNER: `.ai/rules/github-ships-main.md`
- Files with actions: `.ai/rules/no-remote-control.md` 16-17 (D144).
- Input only, no edits planned: CLAUDE.md lines 158-160; AGENTS.md line 51.
- Why: `no-remote-control` says it again (Phase 3 call #9).

### C15a The product is live; INNGEST_EVENT_KEY stays on
- Law (8 words or fewer): Product is live; INNGEST_EVENT_KEY stays on.
- OWNER: `.ai/rules/product-is-live.md` (plus the extra sentences folded from CLAUDE.md section 11)
- Files with actions: `.ai/rules/agentic-audit-guardrails.md` 49 (D82); `.ai/rules/product-is-live.md` 14 (D155).
- Input only, no edits planned: CLAUDE.md lines 326-328, 736-740; AGENTS.md line 52.
- Why: Said again in `features-stay-on`, `agentic-audit-guardrails` and RUNBOOK.md.

### C15b Plaid payouts stay in test mode
- Law (8 words or fewer): Plaid payouts stay in test mode.
- OWNER: `.ai/rules/owner-calls-settled.md`
- Files with actions: `.ai/rules/owner-calls-settled.md` 13 (D147); `.ai/rules/product-is-live.md` 20 (D156).
- Input only, no edits planned: CLAUDE.md lines 410-412.
- Why: `product-is-live` and `features-stay-on` repeat the fact.

### C15c Never put a live integration in demo mode
- Law (8 words or fewer): Never put a live integration in demo mode.
- OWNER: `.ai/rules/product-is-live.md`
- Files with actions: `.agents/skills/fundhub-auditor/SKILL.md` 27 (D13); `.agents/skills/fundhub-fixer/SKILL.md` 31 (D32).
- Input only, no edits planned: none.
- Why: Prime rule 5 of the fixer and prime rule 2 of the auditor are copies.

### C16 A rule lives once; every older line is rewritten
- Law (8 words or fewer): A rule lives in one home.
- OWNER: `.ai/rules/rules-no-drift.md` (absorbs `rules-for-claude-and-cursor`, merge M6)
- Files with actions: `.ai/README.md` 15 (D69); `.ai/rules/rules-for-claude-and-cursor.md` whole file (archive) (D162); `.ai/rules/rules-no-drift.md` 8 (D163); 14 (D164); 14 (D165); 20-24 (D166); 26 (D167); `docs/rules/RULES-INDEX.md` 51 (D203); 52 (D204).
- Input only, no edits planned: CLAUDE.md lines 188-190, 422-424.
- Why: Both rules say "write it once in .ai/rules, link it twice, add the CLAUDE.md line, add the index row". `.ai/README.md` repeats the steps as commands.

### C17 Split the work first, then proceed
- Law (8 words or fewer): Split the work first, then proceed.
- OWNER: `.ai/rules/split-and-proceed.md` (the full text of CLAUDE.md section 0 is folded in)
- Files with actions: `.ai/rules/audit-vs-fix-router.md` 66 (D97); `.ai/rules/split-and-proceed.md` 9 (D182); new text (D184).
- Input only, no edits planned: CLAUDE.md lines 13-39; AGENTS.md line 7; `.ai/rules/one-step-adhd.md` line 18.
- Why: The rule is the 7-line short form; the five-item required output and the cannot-be-split paragraph exist only in CLAUDE.md.

### C18a Screens ship four states; speed budgets are law
- Law (8 words or fewer): Screens ship four states; speed budgets are law.
- OWNER: `docs/rules/UI-STANDARDS.md` section 6 and `docs/rules/PERF-STANDARDS.md` section 1
- Files with actions: `.agents/skills/fundhub-builder/SKILL.md` 56 (D18); 59 (D19); 60 (D20); `.agents/skills/fundhub-perf-auditor/SKILL.md` 14 (D52); `.agents/skills/fundhub-ui-auditor/SKILL.md` 41 (D58).
- Input only, no edits planned: none.
- Why: The builder skill copies both. The numbers must live in one place.

### C18b Review screenshots carry numbered red circles
- Law (8 words or fewer): Review screenshots carry numbered red circles.
- OWNER: `.ai/rules/audit-screenshot-markups.md`
- Files with actions: `docs/rules/UI-STANDARDS.md` 231 (D217).
- Input only, no edits planned: CLAUDE.md line 610; AGENTS.md line 45.
- Why: UI-STANDARDS.md line 231 still says "a red box"; Phase 3 call #45 chose numbered circles and yellow arrows.

## Merges

Eight merges. In each, the survivor keeps its name and path. Every merged-away file is archived (not deleted) to `ops/archive/ai-instructions-2026-10-24/rules/<name>.md`, and its two links (`.cursor/rules/<name>.mdc`, `.claude/rules/<name>.md`) are removed. A merge is all or nothing: its fold-ins, its archive, its pointer changes and its index rows go together. Merges do not depend on each other, except that M8 goes before the animation skill edits.

### M1 `approved-launch-release-blockers` into `finish-the-requested-job`
- Why one law: `finish-the-requested-job` (2026-10-20) says it applies to "every approved execution task, not only launches". `approved-launch-release-blockers` (2026-10-17) is the launch case of the same law. phase-3-decisions.md already archives it and says to fold anything unique first.
- Survivor: `.ai/rules/finish-the-requested-job.md`. Merged away: `.ai/rules/approved-launch-release-blockers.md`.
- Fold first (the text is in each action): D119, D120, D121, D123.
- Edits inside the survivor that go with the merge: D122.
- Other files whose pointers change: `.ai/rules/named-fix-regression-gate.md`, `.ai/rules/no-extra-holes.md`, `.ai/rules/owner-scope-minimal-diff.md` (actions D135, D141, D151).
- Then archive the merged-away file: D91.
- Index rows in docs/rules/RULES-INDEX.md: D199, D200.
- Front matter: none (the survivor's description already fits).
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 127 and AGENTS.md line 41 still name the merged-away rule. Retarget them to `finish-the-requested-job`.

### M2 `one-issue-per-thread` into `three-step-repair`
- Why one law: Same date (2026-08-26), same owner paragraph, same sentence "The agent starts that chat from the board prompt; Chris does not have to copy anything." CLAUDE.md line 354 already treats them as one law ("One hole, three steps").
- Survivor: `.ai/rules/three-step-repair.md`. Merged away: `.ai/rules/one-issue-per-thread.md`.
- Fold first (the text is in each action): D192, D193, D195.
- Edits inside the survivor that go with the merge: D194.
- Other files whose pointers change: `.ai/rules/audit-vs-fix-router.md`, `.ai/rules/named-fix-regression-gate.md`, `.ai/rules/no-extra-holes.md` (actions D95, D139, D142).
- Then archive the merged-away file: D145.
- Index rows in docs/rules/RULES-INDEX.md: D201, D202.
- Front matter: none (the survivor's description already says one hole per chat).
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 356 still names the merged-away rule. Retarget it to `three-step-repair`.

### M3 `live-playwright-100-before-manual` into `test-means-human-click`
- Why one law: Each file points at the other, and "Owner override (2026-08-25): do not ask him. Agent walks it. Only if he offers a pass, then he does one." is word for word in both and in `agentic-audit-guardrails`. The survivor is the older base law (2026-08-16) and its name matches Chris's trigger word "test".
- Survivor: `.ai/rules/test-means-human-click.md`. Merged away: `.ai/rules/live-playwright-100-before-manual.md`.
- Fold first (the text is in each action): D187, D188, D191.
- Edits inside the survivor that go with the merge: D189.
- Other files whose pointers change: `.agents/skills/fundhub-fixer/SKILL.md` (actions D34).
- Then archive the merged-away file: D134.
- Index rows in docs/rules/RULES-INDEX.md: D205, D206.
- Front matter: change the survivor's description to: "When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person"; keep `alwaysApply: true`.
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 376 still names the merged-away rule (lines 296-298 already name the survivor). Retarget it to `test-means-human-click`.

### M4 `env-full-copies-never-masked` into `secrets-env-law`
- Why one law: The Banned table and the "Netlify --secret - tightened" section of `secrets-env-law` already carry the mask and --secret bans, and the two files point at each other. Apply Phase 3 call #28 while folding.
- Survivor: `.ai/rules/secrets-env-law.md`. Merged away: `.ai/rules/env-full-copies-never-masked.md`.
- Fold first (the text is in each action): D174.
- Edits inside the survivor that go with the merge: D170, D172.
- Other files whose pointers change: none.
- Then archive the merged-away file: D111.
- Index rows in docs/rules/RULES-INDEX.md: D207, D208.
- Front matter: none (the survivor's description already fits).
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 258 still names the merged-away rule. Retarget it to `secrets-env-law`.

### M5 `clickfunnels-html-api-push` into `chris-never-clickfunnels`
- Why one law: Items 1 to 3 and 7 of the glob rule are lines that `chris-never-clickfunnels` already holds, apart from three small facts the fold-in adds (the Netlify and database sources for the key, the manual-paste exception, and "no pay, no SSN, no live CRS"). Items 4 to 6 are the only new laws and move over.
- Survivor: `.ai/rules/chris-never-clickfunnels.md`. Merged away: `.ai/rules/clickfunnels-html-api-push.md`.
- Fold first (the text is in each action): D98, D99, D101, D102.
- Other files whose pointers change: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md`, `docs/sops/clickfunnels-custom-html-push.md` (actions D24, D25, D223).
- Then archive the merged-away file: D106.
- Index rows in docs/rules/RULES-INDEX.md: D212, D213.
- Front matter: the survivor is already `alwaysApply: true`, so the glob `marketing/landing-pages/**` simply goes away; change the description to: "Chris never logs into ClickFunnels admin: agents push funnel HTML by API (Custom HTML Pages) and prove it live".
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 206 still names the merged-away rule. Retarget it to `chris-never-clickfunnels`.

### M6 `rules-for-claude-and-cursor` into `rules-no-drift`
- Why one law: Steps 1 and 3 of `rules-no-drift` repeat the layout bullets of `rules-for-claude-and-cursor`, and `rules-no-drift` says it "keeps them that way". The skills block and two Never bullets of the old rule are the only new text.
- Survivor: `.ai/rules/rules-no-drift.md`. Merged away: `.ai/rules/rules-for-claude-and-cursor.md`.
- Fold first (the text is in each action): D163, D164, D166, D167.
- Edits inside the survivor that go with the merge: D165.
- Other files whose pointers change: `.ai/README.md` (actions D69).
- Then archive the merged-away file: D162.
- Index rows in docs/rules/RULES-INDEX.md: D203, D204.
- Front matter: change the survivor's description to: "A rule or skill is written once, linked for Claude and Cursor; a new rule updates every line that says otherwise and the index".
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 190 still names the merged-away rule. Retarget it to `rules-no-drift` (line 424 already names the survivor).

### M7 `stop-asking-follow-the-rules` into `owner-go-no-repeat-approval`
- Why one law: Both come from Chris saying "stop asking me" (2026-10-19 and 2026-10-23). The bullet "ask only for a decision only he can make" is already line 15 of the survivor. The rest of the old rule (make the choice a rule already settles; no "keep all or drop?" question) moves over.
- Survivor: `.ai/rules/owner-go-no-repeat-approval.md`. Merged away: `.ai/rules/stop-asking-follow-the-rules.md`.
- Fold first (the text is in each action): D149.
- Other files whose pointers change: `.ai/rules/audit-vs-fix-router.md` (actions D94).
- Then archive the merged-away file: D185.
- Index rows in docs/rules/RULES-INDEX.md: D197, D198.
- Front matter: change the survivor's description to: "Carry authorized work through without repeated approval questions, and make the choice a rule already settles".
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md lines 420 and 440 still name the merged-away rule. Retarget them to `owner-go-no-repeat-approval`.

### M8 `animation-ad-style` into `animation-overlay-on-spoken-words`
- Why one law: `animation-ad-style` says it "joins animation-overlay-on-spoken-words". The face rule is written in both rules. Apply Phase 3 calls #37 and #38 inside the merged file (their wording is in the fold-in text), and do this merge before the animation skill edits.
- Survivor: `.ai/rules/animation-overlay-on-spoken-words.md`. Merged away: `.ai/rules/animation-ad-style.md`.
- Fold first (the text is in each action): D90.
- Edits inside the survivor that go with the merge: D89.
- Other files whose pointers change: `.agents/skills/fundhub-video-animation-overlay/SKILL.md` (actions D63, D64, D66).
- Then archive the merged-away file: D87.
- Index rows in docs/rules/RULES-INDEX.md: D210, D211.
- Front matter: change the survivor's description to: "See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear".
- Phase 5 stage (CLAUDE.md and AGENTS.md are input only): CLAUDE.md line 320 still names the merged-away rule. Retarget it to `animation-overlay-on-spoken-words`.

## Actions by file

Kinds: REPEAT (same instruction said again: replace with the pointer or delete), EXACT COPY (word for word: delete), FOLD IN (text the owner file gains before any repeat is removed), MERGED INTO (archive the whole file), POINTER TO (change a pointer that would dangle), and one-line edits.

### .agents/skills/clickfunnels-developers-docs/SKILL.md

- D1 | lines 13-28 ("Law") | REPEAT of cluster C2b | replace with the pointer: "Law: clickfunnels-developers-docs (.ai/rules/clickfunnels-developers-docs.md) - open https://developers.myclickfunnels.com/ before any ClickFunnels answer, never invent endpoints, never default to builder paste." | note: the whole body after the title is a copy of the rule (Law, Never, and a 'Same law lives in' line). Keep the front matter and the title; the pointer stands in for the body. Codex reads skills, not rules, so the pointer keeps the point in words

### .agents/skills/fundhub-ad-editor/SKILL.md

- D2 | line 9 ("Submagic only does captions") | REPEAT of cluster C9c | replace with the pointer: "Law: ad-video-best-of-clips (.ai/rules/ad-video-best-of-clips.md) - B-roll is only our own animations and screen recordings, never Submagic B-roll." | note: replace only the second sentence 'B-roll is only our own animations and screen recordings, never Submagic B-roll (owner-set 2026-10-24).' The first sentence is Phase 3 call #36
- D3 | lines 65-66 ("-14 LUFS loudness") | REPEAT of cluster C9c | replace with the pointer: "Law: ad-sound-level (.ai/rules/ad-sound-level.md) - every finished video is -14 LUFS with true peak at or under -1.5 dB; measure again after Submagic." | note: keep the heading

### .agents/skills/fundhub-ad-writer/SKILL.md

- D4 | lines 37-40 ("4th grade reading level") | REPEAT of cluster C6a | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level; the ad script itself is written at a 5th grade level." | note: keep the heading
- D5 | lines 51-56 ("3. **You never name an ad.**") | REPEAT of cluster C11c | replace with the pointer: "Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the number in utm_content; only Chris names an ad; a blank title is never a defect." | note: keep the number 3 and the bold label; drop the long quote (it is now in the rule)
- D6 | line 136 ("Never invent an ad title") | REPEAT of cluster C11c | replace with the pointer: "Law: ad-naming (.ai/rules/ad-naming.md) - only Chris names an ad; never invent a title."
- D7 | line 141 ("Never add a page, tab, or menu row") | REPEAT of .agents/skills/fundhub-ad-writer/SKILL.md lines 57-58 (prime rule 4) | delete | note: within-file copy; delete the Never bullet

### .agents/skills/fundhub-agent-tester/SKILL.md

- D8 | lines 30-31 ("Do not ask Chris to listen") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - sims use plus-tag emails and the one agent phone; no live credit pull, card charge, bureau mail or personal prove phone." | note: keep 'Do not ask Chris to listen.' as the skill's own sentence
- D9 | lines 63-68 ("Sim identity") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - sim email is plus-tag (+sim-...@ or e2e+...@); the phone is the one agent phone; never Chris's personal prove phone or a real client's file." | note: keep line 70 (fill prompt placeholders from the sim's survey only), it is the skill's own
- D10 | line 86 ("Do not send extra SMS") | REPEAT of this file's line 30 | keep 'Do not send extra SMS.' and delete the rest of the sentence ('Do not charge a card. Do not live CRS. Do not paper mail.'); it repeats line 30
- D11 | line 131 ("Use a real client") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - no real client, real card, live credit pull or paper mail in an agent test."

### .agents/skills/fundhub-auditor/SKILL.md

- D12 | line 17 ("**Not this skill:**") | REPEAT of cluster C13a | replace with the pointer: "Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - on 'Full End-To-End Audit' skip the split, ask the two gate questions, then walk every live path; this read-only skill does not apply."
- D13 | line 27 ("2. **Never put a live production") | REPEAT of cluster C15c | replace with the pointer: "Law: product-is-live (.ai/rules/product-is-live.md) - never put a live production integration into demo, mock or sandbox mode; if a check seems to need that, stop and ask."
- D14 | line 54 ("Preferred") | REPEAT of cluster C5a | replace with the pointer: "Law: test-means-human-click (.ai/rules/test-means-human-click.md) - the agent or CI runs Playwright; Chris does not run it and does no QA."
- D15 | lines 72-76 ("Fake e2e emails only") | REPEAT of cluster C5b | replace with the pointer: "Law: test-means-human-click (.ai/rules/test-means-human-click.md) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); never print passwords." | note: line 73 'Never production client records' stays. Line 75 (credentials) becomes: 'Law: secrets-env-law (.ai/rules/secrets-env-law.md) - credentials come from gitignored .env / Netlify env only.' Line 76 becomes: 'Law: verify-scratch-only (.ai/rules/verify-scratch-only.md) - never run verify:e2e or the scratch harness against the live database.'

### .agents/skills/fundhub-builder/SKILL.md

- D16 | lines 18-22 ("Third or fourth grade") | REPEAT of cluster C6a | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level: short words and sentences, no jargon, no status codes, no cryptic shorthand." | note: keep the heading; the two paragraphs under it become the pointer
- D17 | lines 26-34 ("Never phrase a handoff") | REPEAT of cluster C6b | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, for example 'This needs new code, so I'm building it now.'" | note: keep the heading; the intro, the three example sentences and the closing paragraph become the pointer
- D18 | line 56 ("- **Four states or it is not done:**") | REPEAT of cluster C18a | replace with the pointer: "Law: UI-STANDARDS section 6 (docs/rules/UI-STANDARDS.md) - every screen ships four states: loading, empty, error and full." | note: docs/rules/UI-STANDARDS.md section 6 is the owner
- D19 | line 59 ("- **Shared stylesheet") | REPEAT of cluster C18a | replace with the pointer: "Law: PERF-STANDARDS section 2 (docs/rules/PERF-STANDARDS.md) - one shared stylesheet and design tokens; an inline style= attribute is a finding."
- D20 | line 60 ("- **Budgets are law") | REPEAT of cluster C18a | replace with the pointer: "Law: PERF-STANDARDS section 1 (docs/rules/PERF-STANDARDS.md) - every new screen meets the speed budgets there, measured on mobile, Slow 4G, 4x CPU." | note: the numbers (2.0 s, 2.5 s, 1.5 s) stay only in PERF-STANDARDS.md
- D21 | lines 75-77 ("Tell Chris what is going on") | REPEAT of cluster C6b | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, never 'will not be built,' 'BLOCKED' or 'cannot.'" | note: replace only the last sentence ('Never "will not be built", "BLOCKED", or "cannot".'); keep 'Tell Chris what is going on in plain English. What you built. What still needs data (name what is missing). What you have not checked yet.'

### .agents/skills/fundhub-clickfunnels-html-push/SKILL.md

- D22 | line 25 ("If") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - if CLICKFUNNELS_API_KEY is missing after checking .env, Netlify and the database, report the env name and stop; never ask Chris to paste it." | note: the 'Do not rotate keys unless a known-good API call returns 401' clause is the secrets-env-law rule; add 'Law: secrets-env-law ...' as a second short pointer
- D23 | line 40 ("A **Custom HTML Page**") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - a Custom HTML page replaces the whole step, so never full-replace /funding-book-call; inject tracking only."
- D24 | line 44 ("/funding-book-call") | REPEAT of .ai/rules/chris-never-clickfunnels.md (after the M5 fold-in, funding-book-call bullet) | delete | merge M5 | note: delete this table row. Leave rows 45 and 46 for the stale-text pass (the /apply row disagrees with docs/sops/clickfunnels-custom-html-push.md line 52)
- D25 | line 47 ("$297 `slo-02-booking`") | REPEAT of .ai/rules/chris-never-clickfunnels.md (after the M5 fold-in, $297 bullet) | delete | merge M5 | note: delete this table row
- D26 | lines 51-56 ("[ ] `https://fundhub.ai/funnel/fh-attribution.js`") | REPEAT of cluster C2c | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - tracking goes on every pushed page: fh-attribution.js everywhere, vsl-watch-beacon.js on watch only, Meta pixel, no duplicate UTM fragment." | note: keep the checkbox form if the skill wants a checklist, but each box points at the rule; the two unique bullets (no invented CAPI, no field-capture trackers on pull/SSN pages) are folded into the rule first
- D27 | lines 73-75 ("View-source live URLs") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - prove every push by view-source on the live URL; no pay, no SSN, no live CRS." | note: keep line 76 ('Do not npm run ship for /roadmap unless you changed those files'), it is this skill's own
- D28 | lines 80-83 ("Default answer") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - never default to paste-in-the-editor, never print keys, never full-replace /funding-book-call." | note: the last bullet 'Mint Commas products or restyle public/app/' becomes: 'Law: commas-catalog-hands-off (.ai/rules/commas-catalog-hands-off.md) - never add, rename or edit a Commas product.'

### .agents/skills/fundhub-fixer/SKILL.md

- D29 | lines 19-23 ("Third or fourth grade") | REPEAT of cluster C6a | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level: short words and sentences, no jargon, no status codes, no cryptic shorthand." | note: keep the heading; the two paragraphs under it become the pointer
- D30 | line 27 ("1. **Only what he named.**") | REPEAT of cluster C3a | replace with the pointer: "Law: owner-scope-minimal-diff (.ai/rules/owner-scope-minimal-diff.md) - change only what Chris named; no drive-by renames, refactors, dependency bumps or 'while I was in there.'"
- D31 | line 29 ("3. **Stuck rule.**") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - two failed tries of one fix mean change the fix, never a third try; keep going with a different fix until a stop reason applies." | note: keep the rest of the line (new code -> Builder; missing database value -> say it in plain English; judgment call -> Chris). Phase 3 call #12 asks this same edit
- D32 | line 31 ("5. **Never put a live production integration") | REPEAT of cluster C15c | replace with the pointer: "Law: product-is-live (.ai/rules/product-is-live.md) - never put a live production integration into demo, mock or sandbox mode; unit-test fakes inside src/** tests are fine." | note: keep the second half of the line ('Unit-test fake fetchImpl ... is fine') inside the pointer or as the skill's own sentence
- D33 | line 32 ("**Fake e2e emails only:**") | REPEAT of cluster C5b | replace with the pointer: "Law: test-means-human-click (.ai/rules/test-means-human-click.md) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); outbound prove sends go to Chris or prove addresses only; never print passwords." | note: also delete the clause 'Never ask him to paste a key that is already in .env or Netlify' and write: 'Law: secrets-env-law (.ai/rules/secrets-env-law.md) - read keys from .env; never ask Chris to paste one that is already set.'
- D34 | lines 47-49 ("2. Live Playwright") | REPEAT of cluster C5a | replace with the pointer: "Law: test-means-human-click (.ai/rules/test-means-human-click.md) - live Playwright to 100/100, then the agent walks the live path like a person; Chris does no manual pass unless he offers." | merge M3 | note: keep step 1 (lint and the unit tests, line 46) and step 5 (journeys and the change manifest, line 50) as written; steps 2, 3 and 4 become the pointer. Phase 3 call #22 rewrites this same section. Combined result for steps 2 to 4: one pointer line to test-means-human-click (above), then one line 'Law: named-fix-regression-gate (.ai/rules/named-fix-regression-gate.md) - after the fix a different tester tries to recreate the hole on the live site; the fixer never marks it done.'
- D35 | line 55 ("- New env vars") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - set a new env var yourself, without --secret if the Mac or cloud must read it; batch the variables and ship once." | note: Phase 3 call #10 ('secret when needed' is wrong) and call #24 (ship once on the next push to main) are both inside this pointer. Append the old words '(secret when needed)' to removed-lines/.agents__skills__fundhub-fixer__SKILL.md.md with the reason 'killed by the --secret ban of 2026-10-04'
- D36 | line 56 ("Never print secret values") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - confirm keys by name only; paste a value only when Chris asks (show-secrets-when-chris-asks)." | note: Phase 3 call #11 asks for exactly this 'unless Chris asks' clause; the pointer carries it
- D37 | line 61 ("**Dangerous:**") | REPEAT of cluster C5b | replace with the pointer: "Law: verify-scratch-only (.ai/rules/verify-scratch-only.md) - never run verify:e2e or the scratch harness against the live database; never pause outbound or mass-retire agents for safety."
- D38 | lines 65-66 ("Write this at a third") | REPEAT of cluster C6a | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - write the done report at a 4th grade level: short sentences, no status codes, no shorthand." | note: keep the numbered five-line report (lines 68-72); only the reading-level paragraph under the heading changes
- D39 | lines 76-84 ("Never phrase a handoff") | REPEAT of cluster C6b | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, for example 'This needs new code, so I'm building it now.'" | note: keep the heading; the intro, the three example sentences and the closing paragraph become the pointer
- D40 | line 88 ("Only genuinely new scope") | REPEAT of cluster C3c | replace with the pointer: "Law: fundhub-orchestrator (.agents/skills/fundhub-orchestrator/SKILL.md) - only genuinely new scope, missing data or a real judgment call reaches Chris's phone; a new endpoint that closes a board row does not." | note: keep the heading. The section repeats the orchestrator's "What still comes to Chris" list; its last sentence also repeats this file's line 28 (standing GO for an endpoint that closes a named board row)
- D41 | line 92 ("Audit-and-fix in one pass") | REPEAT of cluster C4c | replace with the pointer: "Law: audit-vs-fix-router (.ai/rules/audit-vs-fix-router.md) - never audit and fix in one pass." | note: in a Never list; the whole bullet becomes the pointer
- D42 | line 93 ("Scope creep past roughly double") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - past double the estimate, re-scope; a required check never counts toward it." | note: Phase 3 call #13
- D43 | line 95 ("Rotating keys") | REPEAT of cluster C1e | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never rotate or re-paste a key unless that exact key is proven broken right now."
- D44 | line 96 ("Phrasing a handoff") | REPEAT of .ai/rules/fourth-grade-english.md (after the fold-in, 'A handoff is never a refusal') | delete | note: delete the Never bullet
- D45 | line 97 ("Stopping to report") | REPEAT of .agents/skills/fundhub-fixer/SKILL.md line 28 | delete | note: within-file copy; delete the Never bullet

### .agents/skills/fundhub-orchestrator/SKILL.md

- D46 | lines 12-16 ("Third or fourth grade") | REPEAT of cluster C6a | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade level: short words and sentences, no jargon, no status codes, no cryptic shorthand." | note: keep the heading; the two paragraphs under it become the pointer
- D47 | lines 20-28 ("Never phrase a handoff") | REPEAT of cluster C6b | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, for example 'This needs new code, so I'm building it now.'" | note: keep the heading; the intro, the three example sentences and the closing paragraph become the pointer
- D48 | line 32 ("1. **PLAN**") | REPEAT of cluster C3d | replace with the pointer: "Law: fundhub-builder (.agents/skills/fundhub-builder/SKILL.md), Step 1 - if the gate-relay is running and this is a real owner decision, write .fundhub-relay/gates/<id>.json and wait; never for a GO already given." | note: replace only the relay part of the line (from 'If `scripts/gate-relay` is running' to 'it never edits app code'). Keep 'PLAN - load fundhub-builder, run its Step 1 plan gate (all seven questions). Wait for go only on genuinely new scope. An endpoint needed to close a board row is standing GO'. The relay steps and the sentence 'Use the relay only for a real owner decision, never for a GO already given' are word for word in builder lines 42-44; the builder skill owns them
- D49 | line 38 ("7. **PRESENT**") | REPEAT of cluster C6b | replace with the pointer: "Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - a handoff is never a refusal; say what is happening, never 'BLOCKED,' 'cannot' or 'will not be built.'" | note: replace only the sentence 'Never "BLOCKED", "cannot", or "will not be built".'
- D50 | line 42 ("- **Two chances per ticket.**") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - two failed tries of one fix mean change the fix, never a third try; keep going with a different fix until a stop reason applies." | note: keep the examples after the first sentence ('If it needs new code ... the loop moves on'); Phase 3 call #12 asks the same edit
- D51 | line 57 ("A new endpoint needed to close a board row") | REPEAT of .agents/skills/fundhub-orchestrator/SKILL.md line 8 ('Standing GO for any endpoint needed to close a board row') | delete | note: the same standing GO is also said at lines 32 and 35 of this file

### .agents/skills/fundhub-perf-auditor/SKILL.md

- D52 | line 14 ("3. Measure on") | REPEAT of cluster C18a | replace with the pointer: "Law: PERF-STANDARDS section 1 (docs/rules/PERF-STANDARDS.md) - measure on mobile, Slow 4G, 4x CPU, never desktop on wifi." | note: keep the second half of the line: 'Run each page 3 times, report the median'

### .agents/skills/fundhub-repo-hygiene/SKILL.md

- D53 | line 38 ("Never touch") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never print key values in chat or commits unless Chris asks; PII packs stay gitignored (agentic-audit-guardrails)." | note: keep 'Never touch .env or credentials/' as this skill's own (do not move or open them while inventorying); only 'or print secrets. PII packs stay gitignored.' becomes the pointer
- D54 | line 71 ("Do not commit raw ID") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - raw ID, SSN and bank files stay in gitignored folders; only blurred packs go in evidence."

### .agents/skills/fundhub-testimonial-thumbnails/SKILL.md

- D55 | lines 59-63 ("Never write:") | REPEAT of cluster C11a | replace with the pointer: "Law: RULES Part 0 (marketing/ads/RULES.md) and outcome-first-copy - no 'credit repair', no 'it's not X, it's Y', no slogans, no 'your number', no EIN or DUNS; cause before effect; the name is Fundhub." | note: the list is a copy of Part 0 rules 1, 2, 5, 6, 13, 14, 16 and of outcome-first-copy. Replacing it also removes the garbled sentence 'Fundhub, never Fundhub' (the company-name law is fundhub-company-name). Keep 'Caption format' (lines 65-66)
- D56 | lines 99-102 ("**Never upscale.**") | REPEAT of cluster C9b | replace with the pointer: "Law: video-4k-unless-ad (.ai/rules/video-4k-unless-ad.md) - testimonial card videos on pages do not need 4K, so a 608x1080 card is not a defect." | note: keep 'Never upscale. 608 wide is correct; stretching to 720 is not. Never call 1080p 4K.' and replace only the owner-set sentence
- D57 | line 126 ("Show Chris the marked draft") | REPEAT of cluster C3d | replace with the pointer: "Law: page-edits-marked-draft (.ai/rules/page-edits-marked-draft.md) - show the marked draft, then push when he authorizes; an existing ship or GO for the release is enough."

### .agents/skills/fundhub-ui-auditor/SKILL.md

- D58 | line 41 ("3. Stop when the board is written.") | POINTER TO A RULE THAT PHASE 3 ARCHIVES (ui-standards, call #20) | change to: "Chris names fixes; docs/rules/UI-STANDARDS.md governs the rebuild." | note: also needed by the archive plan; do it once. Replace 'ui-standards.mdc governs the rebuild'

### .agents/skills/fundhub-version-control/SKILL.md

- D59 | line 13 ("You keep git from eating") | REPEAT of cluster C14b | replace with the pointer: "Law: github-push (.ai/rules/github-push.md) - commit finished work locally in the same session, then push main or a PR branch with git push origin <branch>; the repo is public." | note: replace the first two sentences (the commit rule and the whole-repo script). Keep 'Claude Code: CLAUDE.md section 8 ...' for the Phase 5 stage to retarget. Phase 3 call #5 asks the same edit
- D60 | lines 40-45 ("`.env`, `.env.*`") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never git add .env, .env.* (except .env.example) or credentials/; confirm secrets by name only." | note: keep the heading and the bullet 'Evidence dumps or files that are not part of the finished work', which is this skill's own. The raw SSN/bank/ID packs idea is agentic-audit-guardrails (Identity & privacy)
- D61 | line 49 ("Commit finished work locally in the same session.") | REPEAT of cluster C14b | replace with the pointer: "Law: github-push (.ai/rules/github-push.md) - commit finished work locally in the same session." | note: replace only the first sentence of the bullet; keep 'Follow git safety rules: status + diff + log, HEREDOC message, no --no-verify, no force-push to main, no amend unless the amend rules all pass.' and the next two bullets (small commits; protect main)

### .agents/skills/fundhub-video-animation-overlay/SKILL.md

- D62 | line 27 ("7. **Fix the sound") | REPEAT of cluster C9a | replace with the pointer: "Law: ad-sound-level (.ai/rules/ad-sound-level.md) - every finished video is -14 LUFS with true peak at or under -1.5 dB; measure with ebur128=peak=true and write both numbers." | note: keep the recipe (two-pass loudnorm I=-14:TP=-2.2:LRA=11:linear=true, why TP -2.2, -c:v copy -c:a aac -b:a 320k -ar 48000); drop the sentences that restate the numbers, the -27 to -30 LUFS measurement and 'A video that is not at -14 is not done' (all in the rule)
- D63 | lines 31-41 ("- **Diagrams, on all of them.**") | REPEAT of cluster C7a | replace with the pointer: "Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - what Chris wants on screen: big, diagrams only, one in the first 10 seconds, on the word, never in front of his face." | merge M8 | note: keep the heading line. Replace the twelve bullets with three pointer lines. Pointer 2: "Law: animation-no-echo (.ai/rules/animation-no-echo.md) - anchors come from the script; labels are about 5 words, said a new way; never repeat his sentence." Pointer 3: "Law: animation-builders-opus-placers-sonnet (.ai/rules/animation-builders-opus-placers-sonnet.md) - a Sonnet placer never edits marketing/broll/src/; missing templates go in new-animations-needed.md." The skill's 'Under 50% was so small' loses to the rule's 42 percent. Phase 3 call #38 (skill lines 49 and 56) is a separate edit
- D64 | line 45 ("- **Mode.**") | REPEAT of cluster C7a | replace with the pointer: "Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - see-through clips run in overlay mode; only overlaps are forbidden; the 4 s gap, 3 s cap and 35% share are full-frame limits." | merge M8
- D65 | line 48 ("- **No overlap") | REPEAT of .ai/rules/animation-overlay-on-spoken-words.md line 14 ('no overlaps, and nothing else') | delete | note: delete the bullet
- D66 | line 56 ("- **Vary the spot.**") | REPEAT of cluster C7a | keep the how (schedule.json fields side, dx, dy; the face tool) and replace the sentences 'Words stay clear of the face box and above the caption band; only decoration ... goes behind him. Never hide the start or end of a line.' with: 'Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - words stay clear of the face box and the captions; only decoration goes behind him.' | merge M8 | note: Phase 3 call #38 also edits this line
- D67 | line 64 ("- **Script facts only") | REPEAT of cluster C7b | replace with the pointer: "Law: animation-no-echo (.ai/rules/animation-no-echo.md) - props carry facts from the script in short new words; never his sentence copied." | note: keep the template list under it (ProofWallWide, QualifyTodayWide, BookCallWide); delete the last bullet of that list 'Never invent a number, bank, name or claim. Company name is Fundhub. Certain words only.' and write: 'Law: animation-overlay-on-spoken-words (.ai/rules/animation-overlay-on-spoken-words.md) - never invent a number, bank, name or claim; label sample-client numbers as a sample.'
- D68 | line 101 ("Ask Chris to confirm a choice") | REPEAT of cluster C3d | replace with the pointer: "Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - if a rule settles the choice, make it, finish the work and say what you did."

### .ai/README.md

- D69 | line 15 ("## To add or change a rule") | ADD A POINTER (the README repeats the law's four steps) | keep steps 1 to 4 (they hold the ln -s commands) and add two lines under the heading, the pointer last: 'The steps below are the commands.' then Law: rules-no-drift (.ai/rules/rules-no-drift.md) - a rule is written once, linked for Cursor and Claude, and every older line that says otherwise is rewritten. | merge M6

### .ai/rules/ad-naming.md

- D70 | lines 18-21 ("- **Offer**") | REPEAT of marketing/ads/NAMING.md lines 20-27 (the four-part table) | replace the four bullets with one sentence: 'The angle is the name of that script (the words in its title), never a nickname. The offer words and the full table are in `marketing/ads/NAMING.md`.' | note: do this after the NAMING.md FOLD IN adds the offer-word sentence. Keep line 12 (the formula) and lines 14-16 (the file example)
- D71 | line 23 ("Same offer, same ad number") | REPEAT of marketing/ads/NAMING.md lines 108-112 (the book keeps the full text); one short statement stays here because ad-video-best-of-clips and the join step depend on it | shorten to the first sentence and the last: 'Same offer, same ad number, and the same angle are takes of one video. A different angle is a different video. Read the words before a join.' (delete 'Do not join two angles because both names say Ad 7.')
- D72 | lines 29-33 ("## Never") | REPEAT of marketing/ads/NAMING.md lines 116-122 ('Wrong names') | delete | note: delete the heading and the three bullets; the example block at the end of the rule shows the same wrong names
- D73 | FOLD IN (this file is the owner) | text to add: "## Ads are found by id, not by name (owner-set 2026-09-06)\n`utm_content` is leading digits with an optional `-slug` (`43-ringlights` is ad 43). `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` ignores the slug, so `utm_content=43` resolves with no name at all. `src/ads/store.mjs` stores raw UTMs only; the ad id is computed in Postgres. Meta's own API keys on its ad id too. So never make naming a blocker, never ask Chris to name ads before something else can proceed, and never call an untitled ad a defect. Only Chris names an ad: leave the tracking title blank and never invent one. A title makes a report readable and nothing else. This is about the tracking title only; Drive file names follow `marketing/ads/NAMING.md`." | from CLAUDE.md line 477 | note: one home for the ad-id law. Today it is in CLAUDE.md section 3c, the ad-writer skill (prime rule 3 and Never), marketing/ads/WRITE-ADS-FROM-HERE.md and marketing/ads/README.md

### .ai/rules/ad-second-line.md

- D74 | lines 12-33 ("## Sentence two") | REPEAT of cluster C10b | replace with the pointer: "Law: SECOND-LINE (marketing/ads/SECOND-LINE.md) - sentence two does one job: the win, one proof, the stakes, one new detail, or the reassure; never a greeting, a restatement or an ask." | note: replace the three sections (Sentence two, Never, What to fix) with this one sentence and the pointer. Every item was already in SECOND-LINE.md (lines 9-37, 47); the two 'What to fix' bullets are word-for-word lines 34-35 of the book

### .ai/rules/ad-video-best-of-clips.md

- D75 | line 36 ("Chris never opens Submagic") | REPEAT of cluster C9c | replace with the pointer: "Law: chris-never-submagic (.ai/rules/chris-never-submagic.md) - Chris never opens Submagic or any tool an agent can run by API." | note: replace only the first sentence of the paragraph; keep 'Agents run merge, trim, upload, captions, and B-roll ...' and the B-roll sentences

### .ai/rules/ad-watch-curve.md

- D76 | lines 12-16 ("A **play** means") | REPEAT of cluster C10c | replace with the pointer: "Law: watch-curve (marketing/ads/watch-curve.md) - Meta's own definitions of play, 25/50/75/100%, ThruPlay and the second-by-second curve; there is no 3-second field." | note: the section repeats watch-curve.md lines 5-35 and 37-49
- D77 | line 28 ("When a running ad dies") | REPEAT of cluster C10c | replace with the pointer: "Law: watch-curve (marketing/ads/watch-curve.md), Dying ping - a running ad that dies before 25% with no tap-through buzzes Chris through the ad-video notify path, inside the texting window only." | note: the unique facts (texting window, 'one or two sentences: which ad ...', 'if they are tapping through, do not buzz') are folded into watch-curve.md first. Keep 'Do not pause the campaign or change budgets from this rule.' in the rule
- D78 | lines 32-33 ("Invent a 3-second Meta field") | REPEAT of this file's lines 15 and 20 | keep only 'Build a new notify vendor for this buzz'; delete 'Invent a 3-second Meta field' (said at line 15 and in the book) and 'Recut the ending first when people leave before 25%' (said at line 20)

### .ai/rules/agentic-audit-guardrails.md

- D79 | FOLD IN (this file is the owner) | line 26 ("Raw ID/SSN/bank") | text to add: "Add a bullet under Identity & privacy: '- Never use a real client or a real client's file for a sim, a roleplay or an agent test.'" | from .agents/skills/fundhub-agent-tester/SKILL.md line 68 | note: the agent-tester skill carries this alone (its lines 68 and 131); the guardrails did not say it
- D80 | line 33 ("Full End-To-End Audit: always") | REPEAT of cluster C13a | replace with the pointer: "Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - always five sim files, one scenario each, no 5x5 grid; the ClickFunnels one-pass rule means a new plus-tag per funnel attempt."
- D81 | lines 37-41 ("Bare **audit**") | REPEAT of cluster C4c | replace with the pointer: "Law: audit-vs-fix-router (.ai/rules/audit-vs-fix-router.md) - audit and fix are two doors; a bare audit is read-only; a Full End-To-End Audit follows its own rule; fix only what Chris names."
- D82 | line 49 ("Product is **live**") | REPEAT of cluster C15a | replace with the pointer: "Law: product-is-live (.ai/rules/product-is-live.md) - INNGEST_EVENT_KEY stays on; never flip a live switch for safety."
- D83 | lines 60-63 ("Script green") | REPEAT of cluster C5a | replace with the pointer: "Law: test-means-human-click (.ai/rules/test-means-human-click.md) - a green script is not done; live Playwright to 100/100, then the agent clicks the live page; Chris does no QA unless he offers."
- D84 | line 64 ("**Full End-To-End Audit exception:**") | REPEAT of cluster C13a | replace with the pointer: "Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - in a Full End-To-End Audit the agent reads Gmail and the agent phone; asking Chris to check mail or texts is a FAIL."

### .ai/rules/agents-run-ops-not-chris.md

- D85 | line 14 ("Git push / fetch") | REPEAT of cluster C14a | replace with the pointer: "Law: github-push (.ai/rules/github-push.md) - push only main and branches headed to a PR with git push origin <branch>; the repo is public." | note: keep the first half of the line (configure auth from env, test, push); the push policy half becomes the pointer
- D86 | line 31 ("Decisions only he can make") | REPEAT of cluster C3e | replace with the pointer: "Law: finish-the-answer (.ai/rules/finish-the-answer.md) - Chris is asked first only for yes/no and live-or-sandbox calls, deleting data (not proven test rows or test logins), and repointing DATABASE_URL."

### .ai/rules/animation-ad-style.md

- D87 | whole file | MERGED INTO animation-overlay-on-spoken-words (merge M8) | after the fold-ins on animation-overlay-on-spoken-words: mv .ai/rules/animation-ad-style.md ops/archive/ai-instructions-2026-10-24/rules/animation-ad-style.md; rm the links .cursor/rules/animation-ad-style.mdc and .claude/rules/animation-ad-style.md; remove its row from docs/rules/RULES-INDEX.md and add 'big, on the word, diagrams only, CTA only when it fits' to the overlay row

### .ai/rules/animation-overlay-on-spoken-words.md

- D88 | FOLD IN (this file is the owner) | line 14 ("See-through clips run in overlay mode") | text to add: "Add after the first sentence: '(In `src/ad-videos/animations.mjs` these limits belong to `fullframe` mode only.)'" | from .agents/skills/fundhub-video-animation-overlay/SKILL.md line 45
- D89 | line 15 ("Cut him out") | REPEAT of animation-ad-style line 17 (merge M8) plus a fold from the animation skill line 56 | merge this bullet with the face bullet of animation-ad-style so the face rule is said once: 'Cut him out (`--behind`) so animations can sit behind him, even across the whole screen; his cut-out stays on top. Never in front of his face or head, hair included (owner-set 2026-10-24; Chris: “It should never go over my face.”). Beside him, or over his chest above the captions, is fine. Vary side, height and tuck from clip to clip. Words stay clear of the face box and the captions; only decoration goes behind him. Never hide the start or end of a line.' | merge M8 | note: Phase 3 call #38 asks the same match ('behind his head is fine')
- D90 | FOLD IN (this file is the owner) | text to add: "## Style Chris asked for (owner law 2026-10-23, Direct Book Ad 11)\n- Big: the words box is 70 to 90 percent of the frame width. 42 percent was “so small.”\n- One animation inside the first 10 seconds, on the hook.\n- Each card pops in on the exact word he says it. No fixed stagger.\n- The closing ask can carry a CTA animation, but not every ad needs one, and it is never big by default (owner-set 2026-10-24: “we don't need a massive CTA all the time”). A closing diagram can hold to the end instead.\n- Animations can be long and ride the whole idea.\n- Never over the captions.\n- Chris picks the trigger words (owner-set 2026-10-24): send him the numbered trigger list first, he changes it, then Sonnet places.\n- Diagrams only, on all of them. Start from the video's entry in `marketing/ads/animation-plans/2026-10-22.json` (skill step 1).\n- Never: numbered word lists ('01 02 03' card lists such as PathCards or StepPath) or text-only plates; they were rejected on Ads 11 and 14. Never CompanyLine (text over art) at small size; it was unreadable.\n- 'Run the skills' on a downloaded Submagic ad means add animations only: no cuts and no sound clean-up, except the -14 level reset (`ad-sound-level`)." | from .ai/rules/animation-ad-style.md line 12 | merge M8 | note: the face bullet is NOT in this list; it is merged into the 'Cut him out' bullet above. Phase 3 call #37 gives the last bullet's wording (no cuts and no sound clean-up, except the -14 level reset). Phase 3 call #38 gives the CTA bullet's wording. The two phrases 'PathCards, StepPath' and 'Under 50%' come from the animation skill (line 31 and 32); keep 'PathCards or StepPath' and keep the rule's '42 percent'

### .ai/rules/approved-launch-release-blockers.md

- D91 | whole file | MERGED INTO finish-the-requested-job (merge M1) | after the fold-ins on finish-the-requested-job: mv .ai/rules/approved-launch-release-blockers.md ops/archive/ai-instructions-2026-10-24/rules/approved-launch-release-blockers.md; rm the links .cursor/rules/approved-launch-release-blockers.mdc and .claude/rules/approved-launch-release-blockers.md; remove its row from docs/rules/RULES-INDEX.md | note: phase-3-decisions.md already lists this archive; this plan adds the fold-in text

### .ai/rules/audit-vs-fix-router.md

- D92 | line 14 ("Full End-To-End Audit, full e2e audit") | REPEAT of cluster C13a | replace with the pointer: "Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - ask the two gate questions, then walk every live path in order; the agent proves mail, texts and on-screen data." | note: keep the first two table columns; only the third column ('Do') changes
- D93 | line 38 ("If he said **Full End-To-End Audit**") | REPEAT of cluster C13a | replace with the pointer: "Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - a Full End-To-End Audit beats the split; ask the gate first and do not run the read-only auditor." | note: keep the second paragraph 'Otherwise: run Auditor first...' (line 40), it is this rule's own
- D94 | line 47 ("Otherwise") | POINTER TO A RULE THAT IS MERGING INTO owner-go-no-repeat-approval | change '`stop-asking-follow-the-rules`' to '`owner-go-no-repeat-approval`' | merge M7
- D95 | line 51 ("One issue per thread") | POINTER TO A RULE THAT IS MERGING INTO three-step-repair | change to: "Named-hole repair (owner-set 2026-08-26): Law: three-step-repair (.ai/rules/three-step-repair.md) - one named hole per chat; verify, fix, finish in one paste. The agent starts it from the board prompt." | merge M2
- D96 | line 58 ("Skip VERIFY") | REPEAT of .ai/rules/three-step-repair.md line 18 | delete
- D97 | line 66 ("Parallel work") | REPEAT of cluster C17 | replace with the pointer: "Law: split-and-proceed (.ai/rules/split-and-proceed.md) - the agent starts the agents itself and puts the copy-paste prompts on the shared board; agents coordinate only through the board."

### .ai/rules/chris-never-clickfunnels.md

- D98 | FOLD IN (this file is the owner) | line 14 ("Agents do all ClickFunnels work") | text to add: "Add to the end of the paragraph: 'Read auth from gitignored `.env`, then Netlify production env, then the `analytics_connections` row (`platform = clickfunnels`). In chat, name only the env name.'" | from .ai/rules/clickfunnels-html-api-push.md line 13 | merge M5
- D99 | FOLD IN (this file is the owner) | line 18 ("Ask Chris to open ClickFunnels") | text to add: "Add at the end of the bullet: ' Exception: Chris explicitly chose manual builder paste for that one page.'" | from .ai/rules/clickfunnels-developers-docs.md line 17 | merge M5 | note: this is the one exception sentence that clickfunnels-developers-docs carries. The SOP line that says 'fallback only if API auth is truly missing' is the other version; the owner rule wins (see the action on docs/sops/clickfunnels-custom-html-push.md line 8)
- D100 | line 20 ("Print API keys") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never print key values in chat or commits unless Chris asks for the value (show-secrets-when-chris-asks)." | note: Phase 3 call #11 clause is inside the pointer
- D101 | FOLD IN (this file is the owner) | line 26 ("Prove live customer URLs") | text to add: "Append: ' Look at `apply.fundhub.ai/watch`, `/apply`, `/funding-book-call` and `/thank-you`. No pay, no SSN, no live CRS.'" | from .ai/rules/clickfunnels-html-api-push.md line 17 | merge M5
- D102 | FOLD IN (this file is the owner) | text to add: "## When the work touches `marketing/landing-pages/**` or live `apply.fundhub.ai` funnel HTML\n- Tracking goes on every pushed page: `fh-attribution.js` on every funnel step; `vsl-watch-beacon.js` on the watch page only; the Meta pixel (env, or repo ground truth); and no duplicate `06-utm-hidden-fields.html` when `fh-attribution.js` already loads. Invent no CAPI call unless env provides it. Add no field-capture tracker on pull or SSN pages.\n- `/funding-book-call`: the native calendar is sacred. Inject only (`footer_code` / `head_code` append). A full custom-HTML page replaces the whole funnel step, and the native survey, checkout and booking calendar do not carry over. Never full-replace that step, and never swap in `slo-02-booking.html`.\n- $297 `slo` pages belong on the $297 funnel, not on the live apply calendar step, unless the exact task is that funnel migration.\n- Per-step page types, page ids and the commands live in `docs/sops/clickfunnels-custom-html-push.md`." | from .ai/rules/clickfunnels-html-api-push.md line 14 | merge M5 | note: items 4, 5, 6, 7 of the old glob rule, plus two unique facts from the push skill (lines 55 and 56). The rule was a glob rule (alwaysApply: false); once folded here it is always on

### .ai/rules/chris-never-submagic.md

- D103 | line 16 ("Same pattern as ClickFunnels") | REPEAT of .ai/rules/chris-never-submagic.md lines 12-14 | delete | note: line 12 already names ClickFunnels; delete the sentence
- D104 | line 22 ("Print API keys") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never print key values in chat or commits unless Chris asks for the value (show-secrets-when-chris-asks)." | note: Phase 3 call #11 clause is inside the pointer

### .ai/rules/clickfunnels-developers-docs.md

- D105 | line 17 ("Tell Chris to paste HTML") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - never tell Chris to paste HTML into the funnel builder as the default; the Custom HTML Pages API (GA 2026-09-18) is the path."

### .ai/rules/clickfunnels-html-api-push.md

- D106 | whole file | MERGED INTO chris-never-clickfunnels (merge M5) | after the fold-ins on chris-never-clickfunnels: mv .ai/rules/clickfunnels-html-api-push.md ops/archive/ai-instructions-2026-10-24/rules/clickfunnels-html-api-push.md; rm the links .cursor/rules/clickfunnels-html-api-push.mdc and .claude/rules/clickfunnels-html-api-push.md; remove its row from docs/rules/RULES-INDEX.md

### .ai/rules/dictator-owner-overrides.md

- D107 | line 8 ("Owner law") | A POINTER WRITTEN IN THE OLD .cursor PATH STYLE | keep the owner-law sentence; replace the last sentence ('When he asks to show or paste a token, obey ...') with: 'Law: show-secrets-when-chris-asks (.ai/rules/show-secrets-when-chris-asks.md) - when he asks to show or paste a token, paste the full value.'
- D108 | lines 16-20 ("**Read / write**") | REPEAT of clusters C1a, C1b, C1f (each bullet restated one of those three rules) | replace the five bullets with three pointer lines and one bullet of this file's own. Pointer 1: “Law: secrets-env-law (.ai/rules/secrets-env-law.md) - read and write gitignored .env, .env.* and credentials/** when he orders env work.” Pointer 2: “Law: show-secrets-when-chris-asks (.ai/rules/show-secrets-when-chris-asks.md) - paste the full value when he asks or dictator mode is on.” Pointer 3: “Law: agents-run-ops-not-chris (.ai/rules/agents-run-ops-not-chris.md) - agents run git push, token tests, env save and cloud prep.” Own bullet: “Do the work. No lecture about visibility.” | note: this also removes the 'Build cloud env blocks, clipboard copies' bullet, which Phase 3 call #28 says to stop teaching
- D109 | line 22 ("Still") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - secret values never go into commits, tracked files, boards or evidence JSON, even in dictator mode."
- D110 | line 26 ("Follow") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - outside dictator mode, read .env silently and confirm keys by name unless he asked for the value."

### .ai/rules/env-full-copies-never-masked.md

- D111 | whole file | MERGED INTO secrets-env-law (merge M4) | after the fold-in on secrets-env-law: mv .ai/rules/env-full-copies-never-masked.md ops/archive/ai-instructions-2026-10-24/rules/env-full-copies-never-masked.md; rm the links .cursor/rules/env-full-copies-never-masked.mdc and .claude/rules/env-full-copies-never-masked.md; remove its row from docs/rules/RULES-INDEX.md

### .ai/rules/features-stay-on.md

- D112 | line 23 ("Never delete a key") | POINTER TO A POINTER INTO CLAUDE.md THAT IS MOVING | change to: "Never delete a key. Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never delete, unset, clear or overwrite a stored credential."
- D113 | line 24 ("The two ask-first items") | REPEAT of cluster C3e | replace with the pointer: "Law: finish-the-answer (.ai/rules/finish-the-answer.md) - Chris is asked first only to delete data (not proven test rows or test logins) or to repoint DATABASE_URL."

### .ai/rules/finish-the-answer.md

- D114 | FOLD IN (this file is the owner) | line 18 ("Ask him only when") | text to add: "Replace the line with: 'Ask him only when you are blocked on a decision only he can make. The owner-only decisions are these and no others: yes/no and live-or-sandbox calls; anything that deletes data; anything that repoints `DATABASE_URL` at a different database. Written exception (owner-set 2026-10-24): deleting test rows and test logins that are proven test or sim (`is_demo`, `+sim` emails, TEST names) is allowed without asking. Real-looking people still ask. When you do ask, ask that one decision, then wait; do not ask and proceed in the same turn.'" | from CLAUDE.md line 733 | note: this is the one home of the ask-first list. agents-run-ops-not-chris, features-stay-on, product-is-live and the RUNBOOK point here
- D115 | line 20 ("Still do not fix extra holes") | REPEAT of cluster C3b | replace with the pointer: "Law: no-extra-holes (.ai/rules/no-extra-holes.md) - looking up a fact never licenses fixing a second hole or editing a file Chris did not name." | note: keep the clause 'Looking up the fact is not the same as fixing a second hole' inside the pointer; delete the other two sentences
- D116 | line 26 ("Fix a second hole") | REPEAT of .ai/rules/finish-the-answer.md line 20 (after the pointer replaces it) | delete | note: within-file copy; delete the bullet
- D117 | lines 28-31 ("Always") | REPEAT of .ai/rules/finish-the-answer.md lines 12 and 18 | delete | note: the two Always bullets repeat lines 12 and 18 of this same file; delete the heading and both bullets
- D118 | FOLD IN (this file is the owner) | text to add: "## Never invent\nIf you looked and the fact is not there, that absence is the finding. Report it. Do not fill the gap with a guess. A finding is not confirmed until you have looked everywhere it could live: search `src/`, `scripts/`, `db/` and `docs/` before you call something missing, empty or broken. Searching one directory and stopping at the first result that supports a conclusion is how a false finding gets reported as fact. Data in this repo loads from CSVs and scripts, not only from migrations. Measured 2026-09-11: the `lenders` table was reported empty on the strength of one grep for `INSERT`; the book holds 313 banks in `docs/legacy-strong/lenders-legacy-strong.csv`, loaded by `scripts/lenders-import-alec.mjs`. Read the file before you change it; do not ask Chris what is in a file you can open." | from CLAUDE.md line 79 | note: CLAUDE.md section 2 and AGENTS.md line 43 say the same thing in short form; this is the full text

### .ai/rules/finish-the-requested-job.md

- D119 | FOLD IN (this file is the owner) | line 8 ("Owner rule, 2026-10-20") | text to add: "Add a new line right after line 8: 'Launch form (owner law 2026-10-17, now part of this rule): if Chris approved a launch, said “ship,” or said “go live after checks pass,” each failure in the required release checks is part of that named task. Do not ask again whether to repair it, even if the failing code or test is in an adjacent file.'" | from .ai/rules/approved-launch-release-blockers.md line 8 | merge M1
- D120 | FOLD IN (this file is the owner) | line 11 ("Required build, verification") | text to add: "Append to the bullet: ' Reproduce the failure first and keep the failing evidence until the check genuinely passes. A new file, route, field or test fixture needed for that repair is included in the approval if it preserves the approved behavior.'" | from .ai/rules/approved-launch-release-blockers.md line 10 | merge M1
- D121 | FOLD IN (this file is the owner) | line 16 ("Unrelated improvements") | text to add: "Replace the bullet with: '- Unrelated warnings, optional improvements and backlog work stay on the shared board as leftovers. Existing go-live approval, customer/money protection, credential, deletion and database-repointing rules remain unchanged. This rule does not approve changes to live customer data, money, credentials, or a new product decision. Routine in-scope account access follows `owner-authorized-account-ops`; ask only for truly missing authority or information.'" | from .ai/rules/approved-launch-release-blockers.md line 12 | merge M1
- D122 | line 17 ("After approved go-live") | REPEAT of cluster C3d (owner-go-no-repeat-approval line 11) plus a fold from approved-launch-release-blockers line 14 | keep the sentence, delete the tail 'without asking for the same approval again', and add: 'Never call an unverified release live. Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - an approved release is never asked about twice.' | merge M1
- D123 | FOLD IN (this file is the owner) | line 19 ("Example") | text to add: "Add a second example line: 'Example: a browser check for the approved app fails in another screen. Repair that failure and rerun the check; do not send Chris “May I fix this other test?”'" | from .ai/rules/approved-launch-release-blockers.md line 16 | merge M1 | note: kept as a second example, because the two examples differ
- D124 | FOLD IN (this file is the owner) | text to add: "## Stuck rule\nTwo failed attempts at the same fix mean change the fix. Never try the same fix a third time, and do not start rewriting surrounding code to make the problem go away. Thrashing is the most expensive failure mode there is. For a required check or any approved work, keep going with a different fix until one of the stop reasons above applies. When you do stop, report what you tried, what happened and your best guess at the cause.\n\n## Scope creep\nIf the work grows past roughly double what the plan estimated, stop and re-scope. A required build, verification or release check never counts toward 'double the estimate'. New product scope still stops. Do not push through a task that turned out to be three tasks. The orchestrator's quota checkpoint stays: at about 80% of remaining quota, checkpoint the board and stop cleanly." | from CLAUDE.md line 580 | note: Phase 3 calls #12 and #13 give this wording. The Phase 5 stage must not copy 'The stuck rule' or 'Scope creep check' again into another rule

### .ai/rules/fourth-grade-english.md

- D125 | FOLD IN (this file is the owner) | line 14 ("Short words") | text to add: "Add to the Always list: '- No status codes. No cryptic shorthand. If a ten year old could not follow it, rewrite it.'" | from .agents/skills/fundhub-fixer/SKILL.md line 19 | note: the three skills say 'Third or fourth grade'; this rule says 4th grade (2026-10-05) and wins. Append the old wording to the removed-lines notes of each skill with the reason 'older wording; fourth-grade-english says 4th grade'
- D126 | FOLD IN (this file is the owner) | text to add: "## A handoff is never a refusal\nNever phrase a handoff as a no. “Will not be built,” “BLOCKED” and “cannot” sound like a refusal. Say what is actually happening: “This needs new code, so I'm building it now.” “Nothing is broken here. The old photo was taken before someone fixed it.” “That number isn't in the database yet, so there's nothing to show.” Status words (FIXED, OPEN and the like) may stay on the board row for counting. The sentence to Chris has to explain what is going on. (Carried over from the builder, fixer and orchestrator skills; no owner date was recorded there.)" | from .agents/skills/fundhub-fixer/SKILL.md line 74 | note: the same block was word-for-word in three skills

### .ai/rules/full-end-to-end-audit.md

- D127 | line 25 ("**Five horsemen**") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - sims use plus-tag emails and the one agent phone, never Chris's personal prove phone." | note: keep the five scenario names and the 'do not mint five copies of the same person' sentence in this file; only the sentence 'Plus-tag email per file + agent SMS +16616054248. Never his personal prove phone.' becomes the pointer
- D128 | line 63 ("Test/sim runs bypass quiet hours") | EXACT COPY of .ai/rules/agentic-audit-guardrails.md line 48 | delete | note: the guardrails line is longer (it adds that this never bypasses texting-hours for texts to Chris); keep that one
- D129 | line 74 ("2. **Fulfillment**") | REPEAT of the agent-phone number (one home: agentic-audit-guardrails line 25) | change 'AI agent outbound CALL** to `+16616054248`' to 'AI agent outbound CALL** to the agent phone (`agentic-audit-guardrails`)'
- D130 | line 80 ("8. Agent does **all** testing") | REPEAT of .ai/rules/full-end-to-end-audit.md lines 57 and 59 | delete | note: within-file copy; delete checklist item 8
- D131 | line 86 ("Wipe real people") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - the hard stops (credit pull, card charge, bureau mail, wiping people, prove phone, secret rotation) hold unless he names them in the yes." | note: keep the heading 'Hard stops unless he named them in the yes' and its qualifier; replace the list with the pointer

### .ai/rules/github-push.md

- D132 | line 39 ("Never commit") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never commit .env, .env.* or credentials/; never put a token in tracked files, boards or logs; paste one in chat only when Chris asks." | note: the sentence 'unless Chris explicitly asks in dictator mode' is the show-secrets-when-chris-asks law; the pointer carries it
- D133 | FOLD IN (this file is the owner) | text to add: "## Commit locally, every session (owner-set 2026-09-08)\nA laptop died on 2026-09-07 holding uncommitted work. Four marketing skills and 83 ad scripts were never in git and are gone. So commit to the local repository in the same session the work is done, every time, whether or not a push is possible. An unpushed commit survives. An uncommitted file does not. If you cannot push, commit anyway and say so. Then push that commit to GitHub when auth allows." | from CLAUDE.md line 135 | note: three skills and a router rule restate this. One home

### .ai/rules/live-playwright-100-before-manual.md

- D134 | whole file | MERGED INTO test-means-human-click (merge M3) | after the fold-ins on test-means-human-click: mv .ai/rules/live-playwright-100-before-manual.md ops/archive/ai-instructions-2026-10-24/rules/live-playwright-100-before-manual.md; rm the links .cursor/rules/live-playwright-100-before-manual.mdc and .claude/rules/live-playwright-100-before-manual.md; remove its row from docs/rules/RULES-INDEX.md and change the test-means-human-click row to the new description

### .ai/rules/named-fix-regression-gate.md

- D135 | line 10 ("This gate covers") | POINTER TO A RULE THAT IS MERGING INTO finish-the-requested-job | replace 'follows `approved-launch-release-blockers.mdc`' with 'follows `finish-the-requested-job` (.ai/rules/finish-the-requested-job.md)' | merge M1
- D136 | line 22 ("If live prove of this hole") | REPEAT of cluster C3b | replace with the pointer: "Law: no-extra-holes (.ai/rules/no-extra-holes.md) - a new break found while proving this hole goes on the board as a new hole card; stop and do not fix it here."
- D137 | line 27 ("Invent extra holes") | REPEAT of cluster C3b | replace with the pointer: "Law: no-extra-holes (.ai/rules/no-extra-holes.md) - never invent or hunt extra holes from reading files."
- D138 | lines 32-33 ("Flip") | REPEAT of cluster C5b | replace with the pointer: "Law: verify-scratch-only (.ai/rules/verify-scratch-only.md) - never flip messaging_settings.outbound_enabled or run verify:e2e or the scratch harness against the live database."
- D139 | line 46 ("See also") | POINTER TO A RULE THAT IS MERGING INTO three-step-repair | change to: "See also `three-step-repair` (.ai/rules/three-step-repair.md), `owner-scope-minimal-diff` and `verify-scratch-only`." | merge M2

### .ai/rules/no-api-spend-for-now.md

- D140 | line 20 ("Remove or change the Anthropic key") | POINTER TO A POINTER INTO CLAUDE.md THAT IS MOVING | change to: "Remove or change the Anthropic key. Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never delete, unset, clear or overwrite a stored credential."

### .ai/rules/no-extra-holes.md

- D141 | line 12 ("An approved launch includes") | POINTER TO A RULE THAT IS MERGING INTO finish-the-requested-job | change to: "An approved launch includes its required release checks. A failure in one of those checks is named launch scope, not an extra hole. Fix and rerun it under `finish-the-requested-job` (.ai/rules/finish-the-requested-job.md)." | merge M1
- D142 | line 37 ("Reinforces") | A LINE THAT NAMES one-issue-per-thread (merging into three-step-repair) | change to: 'Reinforces `three-step-repair` (.ai/rules/three-step-repair.md), `named-fix-regression-gate` point 2 and `owner-scope-minimal-diff`.' | merge M2
- D143 | FOLD IN (this file is the owner) | text to add: "Add under 'Never': 'First form (owner-set 2026-09-08): do not fix a hole he did not name and do not change a file he did not ask you to change. Do not open a section called “other things I noticed.” This bites hardest in walkthroughs and audits, where a list of extra findings buries the one thing he asked for.'" | from CLAUDE.md line 117 | note: the Hard lock paragraph of CLAUDE.md (line 121) is already this rule's text; only the 2026-09-08 first form and the 'other things I noticed' line are new

### .ai/rules/no-remote-control.md

- D144 | lines 16-17 ("When he says") | REPEAT of cluster C14c | replace with the pointer: "Law: github-ships-main (.ai/rules/github-ships-main.md) - a cloud session needs only GitHub: push a branch, open the PR, merge or push main. No Netlify or Supabase keys, no hosts." | note: keep the heading and write the lead-in 'When he says use it from my phone:' before the pointer. Phase 3 call #9 rewrites the first bullet ('give the cloud the same GitHub path as the Mac'); the pointer is that wording. The second bullet ('Keep GitHub main as the path to live') is also in github-ships-main; the pointer replaces it

### .ai/rules/one-issue-per-thread.md

- D145 | whole file | MERGED INTO three-step-repair (merge M2) | after the fold-ins on three-step-repair: mv .ai/rules/one-issue-per-thread.md ops/archive/ai-instructions-2026-10-24/rules/one-issue-per-thread.md; rm the links .cursor/rules/one-issue-per-thread.mdc and .claude/rules/one-issue-per-thread.md; remove its row from docs/rules/RULES-INDEX.md and change the three-step-repair row to: 'Verify → Fix → Finish in one paste; one named hole per chat.'

### .ai/rules/owner-authorized-account-ops.md

- D146 | line 12 ("Example") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - ask only for a truly missing product choice or a confirmation the tool itself requires." | note: keep the first sentence of the example; replace the last sentence

### .ai/rules/owner-calls-settled.md

- D147 | FOLD IN (this file is the owner) | line 13 ("Plaid affiliate payouts") | text to add: "Change the cell to: 'Stay in test mode. No live Plaid, no limits to pick. Chris: “we just stay in test mode.”'" | from .ai/rules/product-is-live.md line 20

### .ai/rules/owner-go-no-repeat-approval.md

- D148 | line 15 ("Ask one question only") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - stop and ask one question only when a missing fact, new scope, owner-only decision or tool-enforced approval blocks the next action."
- D149 | FOLD IN (this file is the owner) | text to add: "## When the rules settle the choice (owner-set 2026-10-23)\nChris: “get it done please. stop asking me it wastes time. you know the rules. follow them.”\n- Read which mode or rule applies before you offer options.\n- If the rules, the law files or the skill settle a choice, make it, finish the work, and report what you did.\n- Never end with a “keep all 8 or drop to 5?” question when a rule already answered it." | from .ai/rules/stop-asking-follow-the-rules.md line 8 | merge M7 | note: the third bullet of the old rule ('Ask only for a decision only he can make (CLAUDE.md section 2)') is already line 15 of this file; do not add it again

### .ai/rules/owner-scope-minimal-diff.md

- D150 | line 22 ("'While I was in there'") | REPEAT of cluster C3b | replace with the pointer: "Law: no-extra-holes (.ai/rules/no-extra-holes.md) - write anything else you find on the shared board as one leftover card and stop; do not fix it." | note: the old sentence said 'write it down in the summary'; the newer no-extra-holes law (2026-09-18) says the shared board. Append the old wording to removed-lines/.ai__rules__owner-scope-minimal-diff.md.md with the reason 'older wording; no-extra-holes says shared board'
- D151 | line 26 ("For any approved task") | POINTER TO A RULE THAT IS MERGING INTO finish-the-requested-job | delete the last sentence 'See `approved-launch-release-blockers.mdc`.' (the sentence before it already names finish-the-requested-job) | merge M1
- D152 | line 32 ("Adding a route") | REPEAT of this file's line 26 (and of finish-the-requested-job after M1) | delete the last sentence 'Also stop-and-ask unless it is required to repair a failed required check in an approved task and preserves the intended behavior.' (it repeats line 26 and the M1 fold-in on finish-the-requested-job). Phase 3 call #19 adds its third exception to this same paragraph

### .ai/rules/page-edits-marked-draft.md

- D153 | line 10 ("Owner update (2026-10-19)") | REPEAT of cluster C3d (also said again in this file at step 7, line 22) | keep the dated label; shorten the body to: 'Keep the marked draft. Publication approval carries across turns.' and add: 'Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - a GO already given is never asked again.'
- D154 | line 21 ("6. **Every fact") | REPEAT of cluster C3f | replace with the pointer: "Law: finish-the-answer (.ai/rules/finish-the-answer.md) - look the fact up in the repo, the product or Chris's words; never invent a number, name, quote or feature."

### .ai/rules/product-is-live.md

- D155 | FOLD IN (this file is the owner) | line 14 ("INNGEST_EVENT_KEY") | text to add: "Append: ' Not after an audit, not after a test, not “at the end of the run,” and not because an older thread or doc said to; any prior instruction to disable it is dead. Do not ask to flip it and do not propose flipping it. If it is missing from an environment where workflows should run, set it from the existing secret store and leave it set.'" | from CLAUDE.md line 738 | note: CLAUDE.md section 11 'INNGEST_EVENT_KEY stays ON permanently' becomes a pointer in the Phase 5 stage
- D156 | line 20 ("Plaid affiliate payouts") | REPEAT of cluster C15b | replace with the pointer: "Law: owner-calls-settled (.ai/rules/owner-calls-settled.md) - Plaid affiliate payouts stay in test mode (owner-set 2026-10-21)." | note: keep the heading 'Named exception' because this is the carve-out to 'everything is live'; move Chris's quote 'we just stay in test mode' to the owner-calls-settled row first. Phase 3 call #3 adds a second bullet under the same heading (direct mail, src/mail, stays unbuilt until Chris names the switch)
- D157 | line 25 ("No deleting data") | REPEAT of cluster C3e | replace with the pointer: "Law: finish-the-answer (.ai/rules/finish-the-answer.md) - delete data only after asking, except proven test rows and test logins (owner-set 2026-10-24)."
- D158 | line 26 ("No rotating keys") | REPEAT of cluster C1e | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never rotate or re-paste a key unless that exact key is proven broken right now."
- D159 | line 27 ("Audits stay read-only") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - no live credit pull, card charge or bureau mail in an audit without an explicit GO in that message."

### .ai/rules/repo-hygiene-vc-router.md

- D160 | line 15 ("version control, VC check") | REPEAT of cluster C14b and a pointer into CLAUDE.md that is moving | in the third column replace 'Commit finished work locally in the same session (CLAUDE.md, 2026-09-08).' with 'Law: github-push (.ai/rules/github-push.md) - commit locally every session.'
- D161 | line 31 ("Commit `.env`") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never git add .env, .env.* (except .env.example) or credentials/."

### .ai/rules/rules-for-claude-and-cursor.md

- D162 | whole file | MERGED INTO rules-no-drift (merge M6) | after the fold-ins on rules-no-drift: mv .ai/rules/rules-for-claude-and-cursor.md ops/archive/ai-instructions-2026-10-24/rules/rules-for-claude-and-cursor.md; rm the links .cursor/rules/rules-for-claude-and-cursor.mdc and .claude/rules/rules-for-claude-and-cursor.md; remove its row from docs/rules/RULES-INDEX.md and add 'skills too' to the rules-no-drift row

### .ai/rules/rules-no-drift.md

- D163 | FOLD IN (this file is the owner) | line 8 ("**Owner law (2026-10-24):**") | text to add: "Add a second dated line under it: '**Owner law (2026-09-21):** When Chris asks for a rule, a skill, or a law in this repo, write it for Claude and for Cursor in the same change.'" | from .ai/rules/rules-for-claude-and-cursor.md line 8 | merge M6
- D164 | FOLD IN (this file is the owner) | line 14 ("1. Write the rule once") | text to add: "Add under step 1: 'Skills have one home too: the real folder `.agents/skills/<name>/SKILL.md` (Codex reads this folder). Cursor link: `.cursor/skills/<name>` points at `../../.agents/skills/<name>`. Claude link: `.claude/skills/<name>` points at the same folder. If a link is missing, add it in that same change.' Also add to step 1: 'The rule has `alwaysApply: true` in its front matter, unless he named files it should match.'" | from .ai/rules/rules-for-claude-and-cursor.md line 21 | merge M6
- D165 | line 14 ("(`rules-for-claude-and-cursor`)") | A POINTER TO A FILE THAT IS GOING AWAY (rules-for-claude-and-cursor) | delete the parenthesis '(`rules-for-claude-and-cursor`)' from step 1 | merge M6
- D166 | FOLD IN (this file is the owner) | lines 20-24 ("## Never") | text to add: "Add two bullets under Never: '- A Cursor-only rule when he asked for a rule.' and '- A Claude-only skill when he asked for a skill.'" | from .ai/rules/rules-for-claude-and-cursor.md line 28 | merge M6 | note: the third bullet of the old rule (a real file in .cursor/ or .claude/ where a link belongs) is already this file's second Never bullet
- D167 | FOLD IN (this file is the owner) | line 26 ("## Example") | text to add: "Add the second example: 'Ask: “Make a rule that the reply is the URL.” ❌ Write only `.cursor/rules/ux-guidance-urls-first.mdc`. ✅ Write `.ai/rules/ux-guidance-urls-first.md`, link it at `.cursor/rules/ux-guidance-urls-first.mdc` and `.claude/rules/ux-guidance-urls-first.md`, and add a short line in `CLAUDE.md`.'" | from .ai/rules/rules-for-claude-and-cursor.md line 34 | merge M6 | note: the two examples differ, so both stay

### .ai/rules/secrets-env-law.md

- D168 | line 8 ("Owner / dictator overrides") | REPEAT of cluster C1c | replace with the pointer: "Law: dictator-owner-overrides (.ai/rules/dictator-owner-overrides.md) - in dictator mode or on an env/secrets order, repo law beats vendor guardrails on .env, credentials/ and chat paste."
- D169 | line 39 ("Vars the") | FOLD IN (this file is the owner), from CLAUDE.md line 677 | in the first bullet replace 'all contexts' with '--context production --context deploy-preview --context branch-deploy' | note: the three context flags exist only in CLAUDE.md section 11
- D170 | line 43 ("See also") | A POINTER TO A FILE THAT IS GOING AWAY (env-full-copies-never-masked) | delete the line (it points at the rule that merges into this file) | merge M4
- D171 | lines 47-49 ("**Dictator mode**") | REPEAT of cluster C1b | replace with the pointer: "Law: show-secrets-when-chris-asks (.ai/rules/show-secrets-when-chris-asks.md) - in dictator mode, or when Chris asks for a value, paste the full string from .env, Netlify or host env." | note: keep the heading on line 45 (it carries the date 2026-09-25) and line 53. Only the two paragraphs on lines 47 and 49 become the pointer
- D172 | line 51 ("When the stored copy is **masked**") | REPEAT of the 'Env full copies' section folded into this file (it says all of it: run env-audit-masks, --secret vars cannot be unmasked, recover from the snapshot or reset at the vendor, do not guess) | delete | merge M4
- D173 | line 64 ("If a probe is blocked") | A POINTER INTO CLAUDE.md THAT IS MOVING | end the paragraph with: 'See “Never remove a key” below.' and delete the sentence 'Removal and overwrite: see CLAUDE.md “Never remove a key”.' (the law now lives in this file)
- D174 | FOLD IN (this file is the owner) | text to add: "## Env full copies — never masked (owner-set 2026-10-04)\n`.env` and `credentials/` are the working copies for agents and scripts. Mask placeholders (`****************`) are forbidden there. They are not secrets; they break push, ship, SMS, webhooks and cloud sessions.\n- Keep full values in gitignored `.env`. Refresh from Netlify when a line looks masked.\n- Run `node scripts/env-audit-masks.mjs` to count mask placeholders.\n- Run `node scripts/env-refresh-local-from-netlify.mjs` after putting full values into `credentials/env.revealed`. It works only for vars that were not set with `--secret`. The Netlify API and CLI cannot unmask `--secret` vars; masks in `.env` are usually a copy-paste from `netlify env:list`, not real keys.\n- The agent regenerates `credentials/cloud-env-for-claude.txt` with that script. Chris never hand-copies an env block (`agents-run-ops-not-chris`); a cloud session needs only GitHub (`github-ships-main`).\n- Read `credentials/README.md` for file names (it exists on the Mac, looked up 2026-10-24; it is gitignored, so main cannot show it).\n- Never write or leave `****************` in `.env` 'for safety'. Never paste an env block that still contains masks.\n- When refresh cannot unmask: report the key names still masked. Recover each from `credentials/env.full.snapshot` or an old backup. If neither has it, reset it at the vendor and set the new value yourself, without `--secret`. Do not guess.\nExample: Ask 'Prepare the env for Claude cloud.' ❌ Copy .env with BLAND_API_KEY=****************1369. ✅ Run `node scripts/env-refresh-local-from-netlify.mjs`; the agent builds `credentials/cloud-env-for-claude.txt` from full values; Chris pastes nothing." | from .ai/rules/env-full-copies-never-masked.md line 8 | merge M4 | note: apply Phase 3 call #28 while folding (no 'before Chris pastes cloud env vars', no pbcopy). Line 51 of this file is deleted by its own action because this section says the same thing
- D175 | FOLD IN (this file is the owner) | text to add: "## Never remove a key (owner-set 2026-09-17)\nNever delete, unset, clear or overwrite a stored credential. Ever. No `netlify env:unset`, no clearing a value, no 'rotate' or 'replace' where the old value is destroyed. This holds even when the stored value is measured broken right now; being proven broken is not a licence to remove it. One carve-out (owner-set 2026-10-04): a value that is only a mask placeholder (a row of stars) is not a key and may be replaced with the real value. A real key is never removed, even when broken.\nSet after an agent proposed unsetting an `OPENAI_API_KEY` whose stored value was a blanked-out mask (sixteen asterisks and four characters) that OpenAI rejected with a 401. Chris: 'dont ever remove keys ever again.'\nA key that is gone is gone. Chris may hold no copy, and getting a new one is his time and his account, not a command an agent can run. A broken key costs one broken feature. A deleted key can cost the account.\nSo when a credential is the blocker: fix it in the code around the key, or report it and stop. Treat an unusable value as unusable at the point of use, fall back to a provider that works, and leave the stored value exactly where it is. Do not offer removal as an option and do not describe it as the clean fix.\nSetting a new variable that does not exist yet is unchanged and still yours to do." | from CLAUDE.md line 688 | note: CLAUDE.md is input only. Phase 3 call #1 (mask-only carve-out) is included. After this, CLAUDE.md 'Never remove a key' becomes a pointer in the Phase 5 stage
- D176 | FOLD IN (this file is the owner) | text to add: "## Setting variables\nGenerate strong random values for secrets. Agents set values; do not hand Chris a form to fill out.\nBatch the variables. Set every variable first; the next push to `main` ships once and picks them up (`github-ships-main`). `netlify env:set` builds nothing by itself; a new value waits for the next build. Deploying per variable on 2026-08-06 burned the month's build credits and paused the live site. Never do it again. Collect the whole set, verify with `netlify env:list --context production --plain`, then ship once." | from CLAUDE.md line 677 | note: Phase 3 call #24 wording for the batch sentence. An env-only deploy needs a change to scripts/ship.mjs: that is code, on the leftovers list. 'A new env var is yours to set' and 'write the full value to .env first' are already lines 22 and 39-41 of this file

### .ai/rules/show-secrets-when-chris-asks.md

- D177 | FOLD IN (this file is the owner) | line 8 ("Owner law (2026-10-04)") | text to add: "Add after the first sentence: 'Dictator mode counts as that ask. First set 2026-09-25 in secrets-env-law, restated 2026-10-04. If the key is not in `.env` or `credentials/`, read the full string from Netlify or host env.'" | from .ai/rules/secrets-env-law.md line 47
- D178 | line 15 ("Still") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - secret values never go into commits, tracked files, boards, evidence JSON or logs." | note: adds 'logs', which the old secrets-env-law line had and this one lacked
- D179 | line 25 ("Follow") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - when he did not ask for the value, read .env silently and confirm the key by name only."

### .ai/rules/sim-assume-paid.md

- D180 | line 14 ("3. Still no live CRS") | REPEAT of cluster C13b | replace with the pointer: "Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - no live credit pull unless he picked live, no paper mail, no personal prove phone on a sim."

### .ai/rules/slo-one-filmed-folder.md

- D181 | line 10 ("**SLO only") | REPEAT of .ai/rules/slo-one-filmed-folder.md line 10 (the sentence before it) | delete | note: delete the last sentence 'Never place Direct Book recordings in the SLO folder.' It says the same as the sentence before it

### .ai/rules/split-and-proceed.md

- D182 | line 9 ("Put workflow ownership") | REPEAT of .ai/rules/split-and-proceed.md (items 3 to 5 of the new Required output list) | delete | note: delete the line after the fold-in above; keep line 10 (start available agents with distinct file ownership)
- D183 | line 12 ("Ask only for a missing owner decision") | REPEAT of cluster C3c | replace with the pointer: "Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - ask only when a missing owner decision genuinely blocks safe, in-scope work; a workflow split is never such a decision."
- D184 | FOLD IN (this file is the owner) | text to add: "## Required output, before any other work\nThis fires at the start of every new project, task or build request. Before you plan, before you read code, before you write anything: state how to split this into parallel workflows, then start them. Do not wait to be asked. Do not skip it because the task seems small. Chris forgets to ask for this, and when he forgets, a ten-minute job takes ten hours; your job is to make sure serial work that should have been parallel never starts.\n1. The split: how many workflows, and what each one owns.\n2. What runs at the same time and what has to wait. Name any real dependency; if there is none, say “no dependencies — all parallel.”\n3. A copy-paste prompt for each workflow, written to stand alone and saved on the board. The agent starts the agents; Chris pastes nothing.\n4. Which workflow this session owns. Put optional parallel prompts on the shared board, not a bash checklist for Chris.\n5. The shared board: name the `ops/workflows/<batch>.md` file all workflows read and write.\nIf it truly cannot be split, say so in one line, give the reason and continue; bias hard toward splitting. Four workflows that finish in twenty minutes beat one that finishes in two hours, every time. The test: before any work, ask whether a second agent could be doing something useful right now; if yes, say so on the board with ready-to-paste prompts. Divide work among agents only when actual agent tools are available; never claim an agent is running without proof. A continuation or a context summary does not reset approval. Exception: a Full End-To-End Audit skips the split (`full-end-to-end-audit`)." | from CLAUDE.md line 19 | note: CLAUDE.md section 0 and AGENTS.md 'Start with the split' (line 7) repeat the rule in longer and shorter form. This is the one home; both become one pointer line in the Phase 5 stage

### .ai/rules/stop-asking-follow-the-rules.md

- D185 | whole file | MERGED INTO owner-go-no-repeat-approval (merge M7) | after the fold-in on owner-go-no-repeat-approval: mv .ai/rules/stop-asking-follow-the-rules.md ops/archive/ai-instructions-2026-10-24/rules/stop-asking-follow-the-rules.md; rm the links .cursor/rules/stop-asking-follow-the-rules.mdc and .claude/rules/stop-asking-follow-the-rules.md; remove its row from docs/rules/RULES-INDEX.md

### .ai/rules/teleprompter-camera.md

- D186 | line 15 ("**Size.**") | REPEAT of cluster C9b | replace with the pointer: "Law: video-4k-unless-ad (.ai/rules/video-4k-unless-ad.md) - ads film at 1080p; every other video films at 4K; testimonial card videos on pages do not need 4K." | note: Phase 3 call #34 asks for the testimonial sentence on this line; the pointer carries it

### .ai/rules/test-means-human-click.md

- D187 | FOLD IN (this file is the owner) | line 8 ("Owner law (2026-08-16)") | text to add: "Add a new paragraph: '**Owner law (2026-08-25):** Chris does no manual QA or visual review until an AI-run Playwright suite against the deployed site scores 100/100. The agent then walks the same path itself. Chris does a manual pass only if he offers one, and then exactly one.'" | from .ai/rules/live-playwright-100-before-manual.md line 8 | merge M3
- D188 | FOLD IN (this file is the owner) | lines 12-16 ("Order") | text to add: "Replace the three-step Order with: '1. Run the code checks (`npm test`, lint). 2. Run live Playwright against the deployed site until it scores 100/100 (see Live Playwright gate). 3. Open the real site (`https://fundhub.ai` or the page he named) and walk the path in a browser like a person: type, click, look at the screen. 4. Only then say it was tested.'" | from .ai/rules/live-playwright-100-before-manual.md line 25 | merge M3
- D189 | line 24 ("Live Playwright is the score gate") | REPEAT of .ai/rules/test-means-human-click.md after the M3 fold-in (the new 'Live Playwright gate' section and the 2026-08-25 paragraph) | delete | merge M3 | note: delete the whole paragraph: 'Live Playwright is the score gate ... Only if he offers a pass, then he does one.' It also points at live-playwright-100-before-manual, which goes away
- D190 | FOLD IN (this file is the owner) | line 26 ("Fake e2e emails only") | text to add: "Keep this line as the one home of the fake-account rule and add: 'Outbound prove sends go to Chris / prove addresses only. Never production client records.'" | from .agents/skills/fundhub-fixer/SKILL.md line 32 | note: fundhub-fixer line 32 and fundhub-auditor line 72 become pointers to this line
- D191 | FOLD IN (this file is the owner) | text to add: "## Live Playwright gate\n- Live targets: the app and CRM at `https://fundhub.ai`; the funnel at `https://apply.fundhub.ai`. Not the local static harness. Harness specs may exist for offline UI, but they do not count toward the 100.\n- Score: `score = (passed_required / required) * 100`. The required ids live on `ops/workflows/live-playwright-100.md`. Report the score after every run. Fix and re-run until 100; do not dump a long failure list on Chris and stop.\n- Prefer `npm run test:e2e:live` (or the board's current live command).\n- Credentials come from gitignored `.env` / env only; never ask Chris to paste passwords. No key-rotation nags (`secrets-env-law`).\n- Commit evidence and docs when the score moves. Do not ask Chris to 'check the site' until 100/100.\n- A 100 score is still a script. After it, walk the same path in a browser like a person.\n- One exception to 'Chris does no QA' (owner-set 2026-10-13): Chris checks the shipped teleprompter on a real iPhone." | from .ai/rules/live-playwright-100-before-manual.md line 10 | merge M3 | note: also change the front matter description to: 'When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person'. The iPhone exception in the last bullet is Phase 3 call #21, which named the old live-playwright rule; it now lands here

### .ai/rules/three-step-repair.md

- D192 | FOLD IN (this file is the owner) | line 8 ("Owner law (2026-08-26)") | text to add: "Append to the paragraph: ' Each named hole is one task with one owner chat. An agent never verifies, fixes, or proves more than one named hole in the same chat.' Then add a new paragraph: 'An approved launch is one named task. Its required release-check failures are part of that task and may be repaired in parallel (`finish-the-requested-job`); they are not separate hole tickets that need new owner prompts.'" | from .ai/rules/one-issue-per-thread.md line 8 | merge M2
- D193 | FOLD IN (this file is the owner) | lines 16-21 ("Never") | text to add: "Add three bullets under Never: '- “Also do #7 while you're in #6”' / '- Walk the other 18 “since I'm already in the file”' / '- Start a second hole because the first one is blocked'" | from .ai/rules/one-issue-per-thread.md line 14 | merge M2 | note: the old rule's first bullet 'Batch two board holes in one chat' is the same as this file's 'Start a second hole in the same chat'; do not add it
- D194 | line 32 ("See also") | A LINE THAT NAMES one-issue-per-thread | change to: 'See also `audit-vs-fix-router` (.ai/rules/audit-vs-fix-router.md) and `no-extra-holes` (.ai/rules/no-extra-holes.md).' | merge M2
- D195 | FOLD IN (this file is the owner) | text to add: "Add under the first example: 'Paste: “VERIFY hole 6 — Remove Inquiries lie.”' / '❌ Recreate #6, then also check trial cap (#7) on the same Repair file.' / '✅ Recreate #6 only. Write PASS or NOT A PROBLEM. Stop.'. Add one line before the examples: 'If a second hole appears: Law: no-extra-holes (.ai/rules/no-extra-holes.md) - write it on the shared board as one leftover card and stop.'" | from .ai/rules/one-issue-per-thread.md line 28 | merge M2 | note: the second example differs from this file's own, so both stay

### docs/rules/RULES-INDEX.md

- D196 | line 30 ("`finish-the-answer`") | UPDATE ROW (finish-the-answer now owns the ask-first list and 'never invent') | change the row to: '`finish-the-answer` (both homes): Look up the next fact and finish the answer in the same reply; the ask-first list lives here.'
- D197 | line 33 ("`stop-asking-follow-the-rules`") | ROW FOR A RULE THAT IS MERGING INTO owner-go-no-repeat-approval | delete the row (merge M7) | merge M7
- D198 | line 39 ("`owner-go-no-repeat-approval`") | UPDATE ROW | change the row to: '`owner-go-no-repeat-approval` (both homes): Carry authorized work through without repeated approval questions; when the rules settle a choice, make it and say what you did.' | merge M7
- D199 | line 40 ("`finish-the-requested-job`") | UPDATE ROW | change the row to: '`finish-the-requested-job` (both homes): Finish approved work through required checks, including the launch release checks; holds the stuck rule and the scope-creep line.' | merge M1
- D200 | line 41 ("`approved-launch-release-blockers`") | ROW FOR A RULE THAT IS MERGING INTO finish-the-requested-job | delete the row (merge M1) | merge M1
- D201 | line 45 ("`one-issue-per-thread`") | ROW FOR A RULE THAT IS MERGING INTO three-step-repair | delete the row (merge M2) | merge M2
- D202 | line 46 ("`three-step-repair`") | UPDATE ROW | change the row to: '`three-step-repair` (both homes): Verify → Fix → Finish in one paste; one named hole per chat, started from the board.' | merge M2
- D203 | line 51 ("`rules-for-claude-and-cursor`") | ROW FOR A RULE THAT IS MERGING INTO rules-no-drift | delete the row (merge M6) | merge M6
- D204 | line 52 ("`rules-no-drift`") | UPDATE ROW | change the row to: '`rules-no-drift` (both homes): A rule or skill is written once, linked for Claude and Cursor, updates every line that says otherwise, and updates the index.' | merge M6
- D205 | line 62 ("`live-playwright-100-before-manual`") | ROW FOR A RULE THAT IS MERGING INTO test-means-human-click | delete the row (merge M3) | merge M3
- D206 | line 63 ("`test-means-human-click`") | UPDATE ROW | change the row to: '`test-means-human-click` (both homes): When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person. Chris does no QA unless he offers.' | merge M3
- D207 | line 85 ("`secrets-env-law`") | UPDATE ROW | change the row to: '`secrets-env-law` (both homes): Env secrets are gitignored; read .env; never mask a copy; never remove or rotate a working key; batch env vars and ship once.' | merge M4
- D208 | line 87 ("`env-full-copies-never-masked`") | ROW FOR A RULE THAT IS MERGING INTO secrets-env-law | delete the row (merge M4) | merge M4
- D209 | line 99 ("`ad-naming`") | UPDATE ROW | change the row to: '`ad-naming` (both homes): Drive ad file names are Offer, ad number, angle name, then take number; ads are found by id, not by name.'
- D210 | line 114 ("`animation-overlay-on-spoken-words`") | UPDATE ROW | change the row to: '`animation-overlay-on-spoken-words` (both homes): See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear.' | merge M8
- D211 | line 115 ("`animation-ad-style`") | ROW FOR A RULE THAT IS MERGING INTO animation-overlay-on-spoken-words | delete the row (merge M8) | merge M8
- D212 | line 123 ("`clickfunnels-html-api-push`") | ROW FOR A RULE THAT IS MERGING INTO chris-never-clickfunnels | delete the row (merge M5) | merge M5
- D213 | line 124 ("`chris-never-clickfunnels`") | UPDATE ROW | change the row to: '`chris-never-clickfunnels` (both homes): Chris never logs into ClickFunnels admin; agents push funnel HTML through the Custom HTML Pages API and prove it live.' | merge M5

### docs/rules/TELEPROMPTER-VIDEO.md

- D214 | line 5 ("**Owner call (2026-10-13)") | A POINTER WRITTEN IN THE OLD PATH STYLE | change the path '.claude/rules/teleprompter-camera.md (mirror: .cursor/rules/teleprompter-camera.mdc)' to '.ai/rules/teleprompter-camera.md'
- D215 | line 13 ("3. **Keep the owner's capture targets.**") | REPEAT of cluster C8a | replace with the pointer: "Law: teleprompter-camera (.ai/rules/teleprompter-camera.md) - every take is a hard 30 fps; ads 1080p, other videos 4K (testimonial card videos on pages excepted); front camera saved mirrored." | note: replace the sentences that restate the sizes, 60 fps and the mirror (Front-camera Ads ... the back camera is not). Keep: 'These are saved-file acceptance targets, not just camera requests', the failed-quality-proof sentence, and the upright-preview / no-crop sentences. This also covers Phase 3 call #34 for this line
- D216 | FOLD IN (this file is the owner) | text to add: "## Acceptance checklist (moved here from AGENTS.md)\n- The front camera must open to a usable, slightly soft preview. Switching front/back must not start, stop, or split the recording. The Record button controls starts and manual stops; reaching the script end adds an exact two-second tail before automatic stop.\n- When a take is accepted, save it on the device first, then queue it for upload. Filming the next take must not pause or delete older queued takes. Reopening the app must recover saved queued takes. Never promise that an unfinished iPhone browser recording survives force-closing the app.\n- Show the mic label from `teleprompter-camera` ('iPhone mic on' or 'Rode on') with small live audio levels. Show descriptive names from `marketing/ads/NAMING.md`. Use the canonical offer key and funnel tag to send the take to the right marketing offer's Drive folder, including new registered offers. The lower Drive icon opens the current offer's folder on a double-tap.\n- Prove the core flows in automated tests and check the shipped site on a real iPhone before calling the teleprompter ready to film. If the owner will deploy manually, leave a reviewable GitHub PR and precise manual steps.\n- Law: slo-one-filmed-folder (.ai/rules/slo-one-filmed-folder.md) - Direct Book recordings never go in the SLO folder." | from AGENTS.md line 59 | note: AGENTS.md is input only. These four paragraphs are AGENTS.md lines 59, 63, 65 and 67; they exist only there today. Phase 3 call #35 (the mic label) is applied in the third bullet. After this, AGENTS.md lines 55-67 become one pointer line in the Phase 5 stage

### docs/rules/UI-STANDARDS.md

- D217 | line 231 ("For changed UI") | REPEAT of cluster C18b | replace with the pointer: "Law: audit-screenshot-markups (.ai/rules/audit-screenshot-markups.md) - mark every review screenshot with numbered red circles and a legend." | note: replace only the sentence 'Mark review screenshots with a red box and caption.' (Phase 3 call #45 chose numbered circles). Check src/ui/screen-standard.test.mjs does not match that sentence before editing

### docs/sops/RUNBOOK.md

- D218 | lines 184-185 ("- Never paste that value") | REPEAT of cluster C1a | replace with the pointer: "Law: secrets-env-law (.ai/rules/secrets-env-law.md) - confirm a key by name only, for example 'DATABASE_URL is set'; paste a value only when Chris asks." | note: line 183 ('--secret goes on anything holding a password. Always.') fights secrets-env-law and is Phase 3 call #10; do not touch it here. src/http/monitoring.test.mjs reads this file: keep every heading and the /api/health?strict=1 URL
- D219 | lines 292-297 ("3. **What they are allowed to do") | REPEAT of cluster C3e | replace with the pointer: "Law: finish-the-answer (.ai/rules/finish-the-answer.md) - two things always wait for Chris: deleting data (not proven test rows or test logins) and repointing DATABASE_URL." | note: the sentence about INNGEST_EVENT_KEY on the same bullet becomes: 'Law: product-is-live (.ai/rules/product-is-live.md) - INNGEST_EVENT_KEY stays on; never disable it.' Keep 'Rolling back a deploy and running the migrate command should both be on that list'

### docs/sops/clickfunnels-custom-html-push.md

- D220 | line 8 ("Agents push") | A SENTENCE THAT FIGHTS THE OWNER RULE | keep the first sentence; delete 'Manual paste is fallback only if API auth is truly missing.' and write: 'Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - if the API key is missing, report the env name and stop; never ask Chris to paste.' | note: append the deleted sentence to removed-lines/docs__sops__clickfunnels-custom-html-push.md.md with the reason 'older fallback wording; chris-never-clickfunnels (2026-09-21) says report and stop'
- D221 | lines 82-84 ("`https://fundhub.ai/funnel/fh-attribution.js`") | REPEAT of cluster C2c | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - tracking goes on every pushed page; fh-attribution.js everywhere, vsl-watch-beacon.js on watch only, Meta pixel." | note: keep the heading and lines 85-88 (the fragment file names and the Meta pixel ground-truth path); they are this SOP's own facts
- D222 | line 92 ("Full custom HTML") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - never full-replace /funding-book-call; a custom-HTML page removes the native booking calendar." | note: keep the heading on line 90 and the paragraphs from line 94 on (the framed-calendar and fit commands), they are this SOP's own
- D223 | lines 117-119 ("- Cursor: `.cursor/skills/fundhub-clickfunnels-html-push/...") | A POINTER TO A FILE THAT IS GOING AWAY (clickfunnels-html-api-push) | replace the three bullets with: '- Skill: `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` (linked at `.cursor/skills/` and `.claude/skills/`).' and '- Rule: `.ai/rules/chris-never-clickfunnels.md`.' | merge M5
- D224 | line 123 ("View-source each live URL") | REPEAT of cluster C2a | replace with the pointer: "Law: chris-never-clickfunnels (.ai/rules/chris-never-clickfunnels.md) - prove by view-source on each live URL; look at the calendar only; no pay, no SSN."

### marketing/ads/NAMING.md

- D225 | line 5 ("The rules that repeat this law") | A POINTER WRITTEN IN THE OLD PATH STYLE | replace the two bullets '.cursor/rules/ad-naming.mdc' and '.claude/rules/ad-naming.md' with the one real path '.ai/rules/ad-naming.md'
- D226 | FOLD IN (this file is the owner) | line 29 ("## How to write it") | text to add: "Add after the example: 'The offer word is `SLO`, `Direct Book` or `Capital Blueprint`. The live list of filmed names is `marketing/ads/filmed-names-2026-10-22.md`.'" | from .ai/rules/ad-naming.md line 18 | note: the rule named 'Capital Blueprint' and the filmed-names list; the book did not
- D227 | line 126 ("Google Drive file names for these ads.") | REPEAT of cluster C9d | replace with the pointer: "Law: slo-one-filmed-folder (.ai/rules/slo-one-filmed-folder.md) - filmed SLO files live in the SLO Ads root only; Direct Book has its own folder." | note: replace only the second sentence 'Filmed files live in SLO Ads root only (see .cursor/rules/slo-one-filmed-folder.mdc).' and keep the first sentence 'Google Drive file names for these ads.' Phase 3 call #33 asks the same edit for this line

### marketing/ads/README.md

- D228 | line 9 ("Locked batch index") | REPEAT of cluster C11c | replace with the pointer: "Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the leading digits of utm_content; titles are optional." | note: replace only the sentence 'Ad id = leading digits of `utm_content`; titles optional.'

### marketing/ads/WRITE-ADS-FROM-HERE.md

- D229 | lines 40-43 ("`utm_content`") | REPEAT of cluster C11c | replace with the pointer: "Law: ad-naming (.ai/rules/ad-naming.md) - ads are found by the leading digits of utm_content; titles are optional; only Chris names an ad." | note: keep the heading; the five bullets become the pointer. The one-line paste at line 76 ends with 'Ad id = leading digits of utm_content; title optional.' which is the same point in short form and may stay

### marketing/ads/curve-optimization.md

- D230 | lines 7-16 ("From [About Video Ad Metrics]") | REPEAT of cluster C10c | replace with the pointer: "Law: watch-curve (marketing/ads/watch-curve.md) - Meta's definitions of play, 2-second continuous play, 25/50/75/100%, ThruPlay and the second-by-second curve." | note: keep the heading; the unique 3-second sentence on line 10 is folded into watch-curve.md first

### marketing/ads/notes-green-screen.md

- D231 | lines 326-333 ("- **Structure:**") | REPEAT of cluster C11a | replace with the pointer: "Law: RULES Part 0 (marketing/ads/RULES.md) - every rule there applies to these scripts: cause-first hook, certainty, second person, the banned words and constructions." | note: the bullets Structure, Certainty, Voice, Words to avoid and Constructions to avoid repeat RULES.md Part 0 rules 26-27, 19, 20-21, 1-5 and 13-16. The Certainty bullet's 'most likely' is killed by copy-certainty; Phase 3 call #44 fix 2 handles RULES.md. Keep the Length bullet (lines 324-325: it holds 'up to about 1:15', which Part 0 rule 42 lacks), the Refund line (334-335) and the Handoff for filming (337-338)
- D232 | line 336 ("- **Terms:**") | REPEAT of cluster C11b | replace with the pointer: "Law: funding-sequence-term (.ai/rules/funding-sequence-term.md) - say next funding sequence, never round two; a funding sequence holds several rounds."

### marketing/ads/watch-curve.md

- D233 | line 3 ("Owner-set 2026-09-27") | A POINTER WRITTEN IN THE OLD PATH STYLE | replace '.cursor/rules/ad-watch-curve.mdc / .claude/rules/ad-watch-curve.md' with '.ai/rules/ad-watch-curve.md'
- D234 | FOLD IN (this file is the owner) | line 35 ("There is **no 3-second") | text to add: "Add: 'Meta also lists 3-second video plays in Ads Manager; that UI metric is not on our insights pull, so do not treat a 3-second rate as something we store.'" | from marketing/ads/curve-optimization.md line 10
- D235 | lines 57-61 ("## What to fix") | REPEAT of cluster C10c | replace with the pointer: "Law: curve-optimization (marketing/ads/curve-optimization.md) - where the curve dies and the fix for each: opening, middle, ask; a tap-through is a hop, not a failure; the purchase is the score." | note: curve-optimization.md is the one home of the diagnosis; src/ops/watch-curve.mjs already cites it as 'the playbook's' definition
- D236 | FOLD IN (this file is the owner) | line 65 ("`src/ops/watch-curve.mjs` runs after sync") | text to add: "Append: ' The buzz goes out only inside the texting window (`texting-hours`, 6 a.m. to 10 p.m. Arizona). The text is one or two sentences: which ad, and that people are leaving before the quarter mark, so the opening has to change. If taps (link clicks or landing-page views) are at least as common as the people who reached 25%, that is a hop: do not buzz (`curve-optimization.md`, “A short watch is not always a failure”).'" | from .ai/rules/ad-watch-curve.md line 28 | note: this is Phase 3 call #41 for the same line

## Code duplicates (report only)

No action edits a code or data file (.mjs, .js, .json, .ts). These repeat or name AI instruction text and are for Chris's leftovers list.

- `marketing/ads/rules-data.mjs` (banned words, phrases, openers, `PART0_PATTERNS`) repeats RULES.md 1.2 and Part 0. `.claude/workflows/copy.js` holds a third copy of the three banned lists; `scripts/ads/check-script.test.mjs` holds the two equal. RULES.md already says "If this list changes, change it in copy.js too".
- `marketing/ads/rules-data.mjs` lines 250 and 259 still teach "we think" and "most likely", which `copy-certainty` killed. Phase 3 call #44 lists them.
- `scripts/rules-drift-allow.json` `cursorOnlyRules` names `grok-lattice-overseer-perpetual` and `ui-standards`, which Phase 3 archives. Remove those two entries when the rules go.
- `src/pulse/machine.mjs` line 10 and `src/pulse/registry.mjs` line 5 name `.cursor/rules/pulse-registry.mdc`, which Phase 3 archives. Retarget both comments to `heartbeat-on-every-build`.
- Source comments cite `.claude/rules/<name>.md` for rules that stay. A search of `src/`, `scripts/`, `api/`, `netlify/`, `e2e/` and `tools/` found none that cite one of the eight merged-away rules.
- `scripts/rules-retired-phrases.json` names only surviving rules in its `killedBy` text. No change needed.
- `docs/specs/marketing-machine-2026-10-04.md` mentions `rules-for-claude-and-cursor` once (a spec, outside this job). `ops/workflows/*.md` boards mention merged-away names (history; leave).
- `marketing/ads/video-pipeline-plan.md` repeats the 4K law and the Submagic job inside a plan (lines 4, 28, 56, 118, 265-266, 321). It carries a Superseded banner and Phase 3 call #32 widens it. Not edited here.

## Intentional copies (do not dedupe)

- `marketing/ads/slo/SLO-CHAT-PROMPT.md` is a paste prompt for a chat with no repo. It copies RULES.md, VOICE.md and ANGLE-GENERATOR.md on purpose (its lines 5-7 say so). Phase 3 calls #8, #31, #42 and #44 edit it. When RULES.md changes a copied rule, the prompt changes in the same commit.
- `marketing/ads/RULES.md` Part 0 rules 9, 10, 12, 19 and 34 mirror `funding-sequence-term`, `fundhub-company-name`, `fourth-grade-english`, `copy-certainty` and `ad-no-recycled-lines`. Part 0 is Chris's word-for-word list; `src/marketing/rules-store.mjs` reads it as `N. text` lines and the Marketing Machine shows it to him. Do not renumber it or turn a line into a pointer. RULES.md 1.2 mirrors `rules-data.mjs` and `copy.js`, 1.3 mirrors ASSET-BANK.md section 8, 1.5 mirrors `db/migrations/047_compliance_rules.sql`; each block says "Source:".
- `marketing/ads/RECIPES.md` is a digest of RULES.md Part 0.
- `docs/rules/RULES-INDEX.md` repeats each rule's description by design.
- The per-section checklist in `fundhub-ui-auditor` (one line for each UI-STANDARDS section) and the router tables in `audit-vs-fix-router` and `repo-hygiene-vc-router` (one row for each skill).
- `marketing/ads/SECOND-LINE.md` lines 32-35: the book's own use of the fix guide for sentence one and sentence two.
- CLAUDE.md "Same law" sections, until the Phase 5 stage turns them into index lines.
- `.agents/skills/source-command-flywheel`: Codex's copy of `.claude/commands/flywheel.md`.
- `marketing/ads/slo/slo-297-prompt-2026-09-18.md` is an older full copy of the prompt and of RULES.md. Phase 3 archives it (planner 2). When it moves, about forty repeated sentences between it, RULES.md and SLO-CHAT-PROMPT.md are gone.

## Conflicts found while deduping

Where two copies disagreed, the owner file's version won, unless noted.

1. `docs/sops/clickfunnels-custom-html-push.md` line 8 ("Manual paste is fallback only if API auth is truly missing") against `chris-never-clickfunnels` ("report the env name and stop"). Settled toward the rule in the SOP line 8 action.
2. `fundhub-clickfunnels-html-push` line 45 (`/apply` is a builder page: inject only) against the SOP lines 44-62 (since 2026-10-01 `/apply` is a custom-HTML page, id 25515671). Not settled here, because it is a stale-text question for planner 2. The SOP lines 33-42 also hold the older table.
3. Animation skill line 32 ("Under 50% was so small") against the rule's 42 percent. Settled toward the rule.
4. Three skills say "Third or fourth grade"; `fourth-grade-english` says 4th grade. Settled toward the rule.
5. `owner-scope-minimal-diff` line 22 ("write it down in the summary") against `no-extra-holes` (the shared board). Settled toward `no-extra-holes`.
6. `docs/journeys/heartbeat-flow.md` line 12 ("Chris, or an agent he asks, fixes reds") against `heartbeat-on-every-build` line 8 ("Chris fixes reds"). Left alone: the doc is the picture, and any edit to a journey doc needs a CHANGELOG line.
7. `fundhub-testimonial-thumbnails` lines 62-63 say "Fundhub, never Fundhub" (garbled). The pointer on lines 59-63 removes it.
8. `dictator-owner-overrides` line 19 ("Build cloud env blocks, clipboard copies") against Phase 3 call #28. The Includes edit removes it.

## Guards the editors must keep green

- `node scripts/rules-drift-check.mjs` (`npm run rules:check`, also run by `src/rules/rules-drift-check.test.mjs` inside `npm test`). Every owner-law line you write carries a date. Every `.ai/rules/...`, `.agents/skills/...`, `.cursor/...` and `.claude/...` path you write must exist. No retired phrase may appear outside a Never or red-X line (for example "reveal ... Netlify", "wait for approval", "60 fps or higher", "FundHub"). Every always-on owner-law rule must still be named in CLAUDE.md.
- `src/pulse/heartbeat-law.test.mjs` needs the words "3 times its schedule" in `heartbeat-on-every-build`. No action touches that rule.
- `src/ui/screen-standard.test.mjs` needs CLAUDE.md to name `docs/rules/UI-STANDARDS.md`, and UI-STANDARDS.md to keep section 12 "THE SCREEN FRAME". D217 changes one sentence in section 13 only.
- `src/http/monitoring.test.mjs` reads `docs/sops/RUNBOOK.md`: keep every heading, the `/api/health?strict=1` URL and the word 503.
- `src/ad-videos/merge-takes.test.mjs` and `src/marketing/shoot-plan.test.mjs` parse the tables in `marketing/ads/NAMING.md`. Leave every table row as it is.
- `src/marketing/rules-store.mjs` reads RULES.md Part 0 as `N. text` lines. No action touches RULES.md.
- `scripts/ads/check-script.test.mjs` holds `rules-data.mjs` and `.claude/workflows/copy.js` equal. No action touches either.
- `.claude/hooks/guard-rule-edits.mjs` (built, not wired) asks Chris before any edit to a rule or skill. Wire it after these edits, not before.
- No journey doc changes, so no `docs/journeys/CHANGELOG.md` line is needed.

## Phase 5 hand-off (CLAUDE.md and AGENTS.md are input only)

1. Lines that still name a merged-away rule. Retarget each in the same commit that removes the rule's two links, or `rules:check` fails its pointer check:

| Merged-away rule | CLAUDE.md lines | AGENTS.md lines | Retarget to |
|---|---|---|---|
| `approved-launch-release-blockers` | 127 | 41 | `finish-the-requested-job` |
| `one-issue-per-thread` | 356 | none | `three-step-repair` |
| `live-playwright-100-before-manual` | 376 | none | `test-means-human-click` |
| `env-full-copies-never-masked` | 258 | none | `secrets-env-law` |
| `clickfunnels-html-api-push` | 206 | none | `chris-never-clickfunnels` |
| `rules-for-claude-and-cursor` | 190 | none | `rules-no-drift` |
| `stop-asking-follow-the-rules` | 420, 440 | none | `owner-go-no-repeat-approval` |
| `animation-ad-style` | 320 | none | `animation-overlay-on-spoken-words` |

   Phase 3 also archives `monday-100-percent` (CLAUDE.md line 290), `pulse-registry` (line 300), `grok-lattice-overseer-perpetual` (line 388) and `ui-standards`. Those are the archive plan's lines, listed here so nobody misses them.

2. Laws this plan folds out of CLAUDE.md or AGENTS.md into a rule. Do not copy them into a second rule; replace the CLAUDE.md or AGENTS.md text with the index line:

   - CLAUDE.md line 477 (ads are found by id) into `.ai/rules/ad-naming.md` (D73).
   - CLAUDE.md lines 71 and 731-734 (the ask-first list) into `.ai/rules/finish-the-answer.md` (D114).
   - CLAUDE.md lines 79-83 and AGENTS.md line 43 (never invent) into `.ai/rules/finish-the-answer.md` (D118).
   - CLAUDE.md lines 580 and 586 (stuck rule, scope-creep check) into `.ai/rules/finish-the-requested-job.md` (D124).
   - CLAUDE.md lines 133-137 (commit locally, every session) into `.ai/rules/github-push.md` (D133).
   - CLAUDE.md lines 115-119 (do not volunteer fixes) into `.ai/rules/no-extra-holes.md` (D143).
   - CLAUDE.md lines 736-740 (INNGEST_EVENT_KEY stays on) into `.ai/rules/product-is-live.md` (D155).
   - CLAUDE.md lines 688-708 (never remove a key) into `.ai/rules/secrets-env-law.md` (D175).
   - CLAUDE.md lines 677-683 (set a new variable, batch the variables) into `.ai/rules/secrets-env-law.md` (D176).
   - CLAUDE.md lines 13-39 (section 0) and AGENTS.md line 7 into `.ai/rules/split-and-proceed.md` (D184).
   - AGENTS.md lines 59, 63, 65 and 67 (teleprompter acceptance) into `docs/rules/TELEPROMPTER-VIDEO.md` (D216).

3. CLAUDE.md sections that only summarize a rule and say "Same law: ...": lines 103 to 424, except the sections in item 4. After this plan each named rule holds the full law, so each of those sections can become its index line. The checker (check f) still needs CLAUDE.md to name every always-on owner-law rule.

4. CLAUDE.md laws with no rule home that this plan does not fold. The Phase 5 stage places them: section 1 (the model tier guide; `model-by-job` is the nearest home, and Phase 3 call #48 amends it), the rest of section 2 ("This repo only", "Owner decisions are final"), "Never ask permission to run a tool" (lines 162-176; it also lives in `.claude/settings.json`), "Agents run the work" (lines 178-182; Phase 3 call #21 edits its exceptions list), "Cursor-side agents" (lines 386-388), sections 3a, 3b, 3c, 4, 5, 6, 7, the rest of 8 (frustration, reuse, commit working states, delete your branch, deleting branches, checkpoint, conventions), 9, 10, 11 (the deploy table, migrations on production only, the ship bullets, egress) and 12. AGENTS.md has the same kind of lines: 11, 13, 15, 16, 18, 20 and 21 (the 2026-10-12 owner rule: find a practical way forward, no "Confirm:" endings, a "can't" needs an alternative, remove before add). Phase 3 calls #7 and #14 edit some of them.

5. Rule, skill, doc and book lines that cite a CLAUDE.md section by number. The Phase 5 index must keep the numbers (the old file says they are cited 27 times) or each line needs a new target:

| File | Lines | Cites |
|---|---|---|
| `.ai/rules/build-spec-then-backend-then-frontend.md` | 40 | section 3a |
| `.ai/rules/fourth-grade-english.md` | 8 | section 10 |
| `.ai/rules/full-end-to-end-audit.md` | 10 | section 0 |
| `.ai/rules/model-by-job.md` | 8 | section 1 |
| `.ai/rules/one-step-adhd.md` | 18 | section 0 |
| `.ai/rules/owner-scope-minimal-diff.md` | 47 | section 8 |
| `.ai/rules/rules-no-drift.md` | 15, 16, 32 | CLAUDE.md lines about rules |
| `.ai/rules/verify-scratch-only.md` | 22 | section 12 |
| `.agents/skills/fundhub-ad-writer/SKILL.md` | 22, 134 | section 0 (Phase 3 call #43 rewrites both) |
| `.agents/skills/fundhub-fixer/SKILL.md` | 60 | section 12 |
| `.agents/skills/fundhub-repo-hygiene/SKILL.md` | 16, 32, 77 | sections 8, 0, 5 |
| `.agents/skills/fundhub-version-control/SKILL.md` | 13 (second sentence), 66, 75 | sections 8, 5 |
| `.agents/skills/fundhub-testimonial-thumbnails/SKILL.md` | 19 | section 3a |
| `docs/rules/RULES-INDEX.md` | 20, 155 | CLAUDE.md holds the short owner-set line for each law |
| `docs/sops/postgres-least-privilege.md` | 357 | section 11 |
| `marketing/ads/WRITE-ADS-FROM-HERE.md` | 6, 12, 76 | section 0 |
| `marketing/ads/video-pipeline-plan.md` | 39, 79 | sections 3a, 12 |
| `marketing/ads/slo/SLO-CHAT-PROMPT.md` | 29 | CLAUDE.md |
