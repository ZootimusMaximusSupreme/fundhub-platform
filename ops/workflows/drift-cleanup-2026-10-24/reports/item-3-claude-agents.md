# Item 3 — short CLAUDE.md and AGENTS.md

Date: 2026-10-24. Branch: `drift-cleanup`.

## Line counts

- `CLAUDE.md`: 155 (cap 200)
- `AGENTS.md`: 52 (cap 70)

Every numbered heading from 0 to 12, including 3a, 3b, and 3c, is still there with the old heading text. The UI-STANDARDS law line is still in section 3.

## New rules

Each has front matter (`alwaysApply: true`, description with no colon) and two relative links.

- `.ai/rules/ground-rules.md` — §2, Owner decisions are final, section 3 steps, never-ask-permission, call 14
- `.ai/rules/everything-in-the-repo.md` — §3b
- `.ai/rules/marketing-tooling-from-chat.md` — §3c
- `.ai/rules/journey-documentation.md` — §4 plus call 16
- `.ai/rules/orchestration.md` — §5
- `.ai/rules/definition-of-done.md` — §6 plus call 23
- `.ai/rules/compliance-label-removed.md` — §7
- `.ai/rules/guardrails.md` — §8; stuck rule and scope-creep point at `finish-the-requested-job`; screenshots point at `audit-screenshot-markups` (call 45)
- `.ai/rules/task-report.md` — §9
- `.ai/rules/deployment-and-infrastructure.md` — §11 plus calls 1, 4, 5, 7, 24
- `.ai/rules/traps-in-this-repo.md` — §12

## Folds into existing rules

- §0 → `.ai/rules/split-and-proceed.md` (required-output list already there)
- §1 → `.ai/rules/model-by-job.md` plus call 48
- §3a → `.ai/rules/build-spec-then-backend-then-frontend.md`
- §10 plain language → `.ai/rules/fourth-grade-english.md`
- Agents run the work plus the iPhone check (call 21) → `.ai/rules/agents-run-ops-not-chris.md`
- Teleprompter checklist → `docs/rules/TELEPROMPTER-VIDEO.md`

## Pointers applied

Archived names are gone from CLAUDE.md and AGENTS.md. Live targets used: `rules-no-drift`, `three-step-repair`, `owner-go-no-repeat-approval`, `finish-the-requested-job`, `test-means-human-click`, `secrets-env-law`, `chris-never-clickfunnels`, `animation-overlay-on-spoken-words`, `protected-present-flow`, `no-claude-in-cursor`, `no-test-data-on-production`.

Call 51 standing line kept. Call 52 Present flow points at `protected-present-flow`.

## Cut text not copied into a rule

`ops/archive/ai-instructions-2026-10-24/removed-lines/CLAUDE.md.md`: Monday deadline, pulse-registry paragraph, Grok overseer sentence.

## Sentences I could not place

None. Every other cut sentence is in the rule file CLAUDE.md now points at.
