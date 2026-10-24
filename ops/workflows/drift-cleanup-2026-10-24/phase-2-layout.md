# Phase 2: one home for rules, one home for skills

Date: 2026-10-24. Branch: `drift-cleanup`. Agent: `layout` (Sonnet). Nothing is committed or pushed. The lead commits.

**The answer:** every rule has one real file now. Every skill has one real folder now. Cursor and Claude read links to them. Nothing was deleted. `npm run rules:check` says OK.

## (a) What changed

1. **Rules.** 79 real files live in `.ai/rules/<name>.md`. `.cursor/rules/` and `.claude/rules/` hold links to them.
2. **Skills.** 27 real folders live in `.agents/skills/<name>/`. `.cursor/skills/` and `.claude/skills/` hold links to them. Cursor now sees the same 26 linked skills Claude sees. Before, Cursor saw 15.
3. **Old copies.** 91 old files moved to `ops/archive/ai-instructions-2026-10-24/`. Nothing was deleted.
4. **The guard.** `npm run rules:check` now fails a real copy in `.cursor/` or `.claude/`, a missing link, a wrong link, and a link that points at nothing. Its tests prove each check can go red and green.
5. **The words.** The index, one paragraph of `CLAUDE.md`, and two rules now say where files live. No owner law was changed or softened. No other rule body was touched.

One side effect. Codex now reads the current text of 13 skills. Before, it read old copies. Some of those old copies taught rules you already killed. Codex also sees 2 skills it never had. See (e).

## (b) Before and after

Before:

```text
.cursor/rules/    79 real .mdc files
.claude/rules/    76 real .md files        (copies of the Cursor ones)
.cursor/skills/   15 real folders          (our skills)
.claude/skills/   14 links to .cursor/skills
                  10 links to .agents/skills   (third-party)
                   2 real folders              (a 12-line stub and a copy)
.agents/skills/   13 older copies of our skills
                   1 copy of clickfunnels-developers-docs
                  10 third-party skills        (real)
                   1 source-command-flywheel
```

After:

```text
.ai/rules/        79 real .md files                <- the one home for rules
.cursor/rules/    79 links   <name>.mdc -> ../../.ai/rules/<name>.md
.claude/rules/    76 links   (the 3 Cursor-only rules have none)
.agents/skills/   27 real folders                  <- the one home for skills
.cursor/skills/   26 links   -> ../../.agents/skills/<name>
.claude/skills/   26 links   -> ../../.agents/skills/<name>
ops/archive/ai-instructions-2026-10-24/
    rules-claude-twins/   76 old Claude copies of the rules
    skills-copies/        15 old skill copies (13 from .agents, 2 from .claude)
```

All links are relative, so they work in any checkout and any worktree.

## (c) Which tool reads what

| Tool | Reads rules at | Reads skills at | Also reads | Link-following proof from here |
|---|---|---|---|---|
| Claude Code | `.claude/rules/<name>.md` (links) | `.claude/skills/<name>` (links) | `CLAUDE.md`, `.claude/commands/` | Skill links: yes. This session's skill list is built from 22 of the 24 skill links already in git. Rule links: not proven. |
| Cursor | `.cursor/rules/<name>.mdc` (links) | `.cursor/skills/<name>` (links) | `AGENTS.md` | None. Cursor was not opened. |
| Codex | none (it reads `AGENTS.md`) | `.agents/skills/<name>/` (real folders) | `AGENTS.md`, `.codex/hooks.json` | Nothing to prove. Its folder has no links in its path. |

Proven here: Claude's Edit and Write tools refuse to write through a link. They name the real file instead. So the old habit of editing `.claude/rules/x.md` cannot turn a link into a copy by accident.

## (d) Counts

| What | Count |
|---|---|
| Rules converted (real file + Cursor link + Claude link) | 76 |
| Cursor-only rules (real file + Cursor link only) | 3: `no-claude-in-cursor`, `grok-lattice-overseer-perpetual`, `ui-standards` |
| Rules now in `.ai/rules` | 79 |
| Rule links made | 155 (79 Cursor, 76 Claude) |
| Our skills moved into `.agents/skills` | 15 |
| Skills kept in place in `.agents/skills` | 12 (`clickfunnels-developers-docs`, 10 third-party, `source-command-flywheel`) |
| Skills linked in `.cursor/skills` | 26 (all new) |
| Skills linked in `.claude/skills` | 26 (14 re-pointed, 2 new in place of real folders, 10 unchanged) |
| Files archived | 91 (76 rule copies, 15 skill copies) |
| Checker tests | 22 pass (was 14) |

## (e) What was different between the skill copies

The `.cursor` copy was the real one in every case. The `.agents` copies were older. Codex was reading them.

| Skill | What the old `.agents` copy said that the real one does not |
|---|---|
| `fundhub-ad-editor` | No `.agents` copy existed. Codex had never seen it. |
| `fundhub-video-animation-overlay` | No `.agents` copy existed. Codex had never seen it. |
| `fundhub-ad-writer` | Lacked the 2026-10-02 "set aside" paragraph. Said never run `CLAUDE.md` section 0. Said 5th grade for talking to Chris (real: 4th grade for Chris, 5th grade for the script). |
| `fundhub-agent-tester` | Spelled "FundHub" twice. |
| `fundhub-auditor` | Said stop and wait for Chris to approve the board. Said Chris or CI runs Playwright. Real: stop only for a missing owner decision, and the agent or CI runs Playwright. |
| `fundhub-builder` | Lacked two owner notes: standing GO only for a named board row (2026-10-24), and no relay for a GO already given (2026-10-19). |
| `fundhub-clickfunnels-html-push` | A 12-line pointer stub titled "(Codex)", spelled "FundHub". The `.claude` copy was the same stub. The real skill is the 83-line one. |
| `fundhub-fixer` | Said Chris does one manual pass. Said flag `COMPLIANCE REVIEW REQUIRED` (killed 2026-09-08). Report listed "What Chris should check". Real: no manual pass unless he offers, no compliance label, report says what was proved. |
| `fundhub-orchestrator` | Lacked one sentence: use the relay only for a real owner decision (2026-10-19). |
| `fundhub-perf-auditor` | Said "the 39 screens". Real: count them first, do not quote a number. |
| `fundhub-repo-hygiene` | Labelled one row "Codex:" where the real one says "Cursor:" (same path). Lacked the Claude Code commit pointer. |
| `fundhub-system-map` | Spelled "FundHub" twice. Lacked the "measured 2026-08-26, re-measure before quoting" note. |
| `fundhub-testimonial-thumbnails` | Spelled "FundHub". Said every non-ad video must be 4K (real: testimonial card videos on pages do not, 2026-10-24). Lacked the marked-draft paragraph. |
| `fundhub-ui-auditor` | Named an old evidence folder for route probes. Real: reuse an earlier probe if one is there. |
| `fundhub-version-control` | Said "never commits unless he asks" and "commit only when asked". Killed 2026-09-08: commit locally every session. 24 lines differed. |
| `clickfunnels-developers-docs` | No difference. The `.claude` and `.agents` copies were identical. The `.agents` one stays. |

`.agents/skills/source-command-flywheel` stays where it is. It is Codex's copy of `.claude/commands/flywheel.md`. The text is the same, line for line, apart from blank lines. The guard lists it as Codex-only with that reason.

## (f) How to undo

- **Before the commit:** drop the `drift-cleanup` branch. Main does not change.
- **After the commit:** `git revert <the Phase 2 commit>`. One command. Git tracks every moved file and every link, so the revert puts all 79 + 76 rule files and all skill folders back as they were.
- **By hand:** nothing was deleted. The old Claude rule copies are in `ops/archive/ai-instructions-2026-10-24/rules-claude-twins/`. The old skill copies are in `.../skills-copies/`. Each folder has a README.

## (g) Honest risks

1. **Cursor and Codex following links is not proven from here.** I cannot open Cursor from this session. If Cursor ignores link files, it sees no rules. First check after the merge: Cursor Settings, Rules. It must list 79. If it lists none, the fix is a small script that writes real copies into `.cursor/rules`, and the guard changes to match. Also, each Cursor link ends in `.mdc` but points at a `.md` file. Cursor reads the name of the link. That is not proven either.
2. **Claude rule links are not proven.** Skill links already work in this repo. Rule links use the same kind of link, but a different loader reads them. Not tested from here. This session cannot test it either: its own rules were loaded from the main folder, which this branch does not change.
3. **Other sessions adding rules the old way.** After they merge, `npm run rules:check` fails them: a real file in `.cursor/rules` or `.claude/rules` is a copy. A branch that edits `.cursor/rules/x.mdc` or `.claude/rules/x.md` will conflict on merge (a file against a link). The fix is to put the new text into `.ai/rules/x.md`. The steps are in `.ai/README.md`. Tell those sessions the new way before they merge.
4. **Codex behavior changes.** It now follows the current text of 13 skills. That matches your owner laws. It is still a change.
5. **Front matter.** Claude now reads the `---` block at the top of every rule. It did not before. Two rules have a colon inside their description (`animation-ad-style`, `owner-calls-settled`). Cursor accepts that. Strict YAML readers do not. Not tested in Claude Code from here. I left both files as they were.
6. **Path style.** 20 of the 76 pairs wrote a few paths differently (the Claude copy said `.claude/rules/x.md` or `x.md`, the Cursor copy said `.cursor/rules/x.mdc`). The other 56 pairs were word for word the same. Everyone now reads the Cursor style. Both paths still open. No pair differed in its words.
7. **One ship on merge.** Only the marketing machine folders skip a ship. A rule change ships once, as it does today.
8. **Windows.** A checkout on Windows turns links into small text files. The team is on Mac.
9. **Third-party list.** The guard reads `skills-lock.json` to know which skills are third-party. A third-party skill copied in by hand, without the lock file, is treated as ours and needs an index line.

## What the commit will look like

For the files this phase touched, `git status` shows:

| Git word | Count | What it is |
|---|---|---|
| type changed | 155 | a rule file became a link (79 Cursor, 76 Claude) |
| deleted | 17 | 15 old `.cursor/skills/<name>/SKILL.md` files (they moved) and 2 real `.claude/skills` folders (they became links) |
| modified | 33 | 14 re-pointed `.claude/skills` links, 13 `.agents` skill files now holding the real text, 6 text files (`CLAUDE.md`, `RULES-INDEX.md`, the checker, its allow file, its retired-phrases file, its test) |
| new | 204 | 79 rules, 26 + 2 skill links, 2 skill folders new to `.agents`, 91 archived files, 3 READMEs (one in `.ai`, two in the archive), and this doc |

Git sees most moves as renames once the files are added. That is expected.

## Words outside my files that still use the old layout

These still work, because the old paths still open. I did not touch them. They are for the later phases.

- `CLAUDE.md` line 424 (the "Rules never drift" paragraph) says "adds the Claude and Cursor twin".
- `CLAUDE.md` lines 17 and 43 say "twin" and "mirrors".
- `AGENTS.md` line 36 says "Always-on mirrors".
- `.ai/rules/secrets-env-law.md` line 8 says "mirror" for a Cursor path.
- 67 `CLAUDE.md` lines end "Same law: `.cursor/rules/x.mdc` and `.claude/rules/x.md`". Both paths still open.

## Left alone on purpose

- Rule bodies. Only the layout sentences in `rules-for-claude-and-cursor` and `rules-no-drift` changed.
- `AGENTS.md`, and every part of `CLAUDE.md` except the "Rules and skills for both" paragraph.
- `skills-lock.json`, the third-party skill folders, `.claude/commands/`, hooks and settings.
- `.agents/skills/source-command-flywheel`.

## Proof

- `node scripts/rules-drift-check.mjs`: `rules:check OK — no drift.`
- `node --test` on the drift test, `src/pulse/heartbeat-law.test.mjs` and `src/ui/screen-standard.test.mjs`: 30 pass, 0 fail.
- Real-scale mutation check (eight breakages planted on a copy of the real layout, one at a time): each was caught by the right check. A retired word planted in the one real file was reported once, not once per link. A ninth case (a Cursor-only rule also linked for Claude) correctly stays green.
- Every file moved was compared to its version in `HEAD`: 402 byte checks pass, 0 fail. All 353 paths git tracks under the old homes still open.
- `find .ai .cursor .claude .agents -xtype l`: prints nothing (no dangling links).
- `node scripts/lint.mjs`: parses clean.
- The hooks agent's own self-test, run against this layout: 58 checks pass.
