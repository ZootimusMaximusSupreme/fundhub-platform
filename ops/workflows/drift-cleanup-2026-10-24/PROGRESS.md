# Progress (update after every commit)

Branch `drift-cleanup`. Tick a box only after its check passes. If you stop, say which box is next. Details for each item: `REMAINING.md`.

## Items 1 and 2: apply the 50 calls, merge duplicates, archive stale (do them together, file by file)

- [ ] Agent-work rules (29): fourth-grade-english, ux-guidance-urls-first, one-step-adhd, finish-the-answer, texting-hours, fundhub-company-name, stop-asking-follow-the-rules, no-remote-control, split-and-proceed, owner-go-no-repeat-approval, finish-the-requested-job, approved-launch-release-blockers (archive), owner-authorized-account-ops, owner-scope-minimal-diff, no-extra-holes, one-issue-per-thread, three-step-repair, named-fix-regression-gate, audit-vs-fix-router, build-spec-then-backend-then-frontend, model-by-job, rules-for-claude-and-cursor, rules-no-drift, no-claude-in-cursor, grok-no-displays, grok-lattice-overseer-perpetual (archive), dictator-owner-overrides, owner-calls-settled, no-api-spend-for-now
- [ ] Proof and heartbeat rules (17) and the NEW rule no-test-data-on-production: live-playwright-100-before-manual, test-means-human-click, full-end-to-end-audit, agentic-audit-guardrails, audit-screenshot-markups, sim-assume-paid, sample-clients-consistent, verify-scratch-only, redundancy-before-ui-polish, heartbeat-on-every-build, pulse-registry (archive), monday-100-percent (archive), product-is-live, features-stay-on, commas-catalog-hands-off, ghl-blacklisted, clarity-export-rate-limit
- [ ] Secrets, git and ClickFunnels rules (12): secrets-env-law, show-secrets-when-chris-asks, env-full-copies-never-masked, agents-run-ops-not-chris, github-push, github-ships-main, repo-hygiene-vc-router, ui-standards (archive), clickfunnels-html-api-push, chris-never-clickfunnels, clickfunnels-developers-docs, chris-never-submagic
- [ ] Copy, video and animation rules (21): copy-certainty, ad-no-recycled-lines, ad-second-line, ad-watch-curve, ad-naming, proof-cards-from-source, page-edits-marked-draft, outcome-first-copy, no-ssn-before-checkout-step-3, funding-sequence-term, video-4k-unless-ad, ad-video-best-of-clips, ad-sound-level, slo-one-filmed-folder, teleprompter-speed, teleprompter-camera, animation-overlay-on-spoken-words, animation-ad-style, animation-no-echo, animation-logo-only-on-fundhub, animation-builders-opus-placers-sonnet
- [ ] Skills for build, audit and repo (10): fundhub-auditor, fundhub-ui-auditor, fundhub-perf-auditor, fundhub-agent-tester, fundhub-system-map, fundhub-fixer, fundhub-builder, fundhub-orchestrator, fundhub-version-control, fundhub-repo-hygiene
- [ ] Skills for ads, video, testimonials and ClickFunnels (6): fundhub-ad-writer, fundhub-ad-editor, fundhub-video-animation-overlay, fundhub-testimonial-thumbnails, fundhub-clickfunnels-html-push, clickfunnels-developers-docs
- [ ] Marketing books: RULES.md, VOICE.md, RECIPES.md, ASSET-BANK.md, ANGLE-GENERATOR.md, SECOND-LINE.md, NAMING.md, watch-curve.md, WRITE-ADS-FROM-HERE.md, notes-green-screen.md, video-pipeline-plan.md, slo/SLO-CHAT-PROMPT.md, reference/locked-ads-2026-09.md, ascension, COPY-DIRECTIVES.md, CHECKOUT-FOR-CLAUDE.md, CHRIS-DO-THIS-FIRST.md
- [ ] Docs and ops notes: RUNBOOK.md, docs/sops/README.md, postgres-least-privilege.md banner, README.md, specs W1 W3 W4 W6 W7, TELEPROMPTER-VIDEO.md, journeys/ad-video-flow.md line 265, animation-builds board line 5, pulse-layer brief 04 line 65
- [ ] Archive these boards and files: ops/workflows/codex-build-claude-test-2026-10-13.md, ops/workflows/ad-scripts-2026-10-02.md (first check each standing rule in it is in RULES.md Part 0), marketing/ads/slo/slo-297-prompt-2026-09-18.md (only if no code reads it), plus the "Archive whole files" list in plans/stale-plan.md
- [ ] Stale lines removed and archived (44, plans/stale-plan.md) and dead references fixed
- [ ] `node scripts/rules-drift-check.mjs` read; pointer failures to archived rules fixed

## Item 3: short CLAUDE.md and AGENTS.md

- [ ] New rule files created from CLAUDE.md sections (ground-rules, everything-in-the-repo, marketing-tooling-from-chat, journey-documentation, orchestration, definition-of-done, compliance-label-removed, guardrails, task-report, deployment-and-infrastructure, traps-in-this-repo), each with two links
- [ ] Folds done: section 0 into split-and-proceed, section 1 into model-by-job, section 3a into build-spec-then-backend-then-frontend, plain-language part of section 10 into fourth-grade-english, teleprompter checklist into TELEPROMPTER-VIDEO.md
- [ ] Calls that live in CLAUDE.md sections applied (1, 4, 5, 7, 12, 13, 14, 16, 21, 23, 24, 45, 48)
- [ ] CLAUDE.md is a short index (about 150 lines, cap 200), headings 0 to 12 kept, UI-STANDARDS line kept
- [ ] AGENTS.md is under 70 lines

## Item 4: checker, index, ignore lists

- [ ] scripts/rules-drift-check.mjs and src/rules/rules-drift-check.test.mjs updated (claudemd check replaced, size caps)
- [ ] docs/rules/RULES-INDEX.md updated (new rules, archived rules, call 42 wording, "Archived on 2026-10-24")
- [ ] ops/archive/ai-instructions-2026-10-24/ added to .ignore, .cursorindexingignore, .serena/project.yml

## Item 5: hook fixes

- [ ] 1 guard case-blind names
- [ ] 2 guard the main checkout from a worktree
- [ ] 3 apply_patch text only for apply_patch
- [ ] 4 check-ad-script looks at tool_name
- [ ] 5 self-test: FUNDHUB_RULES_APPROVED=0 still asks
- [ ] 6 check-ad-script skips 2026-10-02.md
- [ ] 7 new hook guard-env-masks.mjs, with self-test cases, wired
- [ ] 8 scripts/hooks/wire.mjs (idempotent)

## Final

- [ ] Every check in the starter prompt run and the real output pasted
- [ ] PR description updated with what changed

## Left for Chris

(empty)
