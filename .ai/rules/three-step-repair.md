---
description: Verify → Fix → Finish in one paste; one hole per chat
alwaysApply: true
---

# Three-step repair

**Owner law (2026-08-26):** Each named hole is one paste, one chat, three steps in order. The agent starts that chat from the board prompt; Chris does not have to copy anything. That chat does VERIFY, then FIX, then FINISH. Never skip VERIFY. Never two holes in one chat. Each named hole is one task with one owner chat. An agent never verifies, fixes, or proves more than one named hole in the same chat.

An approved launch is one named task. Its required release-check failures are part of that task and may be repaired in parallel (`finish-the-requested-job`); they are not separate hole tickets that need new owner prompts.

## The three steps

1. **VERIFY** — recreate the hole. If it is not real, write **NOT A PROBLEM** and **STOP**. Do not fix.
2. **FIX** — only after VERIFY wrote the hole is real. Only that hole. Smallest diff. Isolated worktree off `origin/main`. Load `fundhub-fixer`.
3. **FINISH** — a different tester than the fixer tries to recreate the same hole on the live site (click twice if UI). The fixer never marks done. Write PASS/FAIL. **STOP**. Do not start another hole.

## Never

- Skip VERIFY and go straight to FIX
- Fix after VERIFY said **NOT A PROBLEM**
- Start a second hole in the same chat
- Make Chris open VERIFY, then FIX, then FINISH as three chats
- “Also do #7 while you're in #6”
- Walk the other 18 “since I'm already in the file”
- Start a second hole because the first one is blocked

## Example

If a second hole appears: Law: no-extra-holes (.ai/rules/no-extra-holes.md) - write it on the shared board as one leftover card and stop.

```text
Paste: hole 4 box.

❌ Recreate #4, then also start #5.
✅ Recreate #4. If real, fix #4. Prove #4. Stop.
```

```text
Paste: “VERIFY hole 6 — Remove Inquiries lie.”

❌ Recreate #6, then also check trial cap (#7) on the same Repair file.
✅ Recreate #6 only. Write PASS or NOT A PROBLEM. Stop.
```

See also `audit-vs-fix-router` (.ai/rules/audit-vs-fix-router.md) and `no-extra-holes` (.ai/rules/no-extra-holes.md).
