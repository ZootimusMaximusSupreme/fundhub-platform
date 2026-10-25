# Phase 7: three hooks and a self-test

Status: **built and tested. Not wired.** I did not change `.claude/settings.json`, `.codex/hooks.json` or `.cursor/hooks.json`. The lead wires the hooks after the other phases are checked.

## The short answer

- Three hooks are built. A self-test runs each one the way the tool does. It makes 58 checks and all 58 pass.
- I broke the hooks on purpose, 12 different ways, in a scratch copy. The self-test caught all 12.
- One call is Chris's before the ad check is wired. It is the box in part (b).

Files I made:

| File | What it is |
|---|---|
| `.claude/hooks/session-rules.mjs` | Hook 1. Runs at session start. |
| `.claude/hooks/guard-rule-edits.mjs` | Hook 2. Runs before an edit. |
| `.claude/hooks/check-ad-script.mjs` | Hook 3. Runs after an edit. |
| `scripts/hooks/selftest.mjs` | The self-test. |
| `src/hooks/hooks-selftest.test.mjs` | Runs the self-test inside `npm test`. |
| `ops/workflows/drift-cleanup-2026-10-24/phase-7-hooks.md` | This page. |

## (a) The hooks that exist today

A hook is a small program. The tool runs it at a set moment, such as the start of a session or just before an edit.

| Where | When it runs | What it does |
|---|---|---|
| `.claude/settings.json` | Session start | Prints the "split the work first" reminder and the branch name. |
| | Before Write or Edit | Blocks any file whose name ends in `-intended.md`. |
| | When Claude stops | Runs `npm run lint`. Runs the type check only if `package.json` has the word `typescript`. |
| `.codex/hooks.json` | The same three | A word-for-word copy of the Claude ones. |
| `.cursor/hooks.json` | Before `git add`, `commit`, `stage`, `rm` or `mv` | Runs `.cursor/hooks/warn-secret-stage.cjs`. It asks first if the command may stage `.env`, `credentials/` or `-A`. |
| | After a file edit, and when Cursor stops | Runs `but cursor after-edit` and `but cursor stop`. |

Two things are wrong with them:

1. **The Cursor `but` hooks call a tool that is not installed.** `but` is GitButler. On this Mac, `which but` says "but not found". Those two hooks cannot run.
2. **The Stop hook never runs the type check.** It runs `npx tsc --noEmit` only when `package.json` contains the word `typescript`. It does not. So only lint runs, and lint here is a syntax check.

I did not change either one.

## (b) The three new hooks

Hook 1 prints one line of JSON. Hooks 2 and 3 print nothing when all is well. On any error, all three print nothing and exit 0, so a broken hook never blocks Claude. Each one ran in 30 to 80 milliseconds on this Mac. They use only what comes with Node.

**1. `session-rules.mjs` (session start).** It tells Claude where the rules live, lists the topics from `RULES-INDEX.md` as the file reads today, counts the rule files, and says a rule edit needs Chris's approval. It counts `.ai/rules` when that folder exists, and `.cursor/rules` when it does not. In this worktree today it says "79 rule files in .ai/rules." The whole text is about 570 characters. The limit is 1500.

**2. `guard-rule-edits.mjs` (before Write, Edit or MultiEdit).** It stops and asks Chris before Claude edits a rule, a skill, `CLAUDE.md`, `AGENTS.md` or `RULES-INDEX.md`.

- It guards paths under `.ai/rules/`, `.cursor/rules/`, `.claude/rules/`, `.agents/skills/`, `.cursor/skills/` and `.claude/skills/`. It also guards any file named `CLAUDE.md`, `AGENTS.md` or `RULES-INDEX.md`. Every other path passes without a word.
- It checks the path as written and the real path with links followed. A link name counts both ways. That matters: Phase 2 makes `.claude/rules/x.md` a link to `.ai/rules/x.md`.
- It also counts a worktree copy: `.claude/worktrees/<name>/.cursor/rules/...`.
- It sees only the edit tools. A shell command such as `sed -i` or `mv` still changes a rule file.

**3. `check-ad-script.mjs` (after Write, Edit or MultiEdit).** After Claude saves a draft ad script, it runs the ad checker on that file. If the checker fails, it sends Claude the first failing lines (about 800 characters) and the words "Fix these before showing Chris."

- **Which files.** A file directly in `marketing/ads/scripts/` whose name ends in a date, like `2026-10-14.md` or `book-a-call-final-2026-10-03.md`.
- **Not checked.** `README.md` and `ad-system-notes.md` (no date). The old collections: names that start with `ALL-` or `ADS-NOT-RUNNING`, or hold `-since-`. Anything in a sub-folder. The `machine/` folder holds scripts the app's writer saves, and the app checks those itself.
- **Which mode.** File mode. It runs `node scripts/ads/check-script.mjs <file>`, the same as `npm run ads:check`.
  - The app's writer uses strict mode (`checkScriptText` with `strict: true`).
  - The command line has no strict switch. I was told not to change the checker.
  - Strict mode reads one script at a time. A draft file holds many ads and notes.
  - So the hook does not use strict mode. Strict mode adds the Part 0 patterns and the banned-live list. That list file holds `[]` today.

> **Chris decides before this hook is wired.**
>
> `docs/rules/RULES-INDEX.md` says Chris set the ad rule books aside on 2026-10-02: kept, not applied. This hook runs the checker that reads those rules. Wiring it turns them back on for every ad draft.
>
> The rule book also fights itself. Phase 3 lists the fights (`phase-3-conflicts.md`). I did not change the checker.
>
> One fight shows up today. The checker wants 135 words. The three sorting-hat ads in `2026-10-02.md` run 123 to 125 words on purpose. After every edit to that file, the hook sends Claude "too short" and "Fix these before showing Chris."

What the hook does today on the four draft files:

| File | What the checker says | The hook |
|---|---|---|
| `2026-10-02.md` | 3 of 6 ads need work (too short) | blocks |
| `2026-10-13.md` | no ads found | silent |
| `2026-10-14.md` | no ads found | silent |
| `book-a-call-final-2026-10-03.md` | no ads found | silent |

The checker reads only three kinds of block: a heading that starts with `Ad` or `Script` and a number, a heading with the word VSL, or a block with a HOOK line. The last three files use headings like `1. Script 4`. So the checker finds no ads in them, and the hook checks nothing there.

## (c) The JSON to paste

One block serves both files. The old hooks in `.claude/settings.json` and `.codex/hooks.json` are word for word the same. A machine check confirmed that, and confirmed that every old hook is still in the block below, unchanged.

- In `.claude/settings.json`, replace the `"hooks"` value with this block. Leave `"permissions"` alone.
- In `.codex/hooks.json`, replace the whole file with this block.
- The new matchers list `apply_patch`, the Codex edit tool. Claude Code has no tool with that name, so it never matches there.
- Each command finds the repo from `CLAUDE_PROJECT_DIR`, or asks git for the top folder when that is not set.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "printf '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"MANDATORY FIRST STEP — CLAUDE.md section 0. State the workflow split, parallel work and dependencies, this session owner, and shared ops/workflows board. Put self-contained prompts on the board. OWNER RULE 2026-10-19: split, then do. Start available agents and proceed immediately; NEVER stop for split approval or repeat approval already given. If it cannot be split, explain in one line and continue. Ask only for an owner decision that genuinely blocks safe, in-scope work. Existing tool permissions, intended-journey protection, and production go-live rules remain unchanged. Branch: %s\"}}' \"$(git branch --show-current 2>/dev/null || echo unknown)\""
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/hooks/session-rules.mjs\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "INPUT=$(cat); if command -v jq >/dev/null 2>&1; then P=$(echo \"$INPUT\" | jq -r '.tool_input.file_path // empty'); else P=$(echo \"$INPUT\" | grep -o '\"file_path\":\"[^\"]*' | cut -d'\"' -f4); fi; case \"$P\" in *-intended.md) echo '{\"decision\":\"block\",\"reason\":\"intended journey files are human-authored. If code needs a step not in the intended journey, stop and ask.\"}'; exit 2 ;; esac; exit 0"
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/hooks/guard-rule-edits.mjs\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}/.claude/hooks/check-ad-script.mjs\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd \"${CLAUDE_PROJECT_DIR:-.}\" || exit 0; [ ! -d node_modules ] && exit 0; [ ! -f package.json ] && exit 0; ! grep -q '\"lint\"' package.json && exit 0; FAIL=''; npm run lint --silent >/tmp/cc-lint.txt 2>&1 || FAIL=\"lint\"; if [ -f package.json ] && grep -q '\"typescript\"' package.json && command -v npx >/dev/null 2>&1; then npx tsc --noEmit >/tmp/cc-tsc.txt 2>&1 || FAIL=\"$FAIL typecheck\"; fi; if [ -n \"$FAIL\" ]; then echo '{\"systemMessage\":\"NOT DONE — failing: '$FAIL'. Fix before reporting complete.\"}'; exit 2; fi; exit 0"
          }
        ]
      }
    ]
  }
}
```

How I checked this block: I ran each of the three commands through `sh` from the `src/hooks` folder, with `CLAUDE_PROJECT_DIR` set and with it unset. All three answered right both times.

Not tested:

- **Codex.** Its hook input shape is unproven. The guard reads `tool_input.file_path` (the Claude shape). It also reads the `*** Update File:` lines of an `apply_patch` patch, which is my guess at the Codex shape. If Codex sends neither, the guard stays quiet and protects nothing there.
- **Bypass-permissions mode.** I did not test whether the "ask" answer still shows a question in that mode. After wiring, try one rule edit in a bypass session. If no question shows, change `ask` to `deny` in the guard and in the self-test. Then only `FUNDHUB_RULES_APPROVED=1` lets an edit through.
- **Wiring in a live session.** The lead has not wired anything yet. What Claude Code does with each answer comes from its documented hook format, not from a live run. After wiring, open a fresh session, type `/hooks` to see the three, and ask for a one-line edit to `docs/rules/RULES-INDEX.md`. A question must appear.

## (d) Approve an edit, switch a hook off

**Approve one edit.** The guard shows the edit and asks. Approve it in Claude Code and that one edit goes through.

**Approve a whole session of rule work.** Start the session with `FUNDHUB_RULES_APPROVED=1`. The value must be exactly `1`.

- In a terminal: `FUNDHUB_RULES_APPROVED=1 claude`
- In the Claude app, put this in `.claude/settings.local.json` (a file that stays on this Mac, ignored by git), start a fresh session, and delete it when the rule work is done:

```json
{ "env": { "FUNDHUB_RULES_APPROVED": "1" } }
```

The self-test proves the guard goes quiet when the variable is `1`. I did not test the `settings.local.json` route in the Claude app.

Phases 4 and 5 of this cleanup edit `CLAUDE.md`, `AGENTS.md` and the rule files. Run them with `FUNDHUB_RULES_APPROVED=1`, or expect one question per edit.

**Switch a hook off.**

| Hook | For one session | For good |
|---|---|---|
| `guard-rule-edits.mjs` | `FUNDHUB_RULES_APPROVED=1` | Delete its group from the settings file. |
| `check-ad-script.mjs` | `FUNDHUB_AD_CHECK=off` | Delete its group from the settings file. |
| `session-rules.mjs` | none | Delete its group from the settings file. |

Leave the `.mjs` files in place. A hook that is not in the settings file never runs.

## (e) Run the self-test

```
node scripts/hooks/selftest.mjs
node --test src/hooks/hooks-selftest.test.mjs
```

The first prints `hooks self-test OK: 58 checks passed ...` in about 2 seconds, and exits 0. On a failure it prints the name of the check and what went wrong, and exits 1. The second runs the first one inside `node --test`, so `npm test` runs it too.

What it checks:

- **Session rules.** The answer names `RULES-INDEX`, `CLAUDE.md` and `AGENTS.md`. It holds the first heading of the real index. It counts rule files. It stays under 1500 characters, even for a 150-heading index. It prefers `.ai/rules`. It survives a missing index.
- **Guard.** It asks for a rule file, `CLAUDE.md`, `AGENTS.md` and `RULES-INDEX.md`. It asks for a file that does not exist yet, a worktree copy, a link into a rule folder and a path under a linked skill folder. It stays silent for a normal source file, a Read, bad input and `FUNDHUB_RULES_APPROVED=1`.
- **Ad check.** It blocks a bad draft and passes a clean one. It stays silent for `README.md`, notes, `ALL-` collections, the `machine/` folder, a file with no date and a missing file. It reads a fake checker's lines and cuts them to about 800 characters. It stays silent when the checker crashes. It follows a link name to a draft.
- **Temp files.** All of them live under the system temp folder. The self-test deletes them. It never edits a real rule file.

The self-test has a guard of its own. If a rule change makes the checker reject the clean sample draft, it stops with the message "the self-test's clean sample is out of date".

## (f) The risk

**The guard asks every time.** A background agent that edits a rule stops and waits for Chris. If Chris is away, the agent waits until he is back. For planned rule work, start the session with `FUNDHUB_RULES_APPROVED=1`.
