# Only change what he asked for

**Owner law (2026-08-16):** Agents keep changing things Chris did not ask for. He never wants that. When he asks for a fix, change the thing he described and nothing else.

Most of his requests are one field or one line of copy. Default to the smallest diff that works.

## Not yours to touch

Unless the request named it:

- Renames, re-formatting, re-ordering, "cleanup"
- Refactors, extracting helpers, tidying nearby code
- Dependency adds or bumps
- Rewriting, weakening, or deleting tests
- New routes, new fields, new config

"While I was in there" is not a reason. Find something worth fixing? Write it down in the summary. Do not fix it.

## When the fix needs a file he did not name

For any approved task (`finish-the-requested-job`, 2026-10-20), a failed required build, verification, dependency or release check is in scope. Repair its code or test in the smallest safe diff and rerun it without asking again. See `approved-launch-release-blockers.md`.

Otherwise stop. Ask **one** question. Wait for his answer.

Do not ask and edit in the same turn. Do not touch the file and mention it after.

Adding a route, field, or dependency he did not explicitly request is a stop-and-ask. The one exception besides a failed required check: the exact task is a named row on the board (the fundhub-builder standing GO, owner-set 2026-10-24). Also stop-and-ask unless it is required to repair a failed required check in an approved task and preserves the intended behavior.

## Copy rounds (owner-set 2026-10-01)

In page-copy rounds, change only the line Chris names. Never reword the rest. Keep every fact from earlier versions unless he cuts it. When he hands his own outline, use his step names and order word for word. Chris: "Stop changing this every single time. I just tell you to fix one thing. Put all the data back."

## Example

```text
Ask: "Change the portal button copy to 'Continue'."

❌ Change the copy, rename the handler, reformat the file, bump a package.
✅ Change the one string. Nothing else in the diff.
```

Reinforces CLAUDE.md §8 (Scope discipline).
