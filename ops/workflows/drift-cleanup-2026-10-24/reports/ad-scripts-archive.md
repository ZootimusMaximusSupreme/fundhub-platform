# Ad-scripts board archive

Date: 2026-10-24
Branch: `drift-cleanup`
Did not push.

## Commits

- Work commit: `e47d9acab9c86267855c44f96e2286584be15868`
  Message: Move two ad-script laws into the rule files.
- Follow-up so the live path is gone: `0eda3212d16e8dec7e2636ab2a3949bcc7168cb1`
  The first commit added the archive copy. This one dropped `ops/workflows/ad-scripts-2026-10-02.md` so the board lives only at the archive path.

## Exact sentences added

In `.ai/rules/ad-no-recycled-lines.md` Never list (owner-set 2026-10-02), word for word from board lines 36 and 113:

- No "Not another ___, but..." openers. "Not another ___, but…". (owner-set 2026-10-02)

In `.ai/rules/copy-certainty.md` Never list (owner-set 2026-10-02), word for word from board lines 48 and 142:

- Never state a day count. The page's refund line says "within 7 days". Ads never state a day count. (owner-set 2026-10-02)

Front matter on both files was kept. The rest of each file was not rewritten. `marketing/ads/RULES.md` was not edited.

## Board move

`ops/workflows/ad-scripts-2026-10-02.md` → `ops/archive/ai-instructions-2026-10-24/ops/workflows/ad-scripts-2026-10-02.md`

The helper folder `ops/workflows/ad-scripts-2026-10-02/` was left in place. It is not the board file.

## Progress

Ticked the archive checkbox. Every other file named on that line was already under `ops/archive/ai-instructions-2026-10-24/` (codex-build board, slo-297 prompt, and stale-plan A1–A15). Removed the Left for Chris bullet about this board and the two laws. Kept the pulse-registry comment bullet.

## Pointers updated

Instruction files now point at the archive path, or at the two rule files when the sentence was about those laws:

- `marketing/ads/scripts/2026-10-02.md`
- `marketing/ads/INVENTORY-2026-10-02.md`
- `marketing/MACHINE-GAPS.md` (three board cites). That file already had one other archive-path fix for `full-launch-lattice-2026-09-20.md`. I did not revert it.
- `ops/workflows/repo-sync-and-thread-cleanup-2026-10-05.md`
- `ops/workflows/drift-cleanup-2026-10-24/REMAINING.md` (also names the two rule files)
- `ops/workflows/drift-cleanup-2026-10-24/plans/stale-plan.md`
- `ops/workflows/drift-cleanup-2026-10-24/phase-3-conflicts.md` (opener-ban row now points at `.ai/rules/ad-no-recycled-lines.md`; other cites use the archive path)
- `ops/workflows/drift-cleanup-2026-10-24/PROGRESS.md`

## Pointers left

- `db/migrations/407_ad_number_from_meta.sql` lines 71–72. App/database code. This job does not edit `db/`.
- `ops/workflows/drift-cleanup-2026-10-24/reports/safe-archives.md` lines 40 and 69. Another agent's untracked report. Staging it would have put their whole file in this commit.
- `ops/workflows/drift-cleanup-2026-10-24/phase-3-decisions.md` line 96. I did change that row to the archive path and the two rule files. I left the file unstaged because the same diff also has another agent's "Chris's answers" block for calls 51 and 52.
- `ops/workflows/drift-cleanup-2026-10-24/PROGRESS.md` line 15 still writes the old live path in the ticked checkbox list. That line is the checklist item, not a live pointer.

`src/ads/ad-number-cases.mjs` line 9 names the helper file `ops/workflows/ad-scripts-2026-10-02/w4-findings.md`, not the board `.md`. Left alone. App code.
