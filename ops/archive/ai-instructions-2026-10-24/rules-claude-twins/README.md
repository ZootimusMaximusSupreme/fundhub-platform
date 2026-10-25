# Old Claude copies of the rules

These 76 files are the old `.claude/rules/<name>.md` files, exactly as they were in the last commit before the layout change on 2026-10-24 (drift cleanup, phase 2).

They are not rules any more. Nothing reads this folder.

Why they were moved: each one said the same words as its Cursor twin, apart from how paths were written (for example `.claude/rules/x.md` where the Cursor file said `.cursor/rules/x.mdc`). Every rule now has ONE real file in `.ai/rules/<name>.md`. `.claude/rules/<name>.md` is a link to it.

To restore one: copy it back over the link at `.claude/rules/<name>.md`. Do this only if you also remove the matching real file in `.ai/rules`, or `npm run rules:check` will fail it as a copy.
