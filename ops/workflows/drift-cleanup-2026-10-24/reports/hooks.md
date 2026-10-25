# Hook fixes (item 5)

Date: 2026-10-24. Branch `drift-cleanup`. No commit.

## The 8 items

| # | Fix | Result |
|---|---|---|
| 1 | `guard-rule-edits.mjs` treats `claude.md`, `agents.md`, `rules-index.md` in any letter case | pass |
| 2 | Same guard also protects the main checkout that owns a worktree (from that worktree's `.git` file and `commondir`, not a guessed path) | pass |
| 3 | `*** Update File:` lines are read only for `apply_patch`, not when a Write quotes them | pass |
| 4 | `check-ad-script.mjs` looks at `tool_name`, so a Read never answers block | pass |
| 5 | Self-test: `FUNDHUB_RULES_APPROVED=0` still asks. Same case is named in `src/hooks/hooks-selftest.test.mjs` | pass |
| 6 | `check-ad-script.mjs` skips `marketing/ads/scripts/2026-10-02.md` | pass |
| 7 | New hook `scripts/hooks/guard-env-masks.mjs`: denies a Netlify mask (8 or more stars) and `netlify env:list` / `env:get` output into `.env`, `.env.*`, or `credentials/`. Allows Read, a normal line, and `.env.example`. Wired in both settings files | pass |
| 8 | `scripts/hooks/wire.mjs` merges the hook set into `.claude/settings.json` and `.codex/hooks.json`. Second run printed `already wired`. Unrelated hooks (split reminder, intended-journey, Stop lint) stayed | pass |

## Files changed

- `.claude/hooks/guard-rule-edits.mjs` — items 1, 2, 3
- `.claude/hooks/check-ad-script.mjs` — items 4, 6
- `scripts/hooks/guard-env-masks.mjs` — new (item 7)
- `scripts/hooks/wire.mjs` — new (item 8)
- `scripts/hooks/selftest.mjs` — new cases for 1–8
- `src/hooks/hooks-selftest.test.mjs` — names the `FUNDHUB_RULES_APPROVED=0` case
- `.claude/settings.json` and `.codex/hooks.json` — `wire.mjs` added `guard-env-masks.mjs` once

## Self-test output (real)

`node scripts/hooks/wire.mjs` twice, then `node scripts/hooks/selftest.mjs`:

```
wired: .claude/settings.json
wired: .codex/hooks.json
already wired: .claude/settings.json
already wired: .codex/hooks.json
hooks self-test OK: 82 checks passed (session-rules, guard-rule-edits, check-ad-script, guard-env-masks)
```

`node --test src/hooks/hooks-selftest.test.mjs`:

```
TAP version 13
# Subtest: the AI hooks pass their self-test, including FUNDHUB_RULES_APPROVED=0 still asks
ok 1 - the AI hooks pass their self-test, including FUNDHUB_RULES_APPROVED=0 still asks
  ---
  duration_ms: 3375.379
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3422.031584
```

## Skipped

- Did not edit `PROGRESS.md`, `CLAUDE.md`, `AGENTS.md`, `.ai/rules/`, `.agents/skills/`, or `marketing/`.
- Did not edit `scripts/ship.mjs`, `scripts/ads/check-script.mjs`, or `marketing/ads/rules-data.mjs`.
- Did not commit.
