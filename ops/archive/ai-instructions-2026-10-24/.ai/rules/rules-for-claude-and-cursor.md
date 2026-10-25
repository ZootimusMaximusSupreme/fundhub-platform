---
description: A rule or skill Chris asks for is written for Claude and Cursor
alwaysApply: true
---

# Rules and skills: one real home, linked for Claude and Cursor

**Owner law (2026-09-21):** When Chris asks for a rule, a skill, or a law in this repo, write it for Claude and for Cursor in the same change.

**Where the files live (layout changed 2026-10-24):** each rule and each skill has ONE real home. The Cursor and Claude folders hold links to it, never copies. Edit the real file. `npm run rules:check` fails a copy.

## Rules

- The real file: `.ai/rules/<name>.md`, with `alwaysApply: true` in its front matter, unless he named files it should match.
- Cursor link: `.cursor/rules/<name>.mdc` points at `../../.ai/rules/<name>.md`.
- Claude link: `.claude/rules/<name>.md` points at `../../.ai/rules/<name>.md`.
- Standing laws also get a short owner-set line in `CLAUDE.md`. Do not renumber sections.

## Skills

- The real folder: `.agents/skills/<name>/SKILL.md` (Codex reads this folder too).
- Cursor link: `.cursor/skills/<name>` points at `../../.agents/skills/<name>`.
- Claude link: `.claude/skills/<name>` points at `../../.agents/skills/<name>`.
- If a link is missing, add it in that same change.

## Never

- A Cursor-only rule when he asked for a rule
- A Claude-only skill when he asked for a skill
- A real file or real folder in `.cursor/` or `.claude/` where a link belongs. That is a second copy, and copies drift.

## Example

```text
Ask: "Make a rule that the reply is the URL."

❌ Write only `.cursor/rules/ux-guidance-urls-first.mdc`.
✅ Write `.ai/rules/ux-guidance-urls-first.md`, link it at `.cursor/rules/ux-guidance-urls-first.mdc` and `.claude/rules/ux-guidance-urls-first.md`, and add a short line in `CLAUDE.md`.
```
