# Prompt for Cursor (Grok) to finish the drift cleanup

Copy everything inside the block into a new Cursor chat. Open the folder
`/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/drift-cleanup` first.
If the chat stops early, paste the same prompt into a new chat: it continues at the first empty box in `PROGRESS.md`.

```text
You are finishing a cleanup of the AI instruction files in the Fundhub repo.
Work in small steps. Do not guess. Do not say "done" until every check at the
bottom has printed real output that you paste.

WHERE TO WORK
- Open this folder in Cursor:
  /Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/drift-cleanup
- Run: git branch --show-current     It MUST print: drift-cleanup
- NEVER run git checkout, git switch, git stash, git reset or git clean in
  /Users/chrisstanbridge/Developer/fundhub-platform (the main folder). Another
  session works there.
- NEVER merge to main. NEVER remove a worktree. A draft PR for drift-cleanup is
  already open. Push with: git push origin drift-cleanup

READ FIRST, in this order
1. ops/workflows/drift-cleanup-2026-10-24/REMAINING.md   what is left; do its items 1 to 5 in order
2. ops/workflows/drift-cleanup-2026-10-24/PROGRESS.md    your checklist; continue at the first empty box
3. ops/workflows/drift-cleanup-2026-10-24/phase-3-decisions.md   Chris's deciding rules and the 50 calls
4. ops/workflows/drift-cleanup-2026-10-24/phase-3-conflicts.md   both sides of each fight, with exact quotes
The two plan files are huge. NEVER read them whole. To read the plan for ONE file:
  sh ops/workflows/drift-cleanup-2026-10-24/plans/show.sh dedupe copy-certainty
  sh ops/workflows/drift-cleanup-2026-10-24/plans/show.sh stale copy-certainty
  grep -n -F 'copy-certainty' ops/workflows/drift-cleanup-2026-10-24/plans/stale-plan.md
(replace copy-certainty with any part of the file name)

HARD RULES
1. Edit only REAL files: rules at .ai/rules/<name>.md, skills at
   .agents/skills/<name>/SKILL.md. Files in .cursor/ and .claude/ are links.
   Never edit through a link. Never create a real file inside .cursor/ or .claude/.
2. Touch only AI instruction files: rules, skills, CLAUDE.md, AGENTS.md,
   docs/rules, docs/sops, docs/specs, the marketing .md rule books, hooks,
   settings. NEVER app code: src/, api/, public/, netlify/, db/, e2e/, .github/,
   or scripts/ (except files REMAINING.md names). NEVER edit
   marketing/ads/rules-data.mjs, scripts/ship.mjs, scripts/ads/check-script.mjs.
3. Archive, never delete. Retired files move to
   ops/archive/ai-instructions-2026-10-24/ (same relative path). Stale text you
   cut goes to ops/archive/ai-instructions-2026-10-24/removed-lines/<path with
   / replaced by __>.md with the date and reason. Archiving a rule also means:
   remove its two links (.cursor/rules/<name>.mdc, .claude/rules/<name>.md) and
   every pointer to it.
4. NO LAW LOST. Before you remove or reword a sentence, know where its meaning
   lives now. Compare with the original: git show c54f936a4:<path>. Every dated
   owner-set or owner-law line keeps its date. Never soften an owner law. Keep
   numbers, ids, commands and paths exactly.
5. Do the 50 calls exactly as written in phase-3-decisions.md. Do not re-decide
   any call. Do not invent new calls.
6. Do not rewrite whole files. Change the lines a call or plan names. Keep each
   file's front matter.
7. Tests read some of these files. After touching them run the matching test
   (REMAINING.md, "Rules for whoever finishes this", item 5).
8. If a step needs a code change, or a decision only Chris can make, do NOT do
   it. Write it in "Left for Chris" at the bottom of PROGRESS.md and go on.
9. Stuck rule: if the same fix fails twice, stop, write what you tried in
   PROGRESS.md, and tell me.

HOW TO WORK
- REMAINING.md items 1, 2, 3, 4, 5 in that order. One small group of files at a
  time (example: "the copy rules", then "the audit skills").
- After EACH group: run  node scripts/rules-drift-check.mjs  and read the lines
  about the files you touched. Tick the box in PROGRESS.md. Then
  git add -A and git commit -m "<what you did>".
- Push only when a whole REMAINING.md item is finished (5 pushes at most, each
  push starts a long test run): git push origin drift-cleanup
- If you are running out of room: update PROGRESS.md, commit, and stop. Tell me
  which box is next. A new chat continues from the first empty box.
- CLAUDE.md rewrite (item 3): keep EVERY numbered heading, section 0 to section
  12 including 3a, 3b and 3c, with its old heading text, in the same order. 515
  files point at those numbers. Keep the line "docs/rules/UI-STANDARDS.md is
  law" inside CLAUDE.md. New rules need front matter (a description with no
  colon inside it, and alwaysApply: true) and two relative links. The steps are
  in .ai/README.md.

BEFORE YOU SAY DONE, run these and paste the real output of each:
  node scripts/rules-drift-check.mjs
  node --test src/rules/rules-drift-check.test.mjs src/hooks/hooks-selftest.test.mjs src/pulse/heartbeat-law.test.mjs src/ui/screen-standard.test.mjs src/http/monitoring.test.mjs src/marketing/api-contract.test.mjs src/ad-videos/merge-takes.test.mjs
  node scripts/lint.mjs
  node scripts/hooks/selftest.mjs
  find .ai .cursor .claude .agents -xtype l
  wc -l CLAUDE.md AGENTS.md
  git status --short | head -30
Then list: every box in PROGRESS.md still empty, everything you skipped, and
every "Left for Chris" item. If any check fails, you are NOT done.
```
