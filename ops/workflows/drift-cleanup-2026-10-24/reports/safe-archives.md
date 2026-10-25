# Safe archives

Date: 2026-10-24. Branch `drift-cleanup`. No commit.

Branch check: `git branch --show-current` printed `drift-cleanup`.

## Moves

Each move used `git mv`. Nothing was deleted. Same relative path under `ops/archive/ai-instructions-2026-10-24/`.

### Named in the job

| From | To | Why |
|---|---|---|
| `ops/workflows/codex-build-claude-test-2026-10-13.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/codex-build-claude-test-2026-10-13.md` | Call 25. One-day rule: no new product features that day. |
| `marketing/ads/slo/slo-297-prompt-2026-09-18.md` | `ops/archive/ai-instructions-2026-10-24/marketing/ads/slo/slo-297-prompt-2026-09-18.md` | On the Phase 3 archive list. Old paste prompt, replaced by `SLO-CHAT-PROMPT.md`. No hit in `src/`, `scripts/`, or `marketing/` for the filename. |

### Archive whole files list (`stale-plan.md` line 60)

Searched `src/`, `scripts/`, and `marketing/` for each filename before a move. No code reads these.

| ID | From | To |
|---|---|---|
| A1 | `ops/workflows/full-launch-lattice-2026-09-20.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/full-launch-lattice-2026-09-20.md` |
| A2 | `ops/workflows/ops-overseer-lattice-2026-09-20.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/ops-overseer-lattice-2026-09-20.md` |
| A3 | `ops/workflows/grok-overseer-handoff-2026-09-20.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/grok-overseer-handoff-2026-09-20.md` |
| A4 | `ops/workflows/codex-finish-handoff-2026-10-13.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/codex-finish-handoff-2026-10-13.md` |
| A5 | `ops/workflows/tuesday-plan-review-2026-10-11.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/tuesday-plan-review-2026-10-11.md` |
| A6 | `ops/workflows/animation-plans-2026-10-22.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/animation-plans-2026-10-22.md` |
| A7 | `ops/workflows/claude-submagic-style-brief-2026-09-23.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/claude-submagic-style-brief-2026-09-23.md` |
| A8 | `ops/workflows/lender-data-brief-2026-09-16.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/lender-data-brief-2026-09-16.md` |
| A15 | `ops/workflows/coverage-paused-until-2026-10-13.md` | `ops/archive/ai-instructions-2026-10-24/ops/workflows/coverage-paused-until-2026-10-13.md` |

A1 through A5, A7, A8, and A15 are one-day or one-batch boards. Their standing laws already live in `full-end-to-end-audit`, `heartbeat-on-every-build`, and `fundhub-ad-editor`. A6 is a finished plan board. The live plans sit in `marketing/ads/animation-plans/`.

## Skips

| Path | Why it stayed |
|---|---|
| `ops/workflows/ad-scripts-2026-10-02.md` | Standing rules in this board are not all in `marketing/ads/RULES.md` Part 0. Did not archive. Did not edit `RULES.md`. See Left for Chris. |
| A9 `marketing/landing-pages/fixes.md` | On the do-not-touch list (`marketing/landing-pages/**`). |
| A10 `marketing/landing-pages/fixes-v2.md` | Same. |
| A11 `marketing/landing-pages/fixes-v3.md` | Same. |
| A12 `marketing/landing-pages/roadmap-updates-2026-09-21.md` | Same. |
| A13 `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` | Same. |
| A14 `marketing/landing-pages/slo/FUNDHUB-297-FUNNEL-README.md` | Same. Did not copy its open items to `TODO.md`. |

No listed file was already moved by another process.

## Ignore lines added

No other ignore rows were removed.

`.ignore` and `.cursorindexingignore`:

```text
# This cleanup's archived instruction copies
ops/archive/ai-instructions-2026-10-24/
```

`.serena/project.yml` `ignored_paths`:

```text
  - "ops/archive/ai-instructions-2026-10-24/**"
```

## Left for Chris

`ops/workflows/ad-scripts-2026-10-02.md` stayed live. These standing rules from that board are not in `RULES.md` Part 0. I did not add them.

1. **Ads never state a day count.** The /roadmap page refund says "within 7 days". Ads say "email us and we'll refund you" with no day count. This is not in Part 0. It is not in a live `.ai/rules` file. Archiving the board would drop this law.
2. **Never use "Not another ___, but..." openers.** Part 0 rule 13 bans "it's not X, it's Y". It does not name this opener.
3. **Never name the Social Security number in an ad.** Already live in `.ai/rules/no-ssn-before-checkout-step-3.md`. Missing from Part 0.
4. **Never write "funding gap".** Already live in `.ai/rules/outcome-first-copy.md`. Missing from Part 0.
5. **"Unlimited funding" stays.** Already live in `.ai/rules/outcome-first-copy.md`. Missing from Part 0.
6. **Never might, may, maybe, possibly, potentially, or up to.** Part 0 rule 19 only bans "could" and "could be worth". The rest is already live in `.ai/rules/copy-certainty.md`.

Not treated as missing: the board says never use "optimize" as a verb and say "fix your file". Part 0 rule 1 is newer (2026-10-05) and allows "optimize your credit".

## Pointers I did not fix

Other people own these files.

- `marketing/landing-pages/slo/SNEAK-PEEKS-FOR-CLAUDE.md` line 74 still names `docs/ads/slo-297-prompt-2026-09-18.md`.
- `marketing/MACHINE-GAPS.md` line 145 still names `ops/workflows/full-launch-lattice-2026-09-20.md`.
