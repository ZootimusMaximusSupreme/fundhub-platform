# Item 4 — checker, index, ignore lists

Date: 2026-10-24. Branch: `drift-cleanup`. Commit: `4b391a56c40397eaa22b1baa9bbb9601b6b7c842`.

## Checker

```text
rules:check OK — no drift.
```

```text
# tests 26
# suites 0
# pass 26
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Both commands passed:

- `node scripts/rules-drift-check.mjs`
- `node --test src/rules/rules-drift-check.test.mjs`

## What the checker now requires of CLAUDE.md

The old "every always-on law is named in CLAUDE.md" check is gone. The short index must:

- name `docs/rules/RULES-INDEX.md`
- keep headings 0 to 12, including 3a, 3b, and 3c
- name only paths that exist
- stay at or under 220 lines (AGENTS.md at or under 90)

Those caps were not tightened. Other checks stayed: links, one real home, index rows, retired words, dates. Archived files are not linked as live; each archived rule sits under `ops/archive/ai-instructions-2026-10-24/` and has no live `.ai/rules` file or Cursor/Claude link.

## Index

Item 3's new rules were already listed. No live row was added.

The two "set aside" book lines now say the ad rule books are in force. Where a book line fights a newer rule, the newer rule wins.

All 13 archived rules were confirmed under `ops/archive/ai-instructions-2026-10-24/` before the archive list was added. None are still live.

## Ignore lists

`ops/archive/ai-instructions-2026-10-24/` was already in `.ignore`, `.cursorindexingignore`, and `.serena/project.yml` `ignored_paths`. No ignore-list edit.

## Extra line the checker required

`.ai/rules/compliance-label-removed.md` front matter named the retired phrase `COMPLIANCE REVIEW REQUIRED`. The description was rewritten so the retired-word check stays strict. CLAUDE.md and AGENTS.md were not edited.

Not pushed.
