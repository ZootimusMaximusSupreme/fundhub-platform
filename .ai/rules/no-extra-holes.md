---
description: Never hunt, verify, or fix extra holes Chris did not name
alwaysApply: true
---

# No extra holes

**Owner law (2026-09-18):** Agents never hunt, find, or fix extra holes Chris did not name. That is insane.

This chat owns **only** the hole Chris named in the paste.

An approved launch includes its required release checks. A failure in one of those checks is named launch scope, not an extra hole. Fix and rerun it under `finish-the-requested-job` (.ai/rules/finish-the-requested-job.md).

## Never

- First form (owner-set 2026-09-08): do not fix a hole he did not name and do not change a file he did not ask you to change. Do not open a section called “other things I noticed.” This bites hardest in walkthroughs and audits, where a list of extra findings buries the one thing he asked for.
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

Reinforces `three-step-repair` (.ai/rules/three-step-repair.md), `named-fix-regression-gate` point 2 and `owner-scope-minimal-diff`.
