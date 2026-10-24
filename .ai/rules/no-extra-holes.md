---
description: Never hunt, verify, or fix extra holes Chris did not name
alwaysApply: true
---

# No extra holes

**Owner law (2026-09-18):** Agents never hunt, find, or fix extra holes Chris did not name. That is insane.

This chat owns **only** the hole Chris named in the paste.

An approved launch includes its required release checks. A failure in one of those checks is named launch scope, not an extra hole. Fix and rerun it under `approved-launch-release-blockers.mdc`.

## Never

- VERIFY an unnamed hole
- FIX an unnamed hole
- Spawn a fixer for an unnamed hole
- Spend time on live walkthroughs of unnamed holes
- Dump “while proving hole 7 I also found N1–N27”

## If you trip over another break

Write it on the shared board as a leftover. **STOP.** Do not VERIFY it. Do not FIX it. Do not spawn a fixer.

A dirty leftover on a path that used to work: card it, stop. That is not the headline.

## Example

```text
Paste: hole 7.

❌ Prove #7, then live-walk twenty other breaks and spawn fixers.
✅ Prove #7 only. Trip over something else? One leftover card on the board. Stop.
```

Reinforces `one-issue-per-thread.mdc`, `named-fix-regression-gate.mdc` point 2, `owner-scope-minimal-diff.mdc`, `three-step-repair.mdc`.
