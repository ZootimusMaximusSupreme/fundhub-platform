# Branch cleanup — 2026-10-09

Chris: "all branches on main, for GitHub and for local." Done the same day. `main` is the same commit on this Mac and on GitHub.

## What was removed

- **243 local branches** and **69 GitHub branches** that were already merged into `main`.
- **116 finished work folders** under `.claude/worktrees/` (each was clean and its commit was already on `main`).
- **23 GitHub branches** that were not merged by history but are fully contained in `main` by patch comparison (`git cherry` shows 0 unique commits). `main`'s history was rewritten on 2026-10-05 (blob strip), so these old branches look unmerged but add nothing. Names and tips are below so any can be restored with `git branch <name> <sha>` while GitHub still holds the objects.

| branch | tip |
|---|---|
| `claude/creator-incentive-program-6s4371` | `65e4f8651` |
| `claude/dexa-scanning-gilbert-cost-268zmv` | `c3fa1b80e` |
| `claude/fundhub-platform-updates-3oixdf` | `6d888f9b9` |
| `claude/landing-page-conversion-q6nswg` | `9ecd9c06a` |
| `claude/lindy-panels-review-9xz9sj` | `fbbef6c35` |
| `claude/portal-welcome-video-v6iwef` | `c87a72f0d` |
| `claude/slo-offer-copy-vsl-wo8g2k` | `7392a3fde` |
| `claude/slo-offer-financial-model-fo8uy1` | `a3c3e6f8f` |
| `claude/vigilant-clarke-udvevr` | `ad9cdbdc2` |
| `feat/ad-script-generator` | `a1697048d` |
| `feat/csm-accountability-calls` | `99c37ae4d` |
| `feat/csm-role` | `1ae1a83f7` |
| `feat/csm-role-schema` | `090d7adc7` |
| `feat/laptop-recovery-2026-09-06` | `5b7cbe9bf` |
| `feat/lender-bureaus` | `c22046be3` |
| `feat/letters-all-rounds` | `949a75727` |
| `fix/bundle-vendor-into-functions` | `c36eb77ec` |
| `fix/fulfillment-2026-09-06` | `0bafcd4ae` |
| `fix/nudge-r4-2026-09-06` | `e87fbf176` |
| `fix/r2-w10-deliverables` | `0d8b58e69` |
| `fix/r2-w11-notifications` | `19a8250ad` |
| `fix/r2-w8b-repair-floor` | `4634334db` |
| `fix/walk-2026-09-06` | `f2c8c2610` |

## Merged into main today

- `d1-bundle-fix` (the Netlify bundler fix for `local-whisper.mjs`, plus its board note).
- `mm-u02-rule-changes` (docs and comments only).
- Fix batch 2026-10-09: Q, F1a, F2a, F4, F5b. Zero-unchecked Ship 1 and Ship 2: A, B, C, D, G, R. Repair flow: P.

## Deleted as temporary

- `ci-proof-2` (tip `e07375fc7`): a one-off CI migration proof, named "temporary, ci-proof-2 only".

## Kept, as draft pull requests (real work, not on main, conflicts with main, needs review and the full suite)

| pull request | branch | what it is |
|---|---|---|
| #24 | `finance-os-f2-bank-relink` | FinanceOS F2: a client can fix a broken bank login (Plaid update mode). It was only on this Mac before today. |
| #25 | `mm-x4f-funnel-push-on-domain` | Push live puts a funnel on apply.fundhub.ai (ClickFunnels). |
| #22 | `mm-u37-today-additions` | Marketing Command Center "Today" tab additions. Needs the Playwright check. |
| #26 | `mm-gl-blueprint-glue` | Blueprint glue review fixes (marketing research and shoot plan). |

## Left alone

- 39 git stashes on this Mac (other sessions' unfinished edits). Not branches; nothing was dropped.
- 7 work folders under `.claude/worktrees/` for the branches above.
- Remote branch `claude/creator-incentive-program-6s4371` and the other `claude/*` branches were contained in `main` and are in the table.

## Evening update, 2026-10-09 ~6:50 p.m. Arizona

- **Merged and shipped:** the 4 test fixes (T1 generated docs, T2 workflow pins, T3 fence and pulse scope tests, T4 edit-ops tests) and X4F (funnel push, with a new morning lane `built-funnels:live-pages-answer`). Full suite: 19,863 pass, 1 fail (the climate page copy test, below). It was 12 fails this morning.
- **Still open as draft pull requests, each brought up to date with main and tested:**
  - #26 `mm-gl-blueprint-glue` and #22 `mm-u37-today-additions`: checked and merge-ready, held on purpose because they add model-cost buttons (owner rule 2026-10-06: no AI spend for now).
  - #24 `finance-os-f2-bank-relink`: not merge-ready (Postgres tests never run, text held, owner pick pending). Customer-facing, so it waits.
- **One failing test left:** `src/http/climate-match.test.mjs` (the live climate page still shows an "Approval Odds" column; the owner banned approval-odds words). Fix is a live page edit, so it needs a marked draft first (`ops/workflows/finish-left-2026-10-09-T4.md` has the exact strings).
- GitHub now holds only `main` and those 3 pull-request branches. Local matches.

## Night update, 2026-10-09 — owner order: no branches, local or GitHub

Chris ordered it: only `main`, synced. The 3 held draft-PR branches are gone (local, GitHub, and their work folders). Nothing was merged to main. Each tip is kept as a tag on GitHub so no work is lost. Restore with `git branch <name> archive/<name>`.

| tag | what it holds | why it was held |
|---|---|---|
| `archive/finance-os-f2-bank-relink` (`914cc2004`) | FinanceOS F2: client fixes a broken bank login (PR #24) | not merge-ready; customer-facing text held |
| `archive/mm-gl-blueprint-glue` (`6449ded2e`) | Blueprint glue review fixes (PR #26) | adds model-cost buttons; no AI spend rule |
| `archive/mm-u37-today-additions` (`4e4359719`) | Marketing "Today" tab additions (PR #22) | adds model-cost buttons; no AI spend rule |

The three draft pull requests closed when their branches went.
