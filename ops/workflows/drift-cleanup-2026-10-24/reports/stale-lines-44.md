# Stale lines (44)

Date: 2026-10-24. Branch: `drift-cleanup`. Plan: `plans/stale-plan.md`. No push. No merge. `phase-3-decisions.md` was not edited.

## Counts

- Already gone: **33**
- Cut and archived: **11**
- Skipped: **0**
- Checker: `rules:check OK — no drift.`

Every one of the 44 is either already gone or removed. No owner law was dropped.

## Already gone (33)

S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S15, S17, S18, S20, S21, S22, S23, S24, S26, S27, S28, S29, S30, S31, S32, S33, S35, S36, S37, S38, S43, S44.

These were cleaned in earlier drift-cleanup commits. S8 already had the true Company Brain line. S12's five archived rules already sit under "Archived on 2026-10-24". S31 already says locked controls (filmed August 2026).

## Cut (11)

| ID | File | Why |
|---|---|---|
| S1 | `.ai/rules/everything-in-the-repo.md` | The 83 scripts are in the repo now. |
| S2 | `.ai/rules/github-push.md` | Same story; the 83 scripts were rebuilt on 2026-10-03. The laptop reason for commit-every-session stayed. |
| S13 | `docs/rules/RULES-INDEX.md` | Old board pointer. Now `ops/workflows/drift-cleanup-2026-10-24/BOARD.md`. |
| S16 | `docs/rules/compliance/creative-block-reasons.md` | Diary of the day the folder was made. Remaining gap items were renumbered. |
| S19 | `docs/sops/manual-sms-twilio.md` | "Prove Monday" was 2026-08-17. Sending is live. |
| S25 | `docs/specs/teleprompter-ios-app-build-2026-10-10.md` | App is in progress. Owner step to pay Apple is done. Speed and 30 fps laws stayed. |
| S34 | `marketing/ads/scripts/README.md` | Scripts live in dated batches and the 2026-10-03 compiled files. |
| S39 | `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` | CAPI is built. Section 4 now names the live paths. |
| S40 | `marketing/landing-pages/slo/README.md` | Launch and sim-mode blocks. Booking page added to the PAGES list. |
| S41 | `marketing/landing-pages/CURSOR-PROMPT.md` | One-time repair task. Design tokens stayed. |
| S42 | `marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` | One-time "still on you" ask. Same API banner as `CHRIS-DO-THIS-FIRST.md`. Attribute keys stayed. |

Cut text is in `ops/archive/ai-instructions-2026-10-24/removed-lines/`.

## Dead references

Only pointers that named a file now under `ops/archive/ai-instructions-2026-10-24/` were changed, and only in instruction files.

- `marketing/landing-pages/slo/CHECKOUT-FOR-CLAUDE.md` no longer names `SNEAK-PEEKS-FOR-CLAUDE.md`. It points at the sample cards on `slo-01-sales.html` and `.ai/rules/sample-clients-consistent.md`.
- `docs/specs/marketing-machine-2026-10-04.md` no longer names `.claude/rules/rules-for-claude-and-cursor.md`. It points at `.ai/rules/rules-no-drift.md`.

Pointers that already used the archive path (`ad-scripts-2026-10-02.md`, `full-launch-lattice-2026-09-20.md`) were left alone. The `fixes.md` pointer sat inside the S41 block that was archived.

## Skipped

None. No listed line still held a law that was missing from a live rule.

## Checker

```
rules:check OK — no drift.
```
