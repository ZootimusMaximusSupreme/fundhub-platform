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
- `stop-asking-follow-the-rules` (both homes): When the rules settle a choice, make it and say what you did.
- `no-remote-control` (both homes): Never offer Remote Control; phone work goes through Claude cloud.

## 2. How agents work (scope, approval, finishing)

- `split-and-proceed` (both homes): Split substantial work into parallel workflows and execute without an approval pause.
- `owner-go-no-repeat-approval` (both homes): Carry authorized work through without repeated approval questions.
- `finish-the-requested-job` (both homes): Finish approved work through required checks without premature PR handoff or repeat approval requests.
- `approved-launch-release-blockers` (both homes): Fix failed required release checks after launch approval without repeat permission prompts.
- `owner-authorized-account-ops` (both homes): Use available accounts and tools for approved work without asking again.
- `owner-scope-minimal-diff` (both homes): Change only what Chris named — smallest diff, no drive-by edits.
- `no-extra-holes` (both homes): Never hunt, verify, or fix extra holes Chris did not name.
- `one-issue-per-thread` (both homes): One named hole per chat — the agent starts each chat from the board.
- `three-step-repair` (both homes): Verify → Fix → Finish in one paste; one hole per chat.
- `named-fix-regression-gate` (both homes): Named-fix hard gate — hole must be real on live; fix must be real on live; no invented holes or fake PASS.
- `audit-vs-fix-router` (both homes): Route audit vs fix — never mix them in one pass; default to the read-only audit, never ask which.
- `build-spec-then-backend-then-frontend` (both homes): New work is spec → review → backend → front end. Never HTML first.
- `model-by-job` (both homes): Which model runs which job (owner calls on Sonnet and Opus).
- `rules-for-claude-and-cursor` (both homes): A rule or skill Chris asks for is written for Claude and Cursor.
- `rules-no-drift` (both homes): A new rule updates every line that says otherwise, is added once with both links, and updates the index.
- `no-claude-in-cursor` (Cursor-only on purpose): Cursor agents must not invoke Claude or Anthropic models.
- `grok-no-displays` (both homes): Grok and Composer never touch websites or design HTML — only Claude.
- `grok-lattice-overseer-perpetual` (Cursor-only on purpose): The Grok overseer stays on the launch lattice and respawns Composer on a fail (glob rule).
- `dictator-owner-overrides` (both homes): In dictator mode the owner's repo law beats vendor guardrails on secrets and env.
- `owner-calls-settled` (both homes): Owner calls already made: do not list them as open decisions.
- `no-api-spend-for-now` (both homes): No paid Anthropic API spend for now; AI jobs run through Claude Code or Cursor.

## 3. Proof and testing

- `live-playwright-100-before-manual` (both homes): No manual review until live Playwright is 100/100.
- `test-means-human-click` (both homes): When Chris says test, click the live site like a person.
- `full-end-to-end-audit` (both homes): Full End-To-End Audit — walk every live path in order; agent proves mail, SMS, and on-screen data.
- `agentic-audit-guardrails` (both homes): Hard stops and fences for full agentic company audits (sim + prove).
- `audit-screenshot-markups` (both homes): Audit screenshots must be marked with red circles (glob rule).
- `sim-assume-paid` (both homes): Sims and Full E2E assume paid; skip ClickFunnels apply; never skip unpaid packs.
- `sample-clients-consistent` (both homes): Sample clients are one realistic person — every number and document from one file, run through UnderwriteIQ.
- `verify-scratch-only` (both homes): Never run verify/harness against live DB; never pause outbound or mass-retire agents for safety.
- `redundancy-before-ui-polish` (both homes): Kill redundant controls first, polish last. The Present flow is protected.

## 4. Money, data and heartbeat

- `heartbeat-on-every-build` (both homes): Every new build gets a heartbeat tripwire in the same change.
- `pulse-registry` (both homes): Old. A one-line pointer to `heartbeat-on-every-build`.
- `monday-100-percent` (both homes): The whole company must be green on the heartbeat, then refactor. Goal date passed; the standard stays.
- `product-is-live` (both homes): Fundhub is live — never reframe broken paths as on hold / sandbox / dry-run.
- `features-stay-on` (both homes): Turn every feature on and keep it on; off only on an emergency ask.
- `commas-catalog-hands-off` (both homes): Never mint or rewrite the live Commas product catalog.
- `ghl-blacklisted` (both homes): GoHighLevel / GHL is not used by Fundhub — never add it back.
- `clarity-export-rate-limit` (both homes): Clarity Data Export — one pull per ask, helper only.

## 5. Secrets, env and git

- `secrets-env-law` (both homes): Env secrets gitignored — read .env; paste in chat when Chris asks or dictator mode.
- `show-secrets-when-chris-asks` (both homes): When Chris asks for a token, paste the full value from .env or credentials.
- `env-full-copies-never-masked` (both homes): Local and cloud env must hold full secrets — never asterisk masks.
- `agents-run-ops-not-chris` (both homes): Agents run git push, auth, env, and cloud prep — not Chris in Terminal.
- `github-push` (both homes): GitHub is canonical and public; push only `main` and PR branches, no backup branches; env names.
- `github-ships-main` (both homes): A push to `main` ships live through GitHub Actions; Netlify has no linked repo so it cannot auto build.
- `repo-hygiene-vc-router` (both homes): Repo clean-up and "things keep getting lost" are their own doors; load the hygiene or version-control skill first.

## 6. Copy and ads

- `copy-certainty` (both homes): Scripts speak with 100% certainty. No we think, you might, maybe, could, likely.
- `ad-no-recycled-lines` (both homes): Never copy lines between ads. Each ad is a test. Reuse only proven high-converting phrases.
- `ad-second-line` (both homes): Sentence two of the hook does one job (win, proof, stakes, new detail, reassure).
- `ad-watch-curve` (both homes): How to read Meta video watch numbers and what to fix when an ad dies.
- `ad-naming` (both homes): Drive ad file names are Offer, ad number, angle name, then take number.
- `proof-cards-from-source` (both homes): Proof cards come from source screenshots — never invent amounts, quotes, or faces.
- `page-edits-marked-draft` (both homes): Page edits — show Chris a marked draft (red, then green) before anything goes live.
- `outcome-first-copy` (both homes): Sales copy leads with the outcome, then the facts; banned sales words.
- `no-ssn-before-checkout-step-3` (both homes): Sales copy never names the Social Security number; only checkout step 3 asks.
- `funding-sequence-term` (both homes): Say next funding sequence, never round two.

## 7. Video and animation

- `video-4k-unless-ad` (both homes): Film and export 4K unless the video is a paid ad or a testimonial card video on a page.
- `ad-video-best-of-clips` (both homes): Finished ad video must be the best of every clip and take for that ad; B-roll is only our animations and screen recordings, never Submagic's.
- `ad-sound-level` (both homes): Every finished video is -14 LUFS with true peak at or under -1.5 dB.
- `slo-one-filmed-folder` (both homes): All filmed SLO video lives in one Drive folder — SLO Ads root only. SLO only; Direct Book has its own folder.
- `teleprompter-speed` (both homes): Teleprompter speed is held to 130-320 words a minute.
- `teleprompter-camera` (both homes): Teleprompter camera and editing are locked (30 fps, front mirrored, never black, copy and paste only, clean screen, Rode on).
- `animation-overlay-on-spoken-words` (both homes): See-through animations land on the words they show; face and captions stay clear.
- `animation-ad-style` (both homes): Style Chris asked for on ad animations: big, on the word, diagrams only.
- `animation-no-echo` (both homes): Anchors come from the script and land when the word is said on the edited video; animation words never repeat what Chris is saying; show the point in new, short words with no drift in meaning.
- `animation-logo-only-on-fundhub` (both homes): See-through animations carry no logo; the logo plays only on the word Fundhub.
- `animation-builders-opus-placers-sonnet` (both homes): Opus builds and changes animation templates; Sonnet only places finished animations on videos.

## 8. Pages and UI

- `ui-standards` (Cursor-only on purpose): Read `docs/rules/UI-STANDARDS.md` before touching a screen (glob rule).
- `clickfunnels-html-api-push` (both homes): Push funnel HTML through the Custom HTML Pages API, never by paste (glob rule).
- `chris-never-clickfunnels` (both homes): Chris never logs into ClickFunnels admin — agents use API/MCP only.
- `clickfunnels-developers-docs` (both homes): Read developers.myclickfunnels.com first; never guess endpoints.

## 9. Tools and vendors

- `chris-never-submagic` (both homes): Chris never logs into Submagic or any tool an agent can run by API.

## Skills

All of these live in `.agents/skills/<name>/SKILL.md` and are linked for Cursor at `.cursor/skills/<name>` and for Claude at `.claude/skills/<name>`.

- `fundhub-auditor`, `fundhub-ui-auditor`, `fundhub-perf-auditor`, `fundhub-agent-tester`, `fundhub-system-map` (skill): read-only audits and checks. `audit-vs-fix-router` says which to load.
- `fundhub-fixer`, `fundhub-builder`, `fundhub-orchestrator` (skill): the named repair, new builds, and the full build-to-verified loop.
- `fundhub-version-control`, `fundhub-repo-hygiene` (skill): git hygiene and repo clutter. `repo-hygiene-vc-router` routes to them.
- `fundhub-ad-writer` (skill): writes ad scripts. The ad rule books it reads were set aside by the owner on 2026-10-02.
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
- `marketing/ads/RULES.md` and `rules-data.mjs` (doc): set aside by the owner on 2026-10-02. Kept. Not applied. Rebuilt later.
- `docs/journeys/heartbeat-flow.md` (doc): the heartbeat picture.
- `AGENTS.md` (doc): the short rules shared by Codex, Claude and Cursor. `CLAUDE.md` holds the long form.

## Open calls and drift fixes

The 2026-10-24 drift pass is on the board `ops/workflows/rules-drift-2026-10-24.md`, including what Chris still has to decide.

