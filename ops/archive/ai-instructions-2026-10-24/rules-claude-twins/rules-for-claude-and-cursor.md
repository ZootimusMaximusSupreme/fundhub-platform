# Rules and skills live in both homes

**Owner law (2026-09-21):** When Chris asks for a rule, a skill, or a law in this repo, write it for Claude and for Cursor in the same change.

## Rules

- Cursor: `.cursor/rules/<name>.mdc` with `alwaysApply: true`, unless he named files it should match.
- Claude: `.claude/rules/<name>.md` with the same words.
- Standing laws also get a short owner-set line in `CLAUDE.md`. Do not renumber sections.

## Skills

- Write the skill in `.cursor/skills/<name>/SKILL.md`.
- Link it for Claude: `.claude/skills/<name>` points at `../../.cursor/skills/<name>`.
- If it already exists on only one side, add the missing side in that same change.

## Never

- A Cursor-only rule when he asked for a rule
- A Claude-only skill when he asked for a skill

## Example

```text
Ask: "Make a rule that the reply is the URL."

❌ Write only `.cursor/rules/ux-guidance-urls-first.mdc`.
✅ Write that file, `.claude/rules/ux-guidance-urls-first.md`, and a short line in `CLAUDE.md`.
```
