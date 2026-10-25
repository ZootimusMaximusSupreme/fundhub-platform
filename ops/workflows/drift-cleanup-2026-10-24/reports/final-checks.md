# Final checks — 2026-10-24

Branch: `drift-cleanup` (`git branch --show-current` printed `drift-cleanup`).
Workdir: `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/drift-cleanup`.
Did not push. Did not edit `phase-3-decisions.md`. Did not reset. Did not `git add -A`.
No instruction-file fix was needed. No commit.

`git status` after the seven commands (looked up, not one of the seven): on `drift-cleanup`, ahead of `origin/drift-cleanup` by 9 commits, working tree clean. Writing this file is the only later change.

## 1. `node scripts/rules-drift-check.mjs`

**PASS** (exit 0)

```text
rules:check OK — no drift.
```

## 2. `node --test src/rules/rules-drift-check.test.mjs src/hooks/hooks-selftest.test.mjs src/pulse/heartbeat-law.test.mjs src/ui/screen-standard.test.mjs src/http/monitoring.test.mjs src/marketing/api-contract.test.mjs src/ad-videos/merge-takes.test.mjs`

**PASS** (exit 0). Full TAP was 1447 lines. Tail and summary:

```text
ok 53 - every CRM screen uses the same frame (UI-STANDARDS §12, owner-set 2026-08-30)
  ---
  duration_ms: 99.35875
  type: 'suite'
  ...
1..53
# tests 222
# suites 15
# pass 222
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3077.967583
```

No failure names. 222 pass, 0 fail.

## 3. `node scripts/lint.mjs`

**PASS** (exit 0)

```text
lint: 4305 file(s) and inline script(s) parse clean
```

## 4. `node scripts/hooks/selftest.mjs`

**PASS** (exit 0). Item 5 hook fixes were already done. Did not redo them.

```text
hooks self-test OK: 82 checks passed (session-rules, guard-rule-edits, check-ad-script, guard-env-masks)
```

## 5. `find .ai .cursor .claude .agents -xtype l`

**FAIL** (exit 1). macOS `find` does not have `-xtype`. Real output:

```text
find: -xtype: unknown primary or operator
```

Follow-up (not the named command): `find .ai .cursor .claude .agents -type l ! -exec test -e {} \; -print` exited 0 and printed nothing. No broken links under `.ai`, `.cursor`, `.claude`, or `.agents`.

## 6. `wc -l CLAUDE.md AGENTS.md`

**PASS** (exit 0). CLAUDE.md is 155 lines (under the 200 cap). AGENTS.md is 52 lines (under the 70 cap).

```text
     155 CLAUDE.md
      52 AGENTS.md
     207 total
```

## 7. `git status --short | head -30`

**PASS** (exit 0). Printed nothing. Working tree was clean when this ran.

```text
```

## Empty PROGRESS boxes

From `ops/workflows/drift-cleanup-2026-10-24/PROGRESS.md`. Only one box is ticked: "Archive these boards and files…". Every other box is empty:

- Agent-work rules (29): fourth-grade-english, ux-guidance-urls-first, one-step-adhd, finish-the-answer, texting-hours, fundhub-company-name, stop-asking-follow-the-rules, no-remote-control, split-and-proceed, owner-go-no-repeat-approval, finish-the-requested-job, approved-launch-release-blockers (archive), owner-authorized-account-ops, owner-scope-minimal-diff, no-extra-holes, one-issue-per-thread, three-step-repair, named-fix-regression-gate, audit-vs-fix-router, build-spec-then-backend-then-frontend, model-by-job, rules-for-claude-and-cursor, rules-no-drift, no-claude-in-cursor, grok-no-displays, grok-lattice-overseer-perpetual (archive), dictator-owner-overrides, owner-calls-settled, no-api-spend-for-now
- Proof and heartbeat rules (17) and the NEW rule no-test-data-on-production: live-playwright-100-before-manual, test-means-human-click, full-end-to-end-audit, agentic-audit-guardrails, audit-screenshot-markups, sim-assume-paid, sample-clients-consistent, verify-scratch-only, protected-present-flow, redundancy-before-ui-polish (archive), heartbeat-on-every-build, pulse-registry (archive), monday-100-percent (archive), product-is-live, features-stay-on, commas-catalog-hands-off, ghl-blacklisted, clarity-export-rate-limit
- Secrets, git and ClickFunnels rules (12): secrets-env-law, show-secrets-when-chris-asks, env-full-copies-never-masked, agents-run-ops-not-chris, github-push, github-ships-main, repo-hygiene-vc-router, ui-standards (archive), clickfunnels-html-api-push, chris-never-clickfunnels, clickfunnels-developers-docs, chris-never-submagic
- Copy, video and animation rules (21): copy-certainty, ad-no-recycled-lines, ad-second-line, ad-watch-curve, ad-naming, proof-cards-from-source, page-edits-marked-draft, outcome-first-copy, no-ssn-before-checkout-step-3, funding-sequence-term, video-4k-unless-ad, ad-video-best-of-clips, ad-sound-level, slo-one-filmed-folder, teleprompter-speed, teleprompter-camera, animation-overlay-on-spoken-words, animation-ad-style, animation-no-echo, animation-logo-only-on-fundhub, animation-builders-opus-placers-sonnet
- Skills for build, audit and repo (10): fundhub-auditor, fundhub-ui-auditor, fundhub-perf-auditor, fundhub-agent-tester, fundhub-system-map, fundhub-fixer, fundhub-builder, fundhub-orchestrator, fundhub-version-control, fundhub-repo-hygiene
- Skills for ads, video, testimonials and ClickFunnels (6): fundhub-ad-writer, fundhub-ad-editor, fundhub-video-animation-overlay, fundhub-testimonial-thumbnails, fundhub-clickfunnels-html-push, clickfunnels-developers-docs
- Marketing books: RULES.md, VOICE.md, RECIPES.md, ASSET-BANK.md, ANGLE-GENERATOR.md, SECOND-LINE.md, NAMING.md, watch-curve.md, WRITE-ADS-FROM-HERE.md, notes-green-screen.md, video-pipeline-plan.md, slo/SLO-CHAT-PROMPT.md, reference/locked-ads-2026-09.md, ascension, COPY-DIRECTIVES.md, CHECKOUT-FOR-CLAUDE.md, CHRIS-DO-THIS-FIRST.md
- Docs and ops notes: RUNBOOK.md, docs/sops/README.md, postgres-least-privilege.md banner, README.md, specs W1 W3 W4 W6 W7, TELEPROMPTER-VIDEO.md, journeys/ad-video-flow.md line 265, animation-builds board line 5, pulse-layer brief 04 line 65
- Stale lines removed and archived (44, plans/stale-plan.md) and dead references fixed
- `node scripts/rules-drift-check.mjs` read; pointer failures to archived rules fixed
- New rule files created from CLAUDE.md sections (ground-rules, everything-in-the-repo, marketing-tooling-from-chat, journey-documentation, orchestration, definition-of-done, compliance-label-removed, guardrails, task-report, deployment-and-infrastructure, traps-in-this-repo), each with two links
- Folds done: section 0 into split-and-proceed, section 1 into model-by-job, section 3a into build-spec-then-backend-then-frontend, plain-language part of section 10 into fourth-grade-english, teleprompter checklist into TELEPROMPTER-VIDEO.md
- Calls that live in CLAUDE.md sections applied (1, 4, 5, 7, 12, 13, 14, 16, 21, 23, 24, 45, 48)
- CLAUDE.md is a short index (about 150 lines, cap 200), headings 0 to 12 kept, UI-STANDARDS line kept
- AGENTS.md is under 70 lines
- scripts/rules-drift-check.mjs and src/rules/rules-drift-check.test.mjs updated (claudemd check replaced, size caps)
- docs/rules/RULES-INDEX.md updated (new rules, archived rules, call 42 wording, "Archived on 2026-10-24")
- ops/archive/ai-instructions-2026-10-24/ added to .ignore, .cursorindexingignore, .serena/project.yml
- 1 guard case-blind names
- 2 guard the main checkout from a worktree
- 3 apply_patch text only for apply_patch
- 4 check-ad-script looks at tool_name
- 5 self-test: FUNDHUB_RULES_APPROVED=0 still asks
- 6 check-ad-script skips 2026-10-02.md
- 7 new hook guard-env-masks.mjs, with self-test cases, wired
- 8 scripts/hooks/wire.mjs (idempotent)
- Every check in the starter prompt run and the real output pasted
- PR description updated with what changed

## Left for Chris

From PROGRESS.md:

- Two code comments still name the old pulse-registry rule: `src/pulse/registry.mjs` line 5 and `src/pulse/machine.mjs` line 10. This cleanup does not edit app code. They should point at `heartbeat-on-every-build` when a code change is allowed.
- The comment in `db/migrations/407_ad_number_from_meta.sql` still names the old ad-scripts board path. This cleanup does not edit db/. Leave the migration as it is.
