# Named-fix hard gate

**Owner law (2026-09-18):** AI must not make shit up. AI must not ship a fix that is not real. This gate wins on **done** over `three-step-repair.md` FINISH. Board: `ops/workflows/live-prove-2026-09-17-notes.md`.

This gate covers named live-site hole tickets. A failed required CI or release check in an approved launch follows `approved-launch-release-blockers.md`: reproduce and repair the check, then verify the release. Do not require a live-site defect before repairing a CI-only failure.

## Law

1. **VERIFY on the live site first.** Recreate the named hole. If you cannot see it, write **NOT A PROBLEM** and **STOP**. Do not “fix” a story.
2. **A finding is not real** until you looked at the live screen (or the live API that screen uses). Reading code and guessing is not a hole. Do not invent extra holes.
3. **After FIX, a different tester** than the fixer must try to recreate the **same** hole on live. Click twice. If the bug is still there, the fix is **FAKE**. Not done. Do not start the next hole. Do not mark PASS from unit tests, a comment, or “I changed the file.”
4. **Script green ≠ done.** Playwright green ≠ done unless that spec is the live path. Desk-load ≠ sequence.
5. **Full e2e is not this gate.** This gate is only: is this hole real, and is this fix real.

## Dirty leftover

If live prove of this hole turns up a **new** break on a path that used to work, card it as a **new hole** on the board. Stop. Do not fix it in this chat. That is not the headline.

## Never

- Skip live VERIFY and “fix” from a story or a code maybe
- Invent extra holes from reading files
- Mark PASS from tests, comments, or a file change
- Let the fixer mark done
- Start the next hole after a FAKE fix
- Run full e2e as the per-hole prove
- Flip `messaging_settings.outbound_enabled`
- Run `npm run verify:e2e` (or the scratch harness) on the live database

## Example

```text
Paste: hole 12.

❌ Read the code, “fix” it, write PASS from a green test. Start hole 13.
✅ Recreate #12 on live. If you cannot see it, NOT A PROBLEM. Stop.
   If you see it, fix only that. Other tester tries the same hole on live twice.
   Bug gone → done. Bug still there → FAKE. Not done.
```

See also `one-issue-per-thread.md`, `owner-scope-minimal-diff.md`, `verify-scratch-only.md`.
