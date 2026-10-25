---
description: Do not create a new markdown file unless Chris asks for one
alwaysApply: true
---

# No new markdown files

**Owner law (2026-10-24):** Do not create new .md files unless I ask for one. Update an existing file instead.

## Always

- Update a file that is already there.
- Create a new .md file only when Chris asks for that file.
- The hook blocks a new .md file outside `docs/`, `ops/`, `marketing/`, `.claude/rules/`, `.cursor/rules/`, and `.ai/rules/`.
- `.ai/rules/` is on that list because it is the one real home for a rule. The Cursor and Claude rule folders are links to it.

## Never

- A new .md file he did not ask for.
- A second copy of a note that already has a home.

## Example

```text
Ask: "Fix the login note."

❌ Add a new login-fix.md.
✅ Update the note that already exists.
```
