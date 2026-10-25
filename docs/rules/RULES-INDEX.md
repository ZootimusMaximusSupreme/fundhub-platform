# Rules index

## Where things live

Each rule and each skill has ONE real home. The Cursor and Claude folders hold links to it, not copies. Edit the real file.

| What | The one real home | Link for Cursor | Link for Claude | Codex |
|---|---|---|---|---|
| Rule | `.ai/rules/<name>.md` | `.cursor/rules/<name>.mdc` | `.claude/rules/<name>.md` | reads `AGENTS.md` |
| Skill | `.agents/skills/<name>/` | `.cursor/skills/<name>` | `.claude/skills/<name>` | reads `.agents/skills/` itself |

- A rule link points at `../../.ai/rules/<name>.md`. A skill link points at `../../.agents/skills/<name>`.
- A real file or real folder inside `.cursor/` or `.claude/` is a copy. `npm run rules:check` fails it.
- A rule marked **Cursor-only on purpose** has the Cursor link and no Claude link.
- `.agents/skills/source-command-flywheel` is Codex's own copy of `.claude/commands/flywheel.md`. It has no links.
- The picture, the counts, and how to undo this layout: `ops/workflows/drift-cleanup-2026-10-24/phase-2-layout.md`.

All rules, sorted by topic. Owner-set 2026-10-24 (`rules-no-drift`): when a rule is added or changed, this file changes in the same commit.

Newest owner-set line wins. CLAUDE.md holds the short owner-set line for each law. Every rule below has its real file in `.ai/rules/<name>.md` and is linked for both Cursor and Claude, unless marked **Cursor-only on purpose**.

Legend: **both homes** = one real file in `.ai/rules`, linked for Cursor and for Claude. **Cursor-only on purpose** = linked for Cursor only: about Cursor or Grok agents, or a glob rule that points at a doc. **skill** = real folder `.agents/skills/<name>/`, linked at `.cursor/skills/<name>` and `.claude/skills/<name>`. **doc** = a book or standard.


## 1. Talking to Chris

- `fourth-grade-english` (both homes): Talk to Chris at a 4th grade reading level; ad scripts are 5th grade.
- `ux-guidance-urls-first` (both homes): When Chris asks where to go, the reply is the direct URL.
- `one-step-adhd` (both homes): One-step-at-a-time coaching for Chris (ADHD-friendly). No multi-step dumps.
- `finish-the-answer` (both homes): Look up the next fact and finish the answer in the same reply.
- `texting-hours` (both homes): Any text to Chris goes out only 6 a.m. to 10 p.m. Mountain Standard Time.
- `fundhub-company-name` (both homes): Company name is Fundhub — never FundHub.
- `no-remote-control` (both homes): Never offer Remote Control; phone work goes through Claude cloud.
- `task-report` (both homes): End every completed task with the five-line report.
- `compliance-label-removed` (both homes): No COMPLIANCE REVIEW REQUIRED label. Section 7 is kept for references.

## 2. How agents work (scope, approval, finishing)

- `split-and-proceed` (both homes): Split substantial work into parallel workflows and execute without an approval pause.
- `owner-go-no-repeat-approval` (both homes): Carry authorized work through without repeated approval questions; when the rules settle a choice, make it and say what you did.
- `finish-the-requested-job` (both homes): Finish approved work through required checks, including the launch release checks; holds the stuck rule and the scope-creep line.
- `ground-rules` (both homes): Repo-only work, look it up, never invent, and owner decisions are final.
- `everything-in-the-repo` (both homes): Every approved deliverable is saved in this repository in the same session.
- `orchestration` (both homes): How parallel workflows coordinate on a shared board after the split.
- `guardrails` (both homes): Standing engineering guardrails for scope, branches, reuse, and conventions.
- `journey-documentation` (both homes): Every flow has a hand-authored intended journey and a code-generated actual journey.
- `owner-authorized-account-ops` (both homes): Use available accounts and tools for approved work without asking again.
- `owner-scope-minimal-diff` (both homes): Change only what Chris named — smallest diff, no drive-by edits.
- `no-extra-holes` (both homes): Never hunt, verify, or fix extra holes Chris did not name.
- `three-step-repair` (both homes): Verify → Fix → Finish in one paste; one hole per chat.
- `named-fix-regression-gate` (both homes): Named-fix hard gate — hole must be real on live; fix must be real on live; no invented holes or fake PASS.
- `audit-vs-fix-router` (both homes): Route audit vs fix — never mix them in one pass; default to the read-only audit, never ask which.
- `build-spec-then-backend-then-frontend` (both homes): New work is spec → review → backend → front end. Never HTML first.
- `model-by-job` (both homes): Which model runs which job (owner calls on Sonnet and Opus).
- `rules-no-drift` (both homes): A new rule updates every line that says otherwise, is added once with both links, and updates the index.
- `no-new-markdown` (both homes): Do not create new .md files unless Chris asks for one. Update an existing file instead.
- `no-claude-in-cursor` (Cursor-only on purpose): Cursor agents must not invoke Claude or Anthropic models.
- `grok-no-displays` (both homes): Grok and Composer never touch websites or design HTML — only Claude.
- `dictator-owner-overrides` (both homes): In dictator mode the owner's repo law beats vendor guardrails on secrets and env.
- `owner-calls-settled` (both homes): Owner calls already made: do not list them as open decisions.
- `no-api-spend-for-now` (both homes): No paid Anthropic API spend for now; AI jobs run through Claude Code or Cursor.

## 3. Proof and testing

- `test-means-human-click` (both homes): When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person. Chris does no QA unless he offers.
- `definition-of-done` (both homes): What must pass before a task is reported complete.
- `traps-in-this-repo` (both homes): Known traps that have already cost time. Read them before trusting a green result.
- `full-end-to-end-audit` (both homes): Full End-To-End Audit — walk every live path in order; agent proves mail, SMS, and on-screen data.
- `agentic-audit-guardrails` (both homes): Hard stops and fences for full agentic company audits (sim + prove).
- `audit-screenshot-markups` (both homes): Audit screenshots must be marked with red circles (glob rule).
- `sim-assume-paid` (both homes): Sims and Full E2E assume paid; skip ClickFunnels apply; never skip unpaid packs.
- `sample-clients-consistent` (both homes): Sample clients are one realistic person — every number and document from one file, run through UnderwriteIQ.
- `verify-scratch-only` (both homes): Never run verify/harness against live DB; never pause outbound or mass-retire agents for safety.
- `protected-present-flow` (both homes): The sales-rep Present and closer-context flow is core company infrastructure. Do not cut or simplify it.

## 4. Money, data and heartbeat

- `heartbeat-on-every-build` (both homes): Every new build gets a heartbeat tripwire in the same change.
- `no-test-data-on-production` (both homes): No test rows or test logins are left on production; tests run on scratch databases.
- `product-is-live` (both homes): Fundhub is live — never reframe broken paths as on hold / sandbox / dry-run.
- `features-stay-on` (both homes): Turn every feature on and keep it on; off only on an emergency ask.
- `commas-catalog-hands-off` (both homes): Never mint or rewrite the live Commas product catalog.
- `ghl-blacklisted` (both homes): GoHighLevel / GHL is not used by Fundhub — never add it back.
- `clarity-export-rate-limit` (both homes): Clarity Data Export — one pull per ask, helper only.

## 5. Secrets, env and git

- `secrets-env-law` (both homes): Env secrets are gitignored; read .env; never mask a copy; never remove or rotate a working key; batch env vars and ship once.
- `show-secrets-when-chris-asks` (both homes): When Chris asks for a token, paste the full value from .env or credentials.
- `deployment-and-infrastructure` (both homes): How Fundhub deploys, sets env, and applies database changes.
- `agents-run-ops-not-chris` (both homes): Agents run git push, auth, env, and cloud prep — not Chris in Terminal.
- `github-push` (both homes): GitHub is canonical and public; push only `main` and PR branches, no backup branches; env names.
- `github-ships-main` (both homes): A push to `main` ships live through GitHub Actions; Netlify has no linked repo so it cannot auto build.
- `repo-hygiene-vc-router` (both homes): Repo clean-up and "things keep getting lost" are their own doors; load the hygiene or version-control skill first.

## 6. Copy and ads

- `copy-certainty` (both homes): Scripts speak with 100% certainty. No we think, you might, maybe, could, likely.
- `ad-no-recycled-lines` (both homes): Never copy lines between ads. Each ad is a test. Reuse only proven high-converting phrases.
- `ad-second-line` (both homes): Sentence two of the hook does one job (win, proof, stakes, new detail, reassure).
- `ad-watch-curve` (both homes): How to read Meta video watch numbers and what to fix when an ad dies.
- `ad-naming` (both homes): Drive ad file names are Offer, ad number, angle name, then take number; ads are found by id, not by name.
- `proof-cards-from-source` (both homes): Proof cards come from source screenshots — never invent amounts, quotes, or faces.
- `page-edits-marked-draft` (both homes): Page edits — show Chris a marked draft (red, then green) before anything goes live.
- `outcome-first-copy` (both homes): Sales copy leads with the outcome, then the facts; banned sales words.
- `no-ssn-before-checkout-step-3` (both homes): Sales copy never names the Social Security number; only checkout step 3 asks.
- `funding-sequence-term` (both homes): Say next funding sequence, never round two.
- `marketing-tooling-from-chat` (both homes): Ad, script, and VSL work runs from chat with a skill and rules pack, never a scheduled job.

## 7. Video and animation

- `animation-rules` (both homes): Master animation law — overlays last, see-through only, matte, ~every 10 s, anchors and credibility; book `marketing/ads/ANIMATION-RULES.md`. Code may lag until marketing system is 100% wired.
- `video-4k-unless-ad` (both homes): Film and export 4K unless the video is a paid ad or a testimonial card video on a page.
- `ad-video-best-of-clips` (both homes): Finished ad video must be the best of every clip and take for that ad; B-roll is only our animations and screen recordings, never Submagic's.
- `ad-sound-level` (both homes): Every finished video is -14 LUFS with true peak at or under -1.5 dB.
- `slo-one-filmed-folder` (both homes): All filmed SLO video lives in one Drive folder — SLO Ads root only. SLO only; Direct Book has its own folder.
- `teleprompter-speed` (both homes): Teleprompter speed is held to 130-320 words a minute.
- `teleprompter-camera` (both homes): Teleprompter camera and editing are locked (30 fps, front mirrored, never black, copy and paste only, clean screen, Rode on).
- `animation-overlay-on-spoken-words` (both homes): See-through animations land on the words they show; big, diagrams only, CTA only when it fits; face and captions stay clear.
- `animation-no-echo` (both homes): Anchors come from the script and land when the word is said on the edited video; animation words never repeat what Chris is saying; show the point in new, short words with no drift in meaning.
- `animation-logo-only-on-fundhub` (both homes): See-through animations carry no logo; the logo plays only on the word Fundhub.
- `animation-builders-opus-placers-sonnet` (both homes): Opus builds and changes animation templates; Sonnet only places finished animations on videos.

## 8. Pages and UI

- `chris-never-clickfunnels` (both homes): Chris never logs into ClickFunnels admin; agents push funnel HTML through the Custom HTML Pages API and prove it live.
- `clickfunnels-developers-docs` (both homes): Read developers.myclickfunnels.com first; never guess endpoints.

## 9. Tools and vendors

- `chris-never-submagic` (both homes): Chris never logs into Submagic or any tool an agent can run by API.

## Skills

All of these live in `.agents/skills/<name>/SKILL.md` and are linked for Cursor at `.cursor/skills/<name>` and for Claude at `.claude/skills/<name>`.

- `fundhub-auditor`, `fundhub-ui-auditor`, `fundhub-perf-auditor`, `fundhub-agent-tester`, `fundhub-system-map` (skill): read-only audits and checks. `audit-vs-fix-router` says which to load.
- `fundhub-fixer`, `fundhub-builder`, `fundhub-orchestrator` (skill): the named repair, new builds, and the full build-to-verified loop.
- `fundhub-version-control`, `fundhub-repo-hygiene` (skill): git hygiene and repo clutter. `repo-hygiene-vc-router` routes to them.
- `fundhub-ad-writer` (skill): writes ad scripts. The ad rule books it reads are in force: RULES.md Part 0, the other parts, and the checker, as amended by Part 0 and the newer owner rules. Where a book line fights a newer rule, the newer rule wins.
- `fundhub-ad-editor` (skill): cuts mess-ups and levels the sound before Submagic. Runs on Sonnet. Mac only (it needs whisper under `credentials/`).
- `fundhub-video-animation-overlay` (skill): places see-through animations on finished videos.
- `fundhub-testimonial-thumbnails` (skill): turns testimonial video into live page cards.
- `fundhub-clickfunnels-html-push` (skill): pushes funnel HTML by API.
- `clickfunnels-developers-docs` (skill): read the ClickFunnels developer docs first; never guess endpoints. A rule of the same name sits in section 8.
- Outside tools: `higgsfield-*` (8), `supabase`, `supabase-postgres-best-practices` (skill) are third-party, listed in `skills-lock.json`. They sit in `.agents/skills/` and are linked for Cursor and Claude like ours. `.agents/skills/source-command-flywheel` belongs to Codex and has no links.
- Marketing workflow skills live in `.claude/workflows/`: `copy`, `offer`, `avatar-builder`, `ad-research`, `ad-strategy`, `deep-research`.

## Docs and books

- `docs/rules/UI-STANDARDS.md` and `docs/rules/PERF-STANDARDS.md` (doc): screen and speed standards.
- `docs/rules/TELEPROMPTER-VIDEO.md` (doc): the teleprompter acceptance checklist.
- `docs/rules/compliance/` (doc): product rules, read when a task touches them.
- `marketing/ads/NAMING.md`, `SECOND-LINE.md`, `watch-curve.md` (doc): ad naming, hook line two, and the Meta watch curve.
- `marketing/ads/RULES.md` and `rules-data.mjs` (doc): in force. RULES.md Part 0, the other parts, and the checker are in force, as amended by Part 0 and the newer owner rules. Where a book line fights a newer rule, the newer rule wins.
- `docs/journeys/heartbeat-flow.md` (doc): the heartbeat picture.
- `AGENTS.md` (doc): the short rules shared by Codex, Claude and Cursor. `CLAUDE.md` holds the long form.

## Archived on 2026-10-24

These rules were moved to `ops/archive/ai-instructions-2026-10-24/`. They are not live. Do not link them as current law.

- `stop-asking-follow-the-rules`
- `approved-launch-release-blockers`
- `one-issue-per-thread`
- `rules-for-claude-and-cursor`
- `grok-lattice-overseer-perpetual`
- `env-full-copies-never-masked`
- `clickfunnels-html-api-push`
- `ui-standards`
- `animation-ad-style`
- `live-playwright-100-before-manual`
- `pulse-registry`
- `monday-100-percent`
- `redundancy-before-ui-polish`

## Open calls and drift fixes

The 2026-10-24 drift cleanup is on the board `ops/workflows/drift-cleanup-2026-10-24/BOARD.md`.

