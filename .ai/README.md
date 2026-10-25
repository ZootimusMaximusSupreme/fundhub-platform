# .ai: the one home for rules

Every Fundhub rule is ONE real file here: `.ai/rules/<name>.md`.

The Cursor and Claude folders hold links to these files. They do not hold copies.

| Tool | Reads the rule at | What that path is |
|---|---|---|
| Cursor | `.cursor/rules/<name>.mdc` | a link to `../../.ai/rules/<name>.md` |
| Claude Code | `.claude/rules/<name>.md` | a link to `../../.ai/rules/<name>.md` |
| Codex | `AGENTS.md` | Codex does not read rule folders |

Skills have one home too: `.agents/skills/<name>/`. They are linked at `.cursor/skills/<name>` and `.claude/skills/<name>`.

## To add or change a rule

The steps below are the commands.
Law: rules-no-drift (.ai/rules/rules-no-drift.md) - a rule is written once, linked for Cursor and Claude, and every older line that says otherwise is rewritten.

1. Write or edit `.ai/rules/<name>.md`. Keep the front matter (`description`, `alwaysApply`).
2. Link it for both tools:
   - `ln -s ../../.ai/rules/<name>.md .cursor/rules/<name>.mdc`
   - `ln -s ../../.ai/rules/<name>.md .claude/rules/<name>.md`
3. Add its line to `docs/rules/RULES-INDEX.md` and its owner-set line to `CLAUDE.md`.
4. Run `npm run rules:check`. It fails if a link is missing or wrong, or if a real copy sits in `.cursor/` or `.claude/`.

A rule only for Cursor gets the `.cursor` link only, plus a reasoned entry in `scripts/rules-drift-allow.json`.

The full list of rules is `docs/rules/RULES-INDEX.md`.
