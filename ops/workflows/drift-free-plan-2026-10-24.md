# Drift-free plan — after the Monday ad launch

Date: 2026-10-24. Read only. This file is the only change from that pass.

The ads can launch Monday. The rule pile is not drift-free. The ad path is slow because the same job is written in many places, and those places do not say the same thing. When an AI gets two orders, it adds extra work, or it swings too far the other way.

Nothing else was moved, renamed, or deleted. Untracked files were left alone. A later pass (Composer 2.5, after Monday) can do the folder move. This file is the first proposal.

This job is one workflow. A second writer would have to touch other files. That is not allowed on this pass. Board for later work: this file.

---

## 1. What I counted

Live homes only. I did not count `.codex/worktrees/` as live. That folder holds a second full set of 60 Cursor rule files. An agent can still open it and read an old copy.

| Home | Files | Lines | What it is |
|---|---:|---:|---|
| `CLAUDE.md` | 1 | 608 | Long book. About 8,000 words. It restates 31 laws with the words "Same law." |
| `AGENTS.md` | 1 | 64 | Short book every agent reads. About 1,400 words. Teleprompter checklist lives here. |
| `.cursor/rules/*.mdc` | 60 | 2,261 | Cursor laws. **55 load on every chat.** 5 load only when the topic matches. |
| `.claude/rules/*.md` | 33 | 1,109 | Claude copies. 27 Cursor laws have **no** Claude twin. |
| `.cursor/skills/*/SKILL.md` | 14 skills | 1,221 | The real Fundhub skills. One file each. |
| `.claude/skills/` | 24 entries | — | 12 symlinks to `.cursor/skills`. 10 symlinks to Higgsfield and Supabase packs. 2 real folders that are short copies, not links. |
| `.agents/skills/` | 25 skill folders, 157 files | 26,073 | Most of the lines are Higgsfield and Supabase packs. The Fundhub skill text is about 1,200 lines, copied again. |
| `.codex/` (root files) | 2 | 70 | `hooks.json` and `config.toml`. The config file holds a live token. Do not commit it. Do not paste it. |
| `docs/rules/` | 6 | 704 | Screen rules, speed rules, teleprompter video rules (19 lines), brand CSS. |
| `docs/sops/` | 22 | 6,368 | Staff how-tos. Not the ad pipeline. |
| `marketing/ads/*.md` | 25 | 4,938 | The ad book. `RULES.md` alone is 746 lines. |
| `.claude/workflows/*.js` | 6 | — | Chat checkers. `copy.js` is 495 lines and keeps its own banned-word list. |
| Hooks | 3 files | — | `.cursor/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`. |
| `ops/workflows/*.md` | 411 | — | Work boards. **46** of them still say "owner law" or "owner-set." Those are old orders sitting in boards. |

Always-on load today, every Cursor chat:

- 55 rule files: **16,819 words** (about 25,000 tokens)
- `CLAUDE.md`: **8,039 words**
- `AGENTS.md`: **1,396 words**
- Together: **about 26,300 words** before the task starts

A lot of that is the same law twice: once in a rule file, again as a short block in `CLAUDE.md`. That is why the model overcompensates. It is drowning, then it guesses.

The 5 rules that do **not** load every chat: `audit-screenshot-markups`, `clickfunnels-html-api-push`, `github-push`, `grok-lattice-overseer-perpetual`, `ui-standards`.

---

## 2. Pipeline map

The path is: write the ad, film it on the teleprompter, edit the take, send one file to Submagic, upload. Each row is one sub-skill. "Scattered" means the orders live in more than one place and they do not match.

| Sub-skill | Where the rules live today | Checker that actually runs | Scattered |
|---|---|---|---|
| Write the ad | `.cursor/skills/fundhub-ad-writer/SKILL.md` (also copied in `.agents/skills/`). `marketing/ads/RULES.md`, `VOICE.md`, `WRITE-ADS-FROM-HERE.md`, `CONTROLS.md`, `CONCEPTS.md`. Not linked from `.claude/skills/` at all. | `node scripts/ads/check-script.mjs` and `marketing/ads/rules-data.mjs`. Test: `scripts/ads/check-script.test.mjs`. | Yes. See grade row below. |
| Second line | `.cursor/rules/ad-second-line.mdc`, `.claude/rules/ad-second-line.md`, `marketing/ads/SECOND-LINE.md` (58 lines). | No script of its own. | Mild. Book plus two rule copies. |
| Certain words | `.cursor/rules/copy-certainty.mdc` and the Claude twin. `RULES.md` around line 19. | Checker catches the word "could" (`rules-data.mjs` line 269). It does not catch "might," "maybe," or "likely." | Yes. The rule is wider than the checker. |
| No recycled lines | `.cursor/rules/ad-no-recycled-lines.mdc` and the Claude twin. | No script. An agent is told to compare by hand. | The rule is one place, plus the Claude copy. No machine check. |
| Voice fixes | `marketing/ads/VOICE.md` (176). The ad-writer skill says: when Chris rewrites a line, add the pair the same day. | None. | The skill and the voice file. Easy to skip. |
| Name the file | `marketing/ads/NAMING.md` (128). `ad-naming.mdc` and Claude twin. `AGENTS.md` lines 62–63. `slo-one-filmed-folder.mdc`. | `scripts/ads/check-registry-titles.mjs` checks titles, not Drive file names. | Yes. Name law is in four homes. No file-name check. |
| Banned words (machine list) | `marketing/ads/rules-data.mjs` (320). `RULES.md`. `.claude/workflows/copy.js`. | A test fails if `rules-data.mjs` and `copy.js` lists differ. | The pair is watched. The human page can still drift from the checker. |
| Scroll speed | `.cursor/rules/teleprompter-speed.mdc` and Claude twin. `public/app/teleprompter.js` line 75: `MIN_WPM = 130`, `MAX_WPM = 320`. | `src/ui/teleprompter.test.mjs` lines 1056–1086. `e2e/teleprompter-touch.spec.mjs`. | The film screen is locked. The shoot clock is not. See speed row. |
| Put the script on the teleprompter | `src/marketing/shoot-plan.mjs` lines 192–194: min 80, max 260. `src/marketing/api-contract.mjs` line 1756. `RULES.md` section 1.8 (line 280) for CAPS, pauses, and arrows. | `src/marketing/shoot-store.test.mjs` ("80 to 260"). | Yes. 80–260 fights 130–320. |
| Film (size and frames) | `docs/rules/TELEPROMPTER-VIDEO.md` (19 lines). `video-4k-unless-ad.mdc`. `AGENTS.md` lines 52–64. `public/app/teleprompter.js` line 564: `HARD_FPS = 30`. | `src/ui/teleprompter.test.mjs` (30 fps is a pass; 60 fps is also a pass). More specs under `e2e/teleprompter-*.spec.mjs`. | Yes. Three frame-rate stories. Size agrees: ads 1080p, other videos 4K. |
| Save and upload | `slo-one-filmed-folder.mdc`. `AGENTS.md` lines 60–62 (right offer folder, Direct Book stays out of the SLO folder). | No name check on the Drive file. | Mild. |
| Edit the take | `.cursor/skills/fundhub-ad-editor/SKILL.md` (Claude side is a symlink). `scripts/ad-video-edit/edit.py`, `shake.py`, `batch_cut_one.py`. | `edit.py` prints PASS or FAIL (line 136). No test file next to it. | Yes. Fights the "best of all clips" law. |
| Merge every take | `.cursor/rules/ad-video-best-of-clips.mdc` lines 20–36. | No script that fails when a second take was ignored. | Yes. The editor skill is newer and says the opposite on cuts. |
| Sound level | Editor skill lines 62–65: −14 LUFS, peak under −1.5. Same numbers in older ad-video code comments. | `edit.py` checks loudness. After Submagic, the skill says measure again. Nothing forces that second measure. | Mild. |
| Submagic | Editor skill lines 67–71. `.cursor/rules/chris-never-submagic.mdc`. `src/messaging/providers/submagic.mjs` lines 59–79. | Code refuses `magicBrolls`. `removeSilencePace` can still be turned on by a caller. | Yes. Three stories. See below. |
| B-roll and captions | Best-of-clips law says Submagic gets our B-roll. Editor skill says never send `magicBrolls`. `src/ad-videos/` places animations after captions. | Submagic code blocks AI B-roll. No check that the B-roll matches the words. | Yes. |
| Watch curve | `ad-watch-curve.mdc`, `marketing/ads/watch-curve.md` (69). | No script in the ad handoff. A night job can text Chris if an ad dies before 25%. | Book plus rule. Fine if one of them becomes a pointer. |
| Testimonial cards | `.cursor/skills/fundhub-testimonial-thumbnails/SKILL.md` (159). `proof-cards-from-source.mdc`. `video-4k-unless-ad.mdc`. | No checker script named in the skill. | The skill is one file. The 4K law is separate. |
| Flywheel copy | `.agents/skills/source-command-flywheel/SKILL.md`. `.claude/workflows/copy.js`. | Not the ad-writer path. The ad-writer skill says so on line 8. | Keep it off the ad path. Do not merge it in. |

Company skills that are **not** this pipeline (leave them out of phase 3): auditor, fixer, builder, orchestrator, UI auditor, perf auditor, repo hygiene, version control, system map, agent tester, ClickFunnels HTML push.

---

## 3. Real conflicts

Checked on 2026-10-24. Line numbers are from that read.

| Topic | Homes | Conflict | The exact difference |
|---|---|---|---|
| Who may edit a page | `.cursor/rules/grok-no-displays.mdc` lines 8 and 20. `.cursor/rules/no-claude-in-cursor.mdc` lines 8–18 and 30. No Claude twin for the second file. | Yes | Grok and Composer must stop and leave the page for Claude. Cursor must not call Claude, and must not say "leave it for Claude." The second file even points at the first file. In Cursor, no model is allowed to change a page. |
| How hard to cut | `ad-video-best-of-clips.mdc` lines 20–36. `fundhub-ad-editor/SKILL.md` lines 14–27. | Yes | The always-on law says kill filler (um, uh, like), repeated lines, and the weaker take, then merge every take. The editor skill (2026-10-23) says cut only a mess-up, keep improv, and never cut a good word. Both load. The AI swings between them. |
| What Submagic may do | Best-of-clips lines 34–36. Editor skill lines 67–71. `src/messaging/providers/submagic.mjs` lines 63–77. | Yes | Best-of-clips: Submagic does captions and our B-roll. Editor skill: captions, clean audio, eye contact; never `magicBrolls`, never `removeSilencePace`. The code: `magicBrolls` stays off, and `removeSilencePace` is allowed when a caller passes it (note dated 2026-09-23). |
| Frames per second | `docs/rules/TELEPROMPTER-VIDEO.md` lines 5 and 11. `AGENTS.md` line 58. `public/app/teleprompter.js` lines 554–564. Test lines 47–68 and 213. | Yes | The video rule says 60 fps for ads and for 4K, and a 30 fps file is a failed proof. `AGENTS.md` says ads target 60, and VSLs target 30–60. The app asks for a hard 30 on both lenses (owner call 2026-10-13, written in the code). The test says 30 is a pass and 60 is a pass. The saved-file rule and the camera ask do not match. |
| Picture size | `video-4k-unless-ad.mdc` lines 8–12. `AGENTS.md` line 58. Editor skill line 27. | Size agrees. The editor is loose. | Ads are 1080p. VSLs, thank-you videos, and testimonials are 4K. The editor only says "keep the size you already have," so a 4K ad stays 4K. |
| Scroll speed vs shoot clock | Teleprompter: `teleprompter.js` line 75, rule file, test lines 1056–1058. Shoot clock: `shoot-plan.mjs` lines 192–194, `api-contract.mjs` line 1756. | Yes | The glass is 130 to 320, steps of 5. The shoot timer still accepts 80 to 260. A script timed at 80 or 260 is outside the glass Chris reads on. |
| Grade level | `fourth-grade-english.mdc` line 8. `CLAUDE.md` line 469 (§10). Ad-writer skill lines 35–38. `RULES.md` line 48 and line 296. `rules-data.mjs` line 268. | Yes for chat. The ad line is a second grade. | Talk to Chris at a 4th grade level. `CLAUDE.md` §10 already says 4th. The 4th-grade rule still says it "replaces the 5th grade level in §10," which is stale. The ad-writer skill tells the agent to talk to Chris at a **5th** grade level and says that is §10. `RULES.md` line 48 tells the **script** to sound 5th grade. Those are two jobs. The skill mixes them. |
| Company spelling inside the laws | `fundhub-company-name.mdc` lines 17–19 (the ban). `ghl-blacklisted.mdc` lines 2, 8, 14, 18. `agentic-audit-guardrails.mdc` line 32. Skills: `fundhub-agent-tester` lines 4 and 14, `fundhub-system-map` lines 4 and 10, `fundhub-clickfunnels-html-push` title. | Yes | The name law says write Fundhub. The GHL law, the audit law, and three skills write FundHub as the brand. The name file itself only uses FundHub in the "never write this" list. That part is fine. |
| Cursor copy vs Claude copy | 33 twins. | 2 real, 4 path-only, 27 missing | Same words: 27 twins. Path endings only (`.mdc` vs `.md`): `agents-run-ops-not-chris`, `dictator-owner-overrides`, `env-full-copies-never-masked`, `show-secrets-when-chris-asks`. Real text drift: `ux-guidance-urls-first` (Claude copy is shorter, drops the one-step section, adds ClickFunnels) and `secrets-env-law` (Claude copy has two extra example lines). **27 Cursor laws have no Claude file at all**, including `no-claude-in-cursor`, `owner-scope-minimal-diff`, and the audit laws. `finish-the-requested-job` does have a Claude twin. The "write it in both places" law (`.cursor/rules/rules-for-claude-and-cursor.mdc` lines 8–13) is not true for those 27. |
| One skill, two texts | `.cursor/skills/` vs `.agents/skills/` | 3 of 13 | 10 shared skills are byte-identical. `fundhub-repo-hygiene` and `fundhub-version-control` differ by one word (Cursor vs Codex). `fundhub-clickfunnels-html-push` is 83 lines in Cursor and a 12-line stub in `.agents` and `.claude`. `fundhub-ad-editor` is missing from `.agents`. `fundhub-ad-writer` is missing from `.claude/skills`. |
| The long book copies the laws | `CLAUDE.md` (31 "Same law" lines) plus the rule files | Yes | A change in the rule file does not change the paragraph in `CLAUDE.md`. Both load every chat. |
| Split the work, or do not | Ad-writer skill lines 20–21. `CLAUDE.md` section 0. `.claude/settings.json` and `.codex/hooks.json` SessionStart. | Yes | The ad skill says do not run the split. The session hook pastes "run the split" into every chat. Writing one ad still gets the whole-company order. |
| Only the asked change, or finish the checks | `owner-scope-minimal-diff.mdc`. `no-extra-holes.mdc`. `finish-the-requested-job.mdc`. `AGENTS.md` "Finish the requested outcome." | They fight if you read them loose | See principle 1 below for the line. |
| Dead file a law still names | `full-end-to-end-audit.mdc` lines 25 and 29 | Yes | It points at `ops/workflows/company-sim-2026-08-24.md`. That file is not in the repo. |
| Old agent names | `TELEPROMPTER-VIDEO.md` line 7 | Stale | It says use Sol for screen changes and Luna for recording checks. Those names are not the current rule set. |

Hooks do **not** lock rule files. They only block edits to `*-intended.md`, warn on staging secrets (Cursor, and that hook does not fail closed), and run lint on Claude stop. `.cursor/hooks.json` also lists `but cursor after-edit` and `but cursor stop`. Those are not rule checks.

There is no `CODEOWNERS` file.

---

## 4. The 7 principles — honest take

### 1. Do only what was asked

**Change it. Keep the idea. Draw a line.**

The idea is right. The current "finish the job" rule is also right, and they crash when the line is fuzzy.

The line:

- He named the result. Do that result.
- A check that already exists, and that this result cannot pass without, is part of the ask. Fix that check. Do not ask him if you may.
- A new feature, a redesign, a rename, or a second hole is not part of the ask. Log it. Stop.
- Do not invent a new check so you can "finish" more.

`finish-the-requested-job.mdc` already says unrelated improvements stay on the board. `no-extra-holes.mdc` says the same. The miss is that agents treat "make it better" as a required check. The line above is the fix. Put that line in one file. Point the other two files at it.

### 2. One home for every rule

**Change it. One source. Generated copies. A test that fails on drift.**

A hand-written Claude copy is a second home. That is how 27 laws went missing and 2 copies changed their words.

Keep `.cursor/rules/` and `.claude/rules/` so each tool can read its own folder. A script writes both from `docs/rules/src/`. A test fails if a copy differs, if a law is only on one side, or if a law is not in the index.

The law that says "write the same words by hand in both folders" (`rules-for-claude-and-cursor.mdc`) is the drift machine. Replace that sentence with "edit the source, run the generator."

### 3. Short, specific, with a good and a bad example

**Agree.** Most laws already have an example. Many are still too long to load every chat. `full-end-to-end-audit.mdc` is 108 lines. `heartbeat-on-every-build.mdc` is 57. Those stay as skill files, loaded when that job runs. The always-on line is one sentence plus the path.

Every pipeline rule needs both edges, or the swing comes back:

- Do cut a mess-up. Do not cut a good word or a real improv line.
- Do merge takes of the same angle. Do not merge two angles because the ad number matches.

One good example and one bad example, frozen. When he corrects a swing, add the other edge. Do not delete the first edge.

### 4. Locked rules. Only Chris approves.

**Agree on the policy. The lock has to be a machine, or it is a wish.**

What can be enforced:

- **GitHub `CODEOWNERS` plus branch protection.** Paths under `docs/rules/src/` need a review from the repo owner (`ZootimusMaximusSupreme`) before they reach `main`. Turn off "admins may bypass." This is the real lock. A direct push to `main` skips it, so rule files cannot ride the normal ship push. Product code can keep shipping the way it does now. Rule files go through a pull request he approves.
- **A CI check.** Fail the build if a locked path changed and the pull request has no approval from him. An agent can fake a commit trailer that says `Rule-Approved`. A trailer is not the lock. His review is the lock. The trailer is only a label.
- **Tool denies.** Claude `settings.json` can deny Edit and Write on `docs/rules/src/**`, the same way it already denies `*-intended.md`. A Cursor hook can block those paths the same way. That stops the tool. It does not stop a person with git.

What stays honor-system:

- An agent edits the file, then asks him after. If `main` accepts the push, the lock failed.
- "I suggest a change" with no file edit. That is fine. It is not a lock.

### 5. A script checks whatever a script can check

**Agree. Add one hard line.**

The check is a script that exits with a failure code. An agent saying "I checked" is not a check. The ad writer already has this (`check-script.mjs`). The editor prints PASS or FAIL and has no test around it. Scroll speed has a test. Merge-all-takes, recycled lines, Drive file names, and "both edges" do not.

The handoff includes the script output. No output, no handoff.

### 6. A repeat mistake becomes a rule the same day

**Change the timing. Keep the log.**

Same day: append one line to that sub-skill's mistake log. Do not mint a new always-on law the same day. A same-day law is how the pile grew, and how a correction becomes the opposite extreme.

Cap:

- A sub-skill file stays under **150 lines**.
- The open mistake log stays under **5 lines**.
- Two corrections of the same miss become **one proposed rule**.
- Once a week, merge: he approves, drops, or folds. Approved text moves into the rule section. The log line closes.

A third repeat of a logged miss, after he approved the rule, means the checker is missing. Add the script. Do not add a third paragraph.

### 7. Archive the old stuff

**Agree.** Archive means a dated folder, not a delete. Old drafts and retired laws leave the always-read path. They stay in git so a person can find them.

Do not archive a file until the index says what replaced it. A board that still says "owner law" is a second home. Phase 6 moves those lines out of the 46 boards, or marks them "history, not law."

---

## 5. Principles to add

8. **One index.** `docs/rules/INDEX.md` lists every live rule: id, one source path, the date he approved it, status (live, proposed, archived). If it is not in the index, it is not a rule.

9. **Both edges.** Every rule says what to do and what not to do, with one frozen good example and one frozen bad example. A correction adds the missing edge.

10. **A rule budget.** Always-on text stays under **8,000 words** (today is about 26,300). Everything else loads only when that sub-skill runs. Context size is part of the bug.

11. **A golden set.** Each pipeline sub-skill keeps 3 to 5 samples the checker must pass, and 3 it must fail. A rule change that does not update the golden set fails CI.

12. **The script reports. The agent does not.** The handoff pastes the checker output. "I followed the rules" does not count.

13. **Dates win.** Each rule line has the date he approved it. A newer date wins. The old line moves to the archive note in the same file. It does not stay as a second file that still loads.

14. **Pointers, not copies, in the two big books.** `CLAUDE.md` and `AGENTS.md` keep a short map. They stop pasting the full law. The source file is the law.

---

## 6. Plan, after Monday

No phase starts until the Monday launch is out. Phase 0 can be true the moment he says the freeze is on.

### Phase 0 — Freeze

- **Produces:** No new rule file, no new always-on law, unless he approves that one change in the same message.
- **Files:** none.
- **Verify:** `git diff` on `.cursor/rules`, `.claude/rules`, `CLAUDE.md`, `AGENTS.md`, and `docs/rules` is empty except this plan.
- **Size:** nothing to build.

### Phase 1 — Index

- **Produces:** `docs/rules/INDEX.md` from the tables in this file. One row per live law and per pipeline sub-skill.
- **Files:** that one new file. This plan stays as the evidence.
- **Verify:** every `.cursor/rules/*.mdc` name appears once. Every pipeline sub-skill appears once.
- **Size:** about 200 lines. One afternoon.

### Phase 2 — One source, generated copies, drift test

- **Produces:** `docs/rules/src/` as the only place a law is edited. `scripts/rules/generate-mirrors.mjs` writes `.cursor/rules/*.mdc` and `.claude/rules/*.md`. `scripts/rules/check-drift.test.mjs` fails if they differ, if a law is missing on one side, or if the index does not list it.
- **Files:** about 60 source files, the generator, the test. The hand-copied twins get replaced by the generator output in the same change. `.agents/skills` Fundhub copies become symlinks, same as `.claude/skills` already does for most skills.
- **Verify:** edit a copy by hand, the test fails. Edit the source, run the generator, the test passes.
- **Size:** two or three days. Do not hand-merge 60 files in one sitting. Generate, then diff.

### Phase 3 — Pipeline sub-skill files

Start here, in this order. Each file uses the template in section 8.

1. `ad-edit.md` (the cut fight is the live pain)
2. `submagic.md`
3. `teleprompter-film.md` (frames and size)
4. `teleprompter-speed.md` (one clock: 130–320, and point the shoot timer at it)
5. `ad-write.md`
6. `naming.md`
7. `upload.md`
8. `broll.md`
9. `thumbnails.md`

- **Produces:** those files under `docs/rules/src/pipeline/`. Each names the checker command. The old homes become a one-line pointer.
- **Files:** 9 new sources, then pointers in the old skill and rule files. The generator rewrites the tool copies.
- **Verify:** run the command named in the file. It must fail on the bad example and pass on the good example.
- **Size:** about half a day per file. The first four are the Monday-after week.

### Phase 4 — Lock

- **Produces:** `CODEOWNERS` on `docs/rules/src/` and `scripts/rules/`. Branch protection so those paths need his review. Claude deny on Edit and Write for those paths. A Cursor hook with the same block. CI runs the drift test.
- **Files:** `CODEOWNERS`, `.claude/settings.json` deny list, `.cursor/hooks.json`.
- **Verify:** a branch that edits a source rule cannot merge with no review. A Claude edit of that path is blocked. A hand-edited mirror fails CI.
- **Size:** one day for the files. The GitHub protection setting is the part that makes it real. If the token cannot set that, it is the one switch only he can flip.

### Phase 5 — Mistake log and weekly merge

- **Produces:** a `## Mistake log` section in each pipeline file. A weekly note on this board: merged, dropped, or still open.
- **Files:** the pipeline sources only, and only after he approves a merged line.
- **Verify:** open log lines are 5 or fewer. The file is 150 lines or fewer. A new always-on law does not appear on the day of the mistake.
- **Size:** a few lines a day. One short merge a week.

### Phase 6 — Archive

- **Produces:** `docs/rules/archive/YYYY-MM-DD/` and `marketing/ads/archive/`. Retired drafts and retired laws move there. The index status becomes `archived`. The 46 boards that still say "owner law" get a one-line "history, not law" or the law line moves to the source.
- **Files:** only files he marks retired. Do not guess the kill list.
- **Verify:** the always-on word count is under 8,000. An archived file is not loaded by a skill.
- **Size:** depends on the kill list. The move itself is small once he names the files.

---

## 7. Proposed folders

Do not create these yet.

```text
docs/rules/
  INDEX.md                         # every rule, one path, one date, one status
  src/                             # the only files a person edits
    company/                       # name, secrets, grade, scope, finish-the-job line
    pipeline/
      ad-write.md
      ad-edit.md
      submagic.md
      teleprompter-film.md
      teleprompter-speed.md
      naming.md
      upload.md
      broll.md
      thumbnails.md
      golden/                      # pass samples and fail samples
  archive/
    2026-10-24/
scripts/rules/
  generate-mirrors.mjs             # writes the tool copies
  check-drift.test.mjs             # fails on drift
.cursor/rules/                     # generated. Do not edit by hand.
.claude/rules/                     # generated. Do not edit by hand.
.cursor/skills/                    # one real skill text. It points at docs/rules/src/pipeline/
.claude/skills/                    # symlinks only
.agents/skills/                    # symlinks only for Fundhub skills
marketing/ads/
  RULES.md                         # becomes a pointer, then the long text moves into ad-write.md
  archive/
```

`CLAUDE.md` and `AGENTS.md` stay, short. They point at `docs/rules/INDEX.md`. They stop carrying a second full copy of each law.

Higgsfield and Supabase packs stay in `.agents/skills/`. They are not Fundhub laws. Do not fold them into `docs/rules/src/`.

The Codex worktree at `.codex/worktrees/heartbeat-money-workspace/` is a second tree of rules. Leave it until phase 6. Do not read it as the live law.

---

## 8. Sub-skill file template

One paragraph. Copy this into the top of every pipeline file, then fill the headings under it.

> This file is the only home for `<sub-skill>`. Do `<the action>`. Do not `<the swing the other way>`. A good example is `<one frozen good case>`. A bad example is `<one frozen bad case>`. Before you hand anything back, run `<exact command>` and paste its PASS or FAIL. If it fails, fix that line and run it again. When Chris corrects the same miss twice, add one line under Mistake log the same day. Do not add a new always-on rule until he approves it at the weekly merge. Keep this file under 150 lines.

Skeleton:

```markdown
# <Sub-skill name>
Approved: YYYY-MM-DD
Index id: <id>

## Do
## Do not
## Good example
## Bad example
## Final check
Command: `<exact command>`
Pass looks like: ...
Fail looks like: ...

## Mistake log
| Date | What went wrong | Times | Status |
|---|---|---|---|
| YYYY-MM-DD | one line | 2 | open / merged / dropped |
```

Both edges stay. A new correction does not erase the old example.

---

## 9. What this pass did not do

- No rule file was edited.
- No skill was moved.
- No archive was created.
- The Codex worktree was counted, not diffed line by line.
- `ops/workflows/weekend-2026-10-24.md` and `ops/workflows/v2-notes.md` were not touched.
- The Monday ads were not part of this pass.
