# Three-step repair

**Owner law (2026-08-26):** Each named hole is one paste, one chat, three steps in order. The agent starts that chat from the board prompt; Chris does not have to copy anything. That chat does VERIFY, then FIX, then FINISH. Never skip VERIFY. Never two holes in one chat.

## The three steps

1. **VERIFY** — recreate the hole. If it is not real, write **NOT A PROBLEM** and **STOP**. Do not fix.
2. **FIX** — only after VERIFY wrote the hole is real. Only that hole. Smallest diff. Isolated worktree off `origin/main`. Load `fundhub-fixer`.
3. **FINISH** — prove it yourself on the live site (click twice if UI). Write PASS/FAIL. **STOP**. Do not start another hole.

## Never

- Skip VERIFY and go straight to FIX
- Fix after VERIFY said **NOT A PROBLEM**
- Start a second hole in the same chat
- Make Chris open VERIFY, then FIX, then FINISH as three chats

## Example

```text
Paste: hole 4 box.

❌ Recreate #4, then also start #5.
✅ Recreate #4. If real, fix #4. Prove #4. Stop.
```

See also `one-issue-per-thread.md` (one hole per chat) and `audit-vs-fix-router.md`.
