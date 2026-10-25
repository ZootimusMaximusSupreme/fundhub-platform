---
description: A rule or skill is written once, linked for Claude and Cursor; a new rule updates every line that says otherwise and the index
alwaysApply: true
---

# Rules never drift

**Owner law (2026-10-24):** Rules had drifted. Two rules said opposite things, files named things that were gone, and many rules lived in only one home. Chris ordered them organized and fixed. This keeps them that way.

**Owner law (2026-09-21):** When Chris asks for a rule, a skill, or a law in this repo, write it for Claude and for Cursor in the same change.

## Always

When Chris sets a new rule, or changes an old one, do all of this in the same change:

1. Write the rule once, in its one real home: `.ai/rules/<name>.md` (with `alwaysApply: true`). Link it at `.cursor/rules/<name>.mdc` and at `.claude/rules/<name>.md`. A rule that is only for Cursor gets no Claude link, must say so, and the index must list it as Cursor-only on purpose. The rule has `alwaysApply: true` in its front matter, unless he named files it should match. Skills have one home too: the real folder `.agents/skills/<name>/SKILL.md` (Codex reads this folder). Cursor link: `.cursor/skills/<name>` points at `../../.agents/skills/<name>`. Claude link: `.claude/skills/<name>` points at the same folder. If a link is missing, add it in that same change.
2. Search every rule, skill, board and CLAUDE.md or AGENTS.md line for words that say something different. Rewrite each one to match the newest owner-set line, or replace it with a one-line pointer to it. The newest owner-set line wins. Never delete or soften an owner law to make two lines agree.
3. Add the short owner-set line to CLAUDE.md in the unnumbered owner area. Do not renumber sections.
4. Add the rule to `docs/rules/RULES-INDEX.md` under its topic.
5. If the call came from a chat and lives only in memory, it is not done until it is in the repo.

## Never

- Add a rule and leave an older line that says the opposite.
- Add a rule with a link missing, or as a real copy in `.cursor/` or `.claude/`.
- Leave a rule out of the index.
- A Cursor-only rule when he asked for a rule.
- A Claude-only skill when he asked for a skill.

## Example

```text
Ask: "From now on, never say round two."

❌ Add one new rule file and stop. The ad rules still say "round two".
✅ Add the rule once in `.ai/rules` with both links, rewrite every older line that says it, add the CLAUDE.md line, add the index row.
```

```text
Ask: “Make a rule that the reply is the URL.”

❌ Write only `.cursor/rules/ux-guidance-urls-first.mdc`.
✅ Write `.ai/rules/ux-guidance-urls-first.md`, link it at `.cursor/rules/ux-guidance-urls-first.mdc` and `.claude/rules/ux-guidance-urls-first.md`, and add a short line in `CLAUDE.md`.
```
