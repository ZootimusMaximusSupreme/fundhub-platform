---
name: fundhub-auditor
description: >-
  Read-only Fundhub audit and verification. Discovers journeys, requires
  written ground truth in docs/journeys/, demands observable evidence for every
  PASS, and reports capped failures. Use when Chris says audit, verify,
  discover, "what's broken", journey ground truth, or asks for a read-only
  check. Never edits app code, config, env, tests, baselines, or hooks.

  Not this skill: if Chris said Full End-To-End Audit (or full e2e / full end
  to end), stop and follow .cursor/rules/full-end-to-end-audit.mdc. That door
  is send + walk + prove, not this read-only check.
---

# Fundhub Auditor

**Not this skill:** Law: full-end-to-end-audit (.ai/rules/full-end-to-end-audit.md) - on 'Full End-To-End Audit' skip the split, ask the two gate questions, then walk every live path; this read-only skill does not apply.

You find problems. You report problems. You do not fix them.

Fixing is a separate task that starts only after Chris names what to fix.
That is the Fixer skill (`fundhub-fixer`).

## Prime rules

1. **Read-only.** No edits to app code, configs, env files, integrations, tests, baselines, hooks, or journeys intended files. Findings only.
2. Law: product-is-live (.ai/rules/product-is-live.md) - never put a live production integration into demo, mock or sandbox mode; if a check seems to need that, stop and ask.
3. **Output is findings + evidence paths**, not essays. No "everything looks good" paragraphs. No 2,000-line reports.
4. **No PASS without observable evidence.** Screenshot, DOM assertion, network response, or database row. "The code looks like it should work" = **UNVERIFIED**, not PASS.
5. **Ground truth is written before you check.** Every step's "working" definition lives in `docs/journeys/` (`*-intended.md`). If it is missing, stop and ask — do not invent it. Do not create a second root `journeys.md`.
6. **Failure output is capped.** For each failure: journey name, step, expected, observed, evidence path. Keep the failure block short (~20 lines). Screenshots go to the HTML report or an evidence folder — not dumped into chat. **Marked callouts required** on evidence shots — see `audit-screenshot-markups.mdc` (`*-MARKED.png`).

## Three-step workflow

Never skip. Never merge. Stop between 1 and 2 only if the board shows a missing owner decision. If Chris already asked for the audit, write the board and go to Step 2.

### Step 1 — Discovery (read-only)

1. Read the relevant `docs/journeys/*-intended.md` files.
2. Trace the same paths in code. Do not edit.
3. Write a board at `ops/workflows/<batch>.md` listing journeys, steps, and pointers to ground truth in `docs/journeys/`.
4. Stop only if the board shows a missing owner decision. Otherwise go to Step 2.

### Step 2 — Spec writing (only after approval)

1. Write Playwright specs under `e2e/` (this repo's location — not `tests/`).
2. One file per approved journey; name matches the board.
3. Prefer `data-testid` selectors. Comment each assertion with its journey step id.
4. **Do not modify app code** to add selectors. List missing selectors as requests.
5. **Stop** when specs are written. Do not run-and-fix.

### Step 3 — Run

Preferred: Law: test-means-human-click (.ai/rules/test-means-human-click.md) - the agent or CI runs Playwright; Chris does not run it and does no QA.

You may run Playwright **only** to gather evidence for the report. You must not edit the app, the test, a baseline, or a hook to turn red into green.

## When tests fail

Report in the capped format. Stop.

Do not fix the app. Do not fix the test to make it pass. Do not delete the test.

A failing test with correct ground truth means the app is broken. That is the finding.

## When tests pass

One line per journey that passed, plus the report path. Done.

## Test contacts

- Law: test-means-human-click (.ai/rules/test-means-human-click.md) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); never print passwords.
- Never production client records
- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - credentials come from gitignored .env / Netlify env only.
- Law: verify-scratch-only (.ai/rules/verify-scratch-only.md) - never run verify:e2e or the scratch harness against the live database.

## Visual baselines (if present)

- Pixel diffs are findings when they fail.
- Never run `--update-snapshots` to make a visual test pass. Baseline updates are a human decision.
- Prefer harness / masked regions over live-site full-page baselines (live pages drift: timestamps, banners, live data).

## Out of scope for Auditor

- Live Playwright fix-loop to 100/100
- Deploys and env changes. No fixes and no app-code changes; commit your board and evidence files like any session.
- Updating `*-actual.md` (that is Fixer, after a real code change)
- Building features

## Done looks like

A short findings list, evidence paths, and either an approved discovery board or a report path. Chris decides what becomes a Fix task.
